import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnablePassthrough, RunnableSequence } from "@langchain/core/runnables";
import { Document } from "@langchain/core/documents";
import { getRetriever } from "./retriever";

const PROMPT_TEMPLATE = `You are an enterprise document assistant. Use only the 
context below to answer the question. When comparing numerical values, explicitly 
state both numbers and the direction of comparison before drawing a conclusion. 
When answering, always cite the specific policy rule that applies, 
including any eligibility requirements or conditions, even if the 
user did not explicitly ask about them.
If the question has several parts, answer each part in turn. For each part, 
list every rule in the context that applies to it, including required 
approvals (and any additional approvals), thresholds, deadlines and 
eligibility conditions, not just the first one you find.
If the question doesn't give a detail needed to reach a conclusion, state 
the rule and what the outcome depends on instead of saying you can't determine it.
If the answer is not in the context, say 
"I don't have that information in the provided documents."

Context:
{context}

Question: {question}

Answer:`;

// Chunks retrieved per question; evals use the same value to classify failures
export const AGENT_TOP_K = 12;

export interface QAResult {
  answer: string;
  sources: string[];
}

// Formats retrieved Document objects into a single context string for the prompt
function formatDocs(docs: Document[]): string {
  return docs.map((doc) => doc.pageContent).join("\n\n");
}

export async function queryDocuments(
  question: string,
  docIds?: string[]
): Promise<QAResult> {
  const llm = new ChatOpenAI({
    model: "gpt-4o-mini",
    temperature: 0,
  });

  const retriever = await getRetriever(AGENT_TOP_K, docIds);
  const prompt = PromptTemplate.fromTemplate(PROMPT_TEMPLATE);

  // Retrieve documents separately so we can return sources alongside the answer
  const retrievedDocs = await retriever.invoke(question);

  // LCEL chain: format context + pass question → prompt → LLM → parse output
  const chain = RunnableSequence.from([
    {
      context: () => formatDocs(retrievedDocs),
      question: new RunnablePassthrough(),
    },
    prompt,
    llm,
    new StringOutputParser(),
  ]);

  const answer = await chain.invoke(question);

  const sources: string[] = [
    ...new Set(
      retrievedDocs.map(
        (doc) => doc.metadata?.doc_id ?? "unknown"
      )
    ),
  ];

  return { answer, sources };
}