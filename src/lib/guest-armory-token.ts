import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_VERSION = 1;
const MAX_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_PATTERN = /^cs_[A-Za-z0-9_]{8,240}$/;

export type GuestArmoryClaim = {
  purchaseId: string;
  sessionId: string;
  itemId: string;
  expiresAt: number;
};

type EncodedClaim = {
  v: 1;
  p: string;
  s: string;
  i: string;
  e: number;
};

function isClaimShape(value: unknown): value is EncodedClaim {
  if (typeof value !== "object" || value === null) return false;
  const claim = value as Partial<EncodedClaim>;
  return (
    claim.v === TOKEN_VERSION &&
    typeof claim.p === "string" && UUID_PATTERN.test(claim.p) &&
    typeof claim.s === "string" && SESSION_PATTERN.test(claim.s) &&
    typeof claim.i === "string" && UUID_PATTERN.test(claim.i) &&
    typeof claim.e === "number" && Number.isSafeInteger(claim.e)
  );
}

function signature(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`gymx2:guest-armory-download:v1:${encodedPayload}`)
    .digest();
}

export function createGuestArmoryToken(
  claim: Omit<GuestArmoryClaim, "expiresAt">,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  ttlSeconds = MAX_TOKEN_TTL_SECONDS,
) {
  if (secret.length < 32) throw new Error("Guest download signing key is unavailable.");
  if (
    !UUID_PATTERN.test(claim.purchaseId) ||
    !SESSION_PATTERN.test(claim.sessionId) ||
    !UUID_PATTERN.test(claim.itemId) ||
    !Number.isSafeInteger(nowSeconds) ||
    !Number.isSafeInteger(ttlSeconds) ||
    ttlSeconds < 1 ||
    ttlSeconds > MAX_TOKEN_TTL_SECONDS
  ) {
    throw new Error("Invalid guest download claim.");
  }

  const payload: EncodedClaim = {
    v: TOKEN_VERSION,
    p: claim.purchaseId,
    s: claim.sessionId,
    i: claim.itemId,
    e: nowSeconds + ttlSeconds,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = signature(encodedPayload, secret).toString("base64url");
  return `${encodedPayload}.${mac}`;
}

export function verifyGuestArmoryToken(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): GuestArmoryClaim | null {
  if (secret.length < 32 || token.length > 2048) return null;
  const pieces = token.split(".");
  if (pieces.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(pieces[0]) || !/^[A-Za-z0-9_-]+$/.test(pieces[1])) return null;

  const [encodedPayload, encodedMac] = pieces;
  let actualMac: Buffer;
  try {
    actualMac = Buffer.from(encodedMac, "base64url");
  } catch {
    return null;
  }
  const expectedMac = signature(encodedPayload, secret);
  if (actualMac.length !== expectedMac.length || !timingSafeEqual(actualMac, expectedMac)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isClaimShape(payload)) return null;
  if (
    !Number.isSafeInteger(nowSeconds) ||
    payload.e <= nowSeconds ||
    payload.e - nowSeconds > MAX_TOKEN_TTL_SECONDS
  ) {
    return null;
  }
  return {
    purchaseId: payload.p,
    sessionId: payload.s,
    itemId: payload.i,
    expiresAt: payload.e,
  };
}

export const GUEST_ARMORY_TOKEN_TTL_SECONDS = MAX_TOKEN_TTL_SECONDS;
