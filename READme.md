# Enterprise Document Assistant

An AI-powered document Q&A platform that enables enterprise teams to query 
internal policies, SOPs, and contracts in natural language — with a built-in 
eval framework that measures and improves answer accuracy.

## Business Problem
Enterprise employees waste hours manually searching policy documents for specific 
rules and limits. This system reduces that to a sub-second natural language query 
with source attribution, telling users not just the answer but which document it 
came from.

## Architecture
PDF Upload → Express API → LangChain.js (LCEL) → Pinecone (vector search) 
→ GPT-4o-mini → React UI

## Stack
TypeScript · Node.js · Express · LangChain.js · Pinecone · React · Railway

## Eval Results
Evaluated against a 20-question test set spanning easy (single fact), medium 
(multi-fact), and hard (cross-section reasoning) questions. Failure type tracked 
separately to distinguish retrieval failures from generation failures.

| Experiment | Chunk Size | Overlap | Top-K | Accuracy | Retrieval Failures | Generation Failures |
|---|---|---|---|---|---|---|
| Baseline | 500 | 50 | 4 | 85% | 1 | 2 |
| Prompt improvement | 500 | 50 | 4 | 90% | 1 | 1 |
| Increase top-K | 500 | 50 | 10 | 95% | 1 | 0 |
| Smaller chunks | 300 | 50 | 6 | 90% | 1 | 1 |
| More overlap | 300 | 100 | 10 | 90% | 1 | 1 |
| **Final config** | **300** | **50** | **10** | **95%** | **1** | **0** |

Key finding: most failures were generation failures at baseline. Adding an explicit 
numerical comparison instruction to the prompt eliminated all generation failures. 
The one remaining failure is a known hard case requiring cross-document reasoning 
where the retriever surfaces both correct documents but the LLM fails to extract 
a specific eligibility condition.

## What Would Break at Scale
- **Document freshness** — stale vectors remain in Pinecone if a policy changes. 
  Fix: webhook-triggered re-ingestion pipeline tied to the document source.
- **Multi-tenancy** — all documents share one Pinecone index, so departments can 
  query each other's documents. Fix: namespace by department or use separate indexes.
- **Cost at scale** — every query hits OpenAI twice (embedding + LLM). At 10,000 
  queries/day that's a real line item. Fix: semantic cache for repeated questions.

## Live Demo
https://enterprise-agent.up.railway.app/