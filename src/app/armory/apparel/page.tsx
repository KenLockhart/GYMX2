import type { Metadata } from "next";
import { randomBytes, randomUUID } from "node:crypto";
import { ApparelOrderForm, type PublicApparelVariant } from "./apparel-order-form";
import { parsePublicApparelVariants } from "@/lib/printful/apparel-options";
import { publicImageUrl } from "@/lib/armory";
import { ArmoryPublicHeader } from "@/components/armory-public-header";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "GYMX2 Apparel" };

type PublicApparelProduct = Readonly<{
  product_id: string;
  title: string;
  description: string;
  image_path: string | null;
  price_cents: number;
  shipping_cents: 0;
  variants: readonly PublicApparelVariant[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseProduct(value: unknown): PublicApparelProduct | null {
  if (!isRecord(value) || typeof value.product_id !== "string" || typeof value.title !== "string" ||
    typeof value.description !== "string" || !(value.image_path === null || typeof value.image_path === "string") ||
    !Number.isSafeInteger(value.price_cents) || value.shipping_cents !== 0 || !Array.isArray(value.variants)) return null;
  const variants = parsePublicApparelVariants(value.variants);
  if (!variants?.length) return null;
  return {
    product_id: value.product_id,
    title: value.title,
    description: value.description,
    image_path: value.image_path,
    price_cents: Number(value.price_cents),
    shipping_cents: 0,
    variants,
  };
}

export default async function PrintfulApparelPage({
  searchParams,
}: {
  searchParams: Promise<{ cancelled?: string }>;
}) {
  const [supabase, params] = await Promise.all([createClient(), searchParams]);
  const { data, error } = await supabase.rpc("list_printful_apparel_catalog");
  const products = !error && Array.isArray(data)
    ? data.map(parseProduct).filter((product): product is PublicApparelProduct => product !== null)
    : [];

  return (
    <>
      <ArmoryPublicHeader signedIn={false} />
      <main className="mx-auto max-w-6xl px-4 py-10">
      <header className="max-w-3xl">
        <p className="text-sm font-semibold uppercase tracking-wide text-accent">GYMX2 · made to order</p>
        <h1 className="mt-2 text-5xl">Apparel</h1>
        <p className="mt-3 max-w-2xl text-muted">Choose your size and color. U.S. shipping is free. Made to order; allow 3–4 weeks for delivery.</p>
      </header>
      {params.cancelled === "1" ? <p className="mt-5 rounded-lg border border-border bg-surface p-3 text-muted">You left checkout. We’ll confirm any completed payment by email.</p> : null}
      {products.length === 0 ? (
        <p className="mt-8 rounded-lg border border-border bg-surface p-5 text-muted">Apparel checkout is unavailable right now.</p>
      ) : (
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          {products.map((product) => {
            const token = randomBytes(32).toString("base64url");
            return (
              <article key={product.product_id} className="rounded-2xl border border-border bg-surface p-5">
                {product.image_path ? <img src={publicImageUrl(getSupabaseEnv().url, product.image_path) ?? ""} alt="" className="aspect-square w-full rounded-xl object-cover" /> : null}
                <h2 className="mt-4 text-2xl">{product.title}</h2>
                {product.description ? <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{product.description}</p> : null}
                <ApparelOrderForm
                  productId={product.product_id}
                  priceCents={product.price_cents}
                  variants={product.variants}
                  orderId={randomUUID()}
                  statusToken={token}
                />
              </article>
            );
          })}
        </div>
      )}
    </main>
    </>
  );
}
