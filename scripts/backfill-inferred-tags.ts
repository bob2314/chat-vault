import { ensurePostgresSchema, getPostgresPool } from "@/lib/postgres";
import { inferTags } from "@/lib/tag-rules";

async function backfillPostgres() {
  await ensurePostgresSchema();
  const pool = getPostgresPool();
  const rows = await pool.query<{ user_id: string; id: string; full_text: string }>(`
    SELECT user_id, id, full_text
    FROM conversations
    ORDER BY updated_at DESC
  `);

  let inserted = 0;
  for (const row of rows.rows) {
    const existing = await pool.query<{ tag: string }>(
      `
        SELECT tag
        FROM conversation_tags
        WHERE user_id = $1 AND conversation_id = $2
      `,
      [row.user_id, row.id]
    );
    const inferred = inferTags(row.full_text, existing.rows.map((item) => item.tag));
    for (const tag of inferred) {
      const result = await pool.query(
        `
          INSERT INTO conversation_tags (user_id, conversation_id, tag)
          VALUES ($1, $2, $3)
          ON CONFLICT DO NOTHING
        `,
        [row.user_id, row.id, tag]
      );
      inserted += result.rowCount ?? 0;
    }
  }

  console.log(`Postgres backfill complete. Added ${inserted} inferred tags across ${rows.rowCount} conversations.`);
}

async function main() {
  const provider = (process.env.DB_PROVIDER || "sqlite").toLowerCase();
  if (provider !== "postgres") {
    throw new Error("tags:backfill requires DB_PROVIDER=postgres for this project.");
  }
  await backfillPostgres();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
