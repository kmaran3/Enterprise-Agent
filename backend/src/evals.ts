import * as fs from "fs";
import * as path from "path";
import { ChatOpenAI } from "@langchain/openai";
import { queryDocuments } from "./agent";
import { getRetriever } from "./retriever";
import * as dotenv from "dotenv";

dotenv.config();

type FailureType = "retrieval" | "generation" | "none";

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

export async function runEvals(
  questionsPath: string = "../../eval_data/test_questions.json"
): Promise<EvalMetrics> {
  const questions: TestQuestion[] = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, questionsPath), "utf-8")
  );

  const judgeLlm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });
  const retriever = await getRetriever(4);
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
Expected answer: ${q.expectedAnswer}
Agent answer: ${agentAnswer}

Does the agent answer correctly capture the key information in the expected answer?
Reply with only: CORRECT or INCORRECT`;

    const judgment = await judgeLlm.invoke(judgePrompt);
    const correct = judgment.content.toString().trim() === "CORRECT";

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