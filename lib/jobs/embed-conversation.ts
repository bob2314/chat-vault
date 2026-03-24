import { chunkConversationMessages } from "@/lib/chunking/conversation-chunker";
import { getEmbeddingProvider } from "@/lib/embeddings/provider";
import { ensurePostgresSchema, getPostgresPool } from "@/lib/postgres";

type ConversationMessageRow = {
  id: string;
  role: string;
  content: string;
};

export async function embedConversationForUser(userId: string, conversationId: string) {
  await ensurePostgresSchema();
  const db = getPostgresPool();

  const conversationResult = await db.query<{ id: string; title: string; full_text: string; updated_at: Date }>(
    `
      SELECT id, title, full_text, updated_at
      FROM conversations
      WHERE user_id = $1 AND id = $2
      LIMIT 1
    `,
    [userId, conversationId]
  );
  const conversation = conversationResult.rows[0];
  if (!conversation) return { updated: false, reason: "conversation_not_found" as const };

  const messagesResult = await db.query<ConversationMessageRow>(
    `
      SELECT id, role, content
      FROM messages
      WHERE user_id = $1 AND conversation_id = $2
      ORDER BY id ASC
    `,
    [userId, conversationId]
  );

  const chunks = chunkConversationMessages(messagesResult.rows, {
    minWindowSize: 3,
    maxWindowSize: 7,
    overlap: 2
  });

  const provider = getEmbeddingProvider();
  const nowIso = new Date().toISOString();
  const summary = `${conversation.title}\n\n${conversation.full_text}`.slice(0, 4000);

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `
        INSERT INTO conversation_embeddings (user_id, conversation_id, summary_text, embedding, status, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (user_id, conversation_id) DO UPDATE SET
          summary_text = EXCLUDED.summary_text,
          embedding = EXCLUDED.embedding,
          status = EXCLUDED.status,
          updated_at = EXCLUDED.updated_at
      `,
      [userId, conversationId, summary, null, provider.isConfigured() ? "queued" : "pending", nowIso]
    );

    await client.query("DELETE FROM message_chunks WHERE user_id = $1 AND conversation_id = $2", [userId, conversationId]);

    for (const chunk of chunks) {
      await client.query(
        `
          INSERT INTO message_chunks (
            user_id, conversation_id, chunk_index, start_message_id, end_message_id, chunk_text, embedding, status, created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          userId,
          conversationId,
          chunk.chunkIndex,
          chunk.startMessageId ? Number(chunk.startMessageId) : null,
          chunk.endMessageId ? Number(chunk.endMessageId) : null,
          chunk.text,
          null,
          provider.isConfigured() ? "queued" : "pending",
          nowIso,
          nowIso
        ]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  // Actual embedding generation is intentionally deferred; this job prepares
  // queue-ready rows and status markers for a later async worker.
  return {
    updated: true,
    provider: provider.getName(),
    chunksPrepared: chunks.length,
    status: provider.isConfigured() ? "queued" : "pending"
  };
}
