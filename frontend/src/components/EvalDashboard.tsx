import React, { useEffect, useState } from "react";
import axios from "axios";
import { EvalMetrics, EvalResult } from "../types";

const API_URL = process.env.REACT_APP_API_URL ?? "http://localhost:8000";

// Served from public/sample_docs — the docs the benchmark questions are written against
const sampleDocs = ["expense_policy.pdf", "hr_policy.pdf", "it_security_policy.pdf"];

// Matches MAX_EVAL_DOCS on the backend
const MAX_EVAL_DOCS = 4;

interface Props {
  uploadedDocs: string[];
}

const buttonStyle = (primary: boolean, disabled: boolean): React.CSSProperties => ({
  padding: "8px 20px",
  background: primary ? "#7c3aed" : "white",
  color: primary ? "white" : "#7c3aed",
  border: "1px solid #7c3aed",
  borderRadius: 6,
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.6 : 1,
  marginBottom: "1.5rem",
});

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

const EvalResults: React.FC<{ metrics: EvalMetrics }> = ({ metrics }) => (
  <div style={{ marginBottom: "2rem" }}>
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
          <th style={{ padding: "8px 4px" }}>Expected</th>
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
            <td style={{ padding: "8px 4px", color: "#444" }}>{r.expected}</td>
            <td style={{ padding: "8px 4px", color: "#444" }}>
              {r.agentAnswer}
              {/* Why it failed: the grader's reason and what retrieval surfaced */}
              {!r.correct && (
                <div style={{ marginTop: 6, fontSize: 12, color: "#666" }}>
                  <div><strong>Grader:</strong> {r.judgeReason}</div>
                  <div>
                    <strong>Searched:</strong> {Array.from(new Set(r.retrievedSourceDocs)).join(", ")}
                    {" "}(expected {r.expectedSourceDoc.join(", ")})
                  </div>
                </div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export const EvalDashboard: React.FC<Props> = ({ uploadedDocs }) => {
  const [docMetrics, setDocMetrics] = useState<EvalMetrics | null>(null);
  const [benchmarkMetrics, setBenchmarkMetrics] = useState<EvalMetrics | null>(null);
  const [docsLoading, setDocsLoading] = useState(false);
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);
  const [docsError, setDocsError] = useState("");
  const [benchmarkError, setBenchmarkError] = useState("");
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);

  // Show the last benchmark run on load so it doesn't need re-running
  useEffect(() => {
    axios
      .get<EvalMetrics>(`${API_URL}/evals/latest`)
      .then((res) => setBenchmarkMetrics(res.data))
      .catch(() => {}); // 404 until the first run
  }, []);

  // Auto-select newly uploaded docs, up to the per-run cap
  useEffect(() => {
    setSelectedDocs((prev) => {
      const added = uploadedDocs.filter((doc) => !prev.includes(doc));
      return [...prev, ...added].slice(0, MAX_EVAL_DOCS);
    });
  }, [uploadedDocs]);

  const toggleDoc = (doc: string) => {
    setSelectedDocs((prev) =>
      prev.includes(doc) ? prev.filter((d) => d !== doc) : [...prev, doc]
    );
  };

  const missingDocs = (err: unknown): string[] | null =>
    axios.isAxiosError(err) && err.response?.status === 409
      ? err.response.data.missingDocs ?? []
      : null;

  const runDocEvals = async () => {
    setDocsLoading(true);
    setDocsError("");
    try {
      const res = await axios.post<EvalMetrics>(`${API_URL}/evals/docs`, { docIds: selectedDocs });
      setDocMetrics(res.data);
    } catch (err) {
      const missing = missingDocs(err);
      setDocsError(
        missing
          ? `Not found in the index: ${missing.join(", ")}. Try uploading again.`
          : "Eval run failed. Make sure the backend is running."
      );
    } finally {
      setDocsLoading(false);
    }
  };

  const runBenchmark = async () => {
    setBenchmarkLoading(true);
    setBenchmarkError("");
    try {
      const res = await axios.get<EvalMetrics>(`${API_URL}/evals`);
      setBenchmarkMetrics(res.data);
    } catch (err) {
      const missing = missingDocs(err);
      setBenchmarkError(
        missing
          ? `Benchmark docs not uploaded: ${missing.join(", ")}. Download them above and upload them first.`
          : "Benchmark run failed. Make sure the backend is running."
      );
    } finally {
      setBenchmarkLoading(false);
    }
  };

  const tooManySelected = selectedDocs.length > MAX_EVAL_DOCS;
  const docsDisabled = docsLoading || selectedDocs.length === 0 || tooManySelected;

  return (
    <div style={{ marginTop: "2rem" }}>
      <h2 style={{ marginBottom: 8 }}>Eval Dashboard</h2>

      <h3 style={{ marginBottom: 4, fontSize: 16 }}>Evaluate your documents</h3>
      <p style={{ color: "#666", marginTop: 0, fontSize: 14 }}>
        Generates 5 questions per document from its own text, then has the agent
        answer them, searching only the selected documents, and grades each answer. Questions and expected answers are
        written by an LLM, so check the Expected column before trusting the
        score. Up to {MAX_EVAL_DOCS} documents per run.
      </p>
      {uploadedDocs.length === 0 ? (
        <p style={{ color: "#666", fontSize: 14 }}>
          Upload documents above to evaluate them.
        </p>
      ) : (
        <div style={{ marginBottom: 12, fontSize: 14 }}>
          {uploadedDocs.map((doc) => (
            <label key={doc} style={{ display: "block", marginBottom: 4 }}>
              <input
                type="checkbox"
                checked={selectedDocs.includes(doc)}
                onChange={() => toggleDoc(doc)}
                style={{ marginRight: 6 }}
              />
              {doc}
            </label>
          ))}
          {tooManySelected && (
            <p style={{ color: "red", margin: "4px 0" }}>
              Select at most {MAX_EVAL_DOCS} documents.
            </p>
          )}
        </div>
      )}
      <button onClick={runDocEvals} disabled={docsDisabled} style={buttonStyle(true, docsDisabled)}>
        {docsLoading ? "Generating and running evals..." : "Evaluate Selected Documents"}
      </button>
      {docsError && <p style={{ color: "red" }}>{docsError}</p>}
      {docMetrics && <EvalResults metrics={docMetrics} />}

      <h3 style={{ marginBottom: 4, fontSize: 16 }}>Sample benchmark</h3>
      <p style={{ color: "#666", marginTop: 0, fontSize: 14 }}>
        A fixed 20-question benchmark with hand-written expected answers, covering
        only the three sample policy docs (and searching only those). The agent
        answers live each run, so the score can shift slightly between runs.
        Takes ~1 minute. Sample docs:{" "}
        {sampleDocs.map((doc, i) => (
          <span key={doc}>
            {i > 0 && " · "}
            <a href={`/sample_docs/${doc}`} download>{doc}</a>
          </span>
        ))}
      </p>
      <button
        onClick={runBenchmark}
        disabled={benchmarkLoading}
        style={buttonStyle(false, benchmarkLoading)}
      >
        {benchmarkLoading ? "Running benchmark..." : benchmarkMetrics ? "Re-run Benchmark" : "Run Benchmark"}
      </button>
      {benchmarkError && <p style={{ color: "red" }}>{benchmarkError}</p>}
      {benchmarkMetrics?.ranAt && (
        <p style={{ color: "#666", fontSize: 13, marginTop: 0 }}>
          Last run: {new Date(benchmarkMetrics.ranAt).toLocaleString()}
        </p>
      )}
      {benchmarkMetrics && <EvalResults metrics={benchmarkMetrics} />}
    </div>
  );
};
