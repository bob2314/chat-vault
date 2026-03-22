import fs from "node:fs";
import path from "node:path";
import { createUser, importConversationsForUser } from "@/lib/db";

async function main() {
  let userId = "demo-user";
  try {
    const user = await createUser({ name: "Demo User", email: "demo@example.com", password: "password123" });
    userId = user.id;
  } catch {
    userId = "demo-example-com";
  }

  const filePath = path.join(process.cwd(), "public", "sample-import.json");
  const sample = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const result = await importConversationsForUser(userId, sample);
  console.log(`Seeded ${result.imported} conversations for ${userId} using ${result.provider}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
