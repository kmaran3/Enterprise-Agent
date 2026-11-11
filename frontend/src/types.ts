export interface Message {
  role: "user" | "agent";
  text: string;
  sources?: string[];
}

export interface QueryResponse {
  answer: string;
  sources: string[];
}

export interface IngestResponse {
  chunksIngested: number;
  docId: string;
}

// Eval types — mirrored from backend so the dashboard can consume /evals response
export type FailureType = "retrieval" | "generation" | "none";

export interface EvalResult {
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
  ranAt?: string; // set on saved benchmark runs
}