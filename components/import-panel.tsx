"use client";

import { useEffect, useRef, useState } from "react";
import JSZip from "jszip";

export function ImportPanel() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const gptSyncInputRef = useRef<HTMLInputElement | null>(null);
  const [payload, setPayload] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"neutral" | "success" | "error">("neutral");
  const [importing, setImporting] = useState(false);
  const [lastGptSyncAt, setLastGptSyncAt] = useState<string | null>(null);
  const [lastGptSourceUpdatedAt, setLastGptSourceUpdatedAt] = useState<string | null>(null);
  const [bookmarkletStatus, setBookmarkletStatus] = useState<string | null>(null);

  function getBookmarkletCode(appOrigin: string) {
    const source = `
      (() => {
        try {
          const appOrigin = ${JSON.stringify(appOrigin)};
          const captureUrl = appOrigin + "/capture";
          const popup = window.open(captureUrl, "_blank");
          if (!popup) {
            alert("Popup blocked. Please allow popups for this action.");
            return;
          }

          const nodes = Array.from(document.querySelectorAll('[data-message-author-role]'));
          const messages = nodes
            .map((node) => {
              const roleRaw = node.getAttribute("data-message-author-role") || "user";
              const role = roleRaw === "assistant" || roleRaw === "system" ? roleRaw : "user";
              const content = (node.innerText || "").trim();
              return { role, content };
            })
            .filter((item) => item.content.length > 0);

          if (!messages.length) {
            alert("No messages detected on this page.");
            return;
          }

          const titleFromH1 = document.querySelector("h1")?.textContent?.trim();
          const conversationIdMatch = window.location.pathname.match(/\\/c\\/([a-zA-Z0-9-]+)/);
          const conversationId = conversationIdMatch ? ("chatgpt-" + conversationIdMatch[1]) : undefined;
          const title = titleFromH1 || document.title.replace(/\\s*-\\s*ChatGPT\\s*$/i, "").trim() || "ChatGPT conversation";
          const now = new Date().toISOString();
          const payload = {
            source: "chatvault-bookmarklet",
            payload: {
              source: "chatgpt-bookmarklet",
              source_url: window.location.href,
              captured_at: now,
              parser_version: "bookmarklet-v1",
              conversation: {
                external_id: conversationId,
                title,
                created_at: now,
                updated_at: now,
                messages: messages.map((message) => ({
                  role: message.role,
                  content: message.content
                }))
              }
            }
          };

          const send = () => popup.postMessage(payload, appOrigin);
          setTimeout(send, 600);
          setTimeout(send, 1500);
          setTimeout(send, 2800);
        } catch (error) {
          alert("Bookmarklet failed: " + (error?.message || error));
        }
      })();
    `;

    return `javascript:${source.replace(/\s+/g, " ").trim()}`;
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/import");
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) {
          setLastGptSyncAt(typeof data.lastGptSyncAt === "string" ? data.lastGptSyncAt : null);
          setLastGptSourceUpdatedAt(typeof data.lastGptSourceUpdatedAt === "string" ? data.lastGptSourceUpdatedAt : null);
        }
      } catch {
        // quiet fail: import panel still works without status fetch
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function toNumber(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  }

  function maxIsoTimestamp(a: string | null, b: string | null) {
    if (!a) return b;
    if (!b) return a;
    return a > b ? a : b;
  }

  function buildConversationChunks(conversations: unknown[], options?: { maxChunkBytes?: number; maxItems?: number }) {
    const maxChunkBytes = options?.maxChunkBytes ?? 2_500_000;
    const maxItems = options?.maxItems ?? 40;
    const chunks: unknown[][] = [];
    const encoder = new TextEncoder();
    let current: unknown[] = [];
    let currentBytes = 2; // []

    for (const conversation of conversations) {
      const serialized = JSON.stringify(conversation);
      const serializedBytes = encoder.encode(serialized).length;
      const itemBytes = serializedBytes + (current.length > 0 ? 1 : 0); // comma
      const needsSplit = current.length > 0 && (current.length >= maxItems || currentBytes + itemBytes > maxChunkBytes);

      if (needsSplit) {
        chunks.push(current);
        current = [];
        currentBytes = 2;
      }

      current.push(conversation);
      currentBytes += serializedBytes + (current.length > 1 ? 1 : 0);
    }

    if (current.length > 0) {
      chunks.push(current);
    }

    return chunks;
  }

  async function extractConversationsFromZip(file: File) {
    const zip = await JSZip.loadAsync(file);
    const conversationEntries = Object.values(zip.files)
      .filter((entry) => {
        if (entry.dir) return false;
        const lower = entry.name.toLowerCase();
        const base = lower.split("/").at(-1) || lower;
        return /^conversations(?:-\d+)?\.json$/.test(base);
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    if (conversationEntries.length === 0) {
      throw new Error("Could not find conversations JSON files in ZIP export.");
    }

    const combinedConversations: unknown[] = [];

    for (const entry of conversationEntries) {
      const text = await entry.async("text");
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) {
        combinedConversations.push(...parsed);
        continue;
      }
      if (parsed && typeof parsed === "object" && Array.isArray((parsed as { conversations?: unknown[] }).conversations)) {
        combinedConversations.push(...(parsed as { conversations: unknown[] }).conversations);
      }
    }

    if (combinedConversations.length === 0) {
      throw new Error("Conversations JSON files were found, but no conversations could be parsed.");
    }

    return combinedConversations;
  }

  async function readApiResponse(response: Response) {
    const contentType = response.headers.get("content-type") || "";
    const bodyText = await response.text();

    if (contentType.includes("application/json")) {
      try {
        return JSON.parse(bodyText) as Record<string, unknown>;
      } catch {
        // Fall through and treat body as plain text for a clearer error.
      }
    }

    const message = bodyText.trim();
    if (!response.ok) {
      if (response.status === 413 || /request entity too large/i.test(message)) {
        throw new Error("Upload is too large for this deployment. Try a smaller ZIP, or import JSON in smaller chunks.");
      }
      throw new Error(message || `Request failed with status ${response.status}.`);
    }

    return {};
  }

  async function importConversationsInChunks(conversations: unknown[]) {
    const chunks = buildConversationChunks(conversations);
    let processed = 0;
    let imported = 0;
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let latestSyncedAt: string | null = null;
    let latestSourceUpdatedAt: string | null = null;

    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      setStatus(`Uploading GPT export chunk ${index + 1}/${chunks.length} (${chunk.length} conversations)...`);
      const response = await fetch("/api/import?source=gpt_sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chunk)
      });
      const data = await readApiResponse(response);
      if (!response.ok) {
        throw new Error((typeof data.error === "string" && data.error) || "Sync failed.");
      }

      processed += toNumber(data.processed);
      imported += toNumber(data.imported);
      created += toNumber(data.created);
      updated += toNumber(data.updated);
      skipped += toNumber(data.skipped);
      latestSyncedAt = maxIsoTimestamp(latestSyncedAt, typeof data.syncedAt === "string" ? data.syncedAt : null);
      latestSourceUpdatedAt = maxIsoTimestamp(
        latestSourceUpdatedAt,
        typeof data.sourceMaxUpdatedAt === "string" ? data.sourceMaxUpdatedAt : null
      );
    }

    setStatus(`Synced from GPT export: ${imported} imported (${created} new, ${updated} updated, ${skipped} skipped) across ${processed} processed.`);
    setStatusTone("success");
    if (latestSyncedAt) setLastGptSyncAt(latestSyncedAt);
    if (latestSourceUpdatedAt) setLastGptSourceUpdatedAt(latestSourceUpdatedAt);
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.name.toLowerCase().endsWith(".zip")) {
      await syncFromGptZip(file);
      event.target.value = "";
      return;
    }
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
      const data = await readApiResponse(response);
      if (!response.ok) throw new Error((typeof data.error === "string" && data.error) || "Import failed.");
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

  async function syncFromGptZip(file: File) {
    setStatus(null);
    setStatusTone("neutral");
    setImporting(true);
    try {
      setStatus("Reading ZIP and preparing chunked import...");
      const conversations = await extractConversationsFromZip(file);
      await importConversationsInChunks(conversations);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Sync failed.");
      setStatusTone("error");
    } finally {
      setImporting(false);
    }
  }

  async function handleGptSyncFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    await syncFromGptZip(file);
    event.target.value = "";
  }

  async function copyBookmarklet() {
    setBookmarkletStatus(null);
    try {
      if (!navigator.clipboard) {
        throw new Error("Clipboard API unavailable in this browser.");
      }
      const code = getBookmarkletCode(window.location.origin);
      await navigator.clipboard.writeText(code);
      setBookmarkletStatus("Bookmarklet copied. Add it to your bookmarks bar, then click it on a ChatGPT conversation.");
    } catch (error) {
      setBookmarkletStatus(error instanceof Error ? error.message : "Could not copy bookmarklet.");
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
          <p className="meta" style={{ marginTop: 4 }}>
            Last GPT source update seen: {lastGptSourceUpdatedAt ? new Date(lastGptSourceUpdatedAt).toLocaleString() : "unknown"}
          </p>
        </div>
      </div>
      <div className="button-row" style={{ marginBottom: 12 }}>
        <button className="button secondary" type="button" onClick={copyBookmarklet}>
          Copy Sync Bookmarklet
        </button>
      </div>
      {bookmarkletStatus ? <p className="meta" style={{ marginBottom: 12 }}>{bookmarkletStatus}</p> : null}
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
          accept=".json,.txt,.zip,application/json,text/plain,application/zip,application/x-zip-compressed"
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
