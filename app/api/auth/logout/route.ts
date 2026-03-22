import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Logout route is disabled. Use Clerk UserButton sign-out." },
    { status: 410 }
  );
}
