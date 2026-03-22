import type { AnalyticsResponse } from "@/types";

function intensity(value: number, max: number) {
  if (max <= 0) return 0.12;
  return Math.max(0.12, value / max);
}

export function DashboardPanels({ analytics }: { analytics: AnalyticsResponse }) {
  const maxHeat = Math.max(...analytics.searchHeatmap.map((item) => item.count), 0);

  return (
    <div className="grid" style={{ gap: 20 }}>
      <section className="card">
        <div className="section-title">
          <div>
            <h2>Search heatmap</h2>
            <p className="meta">Daily search volume. Darker cells mean more searches; red badges show misses.</p>
          </div>
        </div>
        <div className="heatmap-grid">
          {analytics.searchHeatmap.length === 0 ? <div className="empty">Run a few searches and this will stop looking dead.</div> : null}
          {analytics.searchHeatmap.map((cell) => (
            <div
              key={cell.day}
              className="heatmap-cell"
              style={{ opacity: intensity(cell.count, maxHeat) }}
              title={`${cell.day}: ${cell.count} searches, ${cell.noResultCount} no-result`}
            >
              <span>{cell.day.slice(5)}</span>
              {cell.noResultCount > 0 ? <em>{cell.noResultCount}</em> : null}
            </div>
          ))}
        </div>
      </section>

      <section className="grid two">
        <div className="card">
          <div className="section-title"><div><h2>Top tags</h2></div></div>
          <div className="tags">
            {analytics.topTags.length === 0 ? <div className="empty">No tags yet. Import conversations with tag data to populate this.</div> : null}
            {analytics.topTags.map((tag) => <span className="tag" key={tag.label}>#{tag.label} ({tag.count})</span>)}
          </div>
        </div>
        <div className="card">
          <div className="section-title"><div><h2>Top topics</h2></div></div>
          <div className="tags">
            {analytics.topTopics.length === 0 ? <div className="empty">No topics yet. Topic extraction kicks in when imports include topic hints.</div> : null}
            {analytics.topTopics.map((topic) => <span className="tag" key={topic.label}>{topic.label} ({topic.count})</span>)}
          </div>
        </div>
      </section>

      <section className="grid two">
        <div className="card">
          <div className="section-title"><div><h2>No-result queries</h2><p className="meta">Great for seeing where indexing, synonyms, or imports need work.</p></div></div>
          <div className="saved-grid">
            {analytics.noResultQueries.length === 0 ? <div className="empty">Zero misses. Either search is great or nobody is using it yet.</div> : null}
            {analytics.noResultQueries.map((item) => (
              <div className="saved-card" key={item.query}><strong>{item.query}</strong><span className="meta">{item.count} miss{item.count === 1 ? "" : "es"}</span></div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="section-title"><div><h2>Recent saved searches</h2></div></div>
          <div className="saved-grid">
            {analytics.recentSavedSearches.length === 0 ? <div className="empty">No saved searches yet. Save common filters to pin them here.</div> : null}
            {analytics.recentSavedSearches.map((saved) => (
              <div className="saved-card" key={saved.id}><strong>{saved.name}</strong><span className="meta">{saved.query || "all chats"}</span></div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
