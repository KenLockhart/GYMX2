"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { EXPECTED_PRINTFUL_STORE_ID } from "@/lib/printful/catalog";
import { bindPrintfulUiCostEvidence, isReviewablePrintfulCostProduct } from "@/lib/printful/catalog-cost-evidence";
import { createPrintfulStoreCatalogReader, getPrintfulCatalogSyncConfig, type CompletePrintfulStoreRead } from "@/lib/printful/catalog-provider";
import { syncPrintfulCatalogToPrivateStage } from "@/lib/printful/catalog-runtime";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readRevision(value: unknown): number | null {
  const text = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : typeof value === "string" ? value : "";
  if (!/^(0|[1-9][0-9]{0,14})$/.test(text)) return null;
  const revision = Number(text);
  return Number.isSafeInteger(revision) ? revision : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readSnapshot(value: unknown): CompletePrintfulStoreRead | null {
  const snapshot = readRecord(value);
  if (!snapshot || snapshot.storeId !== EXPECTED_PRINTFUL_STORE_ID || snapshot.storeName !== "GYMX2" ||
    snapshot.storeType !== "native" || snapshot.completeness !== "consistent_paginated_read" ||
    snapshot.atomicProviderSnapshotProven !== false || !Array.isArray(snapshot.products) ||
    typeof snapshot.readStartedAt !== "string" || typeof snapshot.readCompletedAt !== "string") return null;
  return snapshot as unknown as CompletePrintfulStoreRead;
}

function safeResult(status: string): never {
  redirect(`/admin/printful?result=${encodeURIComponent(status)}`);
}

export async function syncPrintfulCatalogAction() {
  await requireAdmin();
  const result = await syncPrintfulCatalogToPrivateStage();
  revalidatePath("/admin/printful");
  safeResult(result.status === "synced" ? `synced-${result.productCount}-${result.variantCount}` : result.status);
}

export async function beginPrintfulCostReviewAction() {
  const { profile } = await requireAdmin();
  const sync = await syncPrintfulCatalogToPrivateStage();
  if (sync.status !== "synced") safeResult(sync.status);
  let reviewId: string;
  try {
    const { data, error } = await createAdminClient().rpc("begin_printful_ui_cost_review", {
      target_admin_id: profile.id,
    });
    if (error || typeof data !== "string" || !UUID_PATTERN.test(data)) safeResult("review_unavailable");
    reviewId = data;
  } catch {
    safeResult("review_unavailable");
  }
  redirect(`/admin/printful?review=${encodeURIComponent(reviewId!)}`);
}

export async function completePrintfulCostReviewAction(formData: FormData) {
  const { profile } = await requireAdmin();
  const sessionId = formData.get("review_id");
  if (typeof sessionId !== "string" || !UUID_PATTERN.test(sessionId)) safeResult("review_unavailable");
  if (formData.get("attest_ui") !== "on" || formData.get("attest_usd") !== "on" || formData.get("attest_unchanged") !== "on") {
    safeResult("attestation_required");
  }

  const config = getPrintfulCatalogSyncConfig();
  if (!config.enabled) safeResult(config.reason);
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    safeResult("persistence_failed");
  }
  const { data: contextData, error: contextError } = await admin.rpc("get_printful_ui_cost_review_context", {
    target_session_id: sessionId,
    target_admin_id: profile.id,
  });
  const context = readRecord(contextData);
  const before = readSnapshot(context?.snapshot);
  if (contextError || !context || !before) safeResult("review_unavailable");

  const eligibleProducts = before.products.filter(isReviewablePrintfulCostProduct);
  if (eligibleProducts.length === 0) safeResult("no_configured_variants");

  const productEvidence: Array<Record<string, unknown>> = [];
  for (const product of eligibleProducts) {
    const priceRows: Array<{ externalId: string; printfulPrice: string }> = [];
    for (const variant of product.variants) {
      const localVariantId = (variant as typeof variant & { localVariantId?: unknown }).localVariantId;
      if (typeof localVariantId !== "string" || !UUID_PATTERN.test(localVariantId) || !variant.externalId) safeResult("review_unavailable");
      const entered = formData.get(`cost_${localVariantId}`);
      if (typeof entered !== "string" || entered.length > 64 || !entered.trim()) safeResult("all_prices_required");
      priceRows.push({ externalId: variant.externalId, printfulPrice: entered.trim() });
    }
    productEvidence.push({
      syncProductId: product.syncProductId,
      selectedSyncVariantIds: product.variants.map((variant) => variant.syncVariantId),
      priceRows,
    });
  }

  // The attested UI review is complete now. Server time is recorded before the
  // after-read starts; the UI, currency and read-only claims are server-created.
  const observedAt = new Date().toISOString();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const { data: revisionData, error: revisionError } = await admin.rpc("get_printful_catalog_sync_revision");
  const expectedRevision = readRevision(revisionData);
  if (revisionError || expectedRevision === null) safeResult("persistence_failed");
  const reader = createPrintfulStoreCatalogReader({ enabled: true, token: config.token, fetcher: fetch });
  const afterRead = await reader.readCompleteStore();
  if (afterRead.status !== "complete") safeResult("provider_failed");
  const { data: nextRevisionData, error: applyError } = await admin.rpc("apply_printful_catalog_snapshot", {
    target_expected_revision: expectedRevision,
    target_snapshot: afterRead.snapshot,
  });
  const nextRevision = readRevision(nextRevisionData);
  if (applyError || nextRevision === null) safeResult(applyError?.code === "40001" ? "stale_read" : "persistence_failed");

  const evidence = {
    source: "official_printful_ui_edit_retail_prices",
    storeId: EXPECTED_PRINTFUL_STORE_ID,
    currency: "USD",
    currencyContext: "USD",
    observedAt,
    readOnly: true,
    priceChangesSaved: false,
    products: productEvidence,
  };
  const rawEvidenceText = JSON.stringify(evidence);
  const binding = bindPrintfulUiCostEvidence({
    rawEvidenceText,
    adminAttestedOfficialUi: true,
    before,
    after: afterRead.snapshot,
    now: new Date(),
  });
  if (binding.status !== "bound") safeResult(`cost_review_${binding.status}`);

  const { error: evidenceError, data: appliedCount } = await admin.rpc("apply_printful_ui_cost_evidence", {
    target_session_id: sessionId,
    target_admin_id: profile.id,
    target_expected_revision: nextRevision,
    target_evidence: evidence,
    target_costs: binding.costs,
    target_evidence_sha256: binding.evidenceSha256,
  });
  if (evidenceError || typeof appliedCount !== "number") safeResult("cost_review_failed");
  revalidatePath("/admin/printful");
  safeResult(`costs-reviewed-${appliedCount}`);
}

export async function importPrintfulPreviewAction(formData: FormData) {
  const { profile } = await requireAdmin();
  const productId = formData.get("product_id");
  if (typeof productId !== "string" || !UUID_PATTERN.test(productId)) safeResult("invalid_selection");
  try {
    const { data, error } = await createAdminClient().rpc("import_printful_armory_preview", {
      target_product_local_id: productId,
      target_admin_id: profile.id,
    });
    if (error || typeof data !== "string" || !UUID_PATTERN.test(data)) safeResult("import_ineligible");
  } catch {
    safeResult("import_ineligible");
  }
  revalidatePath("/armory");
  revalidatePath("/admin/printful");
  safeResult("private_draft_created");
}

export async function updatePrintfulPreviewCurationAction(formData: FormData) {
  const { profile } = await requireAdmin();
  const itemId = formData.get("item_id");
  const title = formData.get("title");
  const description = formData.get("description");
  const imagePath = formData.get("image_path");
  const price = formData.get("price");
  const shipping = formData.get("shipping");
  const priceCents = typeof price === "string" && /^\d+(?:\.\d{1,2})?$/.test(price.trim()) ? Math.round(Number(price) * 100) : NaN;
  const shippingCents = typeof shipping === "string" && /^\d+(?:\.\d{1,2})?$/.test(shipping.trim()) ? Math.round(Number(shipping) * 100) : NaN;
  if (typeof itemId !== "string" || !UUID_PATTERN.test(itemId) || typeof title !== "string" ||
    typeof description !== "string" || !(imagePath === "" || typeof imagePath === "string") ||
    !Number.isSafeInteger(priceCents) || !Number.isSafeInteger(shippingCents)) safeResult("invalid_curation");
  let curationError: string | null = null;
  try {
    const { error } = await createAdminClient().rpc("update_printful_armory_preview", {
      target_item_id: itemId,
      target_admin_id: profile.id,
      target_title: title,
      target_description: description,
      target_image_path: imagePath || null,
      target_price_cents: priceCents,
      target_shipping_cents: shippingCents,
      target_visible_to_all: formData.get("visible_to_all") === "on",
    });
    if (error) curationError = error.code === "P0001" ? "published_image_required" : "invalid_curation";
  } catch {
    curationError = "invalid_curation";
  }
  if (curationError) safeResult(curationError);
  revalidatePath("/armory");
  revalidatePath("/admin/printful");
  safeResult("curation_saved");
}

export async function publishPrintfulPreviewAction(formData: FormData) {
  const { profile } = await requireAdmin();
  const itemId = formData.get("item_id");
  if (typeof itemId !== "string" || !UUID_PATTERN.test(itemId) || formData.get("attest_publish") !== "on") {
    safeResult("publish_attestation_required");
  }
  try {
    const { data, error } = await createAdminClient().rpc("publish_printful_armory_preview", {
      target_item_id: itemId,
      target_admin_id: profile.id,
    });
    if (error || typeof data !== "string" || !UUID_PATTERN.test(data)) safeResult("publish_ineligible");
  } catch {
    safeResult("publish_ineligible");
  }
  revalidatePath("/armory");
  revalidatePath("/admin/printful");
  safeResult("preview_published");
}
