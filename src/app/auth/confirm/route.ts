import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/validation";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const next = safeRedirectPath(searchParams.get("next"));
      return NextResponse.redirect(new URL(next, request.url));
    }
  }

  const failed = new URL("/login", request.url);
  failed.searchParams.set("error", "link");
  return NextResponse.redirect(failed);
}
