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
If the answer is not in the context, say 
"I don't have that information in the provided documents."

Context:
{context}

Question: {question}

Answer:`;

export interface QAResult {
  answer: string;
  sources: string[];
}

// Formats retrieved Document objects into a single context string for the prompt
function formatDocs(docs: Document[]): string {
  return docs.map((doc) => doc.pageContent).join("\n\n");
}

export async function queryDocuments(question: string): Promise<QAResult> {
  const llm = new ChatOpenAI({
    model: "gpt-4o-mini",
    temperature: 0,
  });

  const retriever = await getRetriever(4);
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