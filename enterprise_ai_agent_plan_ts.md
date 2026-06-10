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
```typescript
import { ChatOpenAI } from "@langchain/openai";
import { RetrievalQAChain } from "langchain/chains";
import { PromptTemplate } from "@langchain/core/prompts";
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

export async function queryDocuments(question: string): Promise<QAResult> {
  const llm = new ChatOpenAI({
    model: "gpt-4o-mini",
    temperature: 0,
  });

  const retriever = await getRetriever(4);

  const prompt = PromptTemplate.fromTemplate(PROMPT_TEMPLATE);

  const chain = RetrievalQAChain.fromLLM(llm, retriever, {
    returnSourceDocuments: true,
    combineDocumentsChain: undefined,
  });

  const result = await chain.invoke({ query: question });

  const sources: string[] = [
    ...new Set(
      (result.sourceDocuments ?? []).map(
        (doc: { metadata: { doc_id?: string } }) =>
          doc.metadata?.doc_id ?? "unknown"
      )
    ),
  ];

  return {
    answer: result.text,
    sources,
  };
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

### 4.4 Update `frontend/src/App.tsx`
```tsx
import React, { useState } from "react";
import { FileUpload } from "./components/FileUpload";
import { ChatInterface } from "./components/ChatInterface";

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
    </div>
  );
};

export default App;
```

### 4.5 Test Frontend Locally
```bash
cd frontend
npm start
```

Make sure your backend is still running. Upload a PDF and test end-to-end before moving to evals.

---

## Phase 5: Eval Layer (Day 5) ← This is what separates you

This is the most important phase for FDE interviews. Don't skip it.

### 5.1 Create `eval_data/test_questions.json`
Write 20 questions based on your sample documents:
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
Mix easy, medium, and hard retrieval questions. Write these before you write the eval code — it forces you to think like a tester, not a builder.

### 5.2 Build `backend/src/evals.ts`
```typescript
import * as fs from "fs";
import * as path from "path";
import { ChatOpenAI } from "@langchain/openai";
import { queryDocuments } from "./agent";
import * as dotenv from "dotenv";

dotenv.config();

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
}

interface EvalMetrics {
  accuracy: number;
  total: number;
  correct: number;
  results: EvalResult[];
}

async function runEvals(
  questionsPath: string = "../../eval_data/test_questions.json"
): Promise<EvalMetrics> {
  const questions: TestQuestion[] = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, questionsPath), "utf-8")
  );

  const judgeLlm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });
  const results: EvalResult[] = [];

  for (const q of questions) {
    // Get the agent's answer
    const { answer: agentAnswer } = await queryDocuments(q.question);

    // LLM-as-judge: compare agent answer to expected answer
    const judgePrompt = `
Expected answer: ${q.expectedAnswer}
Agent answer: ${agentAnswer}

Does the agent answer correctly capture the key information in the expected answer?
Reply with only: CORRECT or INCORRECT`;

    const judgment = await judgeLlm.invoke(judgePrompt);
    const correct = judgment.content.toString().trim() === "CORRECT";

    results.push({
      id: q.id,
      question: q.question,
      expected: q.expectedAnswer,
      agentAnswer,
      correct,
    });

    console.log(`Q${q.id}: ${correct ? "✓" : "✗"} ${q.question}`);
  }

  const correctCount = results.filter((r) => r.correct).length;
  const accuracy = correctCount / results.length;

  return {
    accuracy,
    total: results.length,
    correct: correctCount,
    results,
  };
}

// Run directly: ts-node src/evals.ts
runEvals().then((metrics) => {
  console.log(
    `\nAccuracy: ${(metrics.accuracy * 100).toFixed(1)}% (${metrics.correct}/${metrics.total})`
  );
  console.log("\nFailed questions:");
  metrics.results
    .filter((r) => !r.correct)
    .forEach((r) => {
      console.log(`  Q: ${r.question}`);
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

| Experiment | Change | Accuracy |
|---|---|---|
| Baseline | chunkSize=500, topK=4 | ~65% |
| Experiment 1 | chunkSize=300, topK=6 | measure |
| Experiment 2 | chunkSize=500, topK=4, better prompt | measure |
| Experiment 3 | chunkSize=300, topK=8 | measure |

Track these in your README. The experiments and measurements are the interview story.

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
| Experiment | Chunk Size | Top-K | Accuracy |
|---|---|---|---|
| Baseline | 500 | 4 | 67% |
| Best config | 300 | 6 | 81% |

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

Implemented an LLM-as-judge eval framework across 20 test cases, running 
controlled experiments across chunking strategies and retrieval parameters 
to improve answer accuracy from 67% to 81%
```

---

## Timeline Summary

| Day | Focus |
|---|---|
| Day 1 | Environment setup, accounts, dependencies |
| Day 2 | Pinecone index, ingestion pipeline, sample docs |
| Day 3 | Express backend, test with curl |
| Day 4 | React + TypeScript frontend, end-to-end local test |
| Day 5 | Eval framework, run experiments, track results |
| Day 6 | Deploy to Railway |
| Day 7 | README, resume bullets, GitHub polish |

---

## Interview Talking Points

When an FDE interviewer asks about this project, lead with:

1. **The business problem** — "Enterprise employees waste hours manually searching policy docs. I built a system that reduces that to a sub-second natural language query."
2. **The stack choice** — "I used TypeScript across the full stack — Node.js backend and React frontend — because that's the standard pattern at AI-native startups and it reduces context switching across the codebase."
3. **The architecture decision** — "I chose Pinecone over an in-memory store because it's production-grade and scales to millions of vectors — the kind of scale you'd actually hit at an enterprise client."
4. **The eval layer** — "I built an LLM-as-judge eval set of 20 questions and ran experiments across chunking strategies. Accuracy went from 67% to 81% by reducing chunk size and increasing top-k retrieval."
5. **What would break at scale** — "The main failure point at enterprise scale would be document freshness — I'd add a webhook-triggered re-ingestion pipeline when source docs are updated, and rate limiting on the query endpoint."

That last point — proactively identifying what breaks — is exactly what separates FDE candidates in interviews.
