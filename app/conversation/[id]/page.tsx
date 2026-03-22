import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { ensureUserRecord, getConversation } from "@/lib/db";

export default async function ConversationPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureUserRecord(user);

  const conversation = await getConversation(user.id, params.id);
  if (!conversation) notFound();

  return (
    <main className="page-shell">
      <div className="container grid" style={{ gap: 18 }}>
        <div className="button-row"><Link href="/" className="button secondary">← Back</Link></div>
        <section className="card">
          <div className="section-title">
            <div>
              <h1>{conversation.title}</h1>
              <p className="meta">{new Date(conversation.updatedAt).toLocaleString()} · {conversation.messageCount} messages</p>
            </div>
          </div>
          <div className="tags">
            {conversation.tags.map((tag) => <span className="tag" key={tag}>#{tag}</span>)}
            {conversation.topics.map((topic) => <span className="tag" key={topic}>topic:{topic}</span>)}
          </div>
        </section>
        <section className="grid" style={{ gap: 12 }}>
          {conversation.messages.map((message, index) => (
            <article className="message-card" key={`${message.createdAt}-${index}`}>
              <div className="section-title">
                <strong>{message.role}</strong>
                <span className="meta">{message.createdAt ? new Date(message.createdAt).toLocaleString() : "timestamp unknown"}</span>
              </div>
              <pre className="message-content">{message.content}</pre>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
