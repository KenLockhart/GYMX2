export type AssetFetchInit = Readonly<{
  method: "GET";
  mode: "same-origin";
  credentials: "omit";
  redirect: "error";
  referrerPolicy: "no-referrer";
}>;

export type AssetRequestDescriptor = Readonly<{
  url: string;
  method: string;
  body?: unknown;
  mode: string;
  credentials: string;
  redirect: string;
  referrerPolicy: string;
}>;

export type AssetRequestPolicy = Readonly<{
  trustedOrigin: string;
  allowedPaths: readonly string[];
}>;

export type AssetRequestRejection =
  | "invalid-request"
  | "invalid-policy"
  | "invalid-url"
  | "noncanonical-url"
  | "url-credentials"
  | "query-or-fragment"
  | "cross-origin"
  | "path-not-allowlisted"
  | "method-not-allowed"
  | "body-not-allowed"
  | "mode-not-allowed"
  | "credentials-not-omitted"
  | "redirect-not-blocked"
  | "referrer-not-suppressed";

export type AssetRequestDecision =
  | Readonly<{
      allowed: true;
      url: string;
      init: AssetFetchInit;
    }>
  | Readonly<{
      allowed: false;
      reason: AssetRequestRejection;
    }>;

const SAFE_FETCH_INIT: AssetFetchInit = Object.freeze({
  method: "GET",
  mode: "same-origin",
  credentials: "omit",
  redirect: "error",
  referrerPolicy: "no-referrer",
});

function rejected(reason: AssetRequestRejection): AssetRequestDecision {
  return { allowed: false, reason };
}

function parseTrustedOrigin(value: string): string | null {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) return null;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.origin === "null" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    (value !== parsed.origin && value !== `${parsed.origin}/`)
  ) {
    return null;
  }

  return parsed.origin;
}

function isCanonicalAllowedPath(pathname: string, origin: string): boolean {
  if (
    typeof pathname !== "string" ||
    !pathname.startsWith("/") ||
    pathname.startsWith("//") ||
    pathname.includes("\\") ||
    pathname.includes("?") ||
    pathname.includes("#")
  ) {
    return false;
  }

  try {
    const parsed = new URL(pathname, `${origin}/`);
    return (
      parsed.origin === origin &&
      parsed.pathname === pathname &&
      parsed.search === "" &&
      parsed.hash === "" &&
      parsed.username === "" &&
      parsed.password === ""
    );
  } catch {
    return false;
  }
}

function parseCanonicalRequestUrl(rawUrl: string, origin: string): URL | null {
  if (
    typeof rawUrl !== "string" ||
    rawUrl.length === 0 ||
    rawUrl.trim() !== rawUrl ||
    rawUrl.includes("\\")
  ) {
    return null;
  }

  try {
    if (rawUrl.startsWith("/")) {
      const parsed = new URL(rawUrl, `${origin}/`);
      if (rawUrl !== parsed.pathname) return null;
      return parsed;
    }

    const parsed = new URL(rawUrl);
    if (rawUrl !== parsed.href) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Checks a request descriptor for one exact same-origin asset URL and returns safe fetch options.
 * This function performs no I/O and cannot validate a server's redirect response; callers must
 * use the returned `redirect: "error"` option and separately audit actual runtime traffic.
 */
export function validateFormCoachAssetRequest(
  request: AssetRequestDescriptor,
  policy: AssetRequestPolicy,
): AssetRequestDecision {
  if (!request || typeof request !== "object" || !policy || typeof policy !== "object") {
    return rejected("invalid-request");
  }

  const origin = parseTrustedOrigin(policy.trustedOrigin);
  if (
    !origin ||
    !Array.isArray(policy.allowedPaths) ||
    policy.allowedPaths.length === 0 ||
    !policy.allowedPaths.every((pathname) => isCanonicalAllowedPath(pathname, origin))
  ) {
    return rejected("invalid-policy");
  }

  if (request.method !== "GET") return rejected("method-not-allowed");
  if (request.body !== undefined && request.body !== null) return rejected("body-not-allowed");
  if (request.mode !== "same-origin") return rejected("mode-not-allowed");
  if (request.credentials !== "omit") return rejected("credentials-not-omitted");
  if (request.redirect !== "error") return rejected("redirect-not-blocked");
  if (request.referrerPolicy !== "no-referrer") return rejected("referrer-not-suppressed");

  if (typeof request.url !== "string") return rejected("invalid-request");
  if (request.url.includes("?") || request.url.includes("#")) {
    return rejected("query-or-fragment");
  }
  const parsed = parseCanonicalRequestUrl(request.url, origin);
  if (!parsed) return rejected("noncanonical-url");
  if (parsed.username !== "" || parsed.password !== "") return rejected("url-credentials");
  if (parsed.search !== "" || parsed.hash !== "") return rejected("query-or-fragment");
  if (parsed.origin !== origin) return rejected("cross-origin");
  if (!policy.allowedPaths.includes(parsed.pathname)) return rejected("path-not-allowlisted");

  return {
    allowed: true,
    url: parsed.href,
    init: SAFE_FETCH_INIT,
  };
}
