import { searchConversationsForUser } from "@/lib/db";

export async function keywordSearch(input: {
  userId: string;
  query: string;
  tag?: string | null;
  topic?: string | null;
}) {
  return searchConversationsForUser(input);
}
