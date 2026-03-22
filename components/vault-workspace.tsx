"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ImportPanel } from "@/components/import-panel";
import type { SavedSearch, SearchResponse } from "@/types";

type Props = {
  initialData: SearchResponse;
  initialSavedSearches: SavedSearch[];
};

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

  const availableTags = useMemo(() => [...new Set(results.results.flatMap((result) => result.tags))].sort(), [results.results]);
  const availableTopics = useMemo(() => [...new Set(results.results.flatMap((result) => result.topics))].sort(), [results.results]);

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
              placeholder="Try: philadelphia lease, 4runner insurance, cursor api"
              aria-label="Search query"
            />
            <div className="grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
              <select className="select" value={tag} onChange={(event) => setTag(event.target.value)} aria-label="Filter by tag">
                <option value="">All tags</option>
                {availableTags.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <select className="select" value={topic} onChange={(event) => setTopic(event.target.value)} aria-label="Filter by topic">
                <option value="">All topics</option>
                {availableTopics.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
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
            {results.results.map((result) => (
              <a className="result-card" key={result.id} href={`/conversation/${result.id}`}>
                <div className="section-title" style={{ alignItems: "flex-start" }}>
                  <div>
                    <h3>{result.title}</h3>
                    <p className="meta">{new Date(result.updatedAt).toLocaleString()} · {result.messageCount} messages</p>
                  </div>
                </div>
                <div className="tags" style={{ marginTop: 10 }}>
                  {result.tags.map((tagValue) => <span className="tag" key={`${result.id}-${tagValue}`}>#{tagValue}</span>)}
                  {result.topics.map((topicValue) => <span className="tag" key={`${result.id}-${topicValue}`}>topic:{topicValue}</span>)}
                </div>
                <p className="snippet" dangerouslySetInnerHTML={{ __html: result.snippet }} />
              </a>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
