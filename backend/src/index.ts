import express, { Request, Response } from "express";
import cors from "cors";
import multer from "multer";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { ingestDocument } from "./ingest";
import { queryDocuments } from "./agent";
import { runEvals, runDocEvals, MissingEvalDocsError } from "./evals";

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

app.get("/evals", async (_req: Request, res: Response) => {
  try {
    const metrics = await runEvals();
    res.json(metrics);
  } catch (err) {
    if (err instanceof MissingEvalDocsError) {
      res.status(409).json({ error: err.message, missingDocs: err.missingDocs });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Eval run failed" });
  }
});

// Eval the user's own docs with generated questions; capped to keep runs ~1 minute
const MAX_EVAL_DOCS = 4;

app.post("/evals/docs", async (req: Request, res: Response) => {
  const { docIds } = req.body as { docIds?: string[] };
  if (!Array.isArray(docIds) || docIds.length === 0) {
    res.status(400).json({ error: "docIds is required" });
    return;
  }
  if (docIds.length > MAX_EVAL_DOCS) {
    res.status(400).json({ error: `At most ${MAX_EVAL_DOCS} documents per eval run` });
    return;
  }

  try {
    const metrics = await runDocEvals(docIds);
    res.json(metrics);
  } catch (err) {
    if (err instanceof MissingEvalDocsError) {
      res.status(409).json({ error: err.message, missingDocs: err.missingDocs });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Eval run failed" });
  }
});

app.listen(port, () => {
  console.log(`Backend running on http://localhost:${port}`);
});