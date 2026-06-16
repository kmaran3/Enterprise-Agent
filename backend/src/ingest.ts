import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { OpenAIEmbeddings } from "@langchain/openai";
import { PineconeStore } from "@langchain/pinecone";
import { Pinecone } from "@pinecone-database/pinecone";
import * as dotenv from "dotenv";

dotenv.config();

interface IngestResult {
  chunksIngested: number;
  docId: string;
}

export async function ingestDocument(
  filePath: string,
  docId: string
): Promise<IngestResult> {
  // 1. Load PDF
  const loader = new PDFLoader(filePath, {parsedItemSeparator: " ",});
  const pages = await loader.load();

  // 2. Chunk — experiment with these values for your evals
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 300,
    chunkOverlap: 50,
    separators: ["\n\n", "\n", ".", " "],
  });
  const chunks = await splitter.splitDocuments(pages);

  // 3. Add metadata to each chunk
  chunks.forEach((chunk, i) => {
    chunk.metadata = {
      ...chunk.metadata,
      doc_id: docId,
      chunk_index: i,
    };
  });

  // 4. Embed and upsert to Pinecone
  const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  const index = pinecone.Index(process.env.PINECONE_INDEX_NAME!);

  const embeddings = new OpenAIEmbeddings({
    model: "text-embedding-3-small",
  });

  // Delete existing vectors for this document before upserting new ones
  await index.deleteMany({ doc_id: docId });

  await PineconeStore.fromDocuments(chunks, embeddings, {
    pineconeIndex: index,
  });

  return { chunksIngested: chunks.length, docId };
}