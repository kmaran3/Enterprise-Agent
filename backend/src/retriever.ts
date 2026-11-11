import { OpenAIEmbeddings } from "@langchain/openai";
import { PineconeStore } from "@langchain/pinecone";
import { Pinecone } from "@pinecone-database/pinecone";
import * as dotenv from "dotenv";

dotenv.config();

// docIds limits search to those documents; omit to search the whole index
export async function getRetriever(topK: number = 10, docIds?: string[]) {
  const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  const index = pinecone.Index(process.env.PINECONE_INDEX_NAME!);

  const embeddings = new OpenAIEmbeddings({
    model: "text-embedding-3-small",
  });

  const vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
    pineconeIndex: index,
    namespace: process.env.PINECONE_NAMESPACE,
  });

  return vectorStore.asRetriever({
    k: topK,
    filter: docIds ? { doc_id: { $in: docIds } } : undefined,
  });
}