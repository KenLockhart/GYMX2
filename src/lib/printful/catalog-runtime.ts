import "server-only";
import { createPrintfulStoreCatalogReader, getPrintfulCatalogSyncConfig } from "./catalog-provider";
import { createAdminClient } from "@/lib/supabase/admin";

export type PrintfulCatalogSyncResult =
  | { status: "synced"; productCount: number; variantCount: number; availableVariantCount: number; revision: string }
  | { status: "disabled" | "missing_credentials" | "wrong_store" | "provider_failed" | "persistence_failed" | "stale_read" };

function revisionText(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === "string" && /^(0|[1-9][0-9]{0,14})$/.test(value)) return value;
  return null;
}

/**
 * Collect a fully validated Printful read, then write one private atomic DB
 * snapshot using the revision read before the provider request. This never
 * creates public Armory inventory, orders, checkout, or fulfillment work.
 */
export async function syncPrintfulCatalogToPrivateStage(): Promise<PrintfulCatalogSyncResult> {
  const config = getPrintfulCatalogSyncConfig();
  if (!config.enabled) {
    if (config.reason === "wrong_store") return { status: "wrong_store" };
    return { status: config.reason };
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return { status: "persistence_failed" };
  }
  const { data: revisionData, error: revisionError } = await admin.rpc("get_printful_catalog_sync_revision");
  const expectedRevision = revisionText(revisionData);
  if (revisionError || expectedRevision === null) return { status: "persistence_failed" };

  const reader = createPrintfulStoreCatalogReader({ enabled: true, token: config.token, fetcher: fetch });
  const read = await reader.readCompleteStore();
  if (read.status !== "complete") return { status: "provider_failed" };

  const { data: nextRevisionData, error: applyError } = await admin.rpc("apply_printful_catalog_snapshot", {
    target_expected_revision: Number(expectedRevision),
    target_snapshot: read.snapshot,
  });
  if (applyError) return applyError.code === "40001" ? { status: "stale_read" } : { status: "persistence_failed" };
  const nextRevision = revisionText(nextRevisionData);
  if (nextRevision === null) return { status: "persistence_failed" };
  const variants = read.snapshot.products.flatMap((product) => product.variants);
  return {
    status: "synced",
    productCount: read.snapshot.products.length,
    variantCount: variants.length,
    availableVariantCount: variants.filter((variant) =>
      variant.synced && variant.ignored === false && variant.availabilityStatus === "active" && variant.catalogVariantId !== null
    ).length,
    revision: nextRevision,
  };
}

export async function getPrintfulAdminSnapshot(): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await createAdminClient().rpc("get_printful_catalog_admin_snapshot");
    if (error || data === null || typeof data !== "object" || Array.isArray(data)) return null;
    return data as Record<string, unknown>;
  } catch {
    return null;
  }
}
