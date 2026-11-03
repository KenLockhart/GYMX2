import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "./env";

const PROTECTED_PREFIXES = ["/dashboard", "/profile", "/admin"];
const SIGNED_OUT_ONLY_PATHS = ["/login", "/signup"];

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

  let redirectTo: URL | null = null;
  if (!signedIn && PROTECTED_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix))) {
    redirectTo = new URL("/login", request.url);
    redirectTo.searchParams.set("next", `${pathname}${search}`);
  } else if (signedIn && SIGNED_OUT_ONLY_PATHS.includes(pathname)) {
    redirectTo = new URL("/dashboard", request.url);
  }

  if (!redirectTo) return response;

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
