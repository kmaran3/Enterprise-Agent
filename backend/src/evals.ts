import * as fs from "fs";
import * as path from "path";
import { ChatOpenAI } from "@langchain/openai";
import { queryDocuments } from "./agent";
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

  const retriever = await getRetriever(4);

  // Questions are written against specific docs — check they're all indexed
  const requiredDocs = [...new Set(questions.flatMap((q) => q.sourceDocs))];
  const missingDocs: string[] = [];
  for (const doc of requiredDocs) {
    const hits = await retriever.vectorStore.similaritySearch(doc, 1, { doc_id: doc });
    if (hits.length === 0) missingDocs.push(doc);
  }
  if (missingDocs.length > 0) throw new MissingEvalDocsError(missingDocs);

  return scoreQuestions(questions, retriever);
}

const generatedQuestionsSchema = z.object({
  questions: z.array(
    z.object({
      question: z.string(),
      expectedAnswer: z.string(),
    })
  ),
});

// Reason comes first so the judge explains before deciding
const judgmentSchema = z.object({
  reason: z.string().describe("One sentence on why the answer is or isn't correct"),
  correct: z.boolean(),
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
  const retriever = await getRetriever(4);

  const questions: TestQuestion[] = [];
  for (const docId of docIds) {
    const generated = await generateQuestions(docId, questionsPerDoc, retriever);
    generated.forEach((q) => questions.push({ ...q, id: questions.length + 1 }));
  }

  return scoreQuestions(questions, retriever);
}

async function scoreQuestions(
  questions: TestQuestion[],
  retriever: Retriever
): Promise<EvalMetrics> {
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
    const { answer: agentAnswer } = await queryDocuments(q.question);

    // 3. LLM-as-judge: did the agent answer correctly?
    const judgePrompt = `
You are grading a document Q&A assistant against an answer key.

Question: ${q.question}
Expected answer: ${q.expectedAnswer}
Agent answer: ${agentAnswer}

Does the agent answer correctly capture the key information in the expected answer?
Treat the expected answer as true, even if it mentions dates, people or facts you
don't recognise or that seem to be in the future. Don't use your own knowledge.
Extra detail or explanation in the agent answer is fine.`;

    const judgment = await judgeLlm.invoke(judgePrompt);
    const correct = judgment.correct;

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