// The emails GYMX2 sends. Each returns a subject plus HTML and plain-text bodies.
// Kept free of server code so they can be tested on their own.

export type Email = { subject: string; html: string; text: string };

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Subjects are plain text, but a line break in one would break the email.
function oneLine(value: string, max = 80) {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

type Block = { kind: "p"; text: string } | { kind: "lines"; lines: string[] } | { kind: "quote"; text: string };

function render({
  heading,
  blocks,
  button,
  footer,
}: {
  heading: string;
  blocks: Block[];
  button: { label: string; url: string };
  footer: string;
}): Omit<Email, "subject"> {
  const htmlBlocks = blocks
    .map((block) => {
      if (block.kind === "p") return `<p style="margin:0 0 16px">${escapeHtml(block.text)}</p>`;
      if (block.kind === "lines")
        return `<p style="margin:0 0 16px">${block.lines.map(escapeHtml).join("<br>")}</p>`;
      return `<blockquote style="margin:0 0 16px;padding:12px 16px;border-left:3px solid #c8f135;background:#f4f4f5;white-space:pre-wrap">${escapeHtml(block.text)}</blockquote>`;
    })
    .join("");

  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b">
<div style="max-width:560px;margin:0 auto;padding:24px">
<p style="margin:0 0 16px;padding:12px 16px;border-radius:8px;background:#141704;color:#c8f135;font-size:20px;font-weight:bold;letter-spacing:1px">GYMX2</p>
<div style="background:#ffffff;border-radius:8px;padding:24px;font-size:15px;line-height:1.5">
<h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(heading)}</h1>
${htmlBlocks}
<p style="margin:24px 0 0"><a href="${escapeHtml(button.url)}" style="display:inline-block;background:#c8f135;color:#141704;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:6px">${escapeHtml(button.label)}</a></p>
</div>
<p style="margin:16px 0 0;font-size:12px;color:#71717a">${escapeHtml(footer)}</p>
</div></body></html>`;

  const textBlocks = blocks.map((block) => {
    if (block.kind === "p") return block.text;
    if (block.kind === "lines") return block.lines.join("\n");
    return block.text
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
  });
  const text = [heading, ...textBlocks, `${button.label}: ${button.url}`, "", footer].join("\n\n");

  return { html, text };
}

const ORDER_FOOTER = "You're getting this because of an order on GYMX2.";
const UPDATES_FOOTER = "You can turn these emails off on your Profile page on GYMX2.";

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

// A link to the carrier's tracking page when the number's format makes the carrier clear.
export function trackingUrl(tracking: string) {
  const number = tracking.replace(/\s+/g, "").toUpperCase();
  if (/^1Z[0-9A-Z]{16}$/.test(number)) return `https://www.ups.com/track?tracknum=${number}`;
  if (/^(9[2-5]\d{18,20}|[A-Z]{2}\d{9}US)$/.test(number))
    return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${number}`;
  if (/^(\d{12}|\d{15})$/.test(number)) return `https://www.fedex.com/fedextrack/?trknbr=${number}`;
  return null;
}

export function newSaleEmail(input: {
  siteUrl: string;
  itemTitle: string;
  buyerName: string;
  amountCents: number;
  feeCents: number;
  size: string | null;
  shippingName: string | null;
  addressLines: string[];
  needsShipping: boolean;
}): Email {
  const blocks: Block[] = [
    {
      kind: "p",
      text: `${input.buyerName} bought ${input.itemTitle}${input.size ? ` (size ${input.size})` : ""} for ${money(input.amountCents)}.`,
    },
  ];
  if (input.feeCents > 0) {
    blocks.push({
      kind: "p",
      text: `GYMX2's fee is ${money(input.feeCents)}. Stripe sends the rest, less its card fees, to your bank.`,
    });
  }
  if (input.needsShipping) {
    blocks.push({ kind: "p", text: "Ship it to:" });
    blocks.push({ kind: "lines", lines: [input.shippingName ?? input.buyerName, ...input.addressLines] });
    blocks.push({
      kind: "p",
      text: "When it's on its way, mark it shipped on your Sales page and add the tracking number. We'll email the buyer.",
    });
  }

  return {
    subject: input.needsShipping
      ? `New order to ship: ${oneLine(input.itemTitle)}`
      : `You made a sale: ${oneLine(input.itemTitle)}`,
    ...render({
      heading: input.needsShipping ? "You have an order to ship" : "You made a sale",
      blocks,
      button: { label: input.needsShipping ? "Open orders to ship" : "See your sales", url: `${input.siteUrl}/armory/sales` },
      footer: ORDER_FOOTER,
    }),
  };
}

export function orderShippedEmail(input: {
  siteUrl: string;
  itemTitle: string;
  sellerName: string;
  size: string | null;
  tracking: string | null;
}): Email {
  const link = input.tracking ? trackingUrl(input.tracking) : null;
  const blocks: Block[] = [
    {
      kind: "p",
      text: `${input.sellerName} shipped your ${input.itemTitle}${input.size ? ` (size ${input.size})` : ""}.`,
    },
    input.tracking
      ? { kind: "p", text: `Tracking number: ${input.tracking}` }
      : { kind: "p", text: "No tracking number was added. Message your coach if you have questions." },
  ];

  return {
    subject: `Your order shipped: ${oneLine(input.itemTitle)}`,
    ...render({
      heading: "Your order is on its way",
      blocks,
      button: link
        ? { label: "Track your package", url: link }
        : { label: "Open the Armory", url: `${input.siteUrl}/armory` },
      footer: ORDER_FOOTER,
    }),
  };
}

export function newMessageEmail(input: {
  siteUrl: string;
  senderName: string;
  body: string;
  conversationPath: string;
}): Email {
  const preview = input.body.length > 500 ? `${input.body.slice(0, 499)}…` : input.body;
  return {
    subject: `New message from ${oneLine(input.senderName, 60)}`,
    ...render({
      heading: `${input.senderName} sent you a message`,
      blocks: [{ kind: "quote", text: preview }],
      button: { label: "Reply on GYMX2", url: `${input.siteUrl}${input.conversationPath}` },
      footer: `We only email about the first unread message in a conversation. ${UPDATES_FOOTER}`,
    }),
  };
}

export type SessionChange = "invited" | "updated" | "cancelled";

export function sessionEmail(input: {
  siteUrl: string;
  change: SessionChange;
  coachName: string;
  title: string;
  when: string;
  location: string;
  meetingUrl: string | null;
  sessionId: string;
}): Email {
  const details = [`When: ${input.when}`];
  if (input.location) details.push(`Where: ${input.location}`);
  if (input.meetingUrl) details.push(`Join online: ${input.meetingUrl}`);

  const copy = {
    invited: {
      subject: `${oneLine(input.coachName, 40)} invited you: ${oneLine(input.title, 60)}`,
      heading: "You're invited to a session",
      intro: `${input.coachName} added you to ${input.title}.`,
    },
    updated: {
      subject: `Session changed: ${oneLine(input.title)}`,
      heading: "A session changed",
      intro: `${input.coachName} changed the time or place of ${input.title}. Here are the new details.`,
    },
    cancelled: {
      subject: `Session cancelled: ${oneLine(input.title)}`,
      heading: "A session was cancelled",
      intro: `${input.coachName} cancelled ${input.title}.`,
    },
  }[input.change];

  return {
    subject: copy.subject,
    ...render({
      heading: copy.heading,
      blocks: [
        { kind: "p", text: copy.intro },
        { kind: "lines", lines: details },
        ...(input.change === "cancelled"
          ? []
          : [{ kind: "p" as const, text: "Let your coach know if you can make it." }]),
      ],
      button:
        input.change === "cancelled"
          ? { label: "Open your calendar", url: `${input.siteUrl}/calendar` }
          : { label: "Going or can't go?", url: `${input.siteUrl}/calendar/${input.sessionId}` },
      footer: UPDATES_FOOTER,
    }),
  };
}

export function flaggedMessageEmail(input: {
  siteUrl: string;
  coachName: string;
  memberName: string;
  fromCoach: boolean;
  reasons: string;
  body: string;
  reviewPath: string;
}): Email {
  const sender = input.fromCoach ? `${input.coachName} (coach)` : `${input.memberName} (member)`;
  const preview = input.body.length > 500 ? `${input.body.slice(0, 499)}…` : input.body;
  return {
    subject: `Flagged message: ${oneLine(input.coachName, 40)} and ${oneLine(input.memberName, 40)}`,
    ...render({
      heading: "A message was flagged",
      blocks: [
        { kind: "p", text: `${sender} sent a message that mentions: ${input.reasons}.` },
        { kind: "quote", text: preview },
        { kind: "p", text: "This is a reason to look, not proof. Open the conversation to see it in context." },
      ],
      button: { label: "Review the conversation", url: `${input.siteUrl}${input.reviewPath}` },
      footer: "You get this because you're a GYMX2 admin. We send at most one per conversation each day.",
    }),
  };
}
