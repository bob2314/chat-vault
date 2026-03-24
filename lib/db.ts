import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import {
  authenticateUserPostgres,
  createUserPostgres,
  deleteSavedSearchPostgres,
  ensureUserRecordPostgres,
  getAnalyticsPostgres,
  getConversationPostgres,
  getImportStatusForUserPostgres,
  recordCaptureEventPostgres,
  recordSearchClickPostgres,
  importConversationsForUserPostgres,
  listSavedSearchesPostgres,
  saveSearchPostgres,
  searchConversationsForUserPostgres
} from "@/lib/db-postgres";
import { normalizePayload } from "@/lib/importer";
import { ensurePostgresSchema } from "@/lib/postgres";
import { getSearchProvider } from "@/lib/search";
import { hashPassword, slugify } from "@/lib/utils";
import type { AnalyticsResponse, SavedSearch, SessionUser } from "@/types";

const dbProvider = (process.env.DB_PROVIDER || "sqlite").toLowerCase();
const usePostgres = dbProvider === "postgres";
const sqlitePath = (() => {
  if (usePostgres) {
    // In Postgres mode we keep SQLite strictly in-memory so serverless
    // deployments never touch read-only filesystem paths.
    return ":memory:";
  }

  const databasePath = process.env.DATABASE_PATH || "./data/chatvault.db";
  const absolutePath = path.isAbsolute(databasePath) ? databasePath : path.join(process.cwd(), databasePath);
  try {
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    return absolutePath;
  } catch {
    // Serverless filesystems (e.g. Vercel /var/task) are read-only.
    // Fall back to in-memory SQLite instead of crashing the request.
    return ":memory:";
  }
})();

export async function initializeDatabase() {
  if (usePostgres) {
    await ensurePostgresSchema();
  }
}

export async function ensureUserRecord(user: SessionUser) {
  if (usePostgres) {
    await ensureUserRecordPostgres(user);
    return;
  }

  db.prepare(`
    INSERT INTO users (id, email, name, password_hash, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      email = excluded.email,
      name = excluded.name
  `).run(user.id, user.email, user.name, "__clerk__", new Date().toISOString());
}

export const db = new Database(sqlitePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    full_text TEXT NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT,
    FOREIGN KEY (user_id, conversation_id) REFERENCES conversations(user_id, id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS conversation_tags (
    user_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (user_id, conversation_id, tag),
    FOREIGN KEY (user_id, conversation_id) REFERENCES conversations(user_id, id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS conversation_topics (
    user_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    PRIMARY KEY (user_id, conversation_id, topic),
    FOREIGN KEY (user_id, conversation_id) REFERENCES conversations(user_id, id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS saved_searches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    query TEXT NOT NULL,
    tag TEXT,
    topic TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS search_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    query TEXT NOT NULL,
    tag TEXT,
    topic TEXT,
    result_count INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS search_click_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    query TEXT,
    tag TEXT,
    topic TEXT,
    rank_position INTEGER,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS import_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    source TEXT NOT NULL,
    processed_count INTEGER NOT NULL,
    imported_count INTEGER NOT NULL,
    created_count INTEGER NOT NULL,
    updated_count INTEGER NOT NULL,
    skipped_count INTEGER NOT NULL,
    source_max_updated_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS capture_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    source TEXT NOT NULL,
    source_url TEXT,
    parser_version TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    processed_at TEXT NOT NULL,
    conversation_external_id TEXT,
    content_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    raw_payload TEXT NOT NULL,
    normalized_payload TEXT,
    result_summary TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS conversation_search USING fts5(
    user_id UNINDEXED,
    conversation_id UNINDEXED,
    title,
    full_text,
    tags,
    topics
  );
`);
try {
  db.exec("ALTER TABLE import_events ADD COLUMN source_max_updated_at TEXT");
} catch {
  // column likely already exists
}

const upsertConversationStmt = db.prepare(`
  INSERT INTO conversations (id, user_id, title, created_at, updated_at, full_text, message_count)
  VALUES (@id, @userId, @title, @createdAt, @updatedAt, @fullText, @messageCount)
  ON CONFLICT(user_id, id) DO UPDATE SET
    title = excluded.title,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at,
    full_text = excluded.full_text,
    message_count = excluded.message_count
`);
const deleteMessagesStmt = db.prepare("DELETE FROM messages WHERE user_id = ? AND conversation_id = ?");
const insertMessageStmt = db.prepare(`INSERT INTO messages (user_id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)`);
const deleteTagsStmt = db.prepare("DELETE FROM conversation_tags WHERE user_id = ? AND conversation_id = ?");
const insertTagStmt = db.prepare("INSERT OR IGNORE INTO conversation_tags (user_id, conversation_id, tag) VALUES (?, ?, ?)");
const deleteTopicsStmt = db.prepare("DELETE FROM conversation_topics WHERE user_id = ? AND conversation_id = ?");
const insertTopicStmt = db.prepare("INSERT OR IGNORE INTO conversation_topics (user_id, conversation_id, topic) VALUES (?, ?, ?)");
const insertImportEventStmt = db.prepare(`
  INSERT INTO import_events (user_id, source, processed_count, imported_count, created_count, updated_count, skipped_count, source_max_updated_at, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertCaptureEventStmt = db.prepare(`
  INSERT INTO capture_events (
    user_id, source, source_url, parser_version, captured_at, processed_at,
    conversation_external_id, content_hash, status, raw_payload, normalized_payload, result_summary
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertSearchClickEventStmt = db.prepare(`
  INSERT INTO search_click_events (user_id, conversation_id, query, tag, topic, rank_position, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

export async function createUser({ email, name, password }: { email: string; name: string; password: string }) {
  if (usePostgres) {
    return createUserPostgres({ email, name, password });
  }

  const id = slugify(email);
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) {
    throw new Error("That email already exists in the local demo database.");
  }

  db.prepare(`INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(id, email, name, hashPassword(password), new Date().toISOString());

  return { id, email, name } satisfies SessionUser;
}

export async function authenticateUser({ email, password }: { email: string; password: string }) {
  if (usePostgres) {
    return authenticateUserPostgres({ email, password });
  }

  const user = db.prepare(`SELECT id, email, name, password_hash FROM users WHERE email = ?`).get(email) as
    | (SessionUser & { password_hash: string })
    | undefined;
  if (!user || user.password_hash !== hashPassword(password)) {
    return null;
  }
  return { id: user.id, email: user.email, name: user.name } satisfies SessionUser;
}

export async function importConversationsForUser(
  userId: string,
  payload: unknown,
  options?: { source?: "manual" | "gpt_sync" }
) {
  if (usePostgres) {
    return importConversationsForUserPostgres(userId, payload, options);
  }

  const normalized = normalizePayload(payload);
  const provider = getSearchProvider();
  const source = options?.source ?? "manual";
  const syncedAt = new Date().toISOString();
  const sourceMaxUpdatedAt = normalized.conversations.reduce<string | null>((max, conversation) => {
    const candidate = conversation.updatedAt ?? null;
    if (!candidate) return max;
    if (!max) return candidate;
    return Date.parse(candidate) > Date.parse(max) ? candidate : max;
  }, null);
  const existingConversationStmt = db.prepare(
    "SELECT full_text, updated_at FROM conversations WHERE user_id = ? AND id = ?"
  );
  const conversationsToIndex: Array<(typeof normalized.conversations)[number]> = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  const transaction = db.transaction(() => {
    for (const conversation of normalized.conversations) {
      const fullText = conversation.messages.map((message) => `[${message.role}] ${message.content}`).join("\n\n");
      const existing = existingConversationStmt.get(userId, conversation.id) as
        | { full_text: string; updated_at: string }
        | undefined;
      const unchanged = existing?.full_text === fullText && existing?.updated_at === conversation.updatedAt;

      if (unchanged) {
        skipped += 1;
        continue;
      }

      if (existing) {
        updated += 1;
      } else {
        created += 1;
      }

      upsertConversationStmt.run({
        id: conversation.id,
        userId,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        fullText,
        messageCount: conversation.messages.length
      });

      deleteMessagesStmt.run(userId, conversation.id);
      for (const message of conversation.messages) {
        insertMessageStmt.run(userId, conversation.id, message.role, message.content, message.createdAt ?? null);
      }

      deleteTagsStmt.run(userId, conversation.id);
      for (const tag of conversation.tags ?? []) {
        insertTagStmt.run(userId, conversation.id, tag);
      }

      deleteTopicsStmt.run(userId, conversation.id);
      for (const topic of conversation.topics ?? []) {
        insertTopicStmt.run(userId, conversation.id, topic);
      }

      conversationsToIndex.push(conversation);
    }
  });

  transaction();

  for (const conversation of conversationsToIndex) {
    const fullText = conversation.messages.map((message) => `[${message.role}] ${message.content}`).join("\n\n");
    await provider.upsertConversationIndex({
      userId,
      conversationId: conversation.id!,
      title: conversation.title!,
      fullText,
      tags: conversation.tags ?? [],
      topics: conversation.topics ?? [],
      createdAt: conversation.createdAt!,
      updatedAt: conversation.updatedAt!,
      messageCount: conversation.messages.length
    });
  }

  insertImportEventStmt.run(
    userId,
    source,
    normalized.conversations.length,
    created + updated,
    created,
    updated,
    skipped,
    sourceMaxUpdatedAt,
    syncedAt
  );

  return {
    imported: created + updated,
    processed: normalized.conversations.length,
    created,
    updated,
    skipped,
    provider: provider.getName(),
    source,
    syncedAt,
    sourceMaxUpdatedAt
  };
}

export async function getImportStatusForUser(userId: string) {
  if (usePostgres) {
    return getImportStatusForUserPostgres(userId);
  }

  const lastImport = db.prepare(`
    SELECT source, created_at
    FROM import_events
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(userId) as { source: string; created_at: string } | undefined;
  const lastGptSync = db.prepare(`
    SELECT created_at, source_max_updated_at
    FROM import_events
    WHERE user_id = ? AND source = 'gpt_sync'
    ORDER BY created_at DESC
    LIMIT 1
  `).get(userId) as { created_at: string; source_max_updated_at: string | null } | undefined;

  return {
    lastImportAt: lastImport?.created_at ?? null,
    lastImportSource: lastImport?.source ?? null,
    lastGptSyncAt: lastGptSync?.created_at ?? null,
    lastGptSourceUpdatedAt: lastGptSync?.source_max_updated_at ?? null
  };
}

export async function recordCaptureEvent(
  userId: string,
  input: {
    source: string;
    sourceUrl?: string | null;
    parserVersion: string;
    capturedAt: string;
    processedAt: string;
    conversationExternalId?: string | null;
    contentHash: string;
    status: "saved" | "updated" | "skipped" | "rejected" | "error";
    rawPayload: unknown;
    normalizedPayload?: unknown;
    resultSummary?: unknown;
  }
) {
  if (usePostgres) {
    return recordCaptureEventPostgres(userId, input);
  }

  insertCaptureEventStmt.run(
    userId,
    input.source,
    input.sourceUrl ?? null,
    input.parserVersion,
    input.capturedAt,
    input.processedAt,
    input.conversationExternalId ?? null,
    input.contentHash,
    input.status,
    JSON.stringify(input.rawPayload),
    input.normalizedPayload ? JSON.stringify(input.normalizedPayload) : null,
    input.resultSummary ? JSON.stringify(input.resultSummary) : null
  );
}

export async function searchConversationsForUser({ userId, query, tag, topic }: { userId: string; query: string; tag?: string | null; topic?: string | null }) {
  if (usePostgres) {
    return searchConversationsForUserPostgres({ userId, query, tag, topic });
  }

  const provider = getSearchProvider();
  const results = await provider.search({ userId, query, tag, topic });
  db.prepare(`INSERT INTO search_events (user_id, query, tag, topic, result_count, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(userId, query, tag ?? null, topic ?? null, results.total, new Date().toISOString());
  return results;
}

export async function recordSearchClick(
  userId: string,
  input: { conversationId: string; query?: string | null; tag?: string | null; topic?: string | null; rankPosition?: number | null }
) {
  if (usePostgres) {
    return recordSearchClickPostgres(userId, input);
  }

  insertSearchClickEventStmt.run(
    userId,
    input.conversationId,
    input.query ?? null,
    input.tag ?? null,
    input.topic ?? null,
    typeof input.rankPosition === "number" ? input.rankPosition : null,
    new Date().toISOString()
  );
}

export async function saveSearch(userId: string, input: { name: string; query: string; tag?: string | null; topic?: string | null }) {
  if (usePostgres) {
    return saveSearchPostgres(userId, input);
  }

  const result = db.prepare(`
    INSERT INTO saved_searches (user_id, name, query, tag, topic, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, input.name, input.query, input.tag ?? null, input.topic ?? null, new Date().toISOString());

  return db.prepare(`SELECT id, user_id as userId, name, query, tag, topic, created_at as createdAt FROM saved_searches WHERE id = ?`)
    .get(result.lastInsertRowid) as SavedSearch;
}

export async function listSavedSearches(userId: string) {
  if (usePostgres) {
    return listSavedSearchesPostgres(userId);
  }

  return db.prepare(`
    SELECT id, user_id as userId, name, query, tag, topic, created_at as createdAt
    FROM saved_searches
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(userId) as SavedSearch[];
}

export async function deleteSavedSearch(userId: string, id: number) {
  if (usePostgres) {
    return deleteSavedSearchPostgres(userId, id);
  }

  db.prepare(`DELETE FROM saved_searches WHERE user_id = ? AND id = ?`).run(userId, id);
}

export async function getConversation(userId: string, id: string) {
  if (usePostgres) {
    return getConversationPostgres(userId, id);
  }

  const conversation = db.prepare(`
    SELECT id, title, created_at, updated_at, message_count
    FROM conversations
    WHERE user_id = ? AND id = ?
  `).get(userId, id) as
    | { id: string; title: string; created_at: string; updated_at: string; message_count: number }
    | undefined;

  if (!conversation) return null;

  const messages = db.prepare(`
    SELECT id, role, content, created_at
    FROM messages
    WHERE user_id = ? AND conversation_id = ?
    ORDER BY id ASC
  `).all(userId, id) as Array<{ id: number; role: string; content: string; created_at: string | null }>;

  const tags = db.prepare(`SELECT tag FROM conversation_tags WHERE user_id = ? AND conversation_id = ? ORDER BY tag ASC`).all(userId, id) as Array<{ tag: string }>;
  const topics = db.prepare(`SELECT topic FROM conversation_topics WHERE user_id = ? AND conversation_id = ? ORDER BY topic ASC`).all(userId, id) as Array<{ topic: string }>;

  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.created_at,
    updatedAt: conversation.updated_at,
    messageCount: conversation.message_count,
    tags: tags.map((item) => item.tag),
    topics: topics.map((item) => item.topic),
    messages: messages.map((message) => ({
      id: `${message.id}`,
      role: message.role,
      content: message.content,
      createdAt: message.created_at
    }))
  };
}

export async function getAnalytics(userId: string): Promise<AnalyticsResponse> {
  if (usePostgres) {
    return getAnalyticsPostgres(userId);
  }

  const totals = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM conversations WHERE user_id = ?) AS conversations,
      (SELECT COUNT(*) FROM messages WHERE user_id = ?) AS messages,
      (SELECT COUNT(DISTINCT tag) FROM conversation_tags WHERE user_id = ?) AS tags,
      (SELECT COUNT(DISTINCT topic) FROM conversation_topics WHERE user_id = ?) AS topics,
      (SELECT COUNT(*) FROM saved_searches WHERE user_id = ?) AS savedSearches,
      (SELECT COUNT(*) FROM search_events WHERE user_id = ? AND result_count = 0) AS noResultSearches
  `).get(userId, userId, userId, userId, userId, userId) as AnalyticsResponse["totals"];

  const topTags = db.prepare(`
    SELECT tag AS label, COUNT(*) AS count
    FROM conversation_tags
    WHERE user_id = ?
    GROUP BY tag
    ORDER BY count DESC, label ASC
    LIMIT 10
  `).all(userId) as AnalyticsResponse["topTags"];

  const topTopics = db.prepare(`
    SELECT topic AS label, COUNT(*) AS count
    FROM conversation_topics
    WHERE user_id = ?
    GROUP BY topic
    ORDER BY count DESC, label ASC
    LIMIT 10
  `).all(userId) as AnalyticsResponse["topTopics"];

  const monthlyConversations = db.prepare(`
    SELECT substr(created_at, 1, 7) AS month, COUNT(*) AS count
    FROM conversations
    WHERE user_id = ?
    GROUP BY substr(created_at, 1, 7)
    ORDER BY month ASC
  `).all(userId) as AnalyticsResponse["monthlyConversations"];

  const searchesByDay = db.prepare(`
    SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count,
      SUM(CASE WHEN result_count = 0 THEN 1 ELSE 0 END) AS noResultCount
    FROM search_events
    WHERE user_id = ?
    GROUP BY substr(created_at, 1, 10)
    ORDER BY day ASC
    LIMIT 120
  `).all(userId) as AnalyticsResponse["searchesByDay"];

  const noResultQueries = db.prepare(`
    SELECT query, COUNT(*) AS count
    FROM search_events
    WHERE user_id = ? AND result_count = 0 AND trim(query) <> ''
    GROUP BY query
    ORDER BY count DESC, query ASC
    LIMIT 8
  `).all(userId) as AnalyticsResponse["noResultQueries"];

  const recentSavedSearches = (await listSavedSearches(userId)).slice(0, 8);

  return {
    totals,
    topTags,
    topTopics,
    monthlyConversations,
    searchesByDay,
    searchHeatmap: searchesByDay,
    noResultQueries,
    recentSavedSearches
  };
}
