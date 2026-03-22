import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensureUserRecord, listSavedSearches, saveSearch } from "@/lib/db";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureUserRecord(user);
  return NextResponse.json(await listSavedSearches(user.id));
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureUserRecord(user);
  const body = await request.json();
  if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  return NextResponse.json(await saveSearch(user.id, body));
}
