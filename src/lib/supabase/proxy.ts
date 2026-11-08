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
];

function matchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
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

  if (signedIn || !PROTECTED_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix))) {
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
