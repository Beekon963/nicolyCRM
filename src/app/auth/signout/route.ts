import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** ログアウト（無効化された人を強制的にログアウトさせるときも使う） */
async function signOut(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const error = request.nextUrl.searchParams.get("error");
  const url = new URL("/login", request.nextUrl.origin);
  if (error === "not_allowed") url.searchParams.set("error", error);
  return NextResponse.redirect(url, { status: 303 });
}

export const GET = signOut;
export const POST = signOut;
