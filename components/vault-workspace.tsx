"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ImportPanel } from "@/components/import-panel";
import type { ConversationSearchResult, SavedSearch, SearchResponse } from "@/types";

type Props = {
  initialData: SearchResponse;
  initialSavedSearches: SavedSearch[];
};

type ConversationPreviewResponse = {
  id: string;
  title: string;
  messages: Array<{ id: string; role: string; content: string; createdAt: string | null }>;
};

type PreviewState = {
  loading: boolean;
  error: string | null;
  messages: Array<{ id: string; role: string; content: string; createdAt: string | null }>;
};

type WorkspaceItem = {
  conversationId: string;
  title: string;
  snippet: string;
  tags: string[];
  topics: string[];
  bestMessageId: string | null;
};

type WorkspaceSummary = {
  summary: string;
  keyPoints: string[];
  sources: Array<{ id: string; title: string }>;
};

function tokenize(input: string) {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function escapeHtml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function highlightText(content: string, query: string) {
  const terms = [...new Set(tokenize(query))].sort((a, b) => b.length - a.length);
  if (terms.length === 0) return escapeHtml(content);
  return terms.reduce((output, term) => {
    const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig");
    return output.replace(regex, "<mark>$1</mark>");
  }, escapeHtml(content));
}

function resolveChatGptConversationUrl(conversationId: string) {
  const prefixed = conversationId.match(/^chatgpt-([a-z0-9-]+)$/i);
  if (prefixed?.[1]) return `https://chatgpt.com/c/${prefixed[1]}`;
  return null;
}

function buildConversationHref(result: ConversationSearchResult, query: string) {
  return buildConversationHrefFromParts(result.id, result.bestMessageId, query);
}

function buildConversationHrefFromParts(conversationId: string, bestMessageId: string | null, query: string) {
  const linkParams = new URLSearchParams();
  if (bestMessageId) {
    linkParams.set("m", bestMessageId);
  }
  if (query.trim()) {
    linkParams.set("q", query.trim());
  }
  const href = linkParams.size > 0
    ? `/conversation/${conversationId}?${linkParams.toString()}`
    : `/conversation/${conversationId}`;
  return bestMessageId ? `${href}#message-${bestMessageId}` : href;
}

function groupResults(results: ConversationSearchResult[]) {
  if (results.length === 0) return { best: [] as ConversationSearchResult[], related: [] as ConversationSearchResult[], loose: [] as ConversationSearchResult[] };
  const topScore = Math.max(results[0]?.score ?? 0, 0.0001);
  const best: ConversationSearchResult[] = [];
  const related: ConversationSearchResult[] = [];
  const loose: ConversationSearchResult[] = [];

  results.forEach((result, index) => {
    const ratio = result.score / topScore;
    if (index === 0 || ratio >= 0.75) {
      best.push(result);
    } else if (ratio >= 0.45) {
      related.push(result);
    } else {
      loose.push(result);
    }
  });

  return { best, related, loose };
}

export function VaultWorkspace({ initialData, initialSavedSearches }: Props) {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResponse>(initialData);
  const [error, setError] = useState<string | null>(null);
  const [savedSearches, setSavedSearches] = useState(initialSavedSearches);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewByConversation, setPreviewByConversation] = useState<Record<string, PreviewState>>({});
  const [workspaceItems, setWorkspaceItems] = useState<WorkspaceItem[]>([]);
  const [workspaceSummary, setWorkspaceSummary] = useState<WorkspaceSummary | null>(null);
  const [workspaceSummaryLoading, setWorkspaceSummaryLoading] = useState(false);
  const [workspaceSummaryError, setWorkspaceSummaryError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("chatvault.workspace.pins");
      if (!raw) return;
      const parsed = JSON.parse(raw) as WorkspaceItem[];
      if (Array.isArray(parsed)) {
        setWorkspaceItems(parsed.filter((item) => item && typeof item.conversationId === "string"));
      }
    } catch {
      // ignore invalid local storage payloads
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("chatvault.workspace.pins", JSON.stringify(workspaceItems));
    } catch {
      // ignore local storage errors
    }
  }, [workspaceItems]);

  const availableTags = useMemo(
    () => results.availableTags ?? [...new Set(results.results.flatMap((result) => result.tags))].sort(),
    [results.availableTags, results.results]
  );
  const availableTopics = useMemo(
    () => results.availableTopics ?? [...new Set(results.results.flatMap((result) => result.topics))].sort(),
    [results.availableTopics, results.results]
  );
  const filteredTagOptions = useMemo(() => {
    const term = tag.trim().toLowerCase();
    if (!term) return availableTags;
    return availableTags.filter((item) => item.toLowerCase().includes(term));
  }, [availableTags, tag]);
  const filteredTopicOptions = useMemo(() => {
    const term = topic.trim().toLowerCase();
    if (!term) return availableTopics;
    return availableTopics.filter((item) => item.toLowerCase().includes(term));
  }, [availableTopics, topic]);
  const groupedResults = useMemo(() => groupResults(results.results), [results.results]);
  const rankByConversationId = useMemo(
    () =>
      Object.fromEntries(results.results.map((result, index) => [result.id, index + 1])) as Record<string, number>,
    [results.results]
  );
  const relatedByConversationId = useMemo(() => {
    const byId = new Map(results.results.map((result) => [result.id, result]));
    const related = new Map<string, string[]>();
    for (const current of results.results) {
      const currentTagSet = new Set(current.tags);
      const currentTopicSet = new Set(current.topics);
      const currentTitleTerms = new Set(tokenize(current.title));
      const scored = results.results
        .filter((candidate) => candidate.id !== current.id)
        .map((candidate) => {
          const sharedTags = candidate.tags.filter((tagValue) => currentTagSet.has(tagValue)).length;
          const sharedTopics = candidate.topics.filter((topicValue) => currentTopicSet.has(topicValue)).length;
          const sharedTitleTerms = tokenize(candidate.title).filter((term) => currentTitleTerms.has(term)).length;
          const score = sharedTags * 3 + sharedTopics * 2 + sharedTitleTerms;
          return { id: candidate.id, score };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 2)
        .map((item) => item.id)
        .filter((id) => byId.has(id));
      related.set(current.id, scored);
    }
    return related;
  }, [results.results]);

  function trackResultClick(resultId: string, rankPosition: number) {
    const payload = {
      conversationId: resultId,
      query: query || null,
      tag: tag || null,
      topic: topic || null,
      rankPosition
    };
    const body = JSON.stringify(payload);

    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon("/api/search/click", blob);
      return;
    }

    void fetch("/api/search/click", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true
    });
  }

  function addToWorkspace(result: ConversationSearchResult) {
    setWorkspaceItems((current) => {
      if (current.some((item) => item.conversationId === result.id)) {
        return current;
      }
      const next: WorkspaceItem = {
        conversationId: result.id,
        title: result.title,
        snippet: result.snippet,
        tags: result.tags,
        topics: result.topics,
        bestMessageId: result.bestMessageId
      };
      return [next, ...current].slice(0, 20);
    });
  }

  function removeFromWorkspace(conversationId: string) {
    setWorkspaceItems((current) => current.filter((item) => item.conversationId !== conversationId));
  }

  async function summarizeWorkspace() {
    if (workspaceItems.length < 2) return;
    setWorkspaceSummaryLoading(true);
    setWorkspaceSummaryError(null);
    try {
      const response = await fetch("/api/workspace/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationIds: workspaceItems.map((item) => item.conversationId) })
      });
      const data = (await response.json()) as WorkspaceSummary | { error?: string };
      if (!response.ok || !("summary" in data)) {
        throw new Error(("error" in data && typeof data.error === "string" && data.error) || "Could not summarize workspace.");
      }
      setWorkspaceSummary(data);
    } catch (summaryError) {
      setWorkspaceSummaryError(summaryError instanceof Error ? summaryError.message : "Could not summarize workspace.");
    } finally {
      setWorkspaceSummaryLoading(false);
    }
  }

  async function runSearch(nextQuery = query, nextTag = tag, nextTopic = topic) {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (nextQuery.trim()) params.set("q", nextQuery.trim());
    if (nextTag) params.set("tag", nextTag);
    if (nextTopic) params.set("topic", nextTopic);

    try {
      const response = await fetch(`/api/search?${params.toString()}`);
      const data = (await response.json()) as SearchResponse;
      setResults(data);
      setQuery(nextQuery);
      setTag(nextTag);
      setTopic(nextTopic);
    } catch {
      setError("Search failed. Check the server logs, seed data, or your auth session.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveSearch() {
    setSaving(true);
    setError(null);
    const payload = {
      name: saveName.trim() || `${query || "All chats"}${tag ? ` / #${tag}` : ""}${topic ? ` / ${topic}` : ""}`,
      query,
      tag: tag || null,
      topic: topic || null
    };

    try {
      const response = await fetch("/api/saved-searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        setError("Could not save search.");
        return;
      }

      const saved = (await response.json()) as SavedSearch;
      setSavedSearches([saved, ...savedSearches]);
      setSaveName("");
    } catch {
      setError("Could not save search.");
    } finally {
      setSaving(false);
    }
  }

  async function togglePreview(input: { conversationId: string; bestMessageId?: string | null }) {
    const existing = previewByConversation[input.conversationId];
    if (existing) {
      setPreviewByConversation((current) => {
        const next = { ...current };
        delete next[input.conversationId];
        return next;
      });
      return;
    }

    setPreviewByConversation((current) => ({
      ...current,
      [input.conversationId]: { loading: true, error: null, messages: [] }
    }));

    try {
      const response = await fetch(`/api/conversations/${input.conversationId}`);
      const data = (await response.json()) as ConversationPreviewResponse | { error?: string };
      if (!response.ok || !("messages" in data)) {
        throw new Error(("error" in data && typeof data.error === "string" && data.error) || "Could not load conversation preview.");
      }

      const messages = data.messages;
      const terms = tokenize(query);
      const centerIndexById = input.bestMessageId ? messages.findIndex((message) => message.id === input.bestMessageId) : -1;
      const centerIndexByQuery = centerIndexById >= 0
        ? centerIndexById
        : messages.findIndex((message) => terms.some((term) => message.content.toLowerCase().includes(term)));
      const center = centerIndexByQuery >= 0 ? centerIndexByQuery : 0;
      const start = Math.max(0, center - 2);
      const end = Math.min(messages.length, center + 3);
      const previewMessages = messages.slice(start, end);

      setPreviewByConversation((current) => ({
        ...current,
        [input.conversationId]: { loading: false, error: null, messages: previewMessages }
      }));
    } catch (loadError) {
      setPreviewByConversation((current) => ({
        ...current,
        [input.conversationId]: {
          loading: false,
          error: loadError instanceof Error ? loadError.message : "Could not load conversation preview.",
          messages: []
        }
      }));
    }
  }

  function renderResultCard(result: ConversationSearchResult, rankPosition: number, isTopCard = false) {
    const href = buildConversationHref(result, query);
    const chatGptUrl = resolveChatGptConversationUrl(result.id);
    const preview = previewByConversation[result.id];
    const hasPreview = Boolean(preview);
    const isPinned = workspaceItems.some((item) => item.conversationId === result.id);
    const relatedItems = (relatedByConversationId.get(result.id) ?? [])
      .map((conversationId) => results.results.find((candidate) => candidate.id === conversationId))
      .filter(Boolean) as ConversationSearchResult[];

    return (
      <article className={`result-card ${isTopCard ? "result-card-primary" : ""}`} key={result.id}>
        <div className="section-title" style={{ alignItems: "flex-start" }}>
          <div>
            <h3>
              <a href={href} onClick={() => trackResultClick(result.id, rankPosition)}>
                {result.title}
              </a>
            </h3>
            <p className="meta">{new Date(result.updatedAt).toLocaleString()} · {result.messageCount} messages</p>
          </div>
        </div>
        {isTopCard ? (
          <p className="meta">
            Best match because: {result.matchFields.slice(0, 3).map((field) => `${field} match`).join(", ") || "high overall relevance"}.
          </p>
        ) : null}
        <div className="result-actions">
          <a className="button primary small" href={href} onClick={() => trackResultClick(result.id, rankPosition)}>
            Jump to match
          </a>
          {chatGptUrl ? (
            <a className="button secondary small" href={chatGptUrl} target="_blank" rel="noreferrer">
              Open in ChatGPT
            </a>
          ) : null}
          <button className="button secondary small" type="button" onClick={() => togglePreview({ conversationId: result.id, bestMessageId: result.bestMessageId })}>
            {hasPreview ? "Hide context" : "Show context"}
          </button>
          <button
            className="button secondary small"
            type="button"
            onClick={() => (isPinned ? removeFromWorkspace(result.id) : addToWorkspace(result))}
          >
            {isPinned ? "Unpin" : "Pin to workspace"}
          </button>
        </div>
        {preview ? (
          <div className="context-preview">
            {preview.loading ? <p className="meta">Loading context...</p> : null}
            {preview.error ? <p className="meta error-text">{preview.error}</p> : null}
            {!preview.loading && !preview.error ? preview.messages.map((message) => (
              <div className="context-message" key={`${result.id}-${message.id}`}>
                <p className="meta"><strong>{message.role}</strong> {message.createdAt ? `· ${new Date(message.createdAt).toLocaleString()}` : ""}</p>
                <pre className="message-content" dangerouslySetInnerHTML={{ __html: highlightText(message.content, query) }} />
              </div>
            )) : null}
          </div>
        ) : null}
        {result.matchSignals.length > 0 ? (
          <div className="tags" style={{ marginTop: 8 }}>
            {result.matchSignals.slice(0, 3).map((signal) => (
              <span className="tag signal-tag" key={`${result.id}-signal-${signal}`}>
                {signal}
              </span>
            ))}
          </div>
        ) : null}
        {result.matchFields.length > 0 ? (
          <div className="tags" style={{ marginTop: 8 }}>
            {result.matchFields.map((field) => (
              <span className="tag match-badge" key={`${result.id}-field-${field}`}>
                {field} match
              </span>
            ))}
          </div>
        ) : null}
        <div className="tags" style={{ marginTop: 10 }}>
          {result.tags.map((tagValue) => <span className="tag" key={`${result.id}-${tagValue}`}>#{tagValue}</span>)}
          {result.topics.map((topicValue) => <span className="tag" key={`${result.id}-${topicValue}`}>topic:{topicValue}</span>)}
        </div>
        <p className="snippet" dangerouslySetInnerHTML={{ __html: result.snippet }} />
        {relatedItems.length > 0 ? (
          <div className="related-list">
            <p className="meta"><strong>Related:</strong></p>
            {relatedItems.map((item) => (
              <a
                key={`${result.id}-related-${item.id}`}
                href={buildConversationHref(item, query)}
                className="related-link"
                onClick={() => trackResultClick(item.id, rankByConversationId[item.id] ?? rankPosition)}
              >
                {item.title}
              </a>
            ))}
          </div>
        ) : null}
      </article>
    );
  }

  function renderWorkspacePanel() {
    return (
      <div className="card workspace-panel-card">
        <div className="section-title">
          <div>
            <h2>Workspace</h2>
            <p className="meta">{workspaceItems.length} pinned</p>
          </div>
          <div className="result-actions">
            {workspaceItems.length >= 2 ? (
              <button className="button primary small" type="button" onClick={summarizeWorkspace} disabled={workspaceSummaryLoading}>
                {workspaceSummaryLoading ? "Summarizing..." : "Summarize pinned"}
              </button>
            ) : null}
            {workspaceItems.length > 0 ? (
              <button className="button secondary small" type="button" onClick={() => setWorkspaceItems([])}>
                Clear
              </button>
            ) : null}
          </div>
        </div>
        {workspaceSummaryError ? <p className="meta error-text">{workspaceSummaryError}</p> : null}
        {workspaceSummary ? (
          <div className="workspace-summary">
            <p>{workspaceSummary.summary}</p>
            {workspaceSummary.keyPoints.length > 0 ? (
              <ul>
                {workspaceSummary.keyPoints.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            ) : null}
            <p className="meta">
              Sources: {workspaceSummary.sources.map((source) => source.title).join(", ")}
            </p>
          </div>
        ) : null}
        {workspaceItems.length === 0 ? (
          <div className="empty">Pin results to compare ideas here while you keep searching.</div>
        ) : (
          <div className="workspace-list">
            {workspaceItems.map((item) => {
              const preview = previewByConversation[item.conversationId];
              const hasPreview = Boolean(preview);
              const href = buildConversationHrefFromParts(item.conversationId, item.bestMessageId, query);
              const chatGptUrl = resolveChatGptConversationUrl(item.conversationId);
              return (
                <article className="workspace-item" key={`workspace-${item.conversationId}`}>
                  <h4>
                    <a href={href}>{item.title}</a>
                  </h4>
                  <div className="result-actions">
                    <a className="button secondary small" href={href}>
                      Jump
                    </a>
                    <button
                      className="button secondary small"
                      type="button"
                      onClick={() => togglePreview({ conversationId: item.conversationId, bestMessageId: item.bestMessageId })}
                    >
                      {hasPreview ? "Hide context" : "Show context"}
                    </button>
                    <button className="button secondary small" type="button" onClick={() => removeFromWorkspace(item.conversationId)}>
                      Unpin
                    </button>
                    {chatGptUrl ? (
                      <a className="button secondary small" href={chatGptUrl} target="_blank" rel="noreferrer">
                        ChatGPT
                      </a>
                    ) : null}
                  </div>
                  <div className="tags">
                    {item.tags.slice(0, 2).map((tagValue) => <span className="tag" key={`${item.conversationId}-wtag-${tagValue}`}>#{tagValue}</span>)}
                    {item.topics.slice(0, 2).map((topicValue) => <span className="tag" key={`${item.conversationId}-wtopic-${topicValue}`}>topic:{topicValue}</span>)}
                  </div>
                  <p className="snippet" dangerouslySetInnerHTML={{ __html: item.snippet }} />
                  {preview ? (
                    <div className="context-preview">
                      {preview.loading ? <p className="meta">Loading context...</p> : null}
                      {preview.error ? <p className="meta error-text">{preview.error}</p> : null}
                      {!preview.loading && !preview.error ? preview.messages.map((message) => (
                        <div className="context-message" key={`${item.conversationId}-${message.id}`}>
                          <p className="meta"><strong>{message.role}</strong> {message.createdAt ? `· ${new Date(message.createdAt).toLocaleString()}` : ""}</p>
                          <pre className="message-content" dangerouslySetInnerHTML={{ __html: highlightText(message.content, query) }} />
                        </div>
                      )) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="grid two" style={{ alignItems: "start" }}>
      <div className="grid" style={{ gap: 20 }}>
        <div className="card">
          <div className="section-title">
            <div>
              <h2>Search vault</h2>
              <p className="meta">Keyword search + filters + saved searches. The part that should actually feel good.</p>
            </div>
            <Link className="button secondary" href="/dashboard">
              Dashboard
            </Link>
          </div>
          <form
            className="search-form"
            onSubmit={async (event) => {
              event.preventDefault();
              await runSearch();
            }}
          >
            <input
              className="input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Try: philadelphia lease, 4runner insurance, search engine app"
              aria-label="Search query"
            />
            <div className="grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
              <input
                className="input"
                value={tag}
                onChange={(event) => setTag(event.target.value)}
                placeholder="All tags (type to filter)"
                list="available-tag-options"
                aria-label="Filter by tag"
              />
              <input
                className="input"
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                placeholder="All topics (type to filter)"
                list="available-topic-options"
                aria-label="Filter by topic"
              />
            </div>
            <datalist id="available-tag-options">
              {filteredTagOptions.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
            <datalist id="available-topic-options">
              {filteredTopicOptions.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
            <div className="button-row">
              <button className="button primary" type="submit" disabled={loading}>
                {loading ? "Searching..." : "Search"}
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  setQuery("");
                  setTag("");
                  setTopic("");
                  setResults(initialData);
                }}
              >
                Reset
              </button>
            </div>
            <div className="button-row">
              <input className="input" value={saveName} onChange={(event) => setSaveName(event.target.value)} placeholder="Optional saved-search label" aria-label="Saved search label" />
              <button className="button secondary" type="button" onClick={handleSaveSearch} disabled={saving}>
                {saving ? "Saving..." : "Save search"}
              </button>
            </div>
            {error ? <p className="meta error-text">{error}</p> : null}
          </form>
        </div>

        <div className="card">
          <div className="section-title">
            <div>
              <h2>Saved searches</h2>
              <p className="meta">One-click routes back into the stuff you always re-find.</p>
            </div>
          </div>
          <div className="saved-grid">
            {savedSearches.length === 0 ? <div className="empty">None yet. Save one once you find a pattern worth keeping.</div> : null}
            {savedSearches.map((saved) => (
              <button
                key={saved.id}
                className="saved-card"
                onClick={() => runSearch(saved.query, saved.tag ?? "", saved.topic ?? "")}
                type="button"
              >
                <strong>{saved.name}</strong>
                <span className="meta">{saved.query || "all chats"}</span>
                <span className="meta">{saved.tag ? `#${saved.tag}` : ""} {saved.topic ? `topic:${saved.topic}` : ""}</span>
              </button>
            ))}
          </div>
        </div>

        {renderWorkspacePanel()}

        <ImportPanel />
      </div>

      <div className="card">
        <div className="section-title">
          <div>
            <h2>Results</h2>
            <p className="meta">{results.total} conversation{results.total === 1 ? "" : "s"} matched.</p>
          </div>
        </div>

        {results.results.length === 0 ? (
          <div className="empty">No matches. Which is annoying, but useful — that query now shows up in the no-result analytics.</div>
        ) : (
          <div className="result-list">
            <section className="result-group">
              <h3 className="result-group-title">Best matches</h3>
              <div className="result-group-list">
                {groupedResults.best.map((result, index) => renderResultCard(result, index + 1, index === 0))}
              </div>
            </section>
            {groupedResults.related.length > 0 ? (
              <section className="result-group">
                <h3 className="result-group-title">Related</h3>
                <div className="result-group-list">
                  {groupedResults.related.map((result, index) => renderResultCard(result, groupedResults.best.length + index + 1))}
                </div>
              </section>
            ) : null}
            {groupedResults.loose.length > 0 ? (
              <section className="result-group">
                <h3 className="result-group-title">Looser matches</h3>
                <div className="result-group-list">
                  {groupedResults.loose.map((result, index) =>
                    renderResultCard(result, groupedResults.best.length + groupedResults.related.length + index + 1)
                  )}
                </div>
              </section>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
