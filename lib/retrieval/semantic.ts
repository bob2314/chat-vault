import { getEmbeddingProvider } from "@/lib/embeddings/provider";
import { ensurePostgresSchema, getPostgresPool } from "@/lib/postgres";

export type SemanticChunkHit = {
  conversationId: string;
  chunkId: string;
  chunkText: string;
  similarity: number;
};

export async function semanticChunkSearch(input: {
  userId: string;
  query: string;
  limit?: number;
}): Promise<SemanticChunkHit[]> {
  const provider = getEmbeddingProvider();
  if (!provider.isConfigured()) {
    return [];
  }

  await ensurePostgresSchema();
  const db = getPostgresPool();
  const queryEmbedding = await provider.embedQuery(input.query);
  const limit = input.limit ?? 20;

  // Note: vector distance operator requires pgvector-backed columns.
  // If fallback array columns are in use, semantic retrieval is intentionally disabled.
  const result = await db.query<{
    id: string;
    conversation_id: string;
    chunk_text: string;
    similarity: number;
  }>(
    `
      SELECT
        mc.id::text AS id,
        mc.conversation_id,
        mc.chunk_text,
        1 - (mc.embedding <=> $2::vector) AS similarity
      FROM message_chunks mc
      WHERE mc.user_id = $1
        AND mc.embedding IS NOT NULL
      ORDER BY mc.embedding <=> $2::vector ASC
      LIMIT $3
    `,
    [input.userId, `[${queryEmbedding.join(",")}]`, limit]
  );

  return result.rows.map((row) => ({
    conversationId: row.conversation_id,
    chunkId: row.id,
    chunkText: row.chunk_text,
    similarity: row.similarity
  }));
}
