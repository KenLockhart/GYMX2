export const FORM_COACH_WORKER_CSP =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function trustedOrigin(value: string | undefined): string | null {
  if (!value || value.trim() !== value) return null;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username !== "" || url.password !== "" ||
      url.pathname !== "/" || url.search !== "" || url.hash !== ""
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function isFormCoachProcessingPage(pathname: string): boolean {
  return pathname === "/form-coach/templates" || /^\/form-checks\/[^/]+\/session$/.test(pathname);
}

export function buildFormCoachPageCsp(options: { readonly nonce: string; readonly supabaseUrl?: string; readonly development?: boolean }): string {
  if (!/^[A-Za-z0-9+/=_-]{16,256}$/.test(options.nonce)) throw new RangeError("Form Coach CSP nonce is invalid.");
  const supabase = trustedOrigin(options.supabaseUrl);
  const connectSources = ["'self'", ...(supabase ? [supabase] : [])];
  const mediaSources = ["'self'", "blob:", ...(supabase ? [supabase] : [])];
  const scriptSources = ["'self'", `'nonce-${options.nonce}'`, "'strict-dynamic'", ...(options.development ? ["'unsafe-eval'"] : [])];
  const styleSources = ["'self'", `'nonce-${options.nonce}'`];
  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    `style-src ${styleSources.join(" ")}`,
    "img-src 'self' data:",
    "font-src 'self'",
    `media-src ${mediaSources.join(" ")}`,
    "worker-src 'self'",
    `connect-src ${connectSources.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
