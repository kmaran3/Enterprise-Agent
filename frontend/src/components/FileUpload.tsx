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