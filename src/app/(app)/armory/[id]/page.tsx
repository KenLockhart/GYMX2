import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, FormStatus, SubmitButton } from "@/components/form-parts";
import { requireAccount } from "@/lib/auth";
import {
  PLATFORM_FEE_PERCENT,
  categoryLabel,
  orderStatusLabel,
  formatMoney,
  formatPrice,
  isDisplayOnly,
  publicImageUrl,
} from "@/lib/armory";
import { confirmCheckoutSession } from "@/lib/purchases";
import { BuyPanel } from "@/components/buy-panel";
import { isStripeTestMode, stripePublishableKey } from "@/lib/stripe";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { ArmoryItem } from "@/lib/types";
import { idSchema } from "@/lib/validation";
import { removeArmoryItem } from "../actions";
import { T } from "@/i18n/t";
import { getTr } from "@/i18n/server";
import { LOCALE_TAG } from "@/i18n/config";
import { getLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTr())("The Armory") };
}

export default async function ArmoryItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const locale = await getLocale();
  const tr = await getTr();
  const { profile } = await requireAccount();
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const query = await searchParams;

  // Back from Stripe: record the payment now, so the download works without waiting for the webhook.
  const returnedSession =
    query.purchase === "done" && typeof query.session_id === "string"
      ? query.session_id
      : null;
  if (returnedSession)
    await confirmCheckoutSession(returnedSession, profile.id);

  const supabase = await createClient();
  const { data } = await supabase
    .from("armory_items")
    .select("*, coach:profiles!coach_id(id, display_name, role)")
    .eq("id", id)
    .maybeSingle();
  const item = data as
    | (ArmoryItem & {
        coach: { id: string; display_name: string; role: string } | null;
      })
    | null;
  if (!item) notFound();

  const isOwner = item.coach_id === profile.id;
  const isSold = item.kind === "paid" || item.kind === "product";
  const [{ data: owned }, { count: salesCount }] = await Promise.all([
    isSold && !isOwner
      ? supabase
          .from("purchases")
          .select(
            "id, size, fulfillment_status, tracking_number, created_at, refunded_at",
          )
          .eq("item_id", item.id)
          .eq("member_id", profile.id)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    isSold && isOwner
      ? supabase
          .from("purchases")
          .select("id", { count: "exact", head: true })
          .eq("item_id", item.id)
      : Promise.resolve({ count: null }),
  ]);
  const myOrders = (owned ?? []) as {
    id: string;
    size: string | null;
    fulfillment_status: string;
    tracking_number: string | null;
    created_at: string;
    refunded_at: string | null;
  }[];
  // A refunded purchase no longer counts: the download stops and the buyer can buy again.
  const hasBought = myOrders.some((order) => !order.refunded_at);
  const canRemove = isOwner || profile.role === "admin";
  const image = publicImageUrl(getSupabaseEnv().url, item.image_path);
  const price = formatPrice(item.price_cents);

  return (
    <div className="space-y-6">
      <Link href="/armory" className="text-link text-sm">
        <T>Back to the Armory</T>
      </Link>

      <div className="grid gap-8 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-raised">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image}
              alt={item.title}
              className="size-full object-cover"
            />
          ) : (
            <span className="font-display text-3xl font-bold uppercase text-muted">
              <T>{categoryLabel(item.category)}</T>
            </span>
          )}
        </div>

        <div className="space-y-5">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-accent">
              <T>{categoryLabel(item.category)}</T>
            </p>
            <h1 className="mt-1 text-4xl">{item.title}</h1>
            {item.coach && !isOwner && (
              <p className="mt-2 text-muted">
                <T>From</T>{" "}
                {item.coach.role === "coach" ? (
                  <Link
                    href={`/coaches/${item.coach.id}`}
                    className="text-link"
                  >
                    {item.coach.display_name}
                  </Link>
                ) : (
                  "GYMX2"
                )}
              </p>
            )}
          </div>

          {item.kind === "link" ? (
            <div className="space-y-2">
              {price && <p className="text-2xl font-semibold">{price}</p>}
              <a
                href={item.buy_url ?? "#"}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="btn-primary"
              >
                <T>Buy now</T>
              </a>
              <p className="text-xs text-muted">
                <T>
                  Opens the seller&apos;s shop in a new tab. Payment happens
                  there, not on GYMX2.
                </T>
              </p>
            </div>
          ) : item.kind === "product" || item.kind === "preview" ? (
            <div className="space-y-3">
              {returnedSession && hasBought && (
                <p
                  role="status"
                  className="rounded-lg border border-accent bg-surface p-3 text-sm"
                >
                  <T>
                    Thanks for your order! The seller will ship it to the
                    address you gave at checkout.
                  </T>
                </p>
              )}
              {returnedSession && !hasBought && (
                <p
                  role="status"
                  className="rounded-lg border border-border bg-surface p-3 text-sm"
                >
                  <T>
                    We&apos;re confirming your payment. Refresh this page in a
                    moment.
                  </T>
                </p>
              )}
              <p className="text-2xl font-semibold">
                {price}
                <span className="ml-2 text-base font-normal text-muted">
                  {item.shipping_cents > 0
                    ? `+ ${formatMoney(item.shipping_cents)} shipping`
                    : "Free shipping"}
                </span>
              </p>
              {isDisplayOnly(item) ? (
                <div className="space-y-2">
                  <p role="status" className="rounded-lg border border-accent bg-surface p-3 text-sm">
                    <T>Coming soon · Not for sale</T>
                  </p>
                  {item.sizes.length > 0 && (
                    <p className="text-sm text-muted">
                      <T>Sizes</T>: {item.sizes.join(", ")}
                    </p>
                  )}
                </div>
              ) : isOwner || profile.role === "admin" ? (
                <p className="text-sm text-muted">
                  {item.sizes.length > 0
                    ? tr("Sizes: {p0} · ", { p0: item.sizes.join(", ") })
                    : ""}
                  {isOwner && (
                    <>
                      {salesCount ?? 0} {salesCount === 1 ? "order" : "orders"}{" "}
                      ·{" "}
                    </>
                  )}
                  <Link href="/armory/sales" className="text-link">
                    {isOwner ? tr("See orders to ship") : tr("See all orders")}
                  </Link>
                </p>
              ) : (
                <>
                  <BuyPanel
                    itemId={item.id}
                    sizes={item.sizes}
                    buttonLabel={
                      hasBought ? tr("Order another") : tr("Buy now")
                    }
                    publishableKey={stripePublishableKey()}
                  />
                  <p className="text-xs text-muted">
                    <T>
                      Secure card payment by Stripe, right here on GYMX2.
                      You&apos;ll enter your US shipping address at checkout.
                    </T>
                    {isStripeTestMode() &&
                      " Test mode: use card 4242 4242 4242 4242, any future date and any CVC."}
                  </p>
                </>
              )}
              {myOrders.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">
                    <T>Your orders</T>
                  </p>
                  <ul className="divide-y divide-border rounded-lg border border-border bg-surface text-sm">
                    {myOrders.map((order) => (
                      <li
                        key={order.id}
                        className="flex flex-wrap justify-between gap-2 p-3"
                      >
                        <span>
                          {new Date(order.created_at).toLocaleDateString(
                            LOCALE_TAG[locale],
                            {
                              month: "short",
                              day: "numeric",
                              timeZone: "UTC",
                            },
                          )}
                          {order.size && ` · Size ${order.size}`}
                        </span>
                        <span
                          className={
                            order.fulfillment_status === "shipped"
                              ? "text-success"
                              : "text-muted"
                          }
                        >
                          <T>{orderStatusLabel(order)}</T>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : item.kind === "paid" ? (
            <div className="space-y-2">
              {returnedSession && hasBought && (
                <p
                  role="status"
                  className="rounded-lg border border-accent bg-surface p-3 text-sm"
                >
                  <T>Thanks for your purchase! Your download is ready.</T>
                </p>
              )}
              {returnedSession && !hasBought && (
                <p
                  role="status"
                  className="rounded-lg border border-border bg-surface p-3 text-sm"
                >
                  <T>
                    We&apos;re confirming your payment. Refresh this page in a
                    moment.
                  </T>
                </p>
              )}
              {hasBought || isOwner || profile.role === "admin" ? (
                <>
                  <p className="text-2xl font-semibold">
                    {hasBought ? tr("You own this") : price}
                  </p>
                  <a
                    href={`/armory/${item.id}/download`}
                    className="btn-primary"
                  >
                    <T>Download</T>
                  </a>
                  {item.file_name && (
                    <p className="text-xs text-muted">{item.file_name}</p>
                  )}
                  {isOwner && (
                    <p className="text-sm text-muted">
                      {salesCount ?? 0} {salesCount === 1 ? "sale" : "sales"} ·{" "}
                      <Link href="/armory/sales" className="text-link">
                        <T>See your sales</T>
                      </Link>
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="text-2xl font-semibold">{price}</p>
                  <BuyPanel
                    itemId={item.id}
                    sizes={[]}
                    buttonLabel={tr("Buy for {price}", { price: price ?? "" })}
                    publishableKey={stripePublishableKey()}
                  />
                  <p className="text-xs text-muted">
                    <T>
                      Secure card payment by Stripe, right here on GYMX2. The
                      download unlocks as soon as you pay.
                    </T>
                    {isStripeTestMode() &&
                      " Test mode: use card 4242 4242 4242 4242, any future date and any CVC."}
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-2xl font-semibold">
                <T>Free</T>
              </p>
              <a href={`/armory/${item.id}/download`} className="btn-primary">
                <T>Download</T>
              </a>
              {item.file_name && (
                <p className="text-xs text-muted">{item.file_name}</p>
              )}
            </div>
          )}

          {item.description && (
            <p className="max-w-2xl whitespace-pre-line">
              <T>{item.description}</T>
            </p>
          )}

          {canRemove && (
            <div className="flex flex-wrap items-start gap-2 border-t border-border pt-5">
              {isOwner && (
                <Link
                  href={`/armory/${item.id}/edit`}
                  className="btn-secondary px-3 py-2 text-sm"
                >
                  <T>Edit</T>
                </Link>
              )}
              <ActionForm
                action={removeArmoryItem}
                confirmMessage={
                  item.kind === "paid"
                    ? tr(
                        'Remove "{title}"? Its files will be deleted, so past buyers won\'t be able to download it again.',
                        { title: item.title },
                      )
                    : tr(
                        'Remove "{title}" from the Armory? Its files will be deleted too.',
                        { title: item.title },
                      )
                }
                className="space-y-2"
              >
                <input type="hidden" name="item_id" value={item.id} />
                <SubmitButton
                  pendingText={tr("Removing...")}
                  className="btn-secondary px-3 py-2 text-sm"
                >
                  <T>Remove</T>
                </SubmitButton>
                <FormStatus />
              </ActionForm>
              {isOwner && isSold && item.coach?.role === "coach" && (
                <p className="w-full text-xs text-muted">
                  You get each sale minus GYMX2&apos;s {PLATFORM_FEE_PERCENT}%
                  fee and Stripe&apos;s card fees.
                </p>
              )}
              {isOwner && (
                <p className="w-full text-xs text-muted">
                  {item.visible_to_all
                    ? tr("Everyone on GYMX2 can see this.")
                    : tr("Only members who joined you can see this.")}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
