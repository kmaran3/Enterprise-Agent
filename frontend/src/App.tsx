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