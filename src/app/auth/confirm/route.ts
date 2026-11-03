import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { emailLinkTypeSchema, safeRedirectPath } from "@/lib/validation";

async function verifyLink(searchParams: URLSearchParams) {
  const supabase = await createClient();

  // Email links carry a token hash, so they work in a different browser from the one that asked for them.
  const tokenHash = searchParams.get("token_hash");
  const type = emailLinkTypeSchema.safeParse(searchParams.get("type"));
  if (tokenHash && type.success) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type.data });
    return !error;
  }

  const code = searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return !error;
  }

  return false;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  if (await verifyLink(searchParams)) {
    const next = safeRedirectPath(searchParams.get("next"));
    return NextResponse.redirect(new URL(next, request.url));
  }

  const failed = new URL("/login", request.url);
  failed.searchParams.set("error", "link");
  return NextResponse.redirect(failed);
}
