import { requireAdmin } from "@/lib/auth";
import { getPrintfulCatalogSyncConfig } from "@/lib/printful/catalog-provider";
import { getPrintfulAdminSnapshot } from "@/lib/printful/catalog-runtime";
import { createAdminClient } from "@/lib/supabase/admin";
import { isReviewablePrintfulCostProduct } from "@/lib/printful/catalog-cost-evidence";
import { PrintfulImageField } from "@/components/printful-image-field";
import {
  beginPrintfulCostReviewAction,
  completePrintfulCostReviewAction,
  importPrintfulPreviewAction,
  publishPrintfulPreviewAction,
  setPrintfulApparelApprovalAction,
  syncPrintfulCatalogAction,
  updatePrintfulPreviewCurationAction,
} from "./actions";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AdminVariant = {
  localVariantId?: string;
  name?: string;
  color?: string | null;
  size?: string | null;
  synced?: boolean;
  ignored?: boolean | null;
  availabilityStatus?: string | null;
  available?: boolean;
  configurationComplete?: boolean;
  productionCostMinCents?: number | null;
  productionCostMaxCents?: number | null;
  productionCostCurrency?: string | null;
  productionCostSource?: string | null;
  productionCostObservedAt?: string | null;
  productionCostRawPrice?: string | null;
  productionCostFresh?: boolean;
};

type AdminProduct = {
  localProductId?: string;
  name?: string;
  ignored?: boolean | null;
  seenInLatestRead?: boolean;
  importedArmoryItemId?: string | null;
  importedTitle?: string | null;
  importedDescription?: string | null;
  importedImagePath?: string | null;
  importedPriceCents?: number | null;
  importedShippingCents?: number | null;
  importedVisibleToAll?: boolean;
  importedRequiredMembershipTier?: "everyone" | "premium";
  importedPublished?: boolean;
  canImport?: boolean;
  variants?: AdminVariant[];
};

type AdminApparelOrder = {
  orderId: string;
  orderStatus: string;
  fulfillmentStatus: string;
  providerStatus: string | null;
  safeErrorCode: string | null;
  costExceptionCode: string | null;
  updatedAt: string;
  retryAt: string | null;
};

function money(cents: number | null | undefined): string {
  return typeof cents === "number" ? `$${(cents / 100).toFixed(2)}` : "Not verified";
}

function toReviewProduct(value: unknown): AdminProduct | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const product = value as AdminProduct;
  if (product.importedRequiredMembershipTier !== "everyone" && product.importedRequiredMembershipTier !== "premium") {
    return { ...product, importedRequiredMembershipTier: "everyone" };
  }
  return product;
}

function toAdminApparelOrder(value: unknown): AdminApparelOrder | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.order_id !== "string" || !UUID_PATTERN.test(row.order_id) ||
    typeof row.order_status !== "string" || typeof row.fulfillment_status !== "string" ||
    typeof row.updated_at !== "string" || !Number.isFinite(Date.parse(row.updated_at)) ||
    !(row.provider_status === null || typeof row.provider_status === "string") ||
    !(row.safe_error_code === null || typeof row.safe_error_code === "string" && /^[a-z0-9_]{1,80}$/.test(row.safe_error_code)) ||
    !(row.provider_cost_exception_code === null || typeof row.provider_cost_exception_code === "string" && /^[a-z0-9_]{1,80}$/.test(row.provider_cost_exception_code)) ||
    !(row.retry_at === null || typeof row.retry_at === "string" && Number.isFinite(Date.parse(row.retry_at)))) return null;
  return {
    orderId: row.order_id,
    orderStatus: row.order_status,
    fulfillmentStatus: row.fulfillment_status,
    providerStatus: row.provider_status as string | null,
    safeErrorCode: row.safe_error_code as string | null,
    costExceptionCode: row.provider_cost_exception_code as string | null,
    updatedAt: row.updated_at,
    retryAt: row.retry_at as string | null,
  };
}

function adminExceptionLabel(code: string): string {
  const known = new Map<string, string>([
    ["provider_cost_facts_unverified", "Supplier cost facts need review"],
    ["provider_cost_changed", "Supplier cost differs from the approved quote"],
    ["provider_cost_above_cap", "Supplier cost exceeds the authorized cap"],
    ["provider_cost_above_net", "Supplier cost exceeds verified payment proceeds"],
    ["stripe_payment_risk_requires_review", "Stripe refund or dispute needs review"],
    ["confirm_outcome_requires_review", "Supplier confirmation outcome needs review"],
  ]);
  return known.get(code) ?? "Order needs admin review";
}

function resultMessage(value: string | undefined): string | null {
  if (!value) return null;
  const safe = new Map<string, string>([
    ["provider_failed", "Printful could not provide a complete consistent catalog read. No catalog rows were written."],
    ["disabled", "Automatic sync is disabled. The feature flag must be explicitly enabled after deployment review."],
    ["missing_credentials", "The server is missing the Printful read-only credential."],
    ["wrong_store", "The server is not configured for the expected GYMX2 store."],
    ["persistence_failed", "The private catalog stage could not be updated."],
    ["stale_read", "Another sync completed first. Run a fresh catalog read."],
    ["review_unavailable", "That cost-review session expired or is unavailable. Start a new review."],
    ["attestation_required", "Confirm that the displayed Printful prices were reviewed in USD and no prices were saved."],
    ["no_configured_variants", "No variants have a complete production design configuration yet."],
    ["all_prices_required", "Enter the Printful production price shown for every eligible color and size."],
    ["cost_review_stale_evidence", "The Printful configuration changed during review or the observation is older than 24 hours."],
    ["cost_review_configuration_changed", "The Printful design or variant mapping changed during review. Review costs again."],
    ["cost_review_variant_set_mismatch", "The selected variant set changed during review. Start a new review."],
    ["cost_review_ambiguous_external_id", "Printful external IDs did not map to unique variants. No prices were saved."],
    ["cost_review_wrong_currency", "Confirm USD in Printful before saving production costs."],
    ["cost_review_failed", "The private cost evidence could not be saved."],
    ["private_draft_created", "Private Printful draft created. It is not in the Armory until you save curation and publish it."],
    ["publish_attestation_required", "Confirm that you approve this image, copy and price for publication."],
    ["publish_ineligible", "Save a title, description, image and price before publishing this preview."],
    ["preview_published", "Curated display-only Gear preview published in the Armory."],
    ["import_ineligible", "This product needs fresh exact USD production costs for every configured variant before import."],
    ["curation_saved", "Preview curation saved."],
    ["invalid_curation", "The curated preview could not be saved. Check the title, image path and prices."],
    ["published_image_required", "A published preview must keep an image. Upload a replacement before saving."],
    ["apparel_attestation_required", "Confirm that this published listing is apparel before approving it for guest checkout."],
    ["apparel_approval_failed", "The Apparel approval could not be saved. Check that the published preview and exact costs are still eligible."],
    ["apparel_approved", "This published listing is explicitly classified as Apparel. Global sales activation remains separately gated."],
    ["apparel_approval_disabled", "Apparel checkout approval was disabled for this listing."],
  ]);
  if (value.startsWith("synced-")) return `Private catalog sync completed: ${value.slice(7).replace("-", " products and ")} variants.`;
  if (value.startsWith("costs-reviewed-")) return `Private UI cost evidence saved for ${value.slice("costs-reviewed-".length)} variants. Ranges remain ineligible for import.`;
  return safe.get(value) ?? null;
}

export default async function PrintfulAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ review?: string; result?: string }>;
}) {
  const { profile } = await requireAdmin();
  const query = await searchParams;
  const syncConfig = getPrintfulCatalogSyncConfig();
  const snapshot = await getPrintfulAdminSnapshot();
  const products = Array.isArray(snapshot?.products)
    ? snapshot.products.map(toReviewProduct).filter((product): product is AdminProduct => product !== null)
    : [];
  let apparelApprovalByProduct = new Map<string, boolean>();
  try {
    const { data, error } = await createAdminClient().rpc("get_printful_apparel_admin_approvals");
    if (!error && Array.isArray(data)) {
      apparelApprovalByProduct = new Map(data.flatMap((entry: unknown) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
        const row = entry as { product_id?: unknown; enabled?: unknown };
        return typeof row.product_id === "string" && typeof row.enabled === "boolean"
          ? [[row.product_id, row.enabled] as const] : [];
      }));
    }
  } catch {
    apparelApprovalByProduct = new Map();
  }
  let apparelOrders: AdminApparelOrder[] = [];
  let apparelOrdersReadFailed = false;
  try {
    const { data, error } = await createAdminClient().rpc("list_printful_apparel_admin_orders");
    if (error || !Array.isArray(data)) apparelOrdersReadFailed = true;
    else apparelOrders = data.map(toAdminApparelOrder).filter((row): row is AdminApparelOrder => row !== null);
  } catch {
    apparelOrdersReadFailed = true;
  }
  const reviewId = typeof query.review === "string" && UUID_PATTERN.test(query.review) ? query.review : null;
  let reviewSnapshot: Record<string, unknown> | null = null;
  if (reviewId) {
    try {
      const { data } = await createAdminClient().rpc("get_printful_ui_cost_review_context", {
        target_session_id: reviewId,
        target_admin_id: profile.id,
      });
      if (data && typeof data === "object" && !Array.isArray(data)) {
        const context = data as { snapshot?: unknown };
        if (context.snapshot && typeof context.snapshot === "object" && !Array.isArray(context.snapshot)) {
          reviewSnapshot = context.snapshot as Record<string, unknown>;
        }
      }
    } catch {
      reviewSnapshot = null;
    }
  }
  const reviewProducts = Array.isArray(reviewSnapshot?.products)
    ? reviewSnapshot.products.map(toReviewProduct).filter((product): product is AdminProduct => product !== null)
    : [];
  const eligibleReviewProducts = reviewProducts.filter(isReviewablePrintfulCostProduct);
  const excludedReviewCount = reviewProducts.length - eligibleReviewProducts.length;

  return (
    <main className="mx-auto max-w-6xl space-y-8">
      <header className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-wider text-accent">Admin Console · Commerce</p>
        <h1 className="text-3xl font-bold">Printful catalog</h1>
        <p className="max-w-3xl text-muted">
          The daily job reads the expected Printful store into a private catalog stage. It does not publish items,
          create Printful products or orders, or enable checkout and fulfillment. Catalog sync is currently {syncConfig.enabled ? "enabled" : "disabled"}.
        </p>
      </header>

      {resultMessage(query.result) && (
        <p role="status" className="rounded-xl border border-border bg-surface p-4 text-sm">{resultMessage(query.result)}</p>
      )}

      <section className="rounded-2xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Private catalog read</h2>
            <p className="mt-1 text-sm text-muted">
              Store 19050731 · {typeof snapshot?.productCount === "number" ? snapshot.productCount : 0} products · revision {String(snapshot?.revision ?? "0")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <form action={syncPrintfulCatalogAction}>
              <button className="rounded-lg bg-accent px-4 py-2 font-semibold text-accent-foreground">Sync catalog now</button>
            </form>
            <form action={beginPrintfulCostReviewAction}>
              <button className="rounded-lg border border-border px-4 py-2 font-semibold">Start configured-cost review</button>
            </form>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted">
          API retail prices are ignored. Production prices below come only from an administrator-reviewed Printful UI observation, expire after 24 hours, and are tied to the exact design fingerprint. Free customer shipping is the initial setting; Printful merchant shipping and seasonal charges remain separate.
        </p>
      </section>

      <section className="space-y-4 rounded-2xl border border-border bg-surface p-5" aria-labelledby="private-apparel-order-status">
        <div>
          <h2 id="private-apparel-order-status" className="text-xl font-semibold">Private Apparel order status</h2>
          <p className="mt-1 text-sm text-muted">
            Review holds and supplier-cost exceptions here. This list contains no customer address, payment details or Printful IDs, and has no refund or fulfillment controls.
          </p>
        </div>
        {apparelOrdersReadFailed ? (
          <p role="status" className="rounded-lg border border-border p-3 text-sm">Private Apparel order status is temporarily unavailable.</p>
        ) : apparelOrders.length === 0 ? (
          <p className="rounded-lg bg-surface-raised p-3 text-sm text-muted">No private Apparel orders have been recorded.</p>
        ) : (
          <ul className="space-y-3">
            {apparelOrders.map((order) => (
              <li key={order.orderId} className="rounded-xl bg-surface-raised p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">Order ending {order.orderId.slice(-8)}</p>
                    <p className="text-sm text-muted">Payment: {order.orderStatus} · Fulfillment: {order.fulfillmentStatus}{order.providerStatus ? ` · Supplier: ${order.providerStatus}` : ""}</p>
                  </div>
                  {order.costExceptionCode || order.safeErrorCode ? (
                    <p className="text-sm font-medium text-accent">{adminExceptionLabel(order.costExceptionCode ?? order.safeErrorCode!)}</p>
                  ) : null}
                </div>
                <p className="mt-2 text-xs text-muted">Updated {new Date(order.updatedAt).toLocaleString()}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {reviewId && reviewSnapshot && (
        <section className="space-y-4 rounded-2xl border border-accent/40 bg-surface p-5">
          <div>
            <h2 className="text-xl font-semibold">Review configured production prices</h2>
            <p className="mt-1 text-sm text-muted">
              Compare every color and size below with the published product’s Printful price. Enter a scalar such as $18.44 or preserve a range such as $11.92 - $12.25. A range is recorded as a range and blocks import until an exact configured cost is known. Do not change or save prices in Printful.
            </p>
          </div>
          {excludedReviewCount > 0 && <p className="text-sm text-muted">{excludedReviewCount} products remain unpriced because their production design configuration is incomplete or ignored.</p>}
          {eligibleReviewProducts.length === 0 ? (
            <p className="rounded-lg bg-surface-raised p-3 text-sm">No products are ready for cost review.</p>
          ) : (
            <form action={completePrintfulCostReviewAction} className="space-y-5">
              <input type="hidden" name="review_id" value={reviewId} />
              {eligibleReviewProducts.map((product, productIndex) => (
                <fieldset key={`${product.name}-${productIndex}`} className="rounded-xl border border-border p-4">
                  <legend className="px-2 font-semibold">{product.name}</legend>
                  <div className="space-y-3">
                    {product.variants?.map((variant) => {
                      const localId = variant.localVariantId!;
                      const label = [variant.color, variant.size].filter(Boolean).join(" · ") || variant.name || "Variant";
                      return (
                        <label key={localId} className="grid gap-2 text-sm sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-center">
                          <span>{label}<span className="ml-2 text-xs text-muted">{variant.available ? "Available" : variant.availabilityStatus ?? "Unavailable"}</span></span>
                          <input
                            name={`cost_${localId}`}
                            defaultValue={variant.productionCostRawPrice ?? ""}
                            maxLength={64}
                            required
                            autoComplete="off"
                            placeholder="$18.44 or a range"
                            className="rounded-lg border border-border bg-background px-3 py-2"
                          />
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
              <div className="space-y-2 rounded-xl bg-surface-raised p-4 text-sm">
                <label className="flex gap-2"><input type="checkbox" name="attest_ui" required />I reviewed these prices in the published Printful product editor and matched each displayed color and size.</label>
                <label className="flex gap-2"><input type="checkbox" name="attest_usd" required />The Printful account currency is USD and these are Printful production prices, not retail prices.</label>
                <label className="flex gap-2"><input type="checkbox" name="attest_unchanged" required />I made no price or design changes in Printful while reviewing.</label>
              </div>
              <button className="rounded-lg bg-accent px-4 py-2 font-semibold text-accent-foreground">Save reviewed costs privately</button>
            </form>
          )}
        </section>
      )}

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Staged products</h2>
          <p className="text-sm text-muted">Provider IDs and design payloads stay server-side. Creating a draft keeps it private. A separate publish action creates the display-only Gear row only after you save approved copy, an image and a customer price.</p>
        </div>
        {products.length === 0 ? <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">No private catalog snapshot has been recorded.</p> : null}
        <div className="space-y-4">
          {products.map((product) => (
            <article key={product.localProductId} className="space-y-4 rounded-2xl border border-border bg-surface p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">{product.name}</h3>
                  <p className="text-sm text-muted">{product.variants?.length ?? 0} variants · {product.seenInLatestRead ? "in latest complete read" : "not present in latest read; retained"}</p>
                </div>
                {product.canImport && !product.importedArmoryItemId ? (
                  <form action={importPrintfulPreviewAction}>
                    <input type="hidden" name="product_id" value={product.localProductId} />
                  <button className="rounded-lg border border-border px-4 py-2 font-semibold">Create private Gear draft</button>
                  </form>
              ) : product.importedArmoryItemId ? <span className="text-sm font-medium text-muted">{product.importedPublished ? "Published · display-only" : "Private draft · not in the Armory"}</span> : null}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] text-left text-sm">
                  <thead><tr className="border-b border-border text-muted"><th className="py-2 pr-4">Color / size</th><th className="py-2 pr-4">Availability</th><th className="py-2 pr-4">Configured Printful price</th><th className="py-2">Evidence</th></tr></thead>
                  <tbody>
                    {product.variants?.map((variant) => (
                      <tr key={variant.localVariantId} className="border-b border-border/60">
                        <td className="py-2 pr-4">{[variant.color, variant.size].filter(Boolean).join(" · ") || variant.name}</td>
                        <td className="py-2 pr-4">{variant.available ? "Available" : variant.availabilityStatus ?? "Unavailable"}</td>
                        <td className="py-2 pr-4">{variant.productionCostRawPrice ?? money(variant.productionCostMinCents)}</td>
                        <td className="py-2">{variant.productionCostSource === "admin-reviewed-printful-ui" && variant.productionCostFresh ? "Admin-reviewed · fresh" : variant.productionCostSource ? "Expired or configuration changed" : "Unverified"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {product.importedArmoryItemId && (
                <form action={updatePrintfulPreviewCurationAction} className="grid gap-3 rounded-xl bg-surface-raised p-4 md:grid-cols-2">
                  <input type="hidden" name="item_id" value={product.importedArmoryItemId} />
                  <label className="grid gap-1 text-sm">Title<input name="title" required maxLength={120} defaultValue={product.importedTitle ?? product.name ?? ""} className="rounded-lg border border-border bg-background px-3 py-2" /></label>
                  <PrintfulImageField initialPath={product.importedImagePath ?? null} managedItemId={product.importedArmoryItemId} />
                  <label className="grid gap-1 text-sm md:col-span-2">Approved description<textarea name="description" required maxLength={4000} defaultValue={product.importedDescription ?? ""} className="rounded-lg border border-border bg-background px-3 py-2" /></label>
                  <label className="grid gap-1 text-sm">Customer price (USD)<input name="price" required inputMode="decimal" defaultValue={product.importedPriceCents === null || product.importedPriceCents === undefined ? "" : (product.importedPriceCents / 100).toFixed(2)} className="rounded-lg border border-border bg-background px-3 py-2" /></label>
                  <label className="grid gap-1 text-sm">Customer shipping (USD)<input name="shipping" required inputMode="decimal" defaultValue={product.importedShippingCents === null || product.importedShippingCents === undefined ? "0.00" : (product.importedShippingCents / 100).toFixed(2)} className="rounded-lg border border-border bg-background px-3 py-2" /></label>
                  <label className="grid gap-1 text-sm">Membership access<select name="required_membership_tier" required defaultValue={product.importedRequiredMembershipTier ?? "everyone"} className="rounded-lg border border-border bg-background px-3 py-2"><option value="everyone">Everyone</option><option value="premium">Premium members</option></select></label>
                  <label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" name="visible_to_all" defaultChecked={product.importedVisibleToAll === true} />After publication, show this preview to everyone. If unchecked, existing linked-member access rules still apply.</label>
                  <button className="justify-self-start rounded-lg border border-border px-4 py-2 font-semibold">Save curation</button>
                </form>
              )}
              {product.importedArmoryItemId && !product.importedPublished && (
                <form action={publishPrintfulPreviewAction} className="space-y-3 rounded-xl border border-accent/40 bg-surface p-4">
                  <input type="hidden" name="item_id" value={product.importedArmoryItemId} />
                  <label className="flex gap-2 text-sm"><input type="checkbox" name="attest_publish" required />I approve the saved copy, image, customer price and shipping for publication in the Armory.</label>
                  <button className="rounded-lg bg-accent px-4 py-2 font-semibold text-accent-foreground">Publish curated Gear preview</button>
                </form>
              )}
              {product.importedArmoryItemId && product.importedPublished && product.localProductId && (
                <form action={setPrintfulApparelApprovalAction} className="space-y-3 rounded-xl border border-accent/40 bg-surface p-4">
                  <input type="hidden" name="product_id" value={product.localProductId} />
                  <p className="text-sm text-muted">Guest sale approval is separate from publication. Only explicitly reviewed Apparel is eligible; mats, bags, bottles and unclassified gear stay blocked.</p>
                  <label className="flex gap-2 text-sm">
                    <input type="checkbox" name="enable_apparel" defaultChecked={apparelApprovalByProduct.get(product.localProductId) === true} />
                    Approve this published product as Apparel for guest checkout
                  </label>
                  <label className="flex gap-2 text-sm">
                    <input type="checkbox" name="attest_apparel" />
                    I verified this is Apparel and its exact size/color variants and current scalar Printful costs are reviewed
                  </label>
                  <button className="rounded-lg border border-border px-4 py-2 font-semibold">Save Apparel approval</button>
                </form>
              )}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
