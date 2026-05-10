"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type CaptureMessage = {
  source: "chatvault-bookmarklet";
  payload: {
    source: "chatgpt-bookmarklet";
    source_url?: string;
    captured_at: string;
    parser_version: string;
    cursor_max_updated_unix?: number;
    sync_summary?: {
      last_sync_unix?: number;
      total_summaries_seen?: number;
      changed_summary_count?: number;
      sent_conversation_count?: number;
      current_conversation_fallback?: boolean;
    };
    conversation?: {
      external_id?: string;
      title?: string;
      messages: Array<{ role: "user" | "assistant" | "system"; content: string; created_at?: string | null }>;
      created_at?: string;
      updated_at?: string;
    };
    conversations?: Array<{
      external_id?: string;
      title?: string;
      messages: Array<{ role: "user" | "assistant" | "system"; content: string; created_at?: string | null }>;
      created_at?: string;
      updated_at?: string;
      source_url?: string;
    }>;
  };
};

export default function CapturePage() {
  const [status, setStatus] = useState<"waiting" | "processing" | "success" | "error">("waiting");
  const [message, setMessage] = useState("Waiting for data from bookmarklet...");
  const [statusLine, setStatusLine] = useState("Status: Waiting for bookmarklet payload...");
  const [captureSummary, setCaptureSummary] = useState<string | null>(null);
  const handledPayloadRef = useRef(false);
  const aliveRef = useRef(true);
  const statusRef = useRef<"waiting" | "processing" | "success" | "error">("waiting");

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    aliveRef.current = true;

    function getCursorMaxUpdatedUnix(payload: CaptureMessage["payload"]) {
      if (typeof payload.cursor_max_updated_unix === "number" && Number.isFinite(payload.cursor_max_updated_unix)) {
        return payload.cursor_max_updated_unix;
      }
      const candidates = (payload.conversations ?? [])
        .map((conversation) => conversation.updated_at)
        .filter((value): value is string => typeof value === "string")
        .map((value) => Math.floor(new Date(value).getTime() / 1000))
        .filter((value) => Number.isFinite(value));
      return candidates.length ? Math.max(...candidates) : undefined;
    }

    function notifyOpener(ok: boolean, payload: CaptureMessage["payload"]) {
      if (!window.opener || window.opener.closed) return;
      const cursorMaxUpdatedUnix = getCursorMaxUpdatedUnix(payload);
      window.opener.postMessage(
        {
          source: "chatvault-capture-ack",
          ok,
          cursorMaxUpdatedUnix
        },
        "*"
      );
    }

    async function handleCapture(payload: CaptureMessage["payload"]) {
      const conversations = payload.conversations ?? (payload.conversation ? [payload.conversation] : []);
      const conversationCount = Array.isArray(payload.conversations)
        ? payload.conversations.length
        : payload.conversation
          ? 1
          : 0;
      const messageCount = Array.isArray(payload.conversations)
        ? payload.conversations.reduce((sum, conversation) => sum + conversation.messages.length, 0)
        : Array.isArray(payload.conversation?.messages)
          ? payload.conversation.messages.length
          : 0;
      const firstTitle = conversations[0]?.title || "Untitled conversation";
      const syncSummary = payload.sync_summary;
      const syncDetail = syncSummary
        ? `Seen: ${syncSummary.total_summaries_seen ?? "unknown"}, changed since cursor: ${syncSummary.changed_summary_count ?? "unknown"}, sent: ${syncSummary.sent_conversation_count ?? conversationCount}${syncSummary.current_conversation_fallback ? " (current-chat fallback)" : ""}.`
        : null;
      setStatus("processing");
      setStatusLine(`Status: Payload received (${conversationCount} conversation${conversationCount === 1 ? "" : "s"}, ${messageCount} messages).`);
      setCaptureSummary(`${firstTitle} · ${conversationCount} conversation${conversationCount === 1 ? "" : "s"} · ${messageCount} messages${syncDetail ? ` · ${syncDetail}` : ""}`);
      setMessage("Importing captured conversation...");
      setStatusLine("Status: Sending payload to /api/capture...");
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
        notifyOpener(true, payload);
        if (!aliveRef.current) return;
        setStatus("success");
        setStatusLine("Status: Sync complete.");
        setMessage(
          `Captured and synced: ${result.imported} imported (${result.created} new, ${result.updated} updated, ${result.skipped} skipped).`
        );
        setCaptureSummary(
          `${firstTitle} · ${conversationCount} conversation${conversationCount === 1 ? "" : "s"} · ${messageCount} messages${syncDetail ? ` · ${syncDetail}` : ""}`
        );
      } catch (error) {
        notifyOpener(false, payload);
        if (!aliveRef.current) return;
        setStatus("error");
        setStatusLine("Status: Sync failed.");
        setMessage(error instanceof Error ? error.message : "Capture failed.");
      }
    }

    function onMessage(event: MessageEvent<unknown>) {
      const data = event.data as Partial<CaptureMessage> | undefined;
      if (!data || data.source !== "chatvault-bookmarklet" || !data.payload) return;
      if (handledPayloadRef.current) {
        return;
      }
      handledPayloadRef.current = true;
      void handleCapture(data.payload);
    }

    window.addEventListener("message", onMessage);

    const timer = window.setTimeout(() => {
      if (aliveRef.current && statusRef.current === "waiting") {
        setMessage("No capture payload received yet. Keep this tab open and run the bookmarklet from a ChatGPT conversation page.");
        setStatusLine("Status: Still waiting for bookmarklet payload...");
      }
    }, 5000);

    return () => {
      aliveRef.current = false;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    };
  }, []);

  return (
    <main className="page-shell">
      <div className="container">
        <section className="card narrow-card">
          <div className="section-title">
            <div>
              <h1>Sync from GPT</h1>
              <p className="meta">Capture helper for incremental bookmarklet sync imports.</p>
              <p className="meta">Keep this tab open, then click the bookmarklet from an active ChatGPT tab.</p>
            </div>
          </div>
          <p className={`meta ${status === "error" ? "status-error" : status === "success" ? "status-success" : ""}`} style={{ marginTop: 12 }}>
            {message}
          </p>
          <p className="meta" style={{ marginTop: 8 }}>
            {statusLine}
          </p>
          {captureSummary ? (
            <p className="meta" style={{ marginTop: 8 }}>
              {captureSummary}
            </p>
          ) : null}
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
