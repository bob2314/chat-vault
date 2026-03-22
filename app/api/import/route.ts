import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensureUserRecord, getImportStatusForUser, importConversationsForUser } from "@/lib/db";
import { normalizePayloadFromUpload } from "@/lib/importer";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureUserRecord(user);
  const status = await getImportStatusForUser(user.id);
  return NextResponse.json(status);
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureUserRecord(user);
    let payload: unknown;
    const contentType = request.headers.get("content-type") || "";
    let source: "manual" | "gpt_sync" = "manual";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "Missing file upload." }, { status: 400 });
      }
      const arrayBuffer = await file.arrayBuffer();
      payload = normalizePayloadFromUpload({
        fileName: file.name,
        buffer: Buffer.from(arrayBuffer)
      });
      source = "gpt_sync";
    } else {
      payload = await request.json();
    }

    const result = await importConversationsForUser(user.id, payload, { source });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Import failed." }, { status: 400 });
  }
}
