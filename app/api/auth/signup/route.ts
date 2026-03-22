import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Signup route is disabled. Use Clerk sign-up components." },
    { status: 410 }
  );
}
