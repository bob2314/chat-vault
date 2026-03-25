import { db } from "@/lib/db";
import { scoreConversation } from "@/lib/search/ranking";
import { clampSnippet, tokenize, uniqueStrings } from "@/lib/utils";
import type { SearchParams, SearchResponse } from "@/types";
import type { SearchProvider } from "@/lib/search/provider";

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

function getBestMessageMatch(messages: Array<{ id: number; content: string }>, query: string) {
  const terms = uniqueStrings(tokenize(query));
  if (terms.length === 0) return null;

  let best: { id: number; content: string; score: number } | null = null;
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

export class SqliteSearchProvider implements SearchProvider {
  getName() {
    return "sqlite";
  }

  upsertConversationIndex(input: {
    userId: string;
    conversationId: string;
    title: string;
    fullText: string;
    tags: string[];
    topics: string[];
    createdAt: string;
    updatedAt: string;
    messageCount: number;
  }) {
    db.prepare("DELETE FROM conversation_search WHERE user_id = ? AND conversation_id = ?").run(input.userId, input.conversationId);
    db.prepare(`
      INSERT INTO conversation_search (user_id, conversation_id, title, full_text, tags, topics)
      VALUES (@userId, @conversationId, @title, @fullText, @tags, @topics)
    `).run({
      userId: input.userId,
      conversationId: input.conversationId,
      title: input.title,
      fullText: input.fullText,
      tags: input.tags.join(" "),
      topics: input.topics.join(" ")
    });
  }

  deleteConversationIndex(userId: string, conversationId: string) {
    db.prepare("DELETE FROM conversation_search WHERE user_id = ? AND conversation_id = ?").run(userId, conversationId);
  }

  search({ userId, query, tag, topic }: SearchParams): SearchResponse {
    const hasQuery = query.trim().length > 0;
    const ftsQuery = uniqueStrings(tokenize(query)).map((token) => `${token}*`).join(" AND ");

    let sql = hasQuery
      ? `
          SELECT c.id, c.title, c.full_text, c.created_at, c.updated_at, c.message_count, bm25(conversation_search) AS score
          FROM conversation_search
          JOIN conversations c ON conversation_search.conversation_id = c.id AND conversation_search.user_id = c.user_id
        `
      : `
          SELECT c.id, c.title, c.full_text, c.created_at, c.updated_at, c.message_count, 0 AS score
          FROM conversations c
        `;

    const where: string[] = ["c.user_id = ?"];
    const params: Array<string> = [userId];

    if (hasQuery && ftsQuery) {
      where.push("conversation_search.user_id = ?");
      params.push(userId);
      where.push("conversation_search MATCH ?");
      params.push(ftsQuery);
    }

    if (tag) {
      where.push("EXISTS (SELECT 1 FROM conversation_tags t WHERE t.user_id = c.user_id AND t.conversation_id = c.id AND t.tag = ?)");
      params.push(tag);
    }

    if (topic) {
      where.push("EXISTS (SELECT 1 FROM conversation_topics t WHERE t.user_id = c.user_id AND t.conversation_id = c.id AND t.topic = ?)");
      params.push(topic);
    }

    sql += ` WHERE ${where.join(" AND ")} ORDER BY ${hasQuery ? "score ASC," : ""} c.updated_at DESC LIMIT 150`;

    const rows = db.prepare(sql).all(...params) as Array<{
      id: string;
      title: string;
      full_text: string;
      created_at: string;
      updated_at: string;
      message_count: number;
      score: number;
    }>;

    const tagLookup = db.prepare("SELECT tag FROM conversation_tags WHERE user_id = ? AND conversation_id = ? ORDER BY tag ASC");
    const topicLookup = db.prepare("SELECT topic FROM conversation_topics WHERE user_id = ? AND conversation_id = ? ORDER BY topic ASC");
    const messageLookup = db.prepare("SELECT id, content FROM messages WHERE user_id = ? AND conversation_id = ? ORDER BY id ASC");

    const rankedResults = rows.map((row) => {
      const tags = (tagLookup.all(userId, row.id) as Array<{ tag: string }>).map((item) => item.tag);
      const topics = (topicLookup.all(userId, row.id) as Array<{ topic: string }>).map((item) => item.topic);
      const messages = messageLookup.all(userId, row.id) as Array<{ id: number; content: string }>;
      const bestMessage = getBestMessageMatch(messages, query);
      const updatedAt = row.updated_at;
      const ranked = scoreConversation({
        query,
        title: row.title,
        fullText: row.full_text,
        tags,
        topics,
        updatedAt,
        activeTag: tag,
        activeTopic: topic
      });
      const snippetSource = bestMessage?.content ?? row.full_text;
      const matchFields = new Set(ranked.matchFields);
      if (bestMessage) {
        matchFields.add("message");
      }

      return {
        id: row.id,
        title: row.title,
        snippet: highlightSnippet(buildSnippet(snippetSource, query), query),
        tags,
        topics,
        bestMessageId: bestMessage ? `${bestMessage.id}` : null,
        matchFields: Array.from(matchFields),
        createdAt: row.created_at,
        updatedAt,
        messageCount: row.message_count,
        score: ranked.score,
        matchSignals: ranked.signals
      };
    });

    rankedResults.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    });

    return {
      total: rankedResults.length,
      query,
      tag: tag ?? null,
      topic: topic ?? null,
      results: rankedResults.slice(0, 50)
    };
  }
}
