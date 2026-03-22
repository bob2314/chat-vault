import { ensurePostgresSchema, getPostgresPool } from "@/lib/postgres";
import type { SearchProvider } from "@/lib/search/provider";
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

function scoreText(query: string, title: string, text: string) {
  const terms = uniqueStrings(tokenize(query));
  if (terms.length === 0) return 0;
  const loweredTitle = title.toLowerCase();
  const loweredText = text.toLowerCase();
  return terms.reduce((score, term) => {
    const inTitle = loweredTitle.includes(term) ? 2 : 0;
    const inText = loweredText.includes(term) ? 1 : 0;
    return score + inTitle + inText;
  }, 0);
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
        LIMIT 50
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

      results.push({
        id: row.id,
        title: row.title,
        snippet: highlightSnippet(buildSnippet(row.full_text, query), query),
        tags: tagsResult.rows.map((item) => item.tag),
        topics: topicsResult.rows.map((item) => item.topic),
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
        messageCount: row.message_count,
        score: scoreText(query, row.title, row.full_text)
      });
    }

    return {
      total: results.length,
      query,
      tag: tag ?? null,
      topic: topic ?? null,
      results
    };
  }
}
