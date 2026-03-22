import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { deleteSavedSearch, ensureUserRecord } from "@/lib/db";

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureUserRecord(user);
  await deleteSavedSearch(user.id, Number(params.id));
  return NextResponse.json({ ok: true });
}
