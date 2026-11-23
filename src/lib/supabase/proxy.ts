import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "./env";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/profile",
  "/affiliate",
  "/plans",
  "/insights",
  "/welcome",
  "/community",
  "/notifications",
  "/moderation",
  "/checkin",
  "/checkins",
  "/track",
  "/programs",
  "/groups",
  "/admin",
  "/tasks",
  "/library",
  "/coaches",
  "/members",
  "/memos",
  "/calendar",
  "/messages",
  "/armory",
  "/membership",
];

function matchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

const PUBLIC_ARMORY_DETAIL = /^\/armory\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUBLIC_PRINTFUL_APPAREL_ORDER = /^\/armory\/apparel\/order\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiresArmorySignIn(pathname: string) {
  if (
    pathname === "/armory" ||
    pathname === "/armory/checkout-complete" ||
    pathname === "/armory/claim" ||
    pathname === "/armory/apparel" ||
    PUBLIC_PRINTFUL_APPAREL_ORDER.test(pathname) ||
    PUBLIC_ARMORY_DETAIL.test(pathname)
  ) {
    return false;
  }
  return true;
}

export function requiresSignIn(pathname: string) {
  return PROTECTED_PREFIXES.some((prefix) => {
    if (!matchesPrefix(pathname, prefix)) return false;
    return prefix !== "/armory" || requiresArmorySignIn(pathname);
  });
}

export async function updateSession(request: NextRequest) {
  const { url, publishableKey } = getSupabaseEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);
  const { pathname, search } = request.nextUrl;

  if (signedIn || !requiresSignIn(pathname)) {
    return response;
  }

  const redirectTo = new URL("/login", request.url);
  redirectTo.searchParams.set("next", `${pathname}${search}`);

  // A refreshed session must survive the redirect.
  const redirect = NextResponse.redirect(redirectTo);
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  response.headers.forEach((value, key) => {
    if (key === "cache-control" || key === "expires" || key === "pragma") {
      redirect.headers.set(key, value);
    }
  });
  return redirect;
}
