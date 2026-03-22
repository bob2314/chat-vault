import { redirect } from "next/navigation";
import { DashboardPanels } from "@/components/dashboard-panels";
import { getSessionUser } from "@/lib/auth";
import { ensureUserRecord, getAnalytics } from "@/lib/db";

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureUserRecord(user);

  const analytics = await getAnalytics(user.id);

  return (
    <main className="page-shell">
      <div className="container grid" style={{ gap: 20 }}>
        <section className="hero">
          <div className="badge-row"><span className="badge">Analytics</span></div>
          <h1>Vault dashboard</h1>
          <p>Cleaner visual analytics for search behavior, misses, saved searches, and tag/topic distribution.</p>
        </section>
        <DashboardPanels analytics={analytics} />
      </div>
    </main>
  );
}
