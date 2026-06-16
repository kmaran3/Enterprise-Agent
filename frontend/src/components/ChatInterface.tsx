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