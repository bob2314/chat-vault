import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Login route is disabled. Use Clerk sign-in components." },
    { status: 410 }
  );
}
