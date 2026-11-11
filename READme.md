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

The grader (an LLM that checks each answer against the expected one) was made 
stricter between rounds, so scores are only comparable within a round.

### Round 1: original grader

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

### Round 2: stricter grader, lengthened prompt
The round 1 grader replied with a bare CORRECT/INCORRECT. It passed answers that 
missed parts of multi-part questions, and failed correct answers containing dates 
it believed were in the future. It was changed to explain its reasoning before 
deciding and to judge only against the expected answer. Under this grader the 
round 1 setup scored 65%, not 85%.

The **lengthened prompt** adds instructions to answer every part of a multi-part 
question, list every rule that applies to each part (approvals, additional 
approvals, thresholds, deadlines, eligibility conditions), and state what an 
outcome depends on instead of saying it can't be determined.

| Experiment | Prompt | Chunk Size | Overlap | Top-K | Accuracy | Retrieval Failures | Generation Failures |
|---|---|---|---|---|---|---|---|
| Baseline | Original | 300 | 50 | 4 | 65% | 1 | 6 |
| Increase top-K | Original | 300 | 50 | 8 | 75% | 1 | 4 |
| Increase top-K | Original | 300 | 50 | 12 | 80% | 0 | 4 |
| Lengthened prompt | Lengthened | 300 | 50 | 12 | 90% | 0 | 2 |
| Increase top-K | Lengthened | 300 | 50 | 16 | 90% | 0 | 2 |
| Larger chunks* | Lengthened | 500 | 100 | 8 | 95% | 0 | 1 |
| Larger chunks* | Lengthened | 500 | 100 | 12 | 95% | 0 | 1 |
| Larger chunks* | Lengthened | 800 | 150 | 6 | 95% | 0 | 1 |
| Larger chunks* | Lengthened | 800 | 150 | 10 | 90% | 0 | 2 |
| Larger chunks* | Lengthened | 1200 | 200 | 4 | 90% | 1 | 1 |
| Larger chunks* | Lengthened | 1200 | 200 | 8 | 95% | 0 | 1 |
| Repeat runs (5) | Lengthened | 300 | 50 | 12 | 75–100%, avg 89% | 0 | 0–5 |

\* Run on a separate copy of the sample docs (its own Pinecone namespace) so each 
chunking could be ingested without touching live data. One run each.

### Round 3: fact-checklist grader, scoped search (current)
The grader now lists each key fact in the expected answer and marks whether the 
agent stated it, allowing different wording and abbreviations; code marks the 
answer correct only if every fact is present and nothing contradicts. The agent 
also searches only the documents being evaluated, so other uploads can't affect 
the score.

| Experiment | Prompt | Chunk Size | Overlap | Top-K | Accuracy | Retrieval Failures | Generation Failures |
|---|---|---|---|---|---|---|---|
| **Final config** (2 runs) | **Lengthened** | **300** | **50** | **12** | **85%, 85%** | **0** | **3** |

Key findings:
- **The prompt was the biggest lever.** With retrieval unchanged (top-K 12), 
  the lengthened prompt raised accuracy from 80% to 90%.
- **More context removed retrieval failures.** Raising top-K from 4 to 12 took 
  the baseline from 65% to 80%, and retrieval failures from 1 to 0.
- **Chunk size and overlap made no measurable difference.** Every lengthened-prompt 
  configuration scored 90–100%, but five runs of the same configuration ranged from 
  75% to 100%, so single-run differences of one question are noise. 300/50 was kept: 
  it sends the least text per question of the configurations reaching ~90%, and needs 
  no re-ingestion.
- **The checklist grader is consistent.** Both final runs failed the same three 
  questions. Two are genuine omissions on three-part questions (additional 
  approvals for conference expenses; multi-factor authentication for customer 
  data); one is a strict reading of a legal qualifier ("unless otherwise required 
  by law").

## What Would Break at Scale
- **Document freshness** — stale vectors remain in Pinecone if a policy changes. 
  Fix: webhook-triggered re-ingestion pipeline tied to the document source.
- **Multi-tenancy** — all documents share one Pinecone index, so departments can 
  query each other's documents. Fix: namespace by department or use separate indexes.
- **Cost at scale** — every query hits OpenAI twice (embedding + LLM). At 10,000 
  queries/day that's a real line item. Fix: semantic cache for repeated questions.

## Live Demo
https://enterprise-agent.up.railway.app/