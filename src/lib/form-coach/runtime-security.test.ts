import { describe, expect, it } from "vitest";
import { buildFormCoachPageCsp, FORM_COACH_WORKER_CSP, isFormCoachProcessingPage } from "./runtime-security";

describe("Form Coach runtime CSP", () => {
  it("adds blob support only for page media while keeping worker and network sources same-origin", () => {
    const csp = buildFormCoachPageCsp({ nonce: "dGVzdC1ub25jZS0xMjM0NTY=", supabaseUrl: "https://gymx2.supabase.co", development: false });
    expect(csp).toContain("media-src 'self' blob: https://gymx2.supabase.co");
    expect(csp).toContain("worker-src 'self'");
    expect(csp).toContain("connect-src 'self' https://gymx2.supabase.co");
    expect(csp).toContain("'nonce-dGVzdC1ub25jZS0xMjM0NTY='");
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).not.toContain("worker-src blob:");
    expect(csp).not.toContain("script-src 'self' blob:");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("google");
  });

  it("rejects missing or malformed page nonces", () => {
    expect(() => buildFormCoachPageCsp({ nonce: "short" })).toThrow(RangeError);
  });

  it("keeps the Worker response default-deny with no external or blob sources", () => {
    expect(FORM_COACH_WORKER_CSP).toContain("default-src 'none'");
    expect(FORM_COACH_WORKER_CSP).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(FORM_COACH_WORKER_CSP).toContain("connect-src 'self'");
    expect(FORM_COACH_WORKER_CSP).toContain("worker-src 'none'");
    expect(FORM_COACH_WORKER_CSP).not.toContain("blob:");
    expect(FORM_COACH_WORKER_CSP).not.toContain("google");
  });

  it("matches only the coach template and one member session path", () => {
    expect(isFormCoachProcessingPage("/form-coach/templates")).toBe(true);
    expect(isFormCoachProcessingPage("/form-checks/a1/session")).toBe(true);
    expect(isFormCoachProcessingPage("/form-checks/a1/session/history")).toBe(false);
    expect(isFormCoachProcessingPage("/dashboard")).toBe(false);
    expect(isFormCoachProcessingPage("/coaches")).toBe(false);
  });
});
