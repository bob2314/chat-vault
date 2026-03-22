"use client";

import { useEffect, useRef, useState } from "react";

export function ImportPanel() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const gptSyncInputRef = useRef<HTMLInputElement | null>(null);
  const [payload, setPayload] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"neutral" | "success" | "error">("neutral");
  const [importing, setImporting] = useState(false);
  const [lastGptSyncAt, setLastGptSyncAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/import");
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) {
          setLastGptSyncAt(typeof data.lastGptSyncAt === "string" ? data.lastGptSyncAt : null);
        }
      } catch {
        // quiet fail: import panel still works without status fetch
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      setStatus(
        `Imported ${data.imported} (${data.created} new, ${data.updated} updated, ${data.skipped} skipped) using ${data.provider}.`
      );
      setStatusTone("success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Import failed.");
      setStatusTone("error");
    } finally {
      setImporting(false);
    }
  }

  async function handleGptSyncFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setStatus(null);
    setStatusTone("neutral");
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/import", {
        method: "POST",
        body: formData
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Sync failed.");
      setStatus(
        `Synced from GPT export: ${data.imported} imported (${data.created} new, ${data.updated} updated, ${data.skipped} skipped).`
      );
      setStatusTone("success");
      if (typeof data.syncedAt === "string") {
        setLastGptSyncAt(data.syncedAt);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Sync failed.");
      setStatusTone("error");
    } finally {
      setImporting(false);
      event.target.value = "";
    }
  }

  return (
    <div className="card">
      <div className="section-title">
        <div>
          <h2>Import</h2>
          <p className="meta">Paste JSON, load a local file, or sync from an official ChatGPT export ZIP.</p>
          <p className="meta" style={{ marginTop: 6 }}>
            Last GPT sync: {lastGptSyncAt ? new Date(lastGptSyncAt).toLocaleString() : "never"}
          </p>
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
        <button className="button secondary" type="button" onClick={() => gptSyncInputRef.current?.click()} disabled={importing}>
          Sync from GPT
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
        <input
          ref={gptSyncInputRef}
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          onChange={handleGptSyncFile}
          style={{ display: "none" }}
        />
      </div>
      {status ? <p className={`meta status-${statusTone}`} style={{ marginTop: 12 }}>{status}</p> : null}
    </div>
  );
}
