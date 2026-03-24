"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type CaptureMessage = {
  source: "chatvault-bookmarklet";
  payload: {
    source: "chatgpt-bookmarklet";
    source_url?: string;
    captured_at: string;
    parser_version: string;
    conversation: {
      external_id?: string;
      title?: string;
      messages: Array<{ role: "user" | "assistant" | "system"; content: string; created_at?: string | null }>;
      created_at?: string;
      updated_at?: string;
    };
  };
};

export default function CapturePage() {
  const [status, setStatus] = useState<"waiting" | "processing" | "success" | "error">("waiting");
  const [message, setMessage] = useState("Waiting for data from bookmarklet...");

  useEffect(() => {
    let alive = true;

    async function handleCapture(payload: CaptureMessage["payload"]) {
      setStatus("processing");
      setMessage("Importing captured conversation...");
      try {
        const response = await fetch("/api/capture", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || "Import failed.");
        }
        if (!alive) return;
        setStatus("success");
        setMessage(
          `Captured and synced: ${result.imported} imported (${result.created} new, ${result.updated} updated, ${result.skipped} skipped).`
        );
      } catch (error) {
        if (!alive) return;
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "Capture failed.");
      }
    }

    function onMessage(event: MessageEvent<unknown>) {
      const data = event.data as Partial<CaptureMessage> | undefined;
      if (!data || data.source !== "chatvault-bookmarklet" || !data.payload) return;
      void handleCapture(data.payload);
    }

    window.addEventListener("message", onMessage);

    const timer = window.setTimeout(() => {
      if (alive && status === "waiting") {
        setMessage("No capture payload received yet. Keep this tab open and run the bookmarklet from a ChatGPT conversation page.");
      }
    }, 5000);

    return () => {
      alive = false;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    };
  }, [status]);

  return (
    <main className="page-shell">
      <div className="container">
        <section className="card narrow-card">
          <div className="section-title">
            <div>
              <h1>Sync from GPT</h1>
              <p className="meta">Capture helper for bookmarklet imports.</p>
            </div>
          </div>
          <p className={`meta ${status === "error" ? "status-error" : status === "success" ? "status-success" : ""}`} style={{ marginTop: 12 }}>
            {message}
          </p>
          <div className="button-row" style={{ marginTop: 14 }}>
            <Link className="button secondary" href="/">
              Back to vault
            </Link>
            <a className="button secondary" href="https://chatgpt.com/" target="_blank" rel="noreferrer">
              Open ChatGPT
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}
