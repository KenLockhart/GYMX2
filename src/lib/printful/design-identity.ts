import "server-only";
import { createHash } from "node:crypto";

const MAX_BIGINT = "9223372036854775807";

function positiveId(value: unknown): string | null {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) return null;
    value = String(value);
  }
  if (typeof value !== "string" || !/^[1-9][0-9]{0,18}$/.test(value)) return null;
  if (value.length > MAX_BIGINT.length || (value.length === MAX_BIGINT.length && value > MAX_BIGINT)) return null;
  return value;
}

function boundedText(value: unknown, maximum: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : null;
}

const INVALID = Symbol("invalid-stable-value");

function stableValue(value: unknown, depth = 0): unknown | typeof INVALID {
  if (depth > 5) return INVALID;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return boundedText(value, 4096) ?? (value === "" ? "" : INVALID);
  if (typeof value === "number") return Number.isFinite(value) && Math.abs(value) <= 1_000_000_000 ? value : INVALID;
  if (Array.isArray(value)) {
    if (value.length > 32) return INVALID;
    const result = value.map((entry) => stableValue(entry, depth + 1));
    return result.some((entry) => entry === INVALID) ? INVALID : result;
  }
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).sort();
    if (keys.length > 32 || keys.some((key) => !boundedText(key, 64))) return INVALID;
    // A provider option may contain an own `__proto__` key. A normal object
    // treats assignment to that key as a prototype mutation, which would make
    // distinct JSON designs hash to the same canonical value.
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const item = stableValue(object[key], depth + 1);
      if (item === INVALID) return INVALID;
      result[key] = item;
    }
    return result;
  }
  return INVALID;
}

function commonFileOptions(value: unknown): unknown | typeof INVALID {
  const stable = stableValue(value);
  if (!Array.isArray(stable)) return stable;

  const isRecord = (item: unknown): item is Record<string, unknown> =>
    !!item && typeof item === "object" && !Array.isArray(item);
  const canonical = stable.filter((item) => isRecord(item) && item.id === "full_color");
  const camelCase = stable.filter((item) => isRecord(item) && item.id === "fullColor");
  if (canonical.length !== 1 || camelCase.length !== 1) return stable;

  const [canonicalOption] = canonical;
  const [camelCaseOption] = camelCase;
  const isExactBooleanOption = (option: Record<string, unknown>) =>
    Object.keys(option).length === 2 && Object.hasOwn(option, "id") && Object.hasOwn(option, "value") &&
    typeof option.value === "boolean";
  if (!isExactBooleanOption(canonicalOption) || !isExactBooleanOption(camelCaseOption) ||
      canonicalOption.value !== camelCaseOption.value) return stable;

  // Observed native product/order response normalization inference only: do not
  // treat this as a vendor-documented alias guarantee. Collapse only the exact,
  // equal pair for common readback identity; the raw approval/config fingerprint
  // remains unchanged.
  return stable.filter((item) => item !== camelCaseOption);
}

/**
 * Common production identity observable in both a SyncVariant read and an Order
 * response. It intentionally excludes provider-only/transport fields and the
 * write-only file positioning field. It is not a cryptographic freeze of Printful's
 * complete design; callers must also compare the current native approval fingerprint.
 */
export function printfulCommonDesignIdentity(input: Readonly<{
  syncVariantId: unknown;
  catalogVariantId: unknown;
  files: unknown;
  options: unknown;
}>): string | null {
  const syncVariantId = positiveId(input.syncVariantId);
  const catalogVariantId = positiveId(input.catalogVariantId);
  if (!syncVariantId || !catalogVariantId || !Array.isArray(input.files) || input.files.length > 16 ||
    !input.files.length || !Array.isArray(input.options) || input.options.length > 64) return null;

  const files: Array<{ id: string | null; hash: string | null; type: string; options: unknown }> = [];
  for (const raw of input.files) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const file = raw as Record<string, unknown>;
    const type = file.type === undefined || file.type === null ? "default" : boundedText(file.type, 100);
    if (!type) return null;
    if (type.toLowerCase() === "preview") continue;
    const id = file.id === undefined || file.id === null ? null : positiveId(file.id);
    const hash = file.hash === undefined || file.hash === null
      ? null
      : typeof file.hash === "string" && /^[0-9a-f]{32}$/i.test(file.hash) ? file.hash.toLowerCase() : null;
    if ((file.id !== undefined && file.id !== null && id === null) ||
      (file.hash !== undefined && file.hash !== null && hash === null) || (!id && !hash)) return null;
    const fileOptions = file.options === undefined ? [] : commonFileOptions(file.options);
    if (fileOptions === INVALID || !Array.isArray(fileOptions)) return null;
    files.push({ id, hash, type, options: fileOptions });
  }
  if (!files.length) return null;
  files.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  const options: Array<{ id: string; value: unknown }> = [];
  for (const raw of input.options) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const option = raw as Record<string, unknown>;
    const id = boundedText(option.id, 100);
    if (!id || !Object.hasOwn(option, "value")) return null;
    const value = stableValue(option.value);
    if (value === INVALID) return null;
    options.push({ id, value });
  }
  options.sort((a, b) => a.id.localeCompare(b.id) || JSON.stringify(a.value).localeCompare(JSON.stringify(b.value)));
  return createHash("sha256").update(JSON.stringify({ syncVariantId, catalogVariantId, files, options })).digest("hex");
}
