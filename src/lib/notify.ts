import "server-only";
import { addressLines, type ShippingAddress } from "@/lib/armory";
import { formatEmailSessionTime } from "@/lib/calendar";
import { loadRecipient, sendEmail } from "@/lib/email";
import { describeFlags, detectFlags } from "@/lib/message-flags";
import {
  flaggedMessageEmail,
  liveNowEmail,
  newMessageEmail,
  newSaleEmail,
  orderShippedEmail,
  sessionEmail,
  type SessionChange,
} from "@/lib/email-templates";
import { sendPush } from "@/lib/push";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteUrl } from "@/lib/supabase/env";

// Each function here runs after the response is sent (see next/server `after`), looks up what it
// needs with the server key, and swallows its own errors so a missed email never breaks anything.

async function safely(label: string, work: () => Promise<void>) {
  try {
    await work();
  } catch (error) {
    console.error(`Notification "${label}" failed`, error);
  }
}

type PurchaseRow = {
  id: string;
  // Empty once the buyer has deleted their account; the order is kept for records.
  member_id: string | null;
  seller_id: string | null;
  item_title: string;
  amount_cents: number;
  fee_cents: number;
  size: string | null;
  shipping_name: string | null;
  shipping_address: ShippingAddress | null;
  fulfillment_status: string;
  tracking_number: string | null;
};

async function loadPurchase(purchaseId: string) {
  const { data } = await createAdminClient()
    .from("purchases")
    .select(
      "id, member_id, seller_id, item_title, amount_cents, fee_cents, size, shipping_name, shipping_address, fulfillment_status, tracking_number",
    )
    .eq("id", purchaseId)
    .maybeSingle<PurchaseRow>();
  return data;
}

// The seller hears about every sale. GYMX2's own items (no seller) go to the admins.
export function notifyNewSale(purchaseId: string) {
  return safely("new sale", async () => {
    const purchase = await loadPurchase(purchaseId);
    if (!purchase) return;

    let sellerIds = purchase.seller_id ? [purchase.seller_id] : [];
    if (!purchase.seller_id) {
      const { data } = await createAdminClient()
        .from("profiles")
        .select("id")
        .eq("role", "admin");
      sellerIds = (data ?? []).map((row) => row.id as string);
    }

    const buyer = purchase.member_id
      ? await loadRecipient(purchase.member_id)
      : null;
    const email = newSaleEmail({
      siteUrl: getSiteUrl(),
      itemTitle: purchase.item_title,
      buyerName: buyer?.name ?? "A member",
      amountCents: purchase.amount_cents,
      feeCents: purchase.seller_id ? purchase.fee_cents : 0,
      size: purchase.size,
      shippingName: purchase.shipping_name,
      addressLines: addressLines(purchase.shipping_address),
      needsShipping: purchase.fulfillment_status === "to_ship",
    });

    for (const sellerId of sellerIds) {
      const seller = await loadRecipient(sellerId);
      if (seller) await sendEmail(seller.email, email);
    }
  });
}

export function notifyOrderShipped(purchaseId: string) {
  return safely("order shipped", async () => {
    const purchase = await loadPurchase(purchaseId);
    if (!purchase?.member_id || purchase.fulfillment_status !== "shipped")
      return;

    const [buyer, seller] = await Promise.all([
      loadRecipient(purchase.member_id),
      purchase.seller_id
        ? loadRecipient(purchase.seller_id)
        : Promise.resolve(null),
    ]);
    if (!buyer) return;

    await sendEmail(
      buyer.email,
      orderShippedEmail({
        siteUrl: getSiteUrl(),
        itemTitle: purchase.item_title,
        sellerName: seller?.name ?? "GYMX2",
        size: purchase.size,
        tracking: purchase.tracking_number,
      }),
    );
  });
}

type MessageRow = {
  id: string;
  coach_id: string;
  member_id: string;
  sender_id: string;
  body: string;
};

export async function notifyNewMessage(messageId: string) {
  const { data: message } = await createAdminClient()
    .from("messages")
    .select("id, coach_id, member_id, sender_id, body")
    .eq("id", messageId)
    .maybeSingle<MessageRow>();
  if (!message) return;
  await Promise.all([notifyRecipient(message), pushNewMessage(message)]);
  await alertAdminsIfFlagged(message);
}

// Every message pushes to the other person's devices; one notification per conversation, replaced
// by the newest, so a quick back-and-forth doesn't stack up.
function pushNewMessage(message: MessageRow) {
  return safely("message push", async () => {
    const recipientId =
      message.sender_id === message.coach_id
        ? message.member_id
        : message.coach_id;
    const sender = await loadRecipient(message.sender_id);
    await sendPush([recipientId], {
      title: sender?.name ?? "New message",
      body: message.body,
      url: `/messages/${message.sender_id}`,
      tag: `message-${message.coach_id}-${message.member_id}`,
    });
  });
}

// Emails only the first unread message in a conversation, so a quick back-and-forth
// doesn't fill someone's inbox. Once they read the conversation, the next message emails again.
function notifyRecipient(message: MessageRow) {
  return safely("new message", async () => {
    const admin = createAdminClient();
    const { count } = await admin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("coach_id", message.coach_id)
      .eq("member_id", message.member_id)
      .eq("sender_id", message.sender_id)
      .is("read_at", null)
      .neq("id", message.id);
    if ((count ?? 0) > 0) return;

    const recipientId =
      message.sender_id === message.coach_id
        ? message.member_id
        : message.coach_id;
    const [recipient, sender] = await Promise.all([
      loadRecipient(recipientId),
      loadRecipient(message.sender_id),
    ]);
    if (!recipient?.wantsUpdates) return;

    await sendEmail(
      recipient.email,
      newMessageEmail({
        siteUrl: getSiteUrl(),
        senderName: sender?.name ?? "Someone on GYMX2",
        body: message.body,
        conversationPath: `/messages/${message.sender_id}`,
      }),
    );
  });
}

// Tells admins when a message mentions a phone number, email, payment app or talking elsewhere.
// At most one email per conversation each day, however many flagged messages follow.
function alertAdminsIfFlagged(message: MessageRow) {
  return safely("flagged message", async () => {
    const flags = detectFlags(message.body);
    if (flags.length === 0) return;

    const admin = createAdminClient();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recent } = await admin
      .from("messages")
      .select("body")
      .eq("coach_id", message.coach_id)
      .eq("member_id", message.member_id)
      .neq("id", message.id)
      .gte("created_at", since)
      .limit(500);
    if (
      (recent ?? []).some((row) => detectFlags(row.body as string).length > 0)
    )
      return;

    const [{ data: admins }, coach, member] = await Promise.all([
      admin.from("profiles").select("id").eq("role", "admin"),
      loadRecipient(message.coach_id),
      loadRecipient(message.member_id),
    ]);
    const email = flaggedMessageEmail({
      siteUrl: getSiteUrl(),
      coachName: coach?.name ?? "A coach",
      memberName: member?.name ?? "a member",
      fromCoach: message.sender_id === message.coach_id,
      reasons: describeFlags(flags).toLowerCase(),
      body: message.body,
      reviewPath: `/admin/messages/${message.coach_id}/${message.member_id}`,
    });
    for (const row of admins ?? []) {
      const person = await loadRecipient(row.id as string);
      if (person) await sendEmail(person.email, email);
    }
    await sendPush(
      (admins ?? []).map((row) => row.id as string),
      {
        title: "A message needs review",
        body: `${coach?.name ?? "A coach"} and ${member?.name ?? "a member"}: ${describeFlags(flags).toLowerCase()}`,
        url: `/admin/messages/${message.coach_id}/${message.member_id}`,
        tag: `flag-${message.coach_id}-${message.member_id}`,
      },
    );
  });
}

export type SessionSnapshot = {
  id: string;
  coach_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location: string;
  meeting_url: string | null;
};

export function notifySession(
  change: SessionChange,
  session: SessionSnapshot,
  memberIds: string[],
) {
  return safely(`session ${change}`, async () => {
    if (memberIds.length === 0) return;
    const coach = await loadRecipient(session.coach_id);
    const email = sessionEmail({
      siteUrl: getSiteUrl(),
      change,
      coachName: coach?.name ?? "Your coach",
      title: session.title,
      when: formatEmailSessionTime(session.starts_at, session.ends_at),
      location: session.location,
      meetingUrl: session.meeting_url,
      sessionId: session.id,
    });

    for (const memberId of memberIds) {
      const member = await loadRecipient(memberId);
      if (member?.wantsUpdates) await sendEmail(member.email, email);
    }
    await sendPush(memberIds, {
      title:
        change === "invited"
          ? `New session: ${session.title}`
          : change === "updated"
            ? `Session changed: ${session.title}`
            : `Cancelled: ${session.title}`,
      body: `${coach?.name ?? "Your coach"} · ${formatEmailSessionTime(session.starts_at, session.ends_at)}`,
      url: change === "cancelled" ? "/calendar" : `/calendar/${session.id}`,
      tag: `session-${session.id}`,
    });
  });
}

// Invited members who haven't said "Not going" hear the moment their coach goes live.
export function notifyLiveNow(sessionId: string) {
  return safely("live now", async () => {
    const db = createAdminClient();
    const { data: session } = await db
      .from("calendar_sessions")
      .select("id, coach_id, title, session_invites(member_id, response)")
      .eq("id", sessionId)
      .maybeSingle();
    if (!session) return;
    const coach = await loadRecipient(session.coach_id as string);
    const invites = (session.session_invites ?? []) as {
      member_id: string;
      response: string;
    }[];
    await sendPush(
      invites
        .filter((invite) => invite.response !== "not_going")
        .map((invite) => invite.member_id),
      {
        title: `${coach?.name ?? "Your coach"} is live`,
        body: `${session.title as string}: tap to watch and chat.`,
        url: `/calendar/${session.id as string}/live`,
        tag: `live-${session.id as string}`,
      },
    );
    for (const invite of invites) {
      if (invite.response === "not_going") continue;
      const member = await loadRecipient(invite.member_id);
      if (!member?.wantsUpdates) continue;
      await sendEmail(
        member.email,
        liveNowEmail({
          siteUrl: getSiteUrl(),
          name: member.name,
          coachName: coach?.name ?? "Your coach",
          title: session.title as string,
          sessionId: session.id as string,
        }),
      );
    }
  });
}

// A new group post pushes to everyone else in the coach's group, one notification per group.
export function notifyGroupPost(post: {
  coach_id: string;
  sender_id: string;
  body: string;
}) {
  return safely("group post", async () => {
    const db = createAdminClient();
    const [{ data: links }, sender, coach] = await Promise.all([
      db
        .from("coach_members")
        .select("member_id")
        .eq("coach_id", post.coach_id),
      loadRecipient(post.sender_id),
      loadRecipient(post.coach_id),
    ]);
    const everyone = [
      post.coach_id,
      ...(links ?? []).map((row) => row.member_id as string),
    ];
    await sendPush(
      everyone.filter((id) => id !== post.sender_id),
      {
        title: `${coach?.name ?? "Your coach"}'s community chat`,
        body: `${sender?.name ?? "Someone"}: ${post.body}`,
        url: `/groups/${post.coach_id}?tab=chat`,
        tag: `group-${post.coach_id}`,
      },
    );
  });
}
