import { NextResponse, type NextRequest } from "next/server";
import { getCurrentAccount } from "@/lib/auth";
import { getPlatformEntitlement } from "@/lib/platform-membership-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validation";

type PaidCheckoutIntent = {
  id: string;
  item_id: string;
  member_id: string | null;
  buyer_was_guest: boolean;
  stripe_session_id: string | null;
  status: string;
  item_kind: string;
  file_path: string | null;
  file_name: string | null;
};

// Files are private. Row security answers "may this person see the item?", paid items also need
// a purchase, and only then is a link made that works for one minute under the original file name.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const account = await getCurrentAccount();
  if (!account) return NextResponse.redirect(new URL("/login", request.url));

  const { id } = await params;
  if (!idSchema.safeParse(id).success) return new NextResponse("Not found", { status: 404 });

  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: snapshotRows } = await admin
    .from("purchases")
    .select(
      "id, item_id, checkout_intent_id, stripe_session_id, intent:armory_checkout_intents!purchases_checkout_intent_id_fkey!inner(id, item_id, member_id, buyer_was_guest, stripe_session_id, status, item_kind, file_path, file_name)",
    )
    .eq("member_id", account.profile.id)
    .is("refunded_at", null)
    .eq("intent.item_id", id)
    .eq("intent.member_id", account.profile.id)
    .eq("intent.buyer_was_guest", false)
    .eq("intent.status", "paid")
    .eq("intent.item_kind", "paid")
    .order("created_at", { ascending: false })
    .limit(1);
  const snapshotCandidate = (snapshotRows ?? [])[0] as
    | {
        id: string;
        item_id: string | null;
        checkout_intent_id: string;
        stripe_session_id: string;
        intent: PaidCheckoutIntent | PaidCheckoutIntent[] | null;
        item?: { kind?: string } | null;
      }
    | undefined;
  const snapshotIntent = Array.isArray(snapshotCandidate?.intent)
    ? snapshotCandidate.intent[0] ?? null
    : snapshotCandidate?.intent ?? null;
  const snapshotMatches = Boolean(
    snapshotCandidate &&
      snapshotIntent &&
      snapshotCandidate.checkout_intent_id === snapshotIntent.id &&
      (snapshotCandidate.item_id === null || snapshotCandidate.item_id === id) &&
      snapshotIntent.item_id === id &&
      snapshotIntent.member_id === account.profile.id &&
      !snapshotIntent.buyer_was_guest &&
      snapshotIntent.stripe_session_id === snapshotCandidate.stripe_session_id &&
      snapshotIntent.status === "paid" &&
      snapshotIntent.item_kind === "paid",
  );
  const paidPurchase = snapshotMatches ? snapshotCandidate : undefined;
  const purchaseIntent = snapshotMatches ? snapshotIntent : null;

  // Old purchases have no immutable intent snapshot, so retain their original live-row lookup.
  const { data: legacyRows } = await supabase
    .from("purchases")
    .select("id, item_id, checkout_intent_id, stripe_session_id, item:armory_items(kind)")
    .eq("item_id", id)
    .eq("member_id", account.profile.id)
    .is("refunded_at", null)
    .is("checkout_intent_id", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const legacyPurchase = (legacyRows ?? [])[0] as
    | {
        id: string;
        item_id: string;
        checkout_intent_id: null;
        stripe_session_id: string;
        item: { kind?: string } | null;
      }
    | undefined;
  const ownedPurchase = paidPurchase ?? legacyPurchase;

  if (account.profile.role === "member") {
    const access = await getPlatformEntitlement(account.profile.id);
    if (!access.ok || !access.entitlement) {
      // A paid, unrefunded download stays available after platform cancellation. The item RLS
      // policy allows the purchased row through solely for this history path.
      const ownsPaidDownload = purchaseIntent?.item_kind === "paid" ||
        (!ownedPurchase?.checkout_intent_id && ownedPurchase?.item?.kind === "paid");
      if (!ownsPaidDownload) {
        const reason = access.ok ? "required" : "check";
        return NextResponse.redirect(
          new URL(`/membership?issue=${reason}`, request.url),
          { status: 303 },
        );
      }
    }
  }

  const { data: item } = await supabase
    .from("armory_items")
    .select("coach_id, kind, file_path, file_name")
    .eq("id", id)
    .maybeSingle();
  const itemKind = purchaseIntent?.item_kind ?? item?.kind;
  const filePath = purchaseIntent?.item_kind === "paid"
    ? purchaseIntent.file_path
    : item?.file_path;
  const fileName = purchaseIntent?.item_kind === "paid"
    ? purchaseIntent.file_name
    : item?.file_name;
  // Use the immutable paid intent path after an item edit/removal; legacy orders retain the
  // historical current-item path fallback.
  if (!itemKind || (itemKind !== "download" && itemKind !== "paid") || !filePath) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Paid files only open for the seller, admins, and people who bought them.
  if (itemKind === "paid" && item?.coach_id !== account.profile.id && account.profile.role !== "admin") {
    const hasOwnedSnapshot = purchaseIntent?.item_kind === "paid";
    const hasLegacyPurchase = !ownedPurchase?.checkout_intent_id && ownedPurchase?.item?.kind === "paid";
    if (!hasOwnedSnapshot && !hasLegacyPurchase) {
      return NextResponse.redirect(new URL(`/armory/${id}`, request.url), { status: 303 });
    }
  }

  const { data, error } = await admin
    .storage.from("armory-files")
    .createSignedUrl(filePath, 60, { download: fileName ?? true });
  if (error || !data) return new NextResponse("This file can't be downloaded right now.", { status: 503 });

  return NextResponse.redirect(data.signedUrl, { status: 303 });
}
