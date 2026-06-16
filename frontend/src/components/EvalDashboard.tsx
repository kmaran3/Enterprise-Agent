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