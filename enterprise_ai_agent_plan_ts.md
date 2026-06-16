# Enterprise Document Q&A Agent — FDE Portfolio Project

> **Stack:** Node.js · Express · TypeScript · LangChain.js · Pinecone · React · Railway  
> **Goal:** A deployable AI agent that ingests company documents and lets employees query them in natural language — with an eval layer that proves it works.  
> **Why full TypeScript:** One language across the entire stack — the standard pattern at AI-native startups and a direct signal to FDE hiring managers.

---

## Project Structure

```
enterprise-doc-agent/
├── backend/
│   ├── src/
│   │   ├── index.ts           # Express app entry point
│   │   ├── ingest.ts          # Document ingestion + chunking
│   │   ├── retriever.ts       # Pinecone + LangChain retrieval
│   │   ├── agent.ts           # LangChain QA chain
│   │   └── evals.ts           # Eval framework
│   ├── package.json
│   ├── tsconfig.json
│   └── .env
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── ChatInterface.tsx
│   │   │   ├── FileUpload.tsx
│   │   │   └── EvalDashboard.tsx
│   ├── package.json
│   ├── tsconfig.json
│   └── .env
├── eval_data/
│   └── test_questions.json    # Your 20-question eval set
├── sample_docs/               # Sample PDFs/SOPs to demo with
├── railway.toml
└── README.md
```

---

## Phase 1: Environment Setup (Day 1)

### 1.1 Accounts to Create
- [ ] [Pinecone](https://www.pinecone.io) — free tier, create an account and note your API key
- [ ] [OpenAI](https://platform.openai.com) — for embeddings and LLM
- [ ] [Railway](https://railway.app) — free tier for deployment
- [ ] [GitHub](https://github.com) — Railway deploys from GitHub

### 1.2 Check Node.js Version
```bash
node --version
```
You need Node 18+. If you're below that:
```bash
# Install via nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc   # or source ~/.zshrc
nvm install 20
nvm use 20
```

### 1.3 Create Project Folder
```bash
mkdir enterprise-doc-agent && cd enterprise-doc-agent
git init
mkdir backend frontend eval_data sample_docs
```

### 1.4 Backend Setup
```bash
cd backend
npm init -y
npm install express cors multer dotenv \
  @langchain/openai @langchain/pinecone @langchain/community \
  langchain @pinecone-database/pinecone \
  pdf-parse uuid
npm install -D typescript ts-node @types/node @types/express \
  @types/cors @types/multer @types/uuid nodemon
```

Create `backend/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

Update `backend/package.json` scripts:
```json
{
  "scripts": {
    "dev": "nodemon --exec ts-node src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

### 1.5 Environment Variables
Create `backend/.env`:
```
OPENAI_API_KEY=your_key_here
PINECONE_API_KEY=your_key_here
PINECONE_INDEX_NAME=doc-agent
PORT=8000
```

### 1.6 Frontend Setup
```bash
cd ../frontend
npx create-react-app . --template typescript
npm install axios
```

Create `frontend/.env`:
```
REACT_APP_API_URL=http://localhost:8000
```

---

## Phase 1.5: Create Sample Documents (Day 1, after setup)

Do this before touching any ingestion code. What's in your documents determines what your eval set can test, which determines whether your accuracy numbers are meaningful or arbitrary. Building the pipeline before you have documents is building blind.

Create three realistic fake company policy PDFs. Write them yourself — do not download public PDFs. You need to control exactly what facts are in them so you can write unambiguous eval questions later.

### Documents to create

**`sample_docs/hr_policy.pdf`**
Include specific, testable facts:
- PTO accrual rate (e.g. "15 days per year")
- PTO request notice period (e.g. "5 business days in advance")
- Maximum PTO carryover (e.g. "10 days maximum")
- Probationary period for new hires (e.g. "90 days")
- Remote work policy (e.g. "up to 2 days per week after 6 months")

**`sample_docs/expense_policy.pdf`**
Include specific, testable facts:
- Business meal reimbursement cap (e.g. "$75 per person")
- Hotel nightly limit (e.g. "$250 per night")
- Approval required above threshold (e.g. "manager approval required for expenses over $500")
- Receipt requirement (e.g. "receipts required for all expenses over $25")
- Submission deadline (e.g. "within 30 days of the expense")

**`sample_docs/it_security_policy.pdf`**
Include specific, testable facts:
- Password minimum length (e.g. "12 characters minimum")
- Password rotation requirement (e.g. "every 90 days")
- MFA requirement (e.g. "required for all systems containing customer data")
- Device encryption requirement (e.g. "all laptops must be encrypted")
- Incident reporting window (e.g. "security incidents must be reported within 24 hours")

### How to create the PDFs

Use Google Docs or Word — write the content, then export as PDF. Aim for 1-2 pages per document. The content should read like real policy documents: sections, headers, numbered rules.

### Why this order matters

You're going to write 20 eval questions in Phase 5 *before* you write the eval code. Those questions need to be grounded in specific facts from these documents. If you write the documents after the pipeline is built, you'll be tempted to reverse-engineer easy questions — which defeats the purpose of the eval entirely.

---

## Phase 2: Pinecone Index + Ingestion Pipeline (Day 2)

### 2.1 Create the Pinecone Index
Log into Pinecone dashboard and create an index:
- **Name:** `doc-agent`
- **Dimensions:** `1536` (matches OpenAI text-embedding-3-small)
- **Metric:** `cosine`
- **Cloud:** AWS, region us-east-1 (free tier)

### 2.2 Build `backend/src/ingest.ts`
```typescript
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
  const loader = new PDFLoader(filePath);
  const pages = await loader.load();

  // 2. Chunk — experiment with these values for your evals
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
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

  await PineconeStore.fromDocuments(chunks, embeddings, {
    pineconeIndex: index,
  });

  return { chunksIngested: chunks.length, docId };
}
```

**Why chunking strategy matters (key for evals later):**
- Too large (1000+ tokens): retrieves too much irrelevant context
- Too small (100 tokens): loses context around the answer
- 500 tokens with 50 overlap is your baseline — you'll tune this

### 2.3 Get Sample Documents
For demo purposes, use 3 fake "company policy" PDFs you create yourself:
- `hr_policy.pdf` — PTO rules, hiring process, conduct policy
- `expense_policy.pdf` — reimbursement limits, approval process
- `it_security_policy.pdf` — password rules, device policy, data handling

Creating your own docs looks more realistic for enterprise demos than downloading public PDFs, and you control exactly what questions the eval set can test.

Place them in `sample_docs/`.

---

## Phase 3: Express Backend (Day 3)

### 3.1 Build `backend/src/retriever.ts`
```typescript
import { OpenAIEmbeddings } from "@langchain/openai";
import { PineconeStore } from "@langchain/pinecone";
import { Pinecone } from "@pinecone-database/pinecone";
import * as dotenv from "dotenv";

dotenv.config();

export async function getRetriever(topK: number = 4) {
  const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  const index = pinecone.Index(process.env.PINECONE_INDEX_NAME!);

  const embeddings = new OpenAIEmbeddings({
    model: "text-embedding-3-small",
  });

  const vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
    pineconeIndex: index,
  });

  return vectorStore.asRetriever({ k: topK });
}
```

### 3.2 Build `backend/src/agent.ts`

> **Why LCEL instead of `RetrievalQAChain`:** `RetrievalQAChain` is deprecated in current LangChain versions. The modern pattern is LCEL — LangChain Expression Language — which uses a pipe (`|`) syntax to compose steps explicitly. LCEL gives you more control, is easier to debug, and is what you'll see in production LangChain codebases. If an interviewer asks why you used this approach, the answer is: "I deliberately avoided the deprecated abstraction because I wanted explicit control over each step in the chain and visibility into what's being passed between them."

```typescript
import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnablePassthrough, RunnableSequence } from "@langchain/core/runnables";
import { Document } from "@langchain/core/documents";
import { getRetriever } from "./retriever";

const PROMPT_TEMPLATE = `You are an enterprise document assistant. Use only the 
context below to answer the question. If the answer is not in the context, say 
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
```

### 3.3 Build `backend/src/index.ts`
```typescript
import express, { Request, Response } from "express";
import cors from "cors";
import multer from "multer";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { ingestDocument } from "./ingest";
import { queryDocuments } from "./agent";

dotenv.config();

const app = express();
const port = process.env.PORT ?? 8000;

app.use(cors());
app.use(express.json());

// Multer for file uploads — stores in /tmp
const upload = multer({ dest: "/tmp/" });

// Health check
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// Upload + ingest a PDF
app.post(
  "/upload",
  upload.single("file"),
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }
    if (!req.file.originalname.endsWith(".pdf")) {
      res.status(400).json({ error: "Only PDF files supported" });
      return;
    }

    try {
      const result = await ingestDocument(
        req.file.path,
        req.file.originalname
      );
      fs.unlinkSync(req.file.path); // clean up temp file
      res.json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Ingestion failed" });
    }
  }
);

// Query documents
app.post("/query", async (req: Request, res: Response) => {
  const { question } = req.body as { question?: string };
  if (!question) {
    res.status(400).json({ error: "question is required" });
    return;
  }

  try {
    const result = await queryDocuments(question);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Query failed" });
  }
});

app.listen(port, () => {
  console.log(`Backend running on http://localhost:${port}`);
});
```

### 3.4 Test the Backend Locally
```bash
cd backend
npm run dev
```

Test with curl:
```bash
# Health check
curl http://localhost:8000/health

# Upload a PDF
curl -X POST http://localhost:8000/upload \
  -F "file=@../sample_docs/hr_policy.pdf"

# Query
curl -X POST http://localhost:8000/query \
  -H "Content-Type: application/json" \
  -d '{"question": "How many days notice is required for PTO?"}'
```

---

## Phase 4: React + TypeScript Frontend (Day 4)

### 4.1 Create `frontend/src/types.ts`
```typescript
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
  failureType: FailureType;
  retrievedSourceDocs: string[];
  expectedSourceDoc: string;
}

export interface EvalMetrics {
  accuracy: number;
  total: number;
  correct: number;
  retrievalFailures: number;
  generationFailures: number;
  results: EvalResult[];
}
```

### 4.2 Create `frontend/src/components/FileUpload.tsx`
```tsx
import React, { useState } from "react";
import axios from "axios";
import { IngestResponse } from "../types";

const API_URL = process.env.REACT_APP_API_URL ?? "http://localhost:8000";

interface Props {
  onUploadSuccess: () => void;
}

export const FileUpload: React.FC<Props> = ({ onUploadSuccess }) => {
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  const handleFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);
    setUploading(true);
    setMessage("");

    try {
      const res = await axios.post<IngestResponse>(
        `${API_URL}/upload`,
        formData
      );
      setMessage(
        `✓ Ingested ${res.data.chunksIngested} chunks from ${file.name}`
      );
      onUploadSuccess();
    } catch {
      setMessage("Upload failed. Make sure the backend is running.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <label style={{ fontWeight: 600, display: "block", marginBottom: 8 }}>
        Upload Company Document (PDF)
      </label>
      <input type="file" accept=".pdf" onChange={handleFileChange} />
      {uploading && <p style={{ color: "#666" }}>Ingesting document...</p>}
      {message && (
        <p style={{ color: message.startsWith("✓") ? "green" : "red" }}>
          {message}
        </p>
      )}
    </div>
  );
};
```

### 4.3 Create `frontend/src/components/ChatInterface.tsx`
```tsx
import React, { useState } from "react";
import axios from "axios";
import { Message, QueryResponse } from "../types";

const API_URL = process.env.REACT_APP_API_URL ?? "http://localhost:8000";

export const ChatInterface: React.FC = () => {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  const handleAsk = async () => {
    if (!question.trim()) return;
    setLoading(true);

    const userMessage: Message = { role: "user", text: question };
    setHistory((prev) => [...prev, userMessage]);
    setQuestion("");

    try {
      const res = await axios.post<QueryResponse>(`${API_URL}/query`, {
        question,
      });
      const agentMessage: Message = {
        role: "agent",
        text: res.data.answer,
        sources: res.data.sources,
      };
      setHistory((prev) => [...prev, agentMessage]);
    } catch {
      setHistory((prev) => [
        ...prev,
        { role: "agent", text: "Error contacting the backend." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleAsk();
  };

  return (
    <div>
      <div
        style={{
          minHeight: 300,
          border: "1px solid #ddd",
          borderRadius: 8,
          padding: 16,
          marginBottom: 16,
          overflowY: "auto",
          maxHeight: 500,
        }}
      >
        {history.length === 0 && (
          <p style={{ color: "#999" }}>
            Upload a document and ask a question...
          </p>
        )}
        {history.map((msg, i) => (
          <div
            key={i}
            style={{
              marginBottom: 12,
              textAlign: msg.role === "user" ? "right" : "left",
            }}
          >
            <span
              style={{
                display: "inline-block",
                background: msg.role === "user" ? "#0070f3" : "#f0f0f0",
                color: msg.role === "user" ? "white" : "black",
                borderRadius: 8,
                padding: "8px 12px",
                maxWidth: "75%",
              }}
            >
              {msg.text}
            </span>
            {msg.sources && msg.sources.length > 0 && (
              <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>
                Sources: {msg.sources.join(", ")}
              </div>
            )}
          </div>
        ))}
        {loading && <p style={{ color: "#999" }}>Thinking...</p>}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          style={{
            flex: 1,
            padding: "8px 12px",
            borderRadius: 6,
            border: "1px solid #ddd",
            fontSize: 14,
          }}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question about your documents..."
        />
        <button
          onClick={handleAsk}
          disabled={loading}
          style={{
            padding: "8px 20px",
            background: "#0070f3",
            color: "white",
            border: "none",
            borderRadius: 6,
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.7 : 1,
          }}
        >
          Ask
        </button>
      </div>
    </div>
  );
};
```

### 4.5 Create `frontend/src/components/EvalDashboard.tsx`

> **Why build this:** The eval dashboard is what turns your eval numbers from a terminal printout into something a recruiter or interviewer can actually see during a live demo. It also forces you to think about how to present failure types visually — retrieval failures vs generation failures — which is a talking point on its own.

```tsx
import React, { useState } from "react";
import axios from "axios";
import { EvalMetrics, EvalResult } from "../types";

const API_URL = process.env.REACT_APP_API_URL ?? "http://localhost:8000";

export const EvalDashboard: React.FC = () => {
  const [metrics, setMetrics] = useState<EvalMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const runEvals = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await axios.get<EvalMetrics>(`${API_URL}/evals`);
      setMetrics(res.data);
    } catch {
      setError("Eval run failed. Make sure the backend is running.");
    } finally {
      setLoading(false);
    }
  };

  const failureBadge = (result: EvalResult) => {
    if (result.correct) return null;
    const label =
      result.failureType === "retrieval" ? "Retrieval Failure" : "Generation Failure";
    const color = result.failureType === "retrieval" ? "#f59e0b" : "#ef4444";
    return (
      <span style={{ fontSize: 11, background: color, color: "white", borderRadius: 4, padding: "2px 6px", marginLeft: 8 }}>
        {label}
      </span>
    );
  };

  return (
    <div style={{ marginTop: "2rem" }}>
      <h2 style={{ marginBottom: 8 }}>Eval Dashboard</h2>
      <p style={{ color: "#666", marginTop: 0, fontSize: 14 }}>
        Runs the full 20-question eval set against live documents. Takes ~1 minute.
      </p>
      <button
        onClick={runEvals}
        disabled={loading}
        style={{
          padding: "8px 20px",
          background: "#7c3aed",
          color: "white",
          border: "none",
          borderRadius: 6,
          cursor: loading ? "not-allowed" : "pointer",
          opacity: loading ? 0.7 : 1,
          marginBottom: "1.5rem",
        }}
      >
        {loading ? "Running evals..." : "Run Evals"}
      </button>

      {error && <p style={{ color: "red" }}>{error}</p>}

      {metrics && (
        <div>
          {/* Summary row */}
          <div style={{ display: "flex", gap: 24, marginBottom: "1.5rem" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 32, fontWeight: 700, color: "#16a34a" }}>
                {(metrics.accuracy * 100).toFixed(0)}%
              </div>
              <div style={{ fontSize: 12, color: "#666" }}>Accuracy</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 32, fontWeight: 700, color: "#f59e0b" }}>
                {metrics.retrievalFailures}
              </div>
              <div style={{ fontSize: 12, color: "#666" }}>Retrieval Failures</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 32, fontWeight: 700, color: "#ef4444" }}>
                {metrics.generationFailures}
              </div>
              <div style={{ fontSize: 12, color: "#666" }}>Generation Failures</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 32, fontWeight: 700 }}>{metrics.total}</div>
              <div style={{ fontSize: 12, color: "#666" }}>Total Questions</div>
            </div>
          </div>

          {/* Results table */}
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #ddd", textAlign: "left" }}>
                <th style={{ padding: "8px 4px" }}>Q</th>
                <th style={{ padding: "8px 4px" }}>Question</th>
                <th style={{ padding: "8px 4px" }}>Result</th>
                <th style={{ padding: "8px 4px" }}>Agent Answer</th>
              </tr>
            </thead>
            <tbody>
              {metrics.results.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid #eee", background: r.correct ? "transparent" : "#fff5f5" }}>
                  <td style={{ padding: "8px 4px", color: "#666" }}>{r.id}</td>
                  <td style={{ padding: "8px 4px" }}>{r.question}</td>
                  <td style={{ padding: "8px 4px", whiteSpace: "nowrap" }}>
                    {r.correct ? "✓" : "✗"}
                    {failureBadge(r)}
                  </td>
                  <td style={{ padding: "8px 4px", color: "#444" }}>{r.agentAnswer}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
```

### 4.6 Update `frontend/src/App.tsx`
```tsx
import React, { useState } from "react";
import { FileUpload } from "./components/FileUpload";
import { ChatInterface } from "./components/ChatInterface";
import { EvalDashboard } from "./components/EvalDashboard";

const App: React.FC = () => {
  const [, setDocsLoaded] = useState(false);

  return (
    <div
      style={{
        maxWidth: 800,
        margin: "0 auto",
        padding: "2rem",
        fontFamily: "sans-serif",
      }}
    >
      <h1 style={{ marginBottom: 4 }}>Enterprise Document Assistant</h1>
      <p style={{ color: "#666", marginTop: 0 }}>
        Upload internal company documents (SOPs, policies, contracts) and
        query them in natural language.
      </p>
      <hr style={{ margin: "1.5rem 0" }} />
      <FileUpload onUploadSuccess={() => setDocsLoaded(true)} />
      <ChatInterface />
      <hr style={{ margin: "1.5rem 0" }} />
      <EvalDashboard />
    </div>
  );
};

export default App;
```

### 4.7 Test Frontend Locally
```bash
cd frontend
npm start
```

Make sure your backend is still running. Upload a PDF and test end-to-end before moving to evals. The EvalDashboard won't work yet — that's expected, the `/evals` endpoint doesn't exist until Phase 5.

---

## Phase 5: Eval Layer (Day 5) ← This is what separates you

This is the most important phase for FDE interviews. Don't skip it.

### 5.1 Create `eval_data/test_questions.json`

Write 20 questions based on your sample documents. Do this **before** writing any eval code — it forces you to think like a tester, not a builder.

Mix question difficulty deliberately:
- **Easy (8 questions):** single fact, exact match — "What is the maximum meal reimbursement?" Answer is one sentence, lives in one chunk.
- **Medium (8 questions):** require combining two facts — "What approval is required for expenses over the hotel limit?" Answer spans multiple sentences.
- **Hard (4 questions):** require reasoning across sections — "Under what conditions can a remote employee be required to come in?" Tests whether retrieval surfaces the right policy section.

The `sourceDoc` field is critical — it's how you detect retrieval failures later.

```json
[
  {
    "id": 1,
    "question": "What is the maximum reimbursable amount for a business meal?",
    "expectedAnswer": "The maximum reimbursable amount for a business meal is $75 per person.",
    "sourceDoc": "expense_policy.pdf"
  },
  {
    "id": 2,
    "question": "How many days notice is required for PTO requests?",
    "expectedAnswer": "PTO requests require at least 5 business days notice.",
    "sourceDoc": "hr_policy.pdf"
  }
]
```

### 5.2 Build `backend/src/evals.ts`

> **Why track failure types:** Knowing your accuracy is 67% tells you the system is broken. Knowing that 80% of failures are retrieval failures tells you *where* to fix it — chunk size and top-K, not the prompt. This is the difference between a number and a diagnosis. It's also a much more interesting interview story.
>
> **How failure type detection works:** After getting the agent's answer, we check whether the `sourceDoc` from the eval question appears in the list of documents the retriever actually surfaced. If the right document wasn't retrieved, that's a retrieval failure — the LLM never had a chance. If the right document *was* retrieved but the answer is still wrong, that's a generation failure — the LLM saw the answer and still got it wrong.

```typescript
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
  sourceDoc: string;
}

interface EvalResult {
  id: number;
  question: string;
  expected: string;
  agentAnswer: string;
  correct: boolean;
  failureType: FailureType;
  retrievedSourceDocs: string[];
  expectedSourceDoc: string;
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
      const sourceWasRetrieved = retrievedSourceDocs.includes(q.sourceDoc);
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
      expectedSourceDoc: q.sourceDoc,
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
```

### 5.3 Add Eval Endpoint to `index.ts`
```typescript
import { runEvals } from "./evals"; // add this import at top

// Add this route
app.get("/evals", async (_req: Request, res: Response) => {
  try {
    const metrics = await runEvals();
    res.json(metrics);
  } catch (err) {
    res.status(500).json({ error: "Eval run failed" });
  }
});
```

### 5.4 Run Evals and Iterate

```bash
cd backend
npx ts-node src/evals.ts
```

**The iteration loop — this is what you talk about in interviews:**

| Experiment | Change | Accuracy | Retrieval Failures | Generation Failures |
|---|---|---|---|---|
| Baseline | chunkSize=500, topK=4 | measure | measure | measure |
| Experiment 1 | chunkSize=300, topK=6 | measure | measure | measure |
| Experiment 2 | chunkSize=500, topK=4, better prompt | measure | measure | measure |
| Experiment 3 | chunkSize=300, topK=8 | measure | measure | measure |

The failure type columns are the key upgrade over the original plan. If Experiment 1 reduces retrieval failures but increases generation failures, that tells you something specific: smaller chunks are surfacing the right document but losing enough context that the LLM can't synthesize the answer. That's a real engineering insight, not just a number going up.

Track all of this in your README.

---

## Phase 6: Deploy to Railway (Day 6)

### 6.1 Add Build Scripts

Update `backend/package.json`:
```json
{
  "scripts": {
    "dev": "nodemon --exec ts-node src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

Update `frontend/package.json` — no changes needed, CRA handles the build.

### 6.2 Create `railway.toml` in project root
```toml
[build]
builder = "nixpacks"
```

Create `backend/Procfile`:
```
web: npm run build && npm start
```

### 6.3 Add `.gitignore` to project root
```
node_modules/
dist/
.env
*.local
/tmp
```

### 6.4 Push to GitHub
```bash
cd enterprise-doc-agent
git add .
git commit -m "Initial commit: Enterprise Doc Agent (TypeScript)"
git remote add origin https://github.com/YOUR_USERNAME/enterprise-doc-agent.git
git push -u origin main
```

### 6.5 Deploy on Railway
1. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
2. Select `enterprise-doc-agent`
3. Create **two services** — one for backend, one for frontend:
   - Click **New Service** → **GitHub Repo** → select the repo → set **Root Directory** to `backend`
   - Repeat for frontend with Root Directory set to `frontend`
4. For the **backend service**, add environment variables under Settings → Variables:
   - `OPENAI_API_KEY`
   - `PINECONE_API_KEY`
   - `PINECONE_INDEX_NAME`
5. For the **frontend service**, add:
   - `REACT_APP_API_URL` = your backend Railway URL (shown in backend service settings after first deploy, e.g. `https://backend-production-xxxx.up.railway.app`)
6. Hit **Deploy** on both services

Railway gives you a public live URL for both.

---

## Phase 7: README + Resume Framing (Day 7)

### 7.1 README Structure
```markdown
## Enterprise Document Assistant

An AI-powered document Q&A platform that enables enterprise teams to query 
internal policies, SOPs, and contracts in natural language.

### Stack
TypeScript · Node.js · Express · LangChain.js · Pinecone · React · Railway

### Architecture
PDF Upload → Express API → LangChain.js → Pinecone (vector search) 
→ GPT-4o-mini → React UI

### Eval Results
| Experiment | Chunk Size | Top-K | Accuracy | Retrieval Failures | Generation Failures |
|---|---|---|---|---|---|
| Baseline | 500 | 4 | X% | X | X |
| Best config | 300 | 6 | X% | X | X |

### Business Problem
Enterprise employees spend significant time manually searching policy documents.
This system reduces that to a sub-second natural language query with source attribution.

### Live Demo
[Link to Railway deployment]
```

### 7.2 Resume Bullets
```
Built and deployed a full-stack RAG application in TypeScript (Node.js + Express 
backend, React frontend) using LangChain.js and Pinecone, enabling natural 
language querying of enterprise documents — deployed live on Railway

Implemented an LLM-as-judge eval framework across 20 test cases that classifies 
failures as retrieval failures vs generation failures, running controlled experiments 
across chunking strategies and retrieval parameters to improve answer accuracy 
from X% to Y%
```

---

## Timeline Summary

| Day | Focus |
|---|---|
| Day 1 | Environment setup, accounts, dependencies, create sample documents |
| Day 2 | Pinecone index, ingestion pipeline |
| Day 3 | Express backend, test with curl |
| Day 4 | React + TypeScript frontend including EvalDashboard, end-to-end local test |
| Day 5 | Eval framework with failure type tracking, run experiments, track results |
| Day 6 | Deploy to Railway |
| Day 7 | README, resume bullets, GitHub polish |

---

## Interview Talking Points

When an FDE interviewer asks about this project, lead with:

1. **The business problem** — "Enterprise employees waste hours manually searching policy docs. I built a system that reduces that to a sub-second natural language query."
2. **The stack choice** — "I used TypeScript across the full stack — Node.js backend and React frontend — because that's the standard pattern at AI-native startups and it reduces context switching across the codebase."
3. **The architecture decision** — "I chose Pinecone over an in-memory store because it's production-grade and scales to millions of vectors — the kind of scale you'd actually hit at an enterprise client."
4. **The eval layer** — "I built an LLM-as-judge eval set of 20 questions that tracks not just accuracy but failure type — retrieval failures vs generation failures. That distinction tells you whether to fix chunking strategy or the prompt. Accuracy went from X% to Y% once I identified that most failures were retrieval failures and increased top-K."
5. **What would break at scale** — "Three things. First, document freshness — if a policy changes, stale vectors stay in Pinecone until someone re-ingests. I'd add a webhook-triggered re-ingestion pipeline tied to the document source. Second, multi-tenancy — right now all documents share one Pinecone index, so HR and Finance can query each other's documents. In production you'd namespace by department or use separate indexes. Third, cost — every query hits OpenAI twice: once for the question embedding and once for the LLM call. At 10,000 queries a day that's a real line item. I'd add a semantic cache to serve repeated questions without hitting the API."

That last point — proactively identifying what breaks and knowing the fix — is exactly what separates FDE candidates in interviews. Notice the answer isn't just "it would be slow" — it's a specific failure mode with a specific production solution for each one.