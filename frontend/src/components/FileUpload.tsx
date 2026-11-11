import React, { useState } from "react";
import axios from "axios";
import { IngestResponse } from "../types";

const API_URL = process.env.REACT_APP_API_URL ?? "http://localhost:8000";

interface Props {
  onUploadSuccess: () => void;
}

export const FileUpload: React.FC<Props> = ({ onUploadSuccess }) => {
  const [uploading, setUploading] = useState("");
  const [messages, setMessages] = useState<string[]>([]);

  const handleFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setMessages([]);

    // Upload one at a time so each file gets its own result
    let anySucceeded = false;
    for (const file of files) {
      const formData = new FormData();
      formData.append("file", file);
      setUploading(file.name);

      try {
        const res = await axios.post<IngestResponse>(
          `${API_URL}/upload`,
          formData
        );
        setMessages((prev) => [
          ...prev,
          `✓ Ingested ${res.data.chunksIngested} chunks from ${file.name}`,
        ]);
        anySucceeded = true;
      } catch {
        setMessages((prev) => [
          ...prev,
          `Upload failed for ${file.name}. Make sure the backend is running.`,
        ]);
      }
    }

    setUploading("");
    e.target.value = ""; // allow re-selecting the same files
    if (anySucceeded) onUploadSuccess();
  };

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <label style={{ fontWeight: 600, display: "block", marginBottom: 8 }}>
        Upload Company Documents (PDF)
      </label>
      <input
        type="file"
        accept=".pdf"
        multiple
        disabled={uploading !== ""}
        onChange={handleFileChange}
      />
      {uploading && <p style={{ color: "#666" }}>Ingesting {uploading}...</p>}
      {messages.map((message) => (
        <p
          key={message}
          style={{ color: message.startsWith("✓") ? "green" : "red", margin: "4px 0" }}
        >
          {message}
        </p>
      ))}
    </div>
  );
};
