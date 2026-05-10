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
      (async () => {
        try {
          const appOrigin = ${JSON.stringify(appOrigin)};
          const captureUrl = appOrigin + "/capture";
          const host = window.location.hostname.toLowerCase();
          const isChatGptHost = host === "chatgpt.com" || host === "chat.openai.com" || host.endsWith(".chatgpt.com");
          if (!isChatGptHost) {
            window.open("https://chatgpt.com/", "_blank", "noopener,noreferrer");
            alert("Run this bookmarklet from a ChatGPT tab (chatgpt.com). Opened ChatGPT in a new tab for you.");
            return;
          }

          const syncCursorKey = "chatvault.gpt.lastSyncUnix";
          const lastSyncUnix = Number(window.localStorage.getItem(syncCursorKey) || 0);

          const roleFromAuthor = (author) => {
            const role = typeof author === "string" ? author : author?.role;
            return role === "assistant" || role === "system" ? role : "user";
          };

          const extractText = (content) => {
            if (!content) return "";
            if (typeof content === "string") return content.trim();
            if (Array.isArray(content)) {
              return content.map(extractText).filter(Boolean).join("\\n").trim();
            }
            if (typeof content === "object") {
              const parts = Array.isArray(content.parts) ? content.parts : [];
              const text = typeof content.text === "string" ? content.text : "";
              return [text, ...parts.map(extractText)].filter(Boolean).join("\\n").trim();
            }
            return "";
          };
          const extractVisibleMessagesFromDom = () => {
            const nodes = Array.from(document.querySelectorAll("[data-message-author-role]"));
            return nodes
              .map((node) => {
                const roleRaw = node.getAttribute("data-message-author-role") || "user";
                const role = roleRaw === "assistant" || roleRaw === "system" ? roleRaw : "user";
                const content = (node.innerText || "").trim();
                return { role, content, created_at: null };
              })
              .filter((message) => message.content.length > 0);
          };

          const listAllConversations = async () => {
            const pageSize = 100;
            let offset = 0;
            const summaries = [];
            while (true) {
              const response = await fetch(window.location.origin + "/backend-api/conversations?offset=" + offset + "&limit=" + pageSize, {
                credentials: "include"
              });
              if (!response.ok) {
                throw new Error("Could not read conversations list (status " + response.status + ").");
              }
              const data = await response.json();
              const items = Array.isArray(data?.items)
                ? data.items
                : Array.isArray(data)
                  ? data
                  : [];
              if (!items.length) break;
              summaries.push(...items);
              if (items.length < pageSize) break;
              offset += pageSize;
            }
            return summaries;
          };

          const fetchConversation = async (id) => {
            const response = await fetch(window.location.origin + "/backend-api/conversation/" + id, {
              credentials: "include"
            });
            if (!response.ok) return null;
            return response.json();
          };

          const summaries = await listAllConversations();
          const incrementalCandidates = summaries.filter((item) => {
            const updated = Number(item?.update_time || item?.updated_at || 0);
            return updated > lastSyncUnix;
          });
          const changedSummaries = [...incrementalCandidates];
          const currentConversationMatch = window.location.pathname.match(/\\/c\\/([a-zA-Z0-9-]+)/);
          const currentConversationId = currentConversationMatch ? currentConversationMatch[1] : null;
          let usedCurrentConversationFallback = false;
          if (changedSummaries.length === 0 && currentConversationId) {
            changedSummaries.push({ id: currentConversationId });
            usedCurrentConversationFallback = true;
          }

          if (!changedSummaries.length) {
            alert("No new ChatGPT conversations since last sync.");
            return;
          }

          const normalizedConversations = [];
          let maxUpdatedUnix = lastSyncUnix;

          for (const summary of changedSummaries) {
            const id = summary?.id;
            if (!id) continue;
            const detail = await fetchConversation(id);
            const isCurrentConversation = currentConversationId === id;
            const fallbackDomMessages = isCurrentConversation ? extractVisibleMessagesFromDom() : [];
            if ((!detail || typeof detail !== "object") && fallbackDomMessages.length === 0) continue;

            const mapping = detail?.mapping && typeof detail.mapping === "object" ? detail.mapping : {};
            const mappedMessages = Object.values(mapping)
              .map((node) => node?.message)
              .filter(Boolean)
              .sort((a, b) => {
                const aTime = Number(a?.create_time || 0);
                const bTime = Number(b?.create_time || 0);
                return aTime - bTime;
              })
              .map((message) => {
                const role = roleFromAuthor(message.author);
                const content = extractText(message.content);
                const createdAt = message.create_time
                  ? new Date(Number(message.create_time) * 1000).toISOString()
                  : null;
                return { role, content, created_at: createdAt };
              })
              .filter((message) => message.content.length > 0);
            const messages = mappedMessages.length > 0 ? mappedMessages : fallbackDomMessages;

            if (!messages.length) continue;

            const createdUnix = Number(summary?.create_time || detail?.create_time || 0);
            const updatedUnix = Number(summary?.update_time || detail?.update_time || createdUnix || 0);
            if (updatedUnix > maxUpdatedUnix) maxUpdatedUnix = updatedUnix;

            normalizedConversations.push({
              external_id: "chatgpt-" + id,
              title: (summary?.title || detail?.title || "ChatGPT conversation").trim(),
              source_url: "https://chatgpt.com/c/" + id,
              created_at: createdUnix ? new Date(createdUnix * 1000).toISOString() : new Date().toISOString(),
              updated_at: updatedUnix ? new Date(updatedUnix * 1000).toISOString() : new Date().toISOString(),
              messages
            });
          }

          if (!normalizedConversations.length) {
            alert("No importable messages found in changed conversations.");
            return;
          }

          const now = new Date().toISOString();
          const maxUpdatedIso = normalizedConversations.reduce((max, item) => {
            if (!item.updated_at) return max;
            if (!max) return item.updated_at;
            return item.updated_at > max ? item.updated_at : max;
          }, null);
          const finalMaxUpdatedUnix = maxUpdatedIso ? Math.floor(new Date(maxUpdatedIso).getTime() / 1000) : lastSyncUnix;
          const payload = {
            source: "chatvault-bookmarklet",
            payload: {
              source: "chatgpt-bookmarklet",
              source_url: window.location.href,
              captured_at: now,
              parser_version: "bookmarklet-v2-incremental",
              conversations: normalizedConversations,
              cursor_max_updated_unix: finalMaxUpdatedUnix,
              sync_summary: {
                last_sync_unix: lastSyncUnix,
                total_summaries_seen: summaries.length,
                changed_summary_count: incrementalCandidates.length,
                sent_conversation_count: normalizedConversations.length,
                current_conversation_fallback: usedCurrentConversationFallback
              }
            }
          };
          const popup = window.open(captureUrl, "_blank");
          if (!popup) {
            alert("Popup blocked. Please allow popups for this action.");
            return;
          }

          let acknowledged = false;
          const onAck = (event) => {
            if (event.origin !== appOrigin) return;
            const data = event.data;
            if (!data || data.source !== "chatvault-capture-ack") return;
            acknowledged = true;
            if (data.ok) {
              const nextCursor =
                typeof data.cursorMaxUpdatedUnix === "number"
                  ? data.cursorMaxUpdatedUnix
                  : finalMaxUpdatedUnix || Math.floor(Date.now() / 1000);
              window.localStorage.setItem(syncCursorKey, String(nextCursor));
            }
            window.removeEventListener("message", onAck);
          };
          window.addEventListener("message", onAck);

          const send = () => popup.postMessage(payload, appOrigin);
          setTimeout(send, 600);
          setTimeout(send, 1500);
          setTimeout(send, 2800);
          setTimeout(() => {
            if (acknowledged) return;
            window.removeEventListener("message", onAck);
          }, 8000);
        } catch (error) {
          alert("Bookmarklet failed: " + (error?.message || error));
        }
      })();
    `;

    return `javascript:${source.replace(/\s+/g, " ").trim()}`;
  }

  function getResetCursorBookmarkletCode() {
    const source = `
      (() => {
        const host = window.location.hostname.toLowerCase();
        const isChatGptHost = host === "chatgpt.com" || host === "chat.openai.com" || host.endsWith(".chatgpt.com");
        if (!isChatGptHost) {
          window.open("https://chatgpt.com/", "_blank", "noopener,noreferrer");
          alert("Open ChatGPT, then run this reset bookmarklet there.");
          return;
        }
        window.localStorage.removeItem("chatvault.gpt.lastSyncUnix");
        alert("Chat Vault GPT sync cursor reset. The next incremental sync will scan from the beginning.");
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
      setBookmarkletStatus(
        "Bookmarklet copied. Add it to your bookmarks bar, open ChatGPT, and click it to incrementally sync new/updated conversations."
      );
    } catch (error) {
      setBookmarkletStatus(error instanceof Error ? error.message : "Could not copy bookmarklet.");
    }
  }

  async function copyResetCursorBookmarklet() {
    setBookmarkletStatus(null);
    try {
      if (!navigator.clipboard) {
        throw new Error("Clipboard API unavailable in this browser.");
      }
      await navigator.clipboard.writeText(getResetCursorBookmarkletCode());
      setBookmarkletStatus("Reset bookmarklet copied. Add it to your bookmarks bar, open ChatGPT, and click it to force the next sync to rescan.");
    } catch (error) {
      setBookmarkletStatus(error instanceof Error ? error.message : "Could not copy reset bookmarklet.");
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
          Copy Incremental Sync Bookmarklet
        </button>
        <button className="button secondary" type="button" onClick={copyResetCursorBookmarklet}>
          Copy Reset GPT Cursor
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
