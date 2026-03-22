import { normalizePayload } from "@/lib/importer";
import { getPostgresPool, ensurePostgresSchema } from "@/lib/postgres";
import { getSearchProvider } from "@/lib/search";
import { hashPassword, slugify } from "@/lib/utils";
import type { AnalyticsResponse, SavedSearch, SessionUser } from "@/types";

type SaveSearchInput = { name: string; query: string; tag?: string | null; topic?: string | null };

export async function ensureUserRecordPostgres(user: SessionUser) {
  await ensurePostgresSchema();
  const db = getPostgresPool();
  await db.query(
    `
      INSERT INTO users (id, email, name, password_hash, created_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        name = EXCLUDED.name
    `,
    [user.id, user.email, user.name, "__clerk__", new Date().toISOString()]
  );
}

export async function createUserPostgres({ email, name, password }: { email: string; name: string; password: string }) {
  await ensurePostgresSchema();
  const db = getPostgresPool();
  const id = slugify(email);

  const existing = await db.query("SELECT id FROM users WHERE email = $1 LIMIT 1", [email]);
  if (existing.rowCount && existing.rowCount > 0) {
    throw new Error("That email already exists in the local demo database.");
  }

  await db.query(
    "INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)",
    [id, email, name, hashPassword(password), new Date().toISOString()]
  );

  return { id, email, name } satisfies SessionUser;
}

export async function authenticateUserPostgres({ email, password }: { email: string; password: string }) {
  await ensurePostgresSchema();
  const db = getPostgresPool();
  const result = await db.query<{ id: string; email: string; name: string; password_hash: string }>(
    "SELECT id, email, name, password_hash FROM users WHERE email = $1 LIMIT 1",
    [email]
  );

  const user = result.rows[0];
  if (!user || user.password_hash !== hashPassword(password)) {
    return null;
  }

  return { id: user.id, email: user.email, name: user.name } satisfies SessionUser;
}

export async function importConversationsForUserPostgres(
  userId: string,
  payload: unknown,
  options?: { source?: "manual" | "gpt_sync" }
) {
  await ensurePostgresSchema();
  const db = getPostgresPool();
  const normalized = normalizePayload(payload);
  const provider = getSearchProvider();
  const source = options?.source ?? "manual";
  const syncedAt = new Date().toISOString();
  const conversationsToIndex: Array<(typeof normalized.conversations)[number]> = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    for (const conversation of normalized.conversations) {
      const fullText = conversation.messages.map((message) => `[${message.role}] ${message.content}`).join("\n\n");
      const existingResult = await client.query<{ full_text: string; updated_at: Date }>(
        "SELECT full_text, updated_at FROM conversations WHERE user_id = $1 AND id = $2 LIMIT 1",
        [userId, conversation.id]
      );
      const existing = existingResult.rows[0];
      const unchanged =
        Boolean(existing) &&
        existing.full_text === fullText &&
        new Date(existing.updated_at).toISOString() === conversation.updatedAt;

      if (unchanged) {
        skipped += 1;
        continue;
      }

      if (existing) {
        updated += 1;
      } else {
        created += 1;
      }

      await client.query(
        `
          INSERT INTO conversations (id, user_id, title, created_at, updated_at, full_text, message_count)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (user_id, id) DO UPDATE SET
            title = EXCLUDED.title,
            created_at = EXCLUDED.created_at,
            updated_at = EXCLUDED.updated_at,
            full_text = EXCLUDED.full_text,
            message_count = EXCLUDED.message_count
        `,
        [
          conversation.id,
          userId,
          conversation.title,
          conversation.createdAt,
          conversation.updatedAt,
          fullText,
          conversation.messages.length
        ]
      );

      await client.query("DELETE FROM messages WHERE user_id = $1 AND conversation_id = $2", [userId, conversation.id]);
      for (const message of conversation.messages) {
        await client.query(
          "INSERT INTO messages (user_id, conversation_id, role, content, created_at) VALUES ($1, $2, $3, $4, $5)",
          [userId, conversation.id, message.role, message.content, message.createdAt ?? null]
        );
      }

      await client.query("DELETE FROM conversation_tags WHERE user_id = $1 AND conversation_id = $2", [userId, conversation.id]);
      for (const tag of conversation.tags ?? []) {
        await client.query(
          "INSERT INTO conversation_tags (user_id, conversation_id, tag) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
          [userId, conversation.id, tag]
        );
      }

      await client.query("DELETE FROM conversation_topics WHERE user_id = $1 AND conversation_id = $2", [userId, conversation.id]);
      for (const topic of conversation.topics ?? []) {
        await client.query(
          "INSERT INTO conversation_topics (user_id, conversation_id, topic) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
          [userId, conversation.id, topic]
        );
      }

      conversationsToIndex.push(conversation);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

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

  await db.query(
    `
      INSERT INTO import_events (user_id, source, processed_count, imported_count, created_count, updated_count, skipped_count, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [userId, source, normalized.conversations.length, created + updated, created, updated, skipped, syncedAt]
  );

  return {
    imported: created + updated,
    processed: normalized.conversations.length,
    created,
    updated,
    skipped,
    provider: provider.getName(),
    source,
    syncedAt
  };
}

export async function getImportStatusForUserPostgres(userId: string) {
  await ensurePostgresSchema();
  const db = getPostgresPool();
  const lastImport = await db.query<{ source: string; created_at: Date }>(
    `
      SELECT source, created_at
      FROM import_events
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [userId]
  );
  const lastGptSync = await db.query<{ created_at: Date }>(
    `
      SELECT created_at
      FROM import_events
      WHERE user_id = $1 AND source = 'gpt_sync'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [userId]
  );

  return {
    lastImportAt: lastImport.rows[0]?.created_at ? new Date(lastImport.rows[0].created_at).toISOString() : null,
    lastImportSource: lastImport.rows[0]?.source ?? null,
    lastGptSyncAt: lastGptSync.rows[0]?.created_at ? new Date(lastGptSync.rows[0].created_at).toISOString() : null
  };
}

export async function searchConversationsForUserPostgres({
  userId,
  query,
  tag,
  topic
}: {
  userId: string;
  query: string;
  tag?: string | null;
  topic?: string | null;
}) {
  await ensurePostgresSchema();
  const provider = getSearchProvider();
  const results = await provider.search({ userId, query, tag, topic });
  const db = getPostgresPool();
  await db.query(
    "INSERT INTO search_events (user_id, query, tag, topic, result_count, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [userId, query, tag ?? null, topic ?? null, results.total, new Date().toISOString()]
  );
  return results;
}

export async function saveSearchPostgres(userId: string, input: SaveSearchInput) {
  await ensurePostgresSchema();
  const db = getPostgresPool();
  const insert = await db.query<{ id: number }>(
    `
      INSERT INTO saved_searches (user_id, name, query, tag, topic, created_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `,
    [userId, input.name, input.query, input.tag ?? null, input.topic ?? null, new Date().toISOString()]
  );

  const id = insert.rows[0]?.id;
  const row = await db.query<{
    id: number;
    userid: string;
    name: string;
    query: string;
    tag: string | null;
    topic: string | null;
    createdat: Date;
  }>(
    `
      SELECT id, user_id AS userId, name, query, tag, topic, created_at AS createdAt
      FROM saved_searches
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );

  const item = row.rows[0];
  return {
    id: item.id,
    userId: item.userid,
    name: item.name,
    query: item.query,
    tag: item.tag,
    topic: item.topic,
    createdAt: new Date(item.createdat).toISOString()
  } satisfies SavedSearch;
}

export async function listSavedSearchesPostgres(userId: string) {
  await ensurePostgresSchema();
  const db = getPostgresPool();
  const result = await db.query<{
    id: number;
    userid: string;
    name: string;
    query: string;
    tag: string | null;
    topic: string | null;
    createdat: Date;
  }>(
    `
      SELECT id, user_id AS userId, name, query, tag, topic, created_at AS createdAt
      FROM saved_searches
      WHERE user_id = $1
      ORDER BY created_at DESC
    `,
    [userId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    userId: row.userid,
    name: row.name,
    query: row.query,
    tag: row.tag,
    topic: row.topic,
    createdAt: new Date(row.createdat).toISOString()
  })) as SavedSearch[];
}

export async function deleteSavedSearchPostgres(userId: string, id: number) {
  await ensurePostgresSchema();
  const db = getPostgresPool();
  await db.query("DELETE FROM saved_searches WHERE user_id = $1 AND id = $2", [userId, id]);
}

export async function getConversationPostgres(userId: string, id: string) {
  await ensurePostgresSchema();
  const db = getPostgresPool();
  const conversationResult = await db.query<{
    id: string;
    title: string;
    created_at: Date;
    updated_at: Date;
    message_count: number;
  }>(
    `
      SELECT id, title, created_at, updated_at, message_count
      FROM conversations
      WHERE user_id = $1 AND id = $2
      LIMIT 1
    `,
    [userId, id]
  );

  const conversation = conversationResult.rows[0];
  if (!conversation) return null;

  const messagesResult = await db.query<{ role: string; content: string; created_at: Date | null }>(
    `
      SELECT role, content, created_at
      FROM messages
      WHERE user_id = $1 AND conversation_id = $2
      ORDER BY id ASC
    `,
    [userId, id]
  );

  const tagsResult = await db.query<{ tag: string }>(
    "SELECT tag FROM conversation_tags WHERE user_id = $1 AND conversation_id = $2 ORDER BY tag ASC",
    [userId, id]
  );
  const topicsResult = await db.query<{ topic: string }>(
    "SELECT topic FROM conversation_topics WHERE user_id = $1 AND conversation_id = $2 ORDER BY topic ASC",
    [userId, id]
  );

  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: new Date(conversation.created_at).toISOString(),
    updatedAt: new Date(conversation.updated_at).toISOString(),
    messageCount: conversation.message_count,
    tags: tagsResult.rows.map((item) => item.tag),
    topics: topicsResult.rows.map((item) => item.topic),
    messages: messagesResult.rows.map((message) => ({
      role: message.role,
      content: message.content,
      createdAt: message.created_at ? new Date(message.created_at).toISOString() : null
    }))
  };
}

export async function getAnalyticsPostgres(userId: string): Promise<AnalyticsResponse> {
  await ensurePostgresSchema();
  const db = getPostgresPool();

  const totalsResult = await db.query<{
    conversations: string;
    messages: string;
    tags: string;
    topics: string;
    savedsearches: string;
    noresultsearches: string;
  }>(
    `
      SELECT
        (SELECT COUNT(*) FROM conversations WHERE user_id = $1) AS conversations,
        (SELECT COUNT(*) FROM messages WHERE user_id = $1) AS messages,
        (SELECT COUNT(DISTINCT tag) FROM conversation_tags WHERE user_id = $1) AS tags,
        (SELECT COUNT(DISTINCT topic) FROM conversation_topics WHERE user_id = $1) AS topics,
        (SELECT COUNT(*) FROM saved_searches WHERE user_id = $1) AS savedSearches,
        (SELECT COUNT(*) FROM search_events WHERE user_id = $1 AND result_count = 0) AS noResultSearches
    `,
    [userId]
  );

  const topTagsResult = await db.query<{ label: string; count: string }>(
    `
      SELECT tag AS label, COUNT(*)::text AS count
      FROM conversation_tags
      WHERE user_id = $1
      GROUP BY tag
      ORDER BY COUNT(*) DESC, tag ASC
      LIMIT 10
    `,
    [userId]
  );

  const topTopicsResult = await db.query<{ label: string; count: string }>(
    `
      SELECT topic AS label, COUNT(*)::text AS count
      FROM conversation_topics
      WHERE user_id = $1
      GROUP BY topic
      ORDER BY COUNT(*) DESC, topic ASC
      LIMIT 10
    `,
    [userId]
  );

  const monthlyResult = await db.query<{ month: string; count: string }>(
    `
      SELECT to_char(created_at, 'YYYY-MM') AS month, COUNT(*)::text AS count
      FROM conversations
      WHERE user_id = $1
      GROUP BY to_char(created_at, 'YYYY-MM')
      ORDER BY month ASC
    `,
    [userId]
  );

  const searchesByDayResult = await db.query<{ day: string; count: string; noresultcount: string }>(
    `
      SELECT to_char(created_at, 'YYYY-MM-DD') AS day,
        COUNT(*)::text AS count,
        SUM(CASE WHEN result_count = 0 THEN 1 ELSE 0 END)::text AS noResultCount
      FROM search_events
      WHERE user_id = $1
      GROUP BY to_char(created_at, 'YYYY-MM-DD')
      ORDER BY day ASC
      LIMIT 120
    `,
    [userId]
  );

  const noResultQueriesResult = await db.query<{ query: string; count: string }>(
    `
      SELECT query, COUNT(*)::text AS count
      FROM search_events
      WHERE user_id = $1 AND result_count = 0 AND btrim(query) <> ''
      GROUP BY query
      ORDER BY COUNT(*) DESC, query ASC
      LIMIT 8
    `,
    [userId]
  );

  const recentSavedSearches = (await listSavedSearchesPostgres(userId)).slice(0, 8);
  const totals = totalsResult.rows[0];

  return {
    totals: {
      conversations: Number(totals.conversations),
      messages: Number(totals.messages),
      tags: Number(totals.tags),
      topics: Number(totals.topics),
      savedSearches: Number(totals.savedsearches),
      noResultSearches: Number(totals.noresultsearches)
    },
    topTags: topTagsResult.rows.map((row) => ({ label: row.label, count: Number(row.count) })),
    topTopics: topTopicsResult.rows.map((row) => ({ label: row.label, count: Number(row.count) })),
    monthlyConversations: monthlyResult.rows.map((row) => ({ month: row.month, count: Number(row.count) })),
    searchesByDay: searchesByDayResult.rows.map((row) => ({
      day: row.day,
      count: Number(row.count),
      noResultCount: Number(row.noresultcount)
    })),
    searchHeatmap: searchesByDayResult.rows.map((row) => ({
      day: row.day,
      count: Number(row.count),
      noResultCount: Number(row.noresultcount)
    })),
    noResultQueries: noResultQueriesResult.rows.map((row) => ({ query: row.query, count: Number(row.count) })),
    recentSavedSearches
  };
}
