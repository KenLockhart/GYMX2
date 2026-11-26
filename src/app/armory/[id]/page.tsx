import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, FormStatus, SubmitButton } from "@/components/form-parts";
import { ArmoryPublicHeader } from "@/components/armory-public-header";
import { BuyPanel } from "@/components/buy-panel";
import { GuestBuyPanel } from "@/components/guest-buy-panel";
import { T } from "@/i18n/t";
import { LOCALE_TAG } from "@/i18n/config";
import { getLocale, getTr } from "@/i18n/server";
import { getCurrentAccount } from "@/lib/auth";
import {
  categoryLabel,
  canAccessArmoryAudience,
  deliveryEstimate,
  formatMoney,
  formatPrice,
  isDisplayOnly,
  orderStatusLabel,
  publicImageUrl,
} from "@/lib/armory";
import { confirmCheckoutSession } from "@/lib/purchases";
import { isPublicArmorySale } from "@/lib/armory-commerce-core";
import { getPlatformEntitlement } from "@/lib/platform-membership-server";
import { stripePublishableKey, isStripeTestMode } from "@/lib/stripe";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { ArmoryItem, PublicArmoryItem } from "@/lib/types";
import { idSchema } from "@/lib/validation";
import { removeArmoryItem } from "@/app/(app)/armory/actions";

type PrivateDetail = Pick<
  ArmoryItem,
  | "id" | "coach_id" | "kind" | "category" | "title" | "description"
  | "required_membership_tier" | "price_cents" | "buy_url" | "file_name" | "image_path" | "visible_to_all"
  | "sizes" | "shipping_cents" | "made_to_order" | "delivery_min_weeks"
  | "delivery_max_weeks" | "created_at"
> & { coach: { id: string; display_name: string; role: string } | null };

type DetailItem = PrivateDetail | (PublicArmoryItem & { file_name: null; visible_to_all: true; coach: null });

const PRIVATE_DETAIL_FIELDS =
  "id, coach_id, kind, category, title, description, required_membership_tier, price_cents, buy_url, file_name, image_path, visible_to_all, sizes, shipping_cents, made_to_order, delivery_min_weeks, delivery_max_weeks, created_at, coach:profiles!coach_id(id, display_name, role)";
const PUBLIC_DETAIL_FIELDS =
  "id, coach_id, seller_label, kind, category, required_membership_tier, title, description, price_cents, buy_url, sizes, shipping_cents, image_path, made_to_order, delivery_min_weeks, delivery_max_weeks, created_at";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return { title: (await getTr())("The Armory") };
  const db = await createClient();
  const { data } = await db.from("public_armory_catalog").select("title").eq("id", id).maybeSingle();
  return { title: typeof data?.title === "string" ? data.title : (await getTr())("The Armory") };
}

export default async function ArmoryItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [account, locale, tr] = await Promise.all([
    getCurrentAccount(),
    getLocale(),
    getTr(),
  ]);
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();

  const query = await searchParams;
  const returnedSession = account && query.purchase === "done" && typeof query.session_id === "string"
    ? query.session_id
    : null;
  if (account && returnedSession) {
    await confirmCheckoutSession(returnedSession, account.profile.id);
  }

  const supabase = await createClient();
  let item: DetailItem | null = null;
  if (account) {
    const { data } = await supabase
      .from("armory_items")
      .select(PRIVATE_DETAIL_FIELDS)
      .eq("id", id)
      .maybeSingle<PrivateDetail>();
    item = data;
  }
  if (!item) {
    const { data } = await supabase
      .from("public_armory_catalog")
      .select(PUBLIC_DETAIL_FIELDS)
      .eq("id", id)
      .maybeSingle<PublicArmoryItem>();
    if (data) item = { ...data, file_name: null, visible_to_all: true, coach: null };
  }
  if (!item) notFound();

  const owner = Boolean(account && item.coach_id === account.profile.id);
  const admin = account?.profile.role === "admin";
  // Private listings can appear only from the authenticated armory_items query above, whose
  // existing RLS rules limit them to the owner, an admin, or a linked member.
  const isSold = item.kind === "paid" || item.kind === "product";
  const [entitlement, [{ data: orders }, { count: salesCount }]] = await Promise.all([
    account ? getPlatformEntitlement(account.profile.id) : Promise.resolve(null),
    Promise.all([
      account && isSold && !owner
        ? supabase
            .from("purchases")
            .select("id, size, fulfillment_status, tracking_number, created_at, refunded_at")
            .eq("item_id", item.id)
            .eq("member_id", account.profile.id)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] }),
      account && isSold && owner
        ? supabase.from("purchases").select("id", { count: "exact", head: true }).eq("item_id", item.id)
        : Promise.resolve({ count: null }),
    ]),
  ]);
  const hasPremium = Boolean(entitlement?.ok && entitlement.entitlement?.tier === "premium");
  const myOrders = (orders ?? []) as {
    id: string;
    size: string | null;
    fulfillment_status: string;
    tracking_number: string | null;
    created_at: string;
    refunded_at: string | null;
  }[];
  const hasBought = myOrders.some((order) => !order.refunded_at);
  const requiredMembershipTier = "required_membership_tier" in item
    ? item.required_membership_tier
    : "everyone";
  const publicProjection = "seller_label" in item;
  const publicSale = isPublicArmorySale(item);
  const hasPurchasedPaidAccess = item.kind === "paid" && hasBought;
  const canReadItemAudience = owner || admin || hasPurchasedPaidAccess ||
    canAccessArmoryAudience(
      requiredMembershipTier,
      hasPremium ? "premium" : account ? "regular" : null,
    );
  if (!canReadItemAudience) notFound();

  const image = publicImageUrl(getSupabaseEnv().url, item.image_path);
  const price = formatPrice(item.price_cents);
  const delivery = deliveryEstimate(item);
  const sellerLabel = "seller_label" in item
    ? item.seller_label
    : item.coach?.role === "admin"
      ? "GYMX2"
      : item.coach?.display_name ?? "Coach";

  return (
    <>
      <ArmoryPublicHeader signedIn={Boolean(account)} />
      <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-8 sm:px-6">
        <Link href="/armory" className="text-link text-sm"><T>Back to the Armory</T></Link>
        <div className="grid gap-8 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-raised">
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image} alt={item.title} className="size-full object-cover" />
            ) : (
              <span className="font-display text-3xl font-bold uppercase text-muted"><T>{categoryLabel(item.category)}</T></span>
            )}
          </div>

          <div className="space-y-5">
            <div>
              <p className="text-sm font-semibold uppercase tracking-widest text-accent"><T>{categoryLabel(item.category)}</T></p>
              <h1 className="mt-1 text-4xl">{item.title}</h1>
              {requiredMembershipTier === "premium" && <p className="mt-1 text-sm font-semibold text-accent"><T>Premium</T></p>}
              {!owner && <p className="mt-2 text-muted"><T>From</T> {sellerLabel}</p>}
            </div>

            {item.kind === "link" ? (
              <div className="space-y-2">
                {price && <p className="text-2xl font-semibold">{price}</p>}
                <a href={item.buy_url ?? "#"} target="_blank" rel="noopener noreferrer nofollow" className="btn-primary"><T>Buy now</T></a>
                <p className="text-xs text-muted"><T>Opens the seller&apos;s shop in a new tab. Payment happens there, not on GYMX2.</T></p>
              </div>
            ) : item.kind === "product" || item.kind === "preview" ? (
              <div className="space-y-3">
                {returnedSession && hasBought && <p role="status" className="rounded-lg border border-accent bg-surface p-3 text-sm"><T>Thanks for your order! The seller will ship it to the address you gave at checkout.</T></p>}
                {returnedSession && !hasBought && <p role="status" className="rounded-lg border border-border bg-surface p-3 text-sm"><T>We&apos;re confirming your payment. Refresh this page in a moment.</T></p>}
                <p className="text-2xl font-semibold">
                  {price}
                  <span className="ml-2 text-base font-normal text-muted">
                    {item.shipping_cents > 0 ? `+ ${formatMoney(item.shipping_cents)} shipping` : tr("Free shipping")}
                  </span>
                </p>
                {delivery && <p className="rounded-lg border border-accent bg-surface p-3 text-sm">{tr("Made to order. Estimated delivery: {min}–{max} weeks.", { min: delivery.minWeeks, max: delivery.maxWeeks })}</p>}
                {isDisplayOnly(item) ? (
                  <div className="space-y-2">
                    <p role="status" className="rounded-lg border border-accent bg-surface p-3 text-sm"><T>Coming soon · Not for sale</T></p>
                    {item.sizes.length > 0 && <p className="text-sm text-muted"><T>Sizes</T>: {item.sizes.join(", ")}</p>}
                  </div>
                ) : publicProjection && !publicSale ? (
                  <p role="status" className="rounded-lg border border-border bg-surface p-3 text-sm">
                    <T>This item is not available for guest checkout.</T>{" "}
                    {!account && <Link href="/login" className="text-link"><T>Sign in to continue</T></Link>}
                  </p>
                ) : owner || admin ? (
                  <p className="text-sm text-muted">
                    {item.sizes.length > 0 ? tr("Sizes: {p0} · ", { p0: item.sizes.join(", ") }) : ""}
                    {owner && <>{salesCount ?? 0} {salesCount === 1 ? tr("order") : tr("orders")} · </>}
                    <Link href="/armory/sales" className="text-link">{owner ? tr("See orders to ship") : tr("See all orders")}</Link>
                  </p>
                ) : account ? (
                  <>
                    <BuyPanel itemId={item.id} sizes={item.sizes} buttonLabel={hasBought ? tr("Order another") : tr("Buy now")} publishableKey={stripePublishableKey()} />
                    <p className="text-xs text-muted"><T>Secure card payment by Stripe, right here on GYMX2. You&apos;ll enter your US shipping address at checkout.</T>{isStripeTestMode() && " Test mode: use card 4242 4242 4242 4242, any future date and any CVC."}</p>
                  </>
                ) : (
                  <>
                    <GuestBuyPanel itemId={item.id} sizes={item.sizes} price={price ?? ""} />
                    <p className="text-xs text-muted"><T>You&apos;ll enter your US shipping address at checkout.</T></p>
                  </>
                )}
                {myOrders.length > 0 && <OrderHistory orders={myOrders} locale={locale} />}
              </div>
            ) : item.kind === "paid" ? (
              <div className="space-y-2">
                {returnedSession && hasBought && <p role="status" className="rounded-lg border border-accent bg-surface p-3 text-sm"><T>Thanks for your purchase! Your download is ready.</T></p>}
                {returnedSession && !hasBought && <p role="status" className="rounded-lg border border-border bg-surface p-3 text-sm"><T>We&apos;re confirming your payment. Refresh this page in a moment.</T></p>}
                {hasBought || owner || admin ? (
                  <>
                    <p className="text-2xl font-semibold">{hasBought ? tr("You own this") : price}</p>
                    {account && <a href={`/armory/${item.id}/download`} className="btn-primary"><T>Download</T></a>}
                    {item.file_name && <p className="text-xs text-muted">{item.file_name}</p>}
                    {owner && <p className="text-sm text-muted">{salesCount ?? 0} {salesCount === 1 ? tr("sale") : tr("sales")} · <Link href="/armory/sales" className="text-link"><T>See your sales</T></Link></p>}
                  </>
                ) : publicProjection && !publicSale ? (
                  <p role="status" className="rounded-lg border border-border bg-surface p-3 text-sm">
                    <T>This item is not available for guest checkout.</T>{" "}
                    {!account && <Link href="/login" className="text-link"><T>Sign in to continue</T></Link>}
                  </p>
                ) : account ? (
                  <>
                    <p className="text-2xl font-semibold">{price}</p>
                    <BuyPanel itemId={item.id} sizes={[]} buttonLabel={tr("Buy for {price}", { price: price ?? "" })} publishableKey={stripePublishableKey()} />
                    <p className="text-xs text-muted"><T>Secure card payment by Stripe, right here on GYMX2. The download unlocks as soon as you pay.</T>{isStripeTestMode() && " Test mode: use card 4242 4242 4242 4242, any future date and any CVC."}</p>
                  </>
                ) : (
                  <>
                    <p className="text-2xl font-semibold">{price}</p>
                    <GuestBuyPanel itemId={item.id} sizes={[]} price={price ?? ""} />
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-2xl font-semibold"><T>Free</T></p>
                {account && <a href={`/armory/${item.id}/download`} className="btn-primary"><T>Download</T></a>}
                {item.file_name && <p className="text-xs text-muted">{item.file_name}</p>}
              </div>
            )}

            {item.description && <p className="max-w-2xl whitespace-pre-line">{item.description}</p>}
            {account && (owner || admin) && (
              <div className="flex flex-wrap items-start gap-2 border-t border-border pt-5">
                {owner && <Link href={`/armory/${item.id}/edit`} className="btn-secondary px-3 py-2 text-sm"><T>Edit</T></Link>}
                <ActionForm action={removeArmoryItem} confirmMessage={tr("Remove {title} from the Armory?", { title: item.title })} className="space-y-2">
                  <input type="hidden" name="item_id" value={item.id} />
                  <SubmitButton pendingText={tr("Removing...")} className="btn-secondary px-3 py-2 text-sm"><T>Remove</T></SubmitButton>
                  <FormStatus />
                </ActionForm>
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}

function OrderHistory({
  orders,
  locale,
}: {
  orders: { id: string; size: string | null; fulfillment_status: string; tracking_number: string | null; created_at: string; refunded_at: string | null }[];
  locale: "en" | "es";
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold"><T>Your orders</T></p>
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface text-sm">
        {orders.map((order) => (
          <li key={order.id} className="flex flex-wrap justify-between gap-2 p-3">
            <span>
              {new Date(order.created_at).toLocaleDateString(LOCALE_TAG[locale], { month: "short", day: "numeric", timeZone: "UTC" })}
              {order.size && ` · ${order.size}`}
            </span>
            <span className={order.fulfillment_status === "shipped" ? "text-success" : "text-muted"}><T>{orderStatusLabel(order)}</T></span>
          </li>
        ))}
      </ul>
    </div>
  );
}
