import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateSession = vi.fn();
vi.mock("@/lib/supabase/proxy", () => ({ updateSession: (...args: unknown[]) => updateSession(...args) }));

import { config, proxy } from "./proxy";

describe("Form Coach Proxy policy", () => {
  beforeEach(() => {
    updateSession.mockReset();
    updateSession.mockImplementation(async () => {
      const response = NextResponse.next();
      response.cookies.set("sb-refresh-token", "synthetic-cookie", { httpOnly: true, sameSite: "lax" });
      return response;
    });
  });

  it("keeps session refresh and Set-Cookie while adding CSP only to processing pages", async () => {
    const request = new NextRequest("http://localhost/form-coach/templates");
    const response = await proxy(request);
    expect(updateSession).toHaveBeenCalledOnce();
    const forwardedRequest = updateSession.mock.calls[0]?.[0] as NextRequest;
    const nonce = forwardedRequest.headers.get("x-nonce");
    const requestCsp = forwardedRequest.headers.get("content-security-policy");
    expect(nonce).toMatch(/^[A-Za-z0-9+/=]{16,256}$/);
    expect(requestCsp).toContain(`'nonce-${nonce}'`);
    expect(requestCsp).toContain("'strict-dynamic'");
    expect(requestCsp).not.toContain("unsafe-inline");
    expect(response.headers.get("content-security-policy")).toBe(requestCsp);
    expect(response.cookies.get("sb-refresh-token")?.value).toBe("synthetic-cookie");
    expect(requestCsp).toContain("worker-src 'self'");
  });

  it("does not change the existing dashboard auth path or add processing CSP there", async () => {
    const response = await proxy(new NextRequest("http://localhost/dashboard"));
    expect(updateSession).toHaveBeenCalledOnce();
    expect(updateSession.mock.calls[0]?.[0]).toBeInstanceOf(NextRequest);
    expect((updateSession.mock.calls[0]?.[0] as NextRequest).headers.get("x-nonce")).toBeNull();
    expect(response.headers.get("content-security-policy")).toBeNull();
    expect(response.cookies.get("sb-refresh-token")?.value).toBe("synthetic-cookie");
  });

  it("excludes only the exact generated asset and Worker path prefixes from session refresh", () => {
    const source = config.matcher[0];
    expect(source).toContain("form-coach-assets/");
    expect(source).toContain("form-coach-worker/");
    expect(source).not.toContain("form-coach/");
  });
});
