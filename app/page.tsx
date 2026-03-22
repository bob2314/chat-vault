import { redirect } from "next/navigation";
import { VaultWorkspace } from "@/components/vault-workspace";
import { getSessionUser } from "@/lib/auth";
import { ensureUserRecord, getAnalytics, listSavedSearches, searchConversationsForUser } from "@/lib/db";

export default async function HomePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureUserRecord(user);

  const analytics = await getAnalytics(user.id);
  const initialResults = await searchConversationsForUser({ userId: user.id, query: "" });
  const savedSearches = await listSavedSearches(user.id);

  return (
    <main className="page-shell">
      <div className="container grid" style={{ gap: 22 }}>
        <section className="hero">
          <div className="badge-row">
            <span className="badge">Next.js</span>
            <span className="badge">SQLite / Typesense provider</span>
            <span className="badge">Per-user vault</span>
          </div>
          <h1>Chat Vault</h1>
          <p>
            A practical POC for importing AI chat history, indexing it sanely, saving useful searches, and surfacing where retrieval is failing.
            This pass adds per-user isolation, provider abstraction for SQLite vs Typesense, rough ChatGPT import adapters, and a cleaner dashboard.
          </p>
        </section>

        <section className="card">
          <div className="section-title">
            <div>
              <h2>Snapshot</h2>
              <p className="meta">Fast pulse-check on whether your vault has substance or is just a shiny empty box.</p>
            </div>
          </div>
          <div className="kpi-grid">
            <div className="kpi"><div className="kpi-label">Conversations</div><div className="kpi-value">{analytics.totals.conversations}</div></div>
            <div className="kpi"><div className="kpi-label">Messages</div><div className="kpi-value">{analytics.totals.messages}</div></div>
            <div className="kpi"><div className="kpi-label">Saved searches</div><div className="kpi-value">{analytics.totals.savedSearches}</div></div>
            <div className="kpi"><div className="kpi-label">No-result queries</div><div className="kpi-value">{analytics.totals.noResultSearches}</div></div>
          </div>
        </section>

        <VaultWorkspace initialData={initialResults} initialSavedSearches={savedSearches} />
      </div>
    </main>
  );
}
