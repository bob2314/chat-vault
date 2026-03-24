import { ensurePostgresSchema, getPostgresPool } from "@/lib/postgres";
import type { SearchProvider } from "@/lib/search/provider";
import { scoreConversation } from "@/lib/search/ranking";
import { clampSnippet, tokenize, uniqueStrings } from "@/lib/utils";
import type { SearchParams, SearchResponse } from "@/types";

function buildSnippet(fullText: string, query: string) {
  const terms = tokenize(query);
  if (terms.length === 0) return clampSnippet(fullText.replace(/\n+/g, " "));
  const lowered = fullText.toLowerCase();
  const firstMatch = terms.map((term) => lowered.indexOf(term)).filter((index) => index >= 0).sort((a, b) => a - b)[0];
  if (firstMatch === undefined) return clampSnippet(fullText.replace(/\n+/g, " "));
  const start = Math.max(0, firstMatch - 90);
  const end = Math.min(fullText.length, firstMatch + 200);
  return `${start > 0 ? "…" : ""}${fullText.slice(start, end).replace(/\n+/g, " ").trim()}${end < fullText.length ? "…" : ""}`;
}

function highlightSnippet(snippet: string, query: string) {
  const terms = uniqueStrings(tokenize(query)).sort((a, b) => b.length - a.length);
  return terms.reduce((output, term) => {
    const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig");
    return output.replace(regex, "<mark>$1</mark>");
  }, snippet);
}

function getBestMessageMatch(messages: Array<{ id: string | number; content: string }>, query: string) {
  const terms = uniqueStrings(tokenize(query));
  if (terms.length === 0) return null;

  let best: { id: string | number; content: string; score: number } | null = null;
  for (const message of messages) {
    const lowered = message.content.toLowerCase();
    const termHits = terms.reduce((count, term) => count + (lowered.includes(term) ? 1 : 0), 0);
    if (termHits === 0) continue;
    const phraseHit = query.trim().length > 1 && lowered.includes(query.trim().toLowerCase()) ? 1 : 0;
    const score = phraseHit * 10 + termHits;
    if (!best || score > best.score) {
      best = { id: message.id, content: message.content, score };
    }
  }
  return best;
}

export class PostgresSearchProvider implements SearchProvider {
  getName() {
    return "postgres";
  }

  async upsertConversationIndex() {
    // Postgres search reads canonical rows directly; no side index required for this POC.
    await ensurePostgresSchema();
  }

  async deleteConversationIndex() {
    await ensurePostgresSchema();
  }

  async search({ userId, query, tag, topic }: SearchParams): Promise<SearchResponse> {
    await ensurePostgresSchema();
    const db = getPostgresPool();
    const terms = uniqueStrings(tokenize(query));

    const where: string[] = ["c.user_id = $1"];
    const params: Array<string | string[]> = [userId];
    let paramIndex = 2;

    if (tag) {
      where.push(`EXISTS (SELECT 1 FROM conversation_tags t WHERE t.user_id = c.user_id AND t.conversation_id = c.id AND t.tag = $${paramIndex})`);
      params.push(tag);
      paramIndex += 1;
    }

    if (topic) {
      where.push(`EXISTS (SELECT 1 FROM conversation_topics t WHERE t.user_id = c.user_id AND t.conversation_id = c.id AND t.topic = $${paramIndex})`);
      params.push(topic);
      paramIndex += 1;
    }

    if (terms.length > 0) {
      const likeTerms = terms.map((term) => `%${term}%`);
      where.push(`(c.title ILIKE ANY($${paramIndex}::text[]) OR c.full_text ILIKE ANY($${paramIndex}::text[]))`);
      params.push(likeTerms);
      paramIndex += 1;
    }

    const rows = await db.query<{
      id: string;
      title: string;
      full_text: string;
      created_at: Date;
      updated_at: Date;
      message_count: number;
    }>(
      `
        SELECT c.id, c.title, c.full_text, c.created_at, c.updated_at, c.message_count
        FROM conversations c
        WHERE ${where.join(" AND ")}
        ORDER BY c.updated_at DESC
        LIMIT 150
      `,
      params
    );

    const results = [];
    for (const row of rows.rows) {
      const tagsResult = await db.query<{ tag: string }>(
        "SELECT tag FROM conversation_tags WHERE user_id = $1 AND conversation_id = $2 ORDER BY tag ASC",
        [userId, row.id]
      );
      const topicsResult = await db.query<{ topic: string }>(
        "SELECT topic FROM conversation_topics WHERE user_id = $1 AND conversation_id = $2 ORDER BY topic ASC",
        [userId, row.id]
      );
      const messagesResult = await db.query<{ id: string; content: string }>(
        "SELECT id, content FROM messages WHERE user_id = $1 AND conversation_id = $2 ORDER BY id ASC",
        [userId, row.id]
      );
      const bestMessage = getBestMessageMatch(messagesResult.rows, query);
      const snippetSource = bestMessage?.content ?? row.full_text;

      const mapped = {
        id: row.id,
        title: row.title,
        snippet: highlightSnippet(buildSnippet(snippetSource, query), query),
        tags: tagsResult.rows.map((item) => item.tag),
        topics: topicsResult.rows.map((item) => item.topic),
        bestMessageId: bestMessage ? `${bestMessage.id}` : null,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
        messageCount: row.message_count,
        score: 0,
        matchSignals: [] as string[],
        matchFields: [] as Array<"title" | "message" | "tag" | "topic">
      };
      const ranked = scoreConversation({
        query,
        title: mapped.title,
        fullText: row.full_text,
        tags: mapped.tags,
        topics: mapped.topics,
        updatedAt: mapped.updatedAt,
        activeTag: tag,
        activeTopic: topic
      });
      mapped.score = ranked.score;
      mapped.matchSignals = ranked.signals;
      mapped.matchFields = bestMessage
        ? Array.from(new Set<"title" | "message" | "tag" | "topic">([...ranked.matchFields, "message"]))
        : ranked.matchFields;
      results.push(mapped);
    }

    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    });

    return {
      total: results.length,
      query,
      tag: tag ?? null,
      topic: topic ?? null,
      results: results.slice(0, 50)
    };
  }
}
