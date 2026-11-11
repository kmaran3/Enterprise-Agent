import * as fs from "fs";
import * as path from "path";
import { ChatOpenAI } from "@langchain/openai";
import { queryDocuments, AGENT_TOP_K } from "./agent";
import { getRetriever } from "./retriever";
import * as dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

type FailureType = "retrieval" | "generation" | "none";
type Retriever = Awaited<ReturnType<typeof getRetriever>>;

// Upper bound on chunks pulled per doc when generating questions (~300 chars each)
const MAX_SOURCE_CHUNKS = 60;

interface TestQuestion {
  id: number;
  question: string;
  expectedAnswer: string;
  sourceDocs: string[];
}

interface EvalResult {
  id: number;
  question: string;
  expected: string;
  agentAnswer: string;
  correct: boolean;
  judgeReason: string;
  failureType: FailureType;
  retrievedSourceDocs: string[];
  expectedSourceDoc: string[];
}

export interface EvalMetrics {
  accuracy: number;
  total: number;
  correct: number;
  retrievalFailures: number;
  generationFailures: number;
  results: EvalResult[];
}

// Thrown when the benchmark's source docs aren't in the index, so we don't
// spend a full run producing a meaningless score
export class MissingEvalDocsError extends Error {
  constructor(public missingDocs: string[]) {
    super(`Eval source docs not in index: ${missingDocs.join(", ")}`);
  }
}

export async function runEvals(
  questionsPath: string = "../eval_data/test_questions.json"
): Promise<EvalMetrics> {
  const questions: TestQuestion[] = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, questionsPath), "utf-8")
  );

  // Questions are written against specific docs — search only those, and check they're all indexed
  const requiredDocs = [...new Set(questions.flatMap((q) => q.sourceDocs))];
  const retriever = await getRetriever(AGENT_TOP_K, requiredDocs);
  const missingDocs: string[] = [];
  for (const doc of requiredDocs) {
    const hits = await retriever.vectorStore.similaritySearch(doc, 1, { doc_id: doc });
    if (hits.length === 0) missingDocs.push(doc);
  }
  if (missingDocs.length > 0) throw new MissingEvalDocsError(missingDocs);

  return scoreQuestions(questions, requiredDocs);
}

const generatedQuestionsSchema = z.object({
  questions: z.array(
    z.object({
      question: z.string(),
      expectedAnswer: z.string(),
    })
  ),
});

// The judge checks each expected fact; correctness is decided in code from its checklist
const judgmentSchema = z.object({
  keyFacts: z.array(
    z.object({
      fact: z.string(),
      inAgentAnswer: z.boolean(),
    })
  ).describe("Each key fact in the expected answer, and whether the agent answer states it"),
  contradicts: z.boolean().describe("Whether the agent answer contradicts the expected answer"),
  reason: z.string().describe("One sentence on why the answer is or isn't correct"),
});

// Builds a test set from the doc's own text: an LLM writes questions and
// answers from its chunks, then they're scored exactly like the benchmark
async function generateQuestions(
  docId: string,
  count: number,
  retriever: Retriever
): Promise<Omit<TestQuestion, "id">[]> {
  const chunks = await retriever.vectorStore.similaritySearch(docId, MAX_SOURCE_CHUNKS, {
    doc_id: docId,
  });
  if (chunks.length === 0) throw new MissingEvalDocsError([docId]);

  const docText = chunks
    .sort((a, b) => (a.metadata.chunk_index ?? 0) - (b.metadata.chunk_index ?? 0))
    .map((chunk) => chunk.pageContent)
    .join("\n\n");

  const generatorLlm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0.3 })
    .withStructuredOutput(generatedQuestionsSchema);

  const { questions } = await generatorLlm.invoke(`
Write ${count} test questions for a document Q&A assistant, based only on the document below.
Each question must be answerable from a specific fact in the document (a number, rule,
deadline, requirement or name), and the expected answer must state that fact concisely.
Spread the questions across different parts of the document. Don't ask about anything
the document doesn't state.

Document (${docId}):
${docText}`);

  return questions.slice(0, count).map((q) => ({ ...q, sourceDocs: [docId] }));
}

export async function runDocEvals(
  docIds: string[],
  questionsPerDoc: number = 5
): Promise<EvalMetrics> {
  // Search only the docs being evaluated, not everything else in the index
  const retriever = await getRetriever(AGENT_TOP_K, docIds);

  const questions: TestQuestion[] = [];
  for (const docId of docIds) {
    const generated = await generateQuestions(docId, questionsPerDoc, retriever);
    generated.forEach((q) => questions.push({ ...q, id: questions.length + 1 }));
  }

  return scoreQuestions(questions, docIds);
}

async function scoreQuestions(
  questions: TestQuestion[],
  docIds: string[]
): Promise<EvalMetrics> {
  const retriever = await getRetriever(AGENT_TOP_K, docIds);
  const judgeLlm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 })
    .withStructuredOutput(judgmentSchema);
  const results: EvalResult[] = [];

  for (const q of questions) {
    // 1. Run retrieval separately to inspect which docs were surfaced
    const retrievedDocs = await retriever.invoke(q.question);
    const retrievedSourceDocs = retrievedDocs.map(
      (doc) => doc.metadata?.doc_id ?? "unknown"
    );

    // 2. Get the agent's answer
    const { answer: agentAnswer } = await queryDocuments(q.question, docIds);

    // 3. LLM-as-judge: did the agent answer correctly?
    const judgePrompt = `
You are grading a document Q&A assistant against an answer key.

Question: ${q.question}
Expected answer: ${q.expectedAnswer}
Agent answer: ${agentAnswer}

1. Break the expected answer into its key facts (numbers, names, rules, conditions, conclusions).
2. For each fact, decide whether the agent answer states it. It counts if the meaning is the
   same, even with different wording, synonyms, abbreviations or a fuller official name
   (e.g. "NYU" = "New York University"). Extra detail in the agent answer doesn't matter.
3. Decide whether the agent answer contradicts the expected answer.
Treat the expected answer as true, even if it mentions dates, people or facts you don't
recognise or that seem to be in the future. Don't use your own knowledge.`;

    const judgment = await judgeLlm.invoke(judgePrompt);
    const correct =
      judgment.keyFacts.length > 0 &&
      judgment.keyFacts.every((f) => f.inAgentAnswer) &&
      !judgment.contradicts;

    // 4. Classify failure type
    // If wrong: was the source doc even retrieved? If not → retrieval failure.
    // If source doc was retrieved but still wrong → generation failure.
    let failureType: FailureType = "none";
    if (!correct) {
      const sourceWasRetrieved = q.sourceDocs.every(
        (doc) => retrievedSourceDocs.includes(doc));
      failureType = sourceWasRetrieved ? "generation" : "retrieval";
    }

    results.push({
      id: q.id,
      question: q.question,
      expected: q.expectedAnswer,
      agentAnswer,
      correct,
      judgeReason: judgment.reason,
      failureType,
      retrievedSourceDocs,
      expectedSourceDoc: q.sourceDocs,
    });

    const tag = correct ? "✓" : `✗ [${failureType}]`;
    console.log(`Q${q.id}: ${tag} ${q.question}`);
  }

  const correctCount = results.filter((r) => r.correct).length;
  const retrievalFailures = results.filter((r) => r.failureType === "retrieval").length;
  const generationFailures = results.filter((r) => r.failureType === "generation").length;

  return {
    accuracy: correctCount / results.length,
    total: results.length,
    correct: correctCount,
    retrievalFailures,
    generationFailures,
    results,
  };
}

// Run directly: ts-node src/evals.ts
if (require.main == module) {
  runEvals().then((metrics) => {
    console.log(
      `\nAccuracy: ${(metrics.accuracy * 100).toFixed(1)}% (${metrics.correct}/${metrics.total})`
    );
    console.log(`Retrieval failures: ${metrics.retrievalFailures}`);
    console.log(`Generation failures: ${metrics.generationFailures}`);
    console.log("\nFailed questions:");
    metrics.results
      .filter((r) => !r.correct)
      .forEach((r) => {
        console.log(`  Q: ${r.question}`);
        console.log(`  Failure type: ${r.failureType}`);
        console.log(`  Expected doc: ${r.expectedSourceDoc}`);
        console.log(`  Retrieved docs: ${r.retrievedSourceDocs.join(", ")}`);
        console.log(`  Expected: ${r.expected}`);
        console.log(`  Got: ${r.agentAnswer}\n`);
      });
  });
}