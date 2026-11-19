import { describe, expect, it } from "vitest";
import {
  validateFormCoachAssetRequest,
  type AssetRequestDescriptor,
  type AssetRequestPolicy,
} from "./session-network-policy";

const origin = "https://gymx2.test";
const wasmPath = "/form-coach-assets/1.2.3-assets1/wasm/vision_wasm_module_internal.wasm";
const modelPath =
  "/form-coach-assets/1.2.3-assets1/models/sha256-59929E1D1EE95287735DDD833B19CF4AC46D29BC7AFDDBBF6753C459690D574A/pose_landmarker_lite.task";
const allowedPaths = [wasmPath, modelPath];
const policy: AssetRequestPolicy = { trustedOrigin: origin, allowedPaths };

function request(overrides: Partial<AssetRequestDescriptor> = {}): AssetRequestDescriptor {
  return {
    url: wasmPath,
    method: "GET",
    body: undefined,
    mode: "same-origin",
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
    ...overrides,
  };
}

describe("Form Coach asset request policy", () => {
  it("returns canonical same-origin GET options for exact allowlisted asset paths", () => {
    const relative = validateFormCoachAssetRequest(request(), policy);
    expect(relative).toEqual({
      allowed: true,
      url: `${origin}${wasmPath}`,
      init: {
        method: "GET",
        mode: "same-origin",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
      },
    });

    expect(validateFormCoachAssetRequest(request({ url: `${origin}${modelPath}` }), policy).allowed).toBe(true);
  });

  it.each([
    { label: "other origin", url: "https://evil.example/form-coach-assets/1.2.3-assets1/wasm/vision_wasm_module_internal.wasm", reason: "cross-origin" },
    { label: "external telemetry", url: "https://odml.pa.googleapis.com/v1/log", reason: "cross-origin" },
    { label: "unlisted same-origin path", url: "/api/redirect", reason: "path-not-allowlisted" },
    { label: "open redirect endpoint", url: "/redirect?next=https://evil.example/", reason: "query-or-fragment" },
    { label: "case-changed path", url: wasmPath.toUpperCase(), reason: "path-not-allowlisted" },
    { label: "encoded path alias", url: wasmPath.replace("wasm/", "%77asm/"), reason: "path-not-allowlisted" },
    { label: "dot-segment traversal", url: "/form-coach-assets/1.2.3-assets1/wasm/../wasm/vision_wasm_module_internal.wasm", reason: "noncanonical-url" },
    { label: "encoded dot-segment traversal", url: "/form-coach-assets/1.2.3-assets1/%2e%2e/1.2.3-assets1/wasm/vision_wasm_module_internal.wasm", reason: "noncanonical-url" },
    { label: "protocol-relative redirect", url: "//evil.example/form-coach-assets/1.2.3-assets1/wasm/vision_wasm_module_internal.wasm", reason: "noncanonical-url" },
    { label: "backslash normalization", url: "\\\\evil.example\\form-coach-assets\\1.2.3-assets1\\wasm\\vision_wasm_module_internal.wasm", reason: "noncanonical-url" },
    { label: "absolute URL with user info", url: `https://person:secret@gymx2.test${wasmPath}`, reason: "url-credentials" },
    { label: "empty query delimiter", url: `${wasmPath}?`, reason: "query-or-fragment" },
    { label: "fragment", url: `${wasmPath}#part`, reason: "query-or-fragment" },
  ] as const)("rejects $label", ({ url, reason }) => {
    expect(validateFormCoachAssetRequest(request({ url }), policy)).toEqual({ allowed: false, reason });
  });

  it.each([
    { label: "POST", request: request({ method: "POST" }), reason: "method-not-allowed" },
    { label: "lowercase get", request: request({ method: "get" }), reason: "method-not-allowed" },
    { label: "nonempty body", request: request({ body: "frame payload" }), reason: "body-not-allowed" },
    { label: "same-origin credentials", request: request({ credentials: "same-origin" }), reason: "credentials-not-omitted" },
    { label: "included credentials", request: request({ credentials: "include" }), reason: "credentials-not-omitted" },
    { label: "follow redirects", request: request({ redirect: "follow" }), reason: "redirect-not-blocked" },
    { label: "manual redirects", request: request({ redirect: "manual" }), reason: "redirect-not-blocked" },
    { label: "CORS mode", request: request({ mode: "cors" }), reason: "mode-not-allowed" },
    { label: "referrer forwarding", request: request({ referrerPolicy: "origin" }), reason: "referrer-not-suppressed" },
  ] as const)("rejects $label transport", ({ request: candidate, reason }) => {
    expect(validateFormCoachAssetRequest(candidate, policy)).toEqual({ allowed: false, reason });
  });

  it("rejects a trusted origin containing path, credentials, or query state", () => {
    for (const trustedOrigin of [
      "https://gymx2.test/account",
      "https://name:secret@gymx2.test",
      "https://gymx2.test?next=/login",
    ]) {
      expect(
        validateFormCoachAssetRequest(request(), { trustedOrigin, allowedPaths }),
      ).toEqual({ allowed: false, reason: "invalid-policy" });
    }
  });

  it("rejects an allowlist entry that URL normalization would rewrite", () => {
    expect(
      validateFormCoachAssetRequest(request(), {
        trustedOrigin: origin,
        allowedPaths: ["/form-coach-assets/1.2.3-assets1/wasm/../wasm/vision_wasm_module_internal.wasm"],
      }),
    ).toEqual({ allowed: false, reason: "invalid-policy" });
  });
});
