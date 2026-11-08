import { NextResponse, type NextRequest } from "next/server";
import {
  findApprovedAffiliate,
  loadProgramSettings,
  recordClick,
} from "@/lib/affiliate-server";
import { REFERRAL_COOKIE, normalizeCode } from "@/lib/affiliates";
import { safeRedirectPath } from "@/lib/validation";

// An affiliate link: gymx2.com/r/<code>, optionally ?to=/a/page. Remembers who sent the visitor
// for a while (the cookie), counts the click, then takes them to sign up or to the page.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const code = normalizeCode((await params).code);
  const destination = safeRedirectPath(
    request.nextUrl.searchParams.get("to"),
    "/signup",
  );
  const response = NextResponse.redirect(new URL(destination, request.url), {
    status: 307,
  });

  const affiliate = await findApprovedAffiliate(code);
  if (!affiliate) return response;

  // Count a click once per visitor and link, not on every page reload.
  const already =
    request.cookies.get(REFERRAL_COOKIE)?.value === affiliate.code;
  if (!already)
    await recordClick(affiliate.user_id).catch((error) => console.error(error));

  const { cookie_days } = await loadProgramSettings();
  response.cookies.set(REFERRAL_COOKIE, affiliate.code, {
    maxAge: cookie_days * 24 * 60 * 60,
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
  });
  return response;
}
