import { notFound, redirect } from "next/navigation";
import { BackButton } from "@/components/back-button";
import { getSessionUser } from "@/lib/auth";
import { resolveChatGptConversationUrl } from "@/lib/chatgpt-links";
import { ensureUserRecord, getConversation } from "@/lib/db";
import { tokenize, uniqueStrings } from "@/lib/utils";

function escapeHtml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function highlightMessage(content: string, query: string) {
  const terms = uniqueStrings(tokenize(query)).sort((a, b) => b.length - a.length);
  if (terms.length === 0) return escapeHtml(content);
  return terms.reduce((output, term) => {
    const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig");
    return output.replace(regex, "<mark>$1</mark>");
  }, escapeHtml(content));
}

export default async function ConversationPage({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams?: { m?: string; q?: string };
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureUserRecord(user);

  const conversation = await getConversation(user.id, params.id);
  if (!conversation) notFound();
  const targetMessageId = searchParams?.m?.trim() || "";
  const highlightQuery = searchParams?.q?.trim() || "";
  const chatGptUrl = resolveChatGptConversationUrl(conversation.id);

  return (
    <main className="page-shell">
      <div className="container grid" style={{ gap: 18 }}>
        <div className="button-row"><BackButton fallbackHref="/" /></div>
        <section className="card">
          <div className="section-title">
            <div>
              <h1>{conversation.title}</h1>
              <p className="meta">{new Date(conversation.updatedAt).toLocaleString()} · {conversation.messageCount} messages</p>
            </div>
            {chatGptUrl ? (
              <a className="button secondary" href={chatGptUrl} target="_blank" rel="noreferrer">
                Open in ChatGPT
              </a>
            ) : null}
          </div>
          <div className="tags">
            {conversation.tags.map((tag) => <span className="tag" key={tag}>#{tag}</span>)}
            {conversation.topics.map((topic) => <span className="tag" key={topic}>topic:{topic}</span>)}
          </div>
        </section>
        <section className="grid" style={{ gap: 12 }}>
          {conversation.messages.map((message, index) => {
            const isTarget = targetMessageId.length > 0 && message.id === targetMessageId;
            return (
            <article
              id={`message-${message.id}`}
              className={`message-card ${isTarget ? "message-card-target" : ""}`}
              key={`${message.id}-${message.createdAt}-${index}`}
            >
              <div className="section-title">
                <strong>{message.role}</strong>
                <span className="meta">{message.createdAt ? new Date(message.createdAt).toLocaleString() : "timestamp unknown"}</span>
              </div>
              <pre className="message-content" dangerouslySetInnerHTML={{ __html: highlightMessage(message.content, highlightQuery) }} />
            </article>
          );
          })}
        </section>
      </div>
    </main>
  );
}
