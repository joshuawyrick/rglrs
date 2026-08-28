import { NextResponse } from "next/server";
import { safeRelativePath } from "@/lib/app-url";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = safeRelativePath(requestUrl.searchParams.get("next"));
  const expired = `/login?expired=1&next=${encodeURIComponent(next)}`;
  if (!code) return NextResponse.redirect(new URL(expired, requestUrl.origin));
  const supabase = await getSupabaseServerClient();
  if (!supabase) return NextResponse.redirect(new URL(expired, requestUrl.origin));
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  return NextResponse.redirect(new URL(error ? expired : next, requestUrl.origin));
}