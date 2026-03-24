import { Pool } from "pg";

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

function requireDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required when DB_PROVIDER=postgres");
  }
  return databaseUrl;
}

export function getPostgresPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: requireDatabaseUrl()
    });
  }
  return pool;
}

export async function ensurePostgresSchema() {
  if (schemaReady) return schemaReady;

  schemaReady = (async () => {
    const db = getPostgresPool();
    let embeddingType = "double precision[]";
    try {
      await db.query("CREATE EXTENSION IF NOT EXISTS vector;");
      embeddingType = "vector(1536)";
    } catch {
      // Some hosted Postgres setups disable extension creation in app role.
      // We still create scaffolding tables with array storage as fallback.
    }

    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        full_text TEXT NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ,
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
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        query TEXT NOT NULL,
        tag TEXT,
        topic TEXT,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS search_events (
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        query TEXT NOT NULL,
        tag TEXT,
        topic TEXT,
        result_count INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS search_click_events (
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        conversation_id TEXT NOT NULL,
        query TEXT,
        tag TEXT,
        topic TEXT,
        rank_position INTEGER,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS import_events (
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        processed_count INTEGER NOT NULL,
        imported_count INTEGER NOT NULL,
        created_count INTEGER NOT NULL,
        updated_count INTEGER NOT NULL,
        skipped_count INTEGER NOT NULL,
        source_max_updated_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL
      );

      ALTER TABLE import_events ADD COLUMN IF NOT EXISTS source_max_updated_at TIMESTAMPTZ;

      CREATE TABLE IF NOT EXISTS capture_events (
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        source_url TEXT,
        parser_version TEXT NOT NULL,
        captured_at TIMESTAMPTZ NOT NULL,
        processed_at TIMESTAMPTZ NOT NULL,
        conversation_external_id TEXT,
        content_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        raw_payload JSONB NOT NULL,
        normalized_payload JSONB,
        result_summary JSONB
      );

      CREATE TABLE IF NOT EXISTS conversation_embeddings (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        conversation_id TEXT NOT NULL,
        summary_text TEXT NOT NULL,
        embedding ${embeddingType},
        status TEXT NOT NULL DEFAULT 'pending',
        updated_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (user_id, conversation_id),
        FOREIGN KEY (user_id, conversation_id) REFERENCES conversations(user_id, id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS message_chunks (
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        conversation_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        start_message_id BIGINT,
        end_message_id BIGINT,
        chunk_text TEXT NOT NULL,
        embedding ${embeddingType},
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        FOREIGN KEY (user_id, conversation_id) REFERENCES conversations(user_id, id) ON DELETE CASCADE,
        UNIQUE (user_id, conversation_id, chunk_index)
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_user_conversation ON messages(user_id, conversation_id, id);
      CREATE INDEX IF NOT EXISTS idx_search_events_user_created ON search_events(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_search_click_events_user_created ON search_click_events(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_import_events_user_created ON import_events(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_capture_events_user_created ON capture_events(user_id, processed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_capture_events_user_hash ON capture_events(user_id, content_hash);
      CREATE INDEX IF NOT EXISTS idx_conversation_embeddings_status ON conversation_embeddings(user_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_message_chunks_lookup ON message_chunks(user_id, conversation_id, chunk_index);
      CREATE INDEX IF NOT EXISTS idx_message_chunks_status ON message_chunks(user_id, status, updated_at DESC);
    `);
  })();

  return schemaReady;
}
