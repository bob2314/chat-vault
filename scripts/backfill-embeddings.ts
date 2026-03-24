import { ensurePostgresSchema, getPostgresPool } from "@/lib/postgres";
import { embedConversationForUser } from "@/lib/jobs/embed-conversation";

async function run() {
  await ensurePostgresSchema();
  const db = getPostgresPool();
  const result = await db.query<{ user_id: string; id: string }>(
    `
      SELECT user_id, id
      FROM conversations
      ORDER BY updated_at DESC
    `
  );

  let processed = 0;
  for (const row of result.rows) {
    await embedConversationForUser(row.user_id, row.id);
    processed += 1;
    if (processed % 25 === 0) {
      console.log(`Prepared embedding scaffolding for ${processed}/${result.rowCount} conversations...`);
    }
  }

  console.log(`Done. Prepared ${processed} conversation embedding jobs.`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
