import { FORM_COACH_ASSET_PATHS } from "./detector-loader";
import { validateFormCoachAssetRequest, type AssetRequestDescriptor, type AssetRequestPolicy } from "./session-network-policy";
import type { NetworkAuditEntry } from "./worker-protocol";

type GuardScope = {
  readonly location: Pick<Location, "origin">;
  fetch: typeof fetch;
  XMLHttpRequest?: typeof XMLHttpRequest;
  WebSocket?: typeof WebSocket;
  navigator?: Navigator;
  importScripts?: (...urls: string[]) => void;
};

const MAX_AUDIT_ENTRIES = 16;

function safeMethod(method: unknown): string {
  return typeof method === "string" && /^[A-Za-z]{1,12}$/.test(method) ? method.toUpperCase() : "UNKNOWN";
}

function safeHostPath(raw: unknown, origin: string): Pick<NetworkAuditEntry, "host" | "path"> {
  try {
    const parsed = new URL(String(raw), origin);
    const path = parsed.pathname.slice(0, 160) || "/";
    return { host: parsed.hostname.slice(0, 100), path };
  } catch {
    return { host: "invalid", path: "/" };
  }
}

function safeAuditKey(entry: Pick<NetworkAuditEntry, "method" | "host" | "path">): string {
  return `${entry.method}\0${entry.host}\0${entry.path}`;
}

function isAllowedDescriptor(policy: AssetRequestPolicy, descriptor: AssetRequestDescriptor): string | null {
  const decision = validateFormCoachAssetRequest(
    {
      ...descriptor,
      mode: "same-origin",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    },
    policy,
  );
  return decision.allowed ? decision.url : null;
}

function requestBody(input: RequestInfo | URL, init?: RequestInit): BodyInit | null | undefined {
  if (init && Object.prototype.hasOwnProperty.call(init, "body")) return init.body;
  return input instanceof Request ? input.body : undefined;
}

function requestUrl(input: RequestInfo | URL): string {
  if (input instanceof Request) return input.url;
  return input instanceof URL ? input.href : input;
}

function auditSummary(allowedAssetGets: number, allowed: Map<string, NetworkAuditEntry>, blocked: Map<string, NetworkAuditEntry>) {
  return {
    allowedAssetGets,
    allowed: [...allowed.values()].map((entry) => ({ ...entry })),
    blocked: [...blocked.values()].map((entry) => ({ ...entry })),
  };
}

/**
 * Installs a one-way request guard before MediaPipe is imported. It rewrites allowed asset fetches
 * to omit credentials and reject redirects, and blocks all other request destinations. Browser CSP
 * and the actual network audit remain separate release checks.
 */
export function installMediaPipeRequestGuard(scope: GuardScope) {
  const allowedPaths = [
    FORM_COACH_ASSET_PATHS.wasmModuleLoader,
    FORM_COACH_ASSET_PATHS.wasmModuleBinary,
    FORM_COACH_ASSET_PATHS.liteModel,
    FORM_COACH_ASSET_PATHS.fullModel,
  ];
  const policy: AssetRequestPolicy = { trustedOrigin: scope.location.origin, allowedPaths };
  const allowed = new Map<string, NetworkAuditEntry>();
  const blocked = new Map<string, NetworkAuditEntry>();
  let allowedAssetGets = 0;

  function recordBlocked(methodValue: unknown, rawUrl: unknown) {
    const method = safeMethod(methodValue);
    const location = safeHostPath(rawUrl, scope.location.origin);
    const candidate = { method, ...location };
    const key = safeAuditKey(candidate);
    const existing = blocked.get(key);
    if (existing) blocked.set(key, { ...existing, count: existing.count + 1 });
    else if (blocked.size < MAX_AUDIT_ENTRIES) blocked.set(key, { ...candidate, count: 1 });
  }

  function recordAllowed(methodValue: unknown, rawUrl: unknown) {
    const method = safeMethod(methodValue);
    const location = safeHostPath(rawUrl, scope.location.origin);
    const candidate = { method, ...location };
    const key = safeAuditKey(candidate);
    const existing = allowed.get(key);
    if (existing) allowed.set(key, { ...existing, count: existing.count + 1 });
    else if (allowed.size < MAX_AUDIT_ENTRIES) allowed.set(key, { ...candidate, count: 1 });
  }

  function assertAllowed(methodValue: unknown, rawUrl: unknown, body: unknown): string {
    const method = safeMethod(methodValue);
    const url = typeof rawUrl === "string" ? rawUrl : String(rawUrl);
    const descriptor: AssetRequestDescriptor = {
      url,
      method,
      ...(body === undefined || body === null ? {} : { body }),
      mode: "same-origin",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    };
    const allowedUrl = isAllowedDescriptor(policy, descriptor);
    if (!allowedUrl) {
      recordBlocked(method, rawUrl);
      throw new TypeError("Form Coach runtime blocked a non-asset request.");
    }
    return allowedUrl;
  }

  const originalFetch = scope.fetch.bind(scope);
  scope.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const url = assertAllowed(method, requestUrl(input), requestBody(input, init));
    allowedAssetGets += 1;
    recordAllowed(method, url);
    return originalFetch(url, {
      method: "GET",
      mode: "same-origin",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
  }) as typeof scope.fetch;

  const OriginalXmlHttpRequest = scope.XMLHttpRequest;
  if (OriginalXmlHttpRequest) {
    class GuardedXmlHttpRequest extends OriginalXmlHttpRequest {
      override open(method: string, url: string | URL): void {
        recordBlocked(method, url);
        throw new TypeError("Form Coach runtime does not allow XMLHttpRequest.");
      }

      override send(): void {
        throw new TypeError("Form Coach runtime does not allow XMLHttpRequest.");
      }
    }
    scope.XMLHttpRequest = GuardedXmlHttpRequest;
  }

  const originalSendBeacon = scope.navigator?.sendBeacon;
  if (scope.navigator && typeof originalSendBeacon === "function") {
    try {
      Object.defineProperty(scope.navigator, "sendBeacon", {
        configurable: false,
        enumerable: false,
        writable: false,
        value: (url: string | URL) => {
          recordBlocked("POST", url);
          return false;
        },
      });
    } catch {
      throw new TypeError("Form Coach request guard could not block beacon requests.");
    }
  }

  const OriginalWebSocket = scope.WebSocket;
  if (OriginalWebSocket) {
    const GuardedWebSocket = function (url: string | URL) {
      recordBlocked("WEBSOCKET", url);
      throw new TypeError("Form Coach runtime blocked WebSocket requests.");
    } as unknown as typeof WebSocket;
    Object.assign(GuardedWebSocket, {
      CONNECTING: OriginalWebSocket.CONNECTING,
      OPEN: OriginalWebSocket.OPEN,
      CLOSING: OriginalWebSocket.CLOSING,
      CLOSED: OriginalWebSocket.CLOSED,
    });
    try {
      Object.defineProperty(scope, "WebSocket", {
        configurable: false,
        enumerable: true,
        writable: false,
        value: GuardedWebSocket,
      });
    } catch {
      throw new TypeError("Form Coach request guard could not block WebSocket requests.");
    }
  }

  if (scope.importScripts) {
    const blockedImportScripts = (...urls: string[]) => {
      for (const url of urls) recordBlocked("IMPORTSCRIPT", url);
      throw new TypeError("Form Coach runtime does not allow importScripts.");
    };
    try {
      Object.defineProperty(scope, "importScripts", {
        configurable: false,
        enumerable: true,
        writable: false,
        value: blockedImportScripts,
      });
      if (scope.importScripts !== blockedImportScripts) throw new TypeError("Import script guard was not installed.");
    } catch {
      throw new TypeError("Form Coach request guard could not block importScripts.");
    }
  }

  return {
    getSummary() {
      return auditSummary(allowedAssetGets, allowed, blocked);
    },
  };
}
