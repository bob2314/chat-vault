"use client";

import { useRef, useState } from "react";

export function ImportPanel() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [payload, setPayload] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"neutral" | "success" | "error">("neutral");
  const [importing, setImporting] = useState(false);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setPayload(text);
      setStatusTone("neutral");
      setStatus(`Loaded ${file.name}. Review/edit if needed, then click Import now.`);
    } catch {
      setStatusTone("error");
      setStatus("Could not read that file. Try a JSON or text export file.");
    } finally {
      event.target.value = "";
    }
  }

  async function handleImport() {
    setStatus(null);
    setStatusTone("neutral");
    setImporting(true);
    try {
      const parsed = JSON.parse(payload);
      const response = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Import failed.");
      setStatus(`Imported ${data.imported} conversations using ${data.provider}. Refresh to see them.`);
      setStatusTone("success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Import failed.");
      setStatusTone("error");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="card">
      <div className="section-title">
        <div>
          <h2>Import</h2>
          <p className="meta">Supports the sample JSON shape and rough ChatGPT conversations export arrays.</p>
        </div>
      </div>
      <textarea
        className="textarea"
        rows={16}
        value={payload}
        onChange={(event) => setPayload(event.target.value)}
        placeholder='Paste sample JSON or a ChatGPT export array here…'
      />
      <div className="button-row" style={{ marginTop: 12 }}>
        <button className="button primary" type="button" onClick={handleImport} disabled={importing}>
          {importing ? "Importing..." : "Import now"}
        </button>
        <button className="button secondary" type="button" onClick={() => fileInputRef.current?.click()} disabled={importing}>
          Choose file
        </button>
        <button className="button secondary" type="button" onClick={() => setPayload("")} disabled={importing || payload.length === 0}>
          Clear
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.txt,application/json,text/plain"
          onChange={handleFileChange}
          style={{ display: "none" }}
        />
      </div>
      {status ? <p className={`meta status-${statusTone}`} style={{ marginTop: 12 }}>{status}</p> : null}
    </div>
  );
}
