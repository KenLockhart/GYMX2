// The emails GYMX2 sends. Each returns a subject plus HTML and plain-text bodies.
// Kept free of server code so they can be tested on their own.

import type { Locale } from "../i18n/config";
import { translate } from "../i18n/phrases";

// Each email is written in its recipient's language (English unless they chose Spanish).
function trFor(locale: Locale | undefined) {
  return (text: string, vars?: Record<string, string | number>) =>
    translate(text, locale ?? "en", vars);
}

export type Email = {
  subject: string;
  html: string;
  text: string;
  // Which automatic email this is and the parts admins can reword (see email-catalog.ts).
  key?: string;
  vars?: Record<string, string>;
  parts?: EmailParts;
  locale?: Locale;
};

type EmailParts = {
  subject: string;
  heading: string;
  blocks: Block[];
  button: { label: string; url: string };
  footer: string;
};

// Admin wording for one automatic email. Empty fields keep the default.
export type EmailCopy = {
  subject: string;
  heading: string;
  intro: string;
  button_label: string;
  note: string;
};

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

type Block =
  | { kind: "p"; text: string }
  | { kind: "lines"; lines: string[] }
  | { kind: "quote"; text: string };

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
}): { html: string; text: string } {
  const htmlBlocks = blocks
    .map((block) => {
      if (block.kind === "p")
        return `<p style="margin:0 0 16px">${escapeHtml(block.text)}</p>`;
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
  const text = [
    heading,
    ...textBlocks,
    `${button.label}: ${button.url}`,
    "",
    footer,
  ].join("\n\n");

  return { html, text };
}

function build(
  locale: Locale | undefined,
  key: string,
  vars: Record<string, string>,
  parts: EmailParts,
): Email {
  return { subject: parts.subject, ...render(parts), key, vars, parts, locale };
}

// Swaps {placeholders} for this email's values; unknown ones are left as typed.
export function fillPlaceholders(
  template: string,
  vars: Record<string, string>,
) {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? vars[name] : match,
  );
}

// Applies an admin's wording to an email: subject, heading, the opening paragraph, the
// button label and an extra note before the button. Details like addresses, quotes and
// links always stay.
export function customizeEmail(
  email: Email,
  copy: Partial<EmailCopy> | null | undefined,
): Email {
  if (!copy || !email.parts) return email;
  const vars = email.vars ?? {};
  const fill = (value: string | undefined, fallback: string) =>
    value && value.trim() ? fillPlaceholders(value.trim(), vars) : fallback;
  const blocks = [...email.parts.blocks];
  if (copy.intro && copy.intro.trim()) {
    const intro: Block = { kind: "p", text: fill(copy.intro, "") };
    if (blocks[0]?.kind === "p") blocks[0] = intro;
    else blocks.unshift(intro);
  }
  if (copy.note && copy.note.trim())
    blocks.push({ kind: "p", text: fill(copy.note, "") });
  const parts: EmailParts = {
    ...email.parts,
    subject: oneLine(fill(copy.subject, email.parts.subject), 120),
    heading: fill(copy.heading, email.parts.heading),
    blocks,
    button: {
      ...email.parts.button,
      label: fill(copy.button_label, email.parts.button.label),
    },
  };
  return { ...email, subject: parts.subject, ...render(parts), parts };
}

const ORDER_FOOTER = "You're getting this because of an order on GYMX2.";
const UPDATES_FOOTER =
  "You can turn these emails off on your Profile page on GYMX2.";

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

// A link to the carrier's tracking page when the number's format makes the carrier clear.
export function trackingUrl(tracking: string) {
  const number = tracking.replace(/\s+/g, "").toUpperCase();
  if (/^1Z[0-9A-Z]{16}$/.test(number))
    return `https://www.ups.com/track?tracknum=${number}`;
  if (/^(9[2-5]\d{18,20}|[A-Z]{2}\d{9}US)$/.test(number))
    return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${number}`;
  if (/^(\d{12}|\d{15})$/.test(number))
    return `https://www.fedex.com/fedextrack/?trknbr=${number}`;
  return null;
}

export function newSaleEmail(input: {
  locale?: Locale;
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
  const tr = trFor(input.locale);
  const blocks: Block[] = [
    {
      kind: "p",
      text: input.size
        ? tr("{buyer} bought {item} (size {size}) for {amount}.", {
            buyer: input.buyerName,
            item: input.itemTitle,
            size: input.size,
            amount: money(input.amountCents),
          })
        : tr("{buyer} bought {item} for {amount}.", {
            buyer: input.buyerName,
            item: input.itemTitle,
            amount: money(input.amountCents),
          }),
    },
  ];
  if (input.feeCents > 0) {
    blocks.push({
      kind: "p",
      text: tr(
        "GYMX2's fee is {p0}. Stripe sends the rest, less its card fees, to your bank.",
        { p0: money(input.feeCents) },
      ),
    });
  }
  if (input.needsShipping) {
    blocks.push({ kind: "p", text: tr("Ship it to:") });
    blocks.push({
      kind: "lines",
      lines: [input.shippingName ?? input.buyerName, ...input.addressLines],
    });
    blocks.push({
      kind: "p",
      text: tr(
        "When it's on its way, mark it shipped on your Sales page and add the tracking number. We'll email the buyer.",
      ),
    });
  }

  return build(
    input.locale,
    input.needsShipping ? "sale.ship" : "sale.digital",
    {
      buyer: input.buyerName,
      item: input.itemTitle,
      amount: money(input.amountCents),
      size: input.size ?? "",
    },
    {
      subject: input.needsShipping
        ? tr("New order to ship: {p0}", { p0: oneLine(input.itemTitle) })
        : tr("You made a sale: {p0}", { p0: oneLine(input.itemTitle) }),
      heading: input.needsShipping
        ? tr("You have an order to ship")
        : tr("You made a sale"),
      blocks,
      button: {
        label: input.needsShipping
          ? tr("Open orders to ship")
          : tr("See your sales"),
        url: `${input.siteUrl}/armory/sales`,
      },
      footer: tr(ORDER_FOOTER),
    },
  );
}

export function orderShippedEmail(input: {
  locale?: Locale;
  siteUrl: string;
  itemTitle: string;
  sellerName: string;
  size: string | null;
  tracking: string | null;
}): Email {
  const tr = trFor(input.locale);
  const link = input.tracking ? trackingUrl(input.tracking) : null;
  const blocks: Block[] = [
    {
      kind: "p",
      text: input.size
        ? tr("{seller} shipped your {item} (size {size}).", {
            seller: input.sellerName,
            item: input.itemTitle,
            size: input.size,
          })
        : tr("{seller} shipped your {item}.", {
            seller: input.sellerName,
            item: input.itemTitle,
          }),
    },
    input.tracking
      ? {
          kind: "p",
          text: tr("Tracking number: {tracking}", { tracking: input.tracking }),
        }
      : {
          kind: "p",
          text: tr(
            "No tracking number was added. Message your coach if you have questions.",
          ),
        },
  ];

  return build(
    input.locale,
    "order.shipped",
    {
      seller: input.sellerName,
      item: input.itemTitle,
      tracking: input.tracking ?? "",
    },
    {
      subject: tr("Your order shipped: {p0}", { p0: oneLine(input.itemTitle) }),
      heading: tr("Your order is on its way"),
      blocks,
      button: link
        ? { label: tr("Track your package"), url: link }
        : { label: tr("Open the Armory"), url: `${input.siteUrl}/armory` },
      footer: tr(ORDER_FOOTER),
    },
  );
}

export function newMessageEmail(input: {
  locale?: Locale;
  siteUrl: string;
  senderName: string;
  body: string;
  conversationPath: string;
}): Email {
  const tr = trFor(input.locale);
  const preview =
    input.body.length > 500 ? `${input.body.slice(0, 499)}…` : input.body;
  return build(
    input.locale,
    "message.new",
    { sender: input.senderName },
    {
      subject: tr("New message from {p0}", {
        p0: oneLine(input.senderName, 60),
      }),
      heading: tr("{senderName} sent you a message", {
        senderName: input.senderName,
      }),
      blocks: [{ kind: "quote", text: preview }],
      button: {
        label: tr("Reply on GYMX2"),
        url: `${input.siteUrl}${input.conversationPath}`,
      },
      footer: `${tr("We only email about the first unread message in a conversation.")} ${tr(UPDATES_FOOTER)}`,
    },
  );
}

export type SessionChange = "invited" | "updated" | "cancelled";

export type IntroChange = "booked_coach" | "booked_member" | "cancelled";

// Free intro sessions: the coach hears about a booking (with the member's message), the member
// gets a confirmation, and whoever didn't cancel hears about a cancellation.
export function introEmail(input: {
  locale?: Locale;
  siteUrl: string;
  change: IntroChange;
  // The other person: the member for the coach's emails, the coach for the member's.
  otherName: string;
  when: string;
  format: string;
  location: string;
  meetingUrl: string | null;
  message: string;
  sessionId: string | null;
}): Email {
  const tr = trFor(input.locale);
  const details = [
    tr("When: {when}", { when: input.when }),
    tr("How: {format}", { format: input.format }),
  ];
  if (input.location)
    details.push(tr("Where: {location}", { location: input.location }));
  if (input.meetingUrl)
    details.push(
      tr("Join online: {meetingUrl}", { meetingUrl: input.meetingUrl }),
    );
  const name = input.otherName;
  const short = oneLine(name, 40);
  const message =
    input.message.length > 1000
      ? `${input.message.slice(0, 999)}…`
      : input.message;
  const calendar = input.sessionId
    ? `${input.siteUrl}/calendar/${input.sessionId}`
    : `${input.siteUrl}/calendar`;
  const vars = { name, when: input.when };
  if (input.change === "booked_coach")
    return build(input.locale, "intro.booked_coach", vars, {
      subject: tr("New intro booked: {short}", { short }),
      heading: tr("{name} booked a free intro", { name }),
      blocks: [
        {
          kind: "p",
          text: tr(
            "{name} found you on GYMX2 and booked a free intro session with you.",
            { name },
          ),
        },
        { kind: "lines", lines: details },
        ...(message
          ? [
              { kind: "p" as const, text: tr("Their message:") },
              { kind: "quote" as const, text: message },
            ]
          : []),
        {
          kind: "p",
          text: tr(
            "It's on your calendar. If you can't make it, cancel it there so they can pick another time.",
          ),
        },
      ],
      button: {
        label: tr("See your intros"),
        url: `${input.siteUrl}/calendar/intros`,
      },
      footer: tr(UPDATES_FOOTER),
    });
  if (input.change === "booked_member")
    return build(input.locale, "intro.booked_member", vars, {
      subject: tr("Your intro with {short} is booked", { short }),
      heading: tr("Your free intro is booked"),
      blocks: [
        {
          kind: "p",
          text: tr(
            "You're booked in for a free intro with {name}. It doesn't start a membership.",
            { name },
          ),
        },
        { kind: "lines", lines: details },
        {
          kind: "p",
          text: tr(
            "Can't make it? Cancel from your calendar any time before it starts.",
          ),
        },
      ],
      button: { label: tr("Open in your calendar"), url: calendar },
      footer: tr(UPDATES_FOOTER),
    });
  return build(input.locale, "intro.cancelled", vars, {
    subject: tr("Intro cancelled: {short}", { short }),
    heading: tr("An intro was cancelled"),
    blocks: [
      {
        kind: "p",
        text: tr("{name} cancelled your free intro session.", { name }),
      },
      { kind: "lines", lines: details.slice(0, 2) },
    ],
    button: {
      label: tr("Open your calendar"),
      url: `${input.siteUrl}/calendar`,
    },
    footer: tr(UPDATES_FOOTER),
  });
}

export function sessionEmail(input: {
  locale?: Locale;
  siteUrl: string;
  change: SessionChange;
  coachName: string;
  title: string;
  when: string;
  location: string;
  meetingUrl: string | null;
  sessionId: string;
}): Email {
  const tr = trFor(input.locale);
  const details = [tr("When: {when}", { when: input.when })];
  if (input.location)
    details.push(tr("Where: {location}", { location: input.location }));
  if (input.meetingUrl)
    details.push(
      tr("Join online: {meetingUrl}", { meetingUrl: input.meetingUrl }),
    );

  const copy = {
    invited: {
      subject: tr("{p0} invited you: {p1}", {
        p0: oneLine(input.coachName, 40),
        p1: oneLine(input.title, 60),
      }),
      heading: tr("You're invited to a session"),
      intro: tr("{coachName} added you to {title}.", {
        coachName: input.coachName,
        title: input.title,
      }),
    },
    updated: {
      subject: tr("Session changed: {p0}", { p0: oneLine(input.title) }),
      heading: tr("A session changed"),
      intro: tr(
        "{coachName} changed the time or place of {title}. Here are the new details.",
        { coachName: input.coachName, title: input.title },
      ),
    },
    cancelled: {
      subject: tr("Session cancelled: {p0}", { p0: oneLine(input.title) }),
      heading: tr("A session was cancelled"),
      intro: `${input.coachName} cancelled ${input.title}.`,
    },
  }[input.change];

  return build(
    input.locale,
    `session.${input.change}`,
    { coach: input.coachName, title: input.title, when: input.when },
    {
      subject: copy.subject,
      heading: copy.heading,
      blocks: [
        { kind: "p", text: copy.intro },
        { kind: "lines", lines: details },
        ...(input.change === "cancelled"
          ? []
          : [
              {
                kind: "p" as const,
                text: tr("Let your coach know if you can make it."),
              },
            ]),
      ],
      button:
        input.change === "cancelled"
          ? {
              label: tr("Open your calendar"),
              url: `${input.siteUrl}/calendar`,
            }
          : {
              label: tr("Going or can't go?"),
              url: `${input.siteUrl}/calendar/${input.sessionId}`,
            },
      footer: tr(UPDATES_FOOTER),
    },
  );
}

export function flaggedMessageEmail(input: {
  locale?: Locale;
  siteUrl: string;
  coachName: string;
  memberName: string;
  fromCoach: boolean;
  reasons: string;
  body: string;
  reviewPath: string;
}): Email {
  const tr = trFor(input.locale);
  const sender = input.fromCoach
    ? `${input.coachName} (coach)`
    : `${input.memberName} (member)`;
  const preview =
    input.body.length > 500 ? `${input.body.slice(0, 499)}…` : input.body;
  return build(
    input.locale,
    "message.flagged",
    {
      coach: input.coachName,
      member: input.memberName,
      reasons: input.reasons,
    },
    {
      subject: tr("Flagged message: {p0} and {p1}", {
        p0: oneLine(input.coachName, 40),
        p1: oneLine(input.memberName, 40),
      }),
      heading: tr("A message was flagged"),
      blocks: [
        {
          kind: "p",
          text: tr("{sender} sent a message that mentions: {reasons}.", {
            sender,
            reasons: input.reasons,
          }),
        },
        { kind: "quote", text: preview },
        {
          kind: "p",
          text: tr(
            "This is a reason to look, not proof. Open the conversation to see it in context.",
          ),
        },
      ],
      button: {
        label: tr("Review the conversation"),
        url: `${input.siteUrl}${input.reviewPath}`,
      },
      footer: tr(
        "You get this because you're a GYMX2 admin. We send at most one per conversation each day.",
      ),
    },
  );
}

export function refundEmail(input: {
  locale?: Locale;
  siteUrl: string;
  audience: "buyer" | "seller";
  itemTitle: string;
  amountCents: number;
  buyerName: string;
  orderCancelled: boolean;
}): Email {
  const tr = trFor(input.locale);
  const amount = money(input.amountCents);
  const buyer = input.audience === "buyer";
  const blocks: Block[] = buyer
    ? [
        {
          kind: "p",
          text: tr(
            "We refunded {amount} for {itemTitle} to the card you paid with.",
            { amount, itemTitle: input.itemTitle },
          ),
        },
        {
          kind: "p",
          text: tr("Your bank may take 5–10 business days to show it."),
        },
        ...(input.orderCancelled
          ? [
              {
                kind: "p" as const,
                text: tr(
                  "Your order was cancelled before it shipped, so nothing will arrive.",
                ),
              },
            ]
          : []),
      ]
    : [
        {
          kind: "p",
          text: tr(
            "{buyerName}'s order of {itemTitle} ({amount}) was refunded.",
            { buyerName: input.buyerName, itemTitle: input.itemTitle, amount },
          ),
        },
        {
          kind: "p",
          text: input.orderCancelled
            ? tr(
                "It hadn't shipped, so it's been removed from your orders to ship. Please don't send it.",
              )
            : tr(
                "Your share of the sale is taken back from your Stripe balance.",
              ),
        },
      ];

  return build(
    input.locale,
    buyer ? "refund.buyer" : "refund.seller",
    { item: input.itemTitle, amount, buyer: input.buyerName },
    {
      subject: buyer
        ? tr("Refund for {p0}", { p0: oneLine(input.itemTitle) })
        : tr("Order refunded: {p0}", { p0: oneLine(input.itemTitle) }),
      heading: buyer
        ? tr("Your refund is on its way")
        : tr("An order was refunded"),
      blocks,
      button: buyer
        ? {
            label: tr("See your purchases"),
            url: `${input.siteUrl}/armory/purchases`,
          }
        : { label: tr("See your sales"), url: `${input.siteUrl}/armory/sales` },
      footer: tr(ORDER_FOOTER),
    },
  );
}

export function accountDeletedEmail(input: {
  locale?: Locale;
  siteUrl: string;
  name: string;
}): Email {
  const tr = trFor(input.locale);
  return build(
    input.locale,
    "account.deleted",
    { name: input.name },
    {
      subject: tr("Your GYMX2 account was deleted"),
      heading: tr("Your account is deleted"),
      blocks: [
        {
          kind: "p",
          text: tr(
            "Hi {name}, your GYMX2 account and everything in it has been deleted, as you asked.",
            { name: input.name },
          ),
        },
        {
          kind: "p",
          text: tr(
            "We keep records of past purchases for tax and accounting, without your name attached. Backups clear within 30 days.",
          ),
        },
        {
          kind: "p",
          text: tr(
            "If you didn't do this, email support@gymx2.com right away.",
          ),
        },
      ],
      button: { label: tr("Visit GYMX2"), url: input.siteUrl },
      footer: tr("This is the last email you'll get from GYMX2."),
    },
  );
}

export function affiliateDecisionEmail(input: {
  locale?: Locale;
  siteUrl: string;
  name: string;
  approved: boolean;
  link: string;
  terms: string[];
}): Email {
  const tr = trFor(input.locale);
  return build(
    input.locale,
    input.approved ? "affiliate.approved" : "affiliate.declined",
    { name: input.name, link: input.link },
    {
      subject: input.approved
        ? tr("You're a GYMX2 affiliate")
        : tr("Your GYMX2 affiliate application"),
      heading: input.approved
        ? tr("Welcome to the affiliate program")
        : tr("About your affiliate application"),
      blocks: input.approved
        ? [
            {
              kind: "p",
              text: tr(
                "Hi {name}, you're approved. Share your link and earn when people you refer join and buy.",
                { name: input.name },
              ),
            },
            {
              kind: "lines",
              lines: [
                tr("Your link: {link}", { link: input.link }),
                ...input.terms,
              ],
            },
            {
              kind: "p",
              text: tr(
                "Set up payouts on your Affiliate page so we can pay you.",
              ),
            },
          ]
        : [
            {
              kind: "p",
              text: tr(
                "Hi {name}, thanks for applying. We can't approve your application right now.",
                { name: input.name },
              ),
            },
            { kind: "p", text: tr("Questions? Email support@gymx2.com.") },
          ],
      button: {
        label: input.approved
          ? tr("Open your Affiliate page")
          : tr("Visit GYMX2"),
        url: `${input.siteUrl}/affiliate`,
      },
      footer: tr(
        "You're getting this because you applied to the GYMX2 affiliate program.",
      ),
    },
  );
}

export function affiliatePayoutEmail(input: {
  locale?: Locale;
  siteUrl: string;
  name: string;
  amountCents: number;
  count: number;
}): Email {
  const tr = trFor(input.locale);
  const amount = money(input.amountCents);
  return build(
    input.locale,
    "affiliate.payout",
    { name: input.name, amount, count: String(input.count) },
    {
      subject: tr("You've been paid {amount}", { amount }),
      heading: tr("Your affiliate payout is on its way"),
      blocks: [
        {
          kind: "p",
          text: tr(
            "Hi {name}, we sent {amount} for {count} {p3} to your Stripe account.",
            {
              name: input.name,
              amount,
              count: input.count,
              p3: input.count === 1 ? tr("commission") : tr("commissions"),
            },
          ),
        },
        {
          kind: "p",
          text: tr(
            "Stripe moves it to your bank on your normal payout schedule, usually within a few business days.",
          ),
        },
      ],
      button: {
        label: tr("See your earnings"),
        url: `${input.siteUrl}/affiliate`,
      },
      footer: tr("You're getting this because you're a GYMX2 affiliate."),
    },
  );
}

export function sessionReminderEmail(input: {
  locale?: Locale;
  siteUrl: string;
  name: string;
  sessions: {
    id: string;
    title: string;
    when: string;
    where: string;
    coachName: string;
  }[];
}): Email {
  const tr = trFor(input.locale);
  const one = input.sessions.length === 1 ? input.sessions[0] : null;
  return build(
    input.locale,
    "reminder.session",
    {
      name: input.name,
      title: input.sessions[0]?.title ?? "",
      count: String(input.sessions.length),
    },
    {
      subject: one
        ? tr("Tomorrow: {p0}", { p0: oneLine(one.title) })
        : tr("You have {length} sessions tomorrow", {
            length: input.sessions.length,
          }),
      heading: one
        ? tr("Your session is tomorrow")
        : tr("Your sessions tomorrow"),
      blocks: [
        {
          kind: "p",
          text: tr("Hi {name}, here's what's coming up.", { name: input.name }),
        },
        ...input.sessions.map((session) => ({
          kind: "lines" as const,
          lines: [
            `${session.title} with ${session.coachName}`,
            session.when,
            ...(session.where ? [session.where] : []),
          ],
        })),
        { kind: "p", text: tr("Can't make it? Let your coach know on GYMX2.") },
      ],
      button: one
        ? {
            label: tr("Open the session"),
            url: `${input.siteUrl}/calendar/${one.id}`,
          }
        : { label: tr("Open your calendar"), url: `${input.siteUrl}/calendar` },
      footer: tr(UPDATES_FOOTER),
    },
  );
}

export function liveNowEmail(input: {
  locale?: Locale;
  siteUrl: string;
  name: string;
  coachName: string;
  title: string;
  sessionId: string;
}): Email {
  const tr = trFor(input.locale);
  return build(
    input.locale,
    "live.now",
    { name: input.name, coach: input.coachName, title: input.title },
    {
      subject: `${oneLine(input.coachName)} is live: ${oneLine(input.title)}`,
      heading: tr("Your session is live"),
      blocks: [
        {
          kind: "p",
          text: tr(
            'Hi {name}, {coachName} just went live for "{title}". Jump in and train together.',
            {
              name: input.name,
              coachName: input.coachName,
              title: input.title,
            },
          ),
        },
      ],
      button: {
        label: tr("Watch live"),
        url: `${input.siteUrl}/calendar/${input.sessionId}/live`,
      },
      footer: tr(UPDATES_FOOTER),
    },
  );
}

export function taskDueEmail(input: {
  locale?: Locale;
  siteUrl: string;
  name: string;
  tasks: { title: string; coachName: string }[];
}): Email {
  const tr = trFor(input.locale);
  const one = input.tasks.length === 1 ? input.tasks[0] : null;
  return build(
    input.locale,
    "reminder.task",
    {
      name: input.name,
      task: input.tasks[0]?.title ?? "",
      count: String(input.tasks.length),
    },
    {
      subject: one
        ? tr("Due tomorrow: {p0}", { p0: oneLine(one.title) })
        : tr("{length} Tasks are due tomorrow", { length: input.tasks.length }),
      heading: one ? tr("A Task is due tomorrow") : tr("Tasks due tomorrow"),
      blocks: [
        {
          kind: "p",
          text: tr(
            "Hi {name}, finish {p1} to stay on track (+3 points each).",
            { name: input.name, p1: one ? tr("this") : tr("these") },
          ),
        },
        {
          kind: "lines",
          lines: input.tasks.map((task) =>
            tr("{title} (from {coach})", {
              title: task.title,
              coach: task.coachName,
            }),
          ),
        },
      ],
      button: { label: tr("Open your Tasks"), url: `${input.siteUrl}/tasks` },
      footer: tr(UPDATES_FOOTER),
    },
  );
}

export function checkinReminderEmail(input: {
  locale?: Locale;
  siteUrl: string;
  name: string;
}): Email {
  const tr = trFor(input.locale);
  return build(
    input.locale,
    "reminder.checkin",
    { name: input.name },
    {
      subject: tr("How did your week go?"),
      heading: tr("Time for your weekly check-in"),
      blocks: [
        {
          kind: "p",
          text: tr(
            "Hi {name}, take a minute to rate your energy, sleep, stress and motivation and share a win. Your coach reads every one.",
            { name: input.name },
          ),
        },
      ],
      button: { label: tr("Check in"), url: `${input.siteUrl}/checkin` },
      footer: tr(UPDATES_FOOTER),
    },
  );
}

export function streakReminderEmail(input: {
  locale?: Locale;
  siteUrl: string;
  name: string;
  days: number;
  coach: boolean;
}): Email {
  const tr = trFor(input.locale);
  return build(
    input.locale,
    "reminder.streak",
    { name: input.name, days: String(input.days) },
    {
      subject: tr("🔥 Keep your {days}-day streak alive", { days: input.days }),
      heading: tr("Your {days}-day streak ends tonight", { days: input.days }),
      blocks: [
        {
          kind: "p",
          text: tr(
            "Hi {name}, you haven't been active today yet. One thing before midnight keeps it going.",
            { name: input.name },
          ),
        },
        {
          kind: "p",
          text: input.coach
            ? tr(
                "Publish a video, give a Task, schedule a session or message a member.",
              )
            : tr(
                "Finish a Task, write a Memo, RSVP to a session or message your coach.",
              ),
        },
      ],
      button: input.coach
        ? { label: tr("Open GYMX2"), url: `${input.siteUrl}/dashboard` }
        : { label: tr("Open your Tasks"), url: `${input.siteUrl}/tasks` },
      footer: tr(UPDATES_FOOTER),
    },
  );
}

export function weeklyDigestEmail(input: {
  locale?: Locale;
  siteUrl: string;
  name: string;
  level: string;
  points: number;
  toNext: number;
  nextLevel: string | null;
  streak: number;
  lastWeekDone: number;
  challengeCount: number;
  newBadges: string[];
  challenges: string[];
  upcoming: string[];
}): Email {
  const tr = trFor(input.locale);
  const blocks: Block[] = [
    {
      kind: "p",
      text: `${tr("Hi {name}, last week you finished {done} of {count} challenges.", { name: input.name, done: input.lastWeekDone, count: input.challengeCount })}${
        input.newBadges.length
          ? tr(" New badges: {badges}.", {
              badges: input.newBadges.map((b) => tr(b)).join(", "),
            })
          : ""
      }`,
    },
    {
      kind: "lines",
      lines: [
        input.nextLevel
          ? tr("Level: {level} ({points} points, {toNext} to {next})", {
              level: tr(input.level),
              points: input.points,
              toNext: input.toNext,
              next: tr(input.nextLevel),
            })
          : tr("Level: {level} ({points} points)", {
              level: tr(input.level),
              points: input.points,
            }),
        tr("Streak: {streak} {p1}", {
          streak: input.streak,
          p1: input.streak === 1 ? tr("day") : tr("days"),
        }),
      ],
    },
    { kind: "p", text: tr("This week's challenges:") },
    { kind: "lines", lines: input.challenges },
  ];
  if (input.upcoming.length) {
    blocks.push(
      { kind: "p", text: tr("Coming up:") },
      { kind: "lines", lines: input.upcoming },
    );
  }
  return build(
    input.locale,
    "digest.weekly",
    {
      name: input.name,
      level: input.level,
      points: String(input.points),
      streak: String(input.streak),
    },
    {
      subject: tr("Your GYMX2 week"),
      heading: tr("A new week starts now"),
      blocks,
      button: {
        label: tr("See your progress"),
        url: `${input.siteUrl}/progress`,
      },
      footer: tr(UPDATES_FOOTER),
    },
  );
}

export function membershipChangeEmail(input: {
  locale?: Locale;
  siteUrl: string;
  change: "started" | "ended";
  memberName: string;
  planName: string;
  priceCents: number;
  trial: boolean;
}): Email {
  const tr = trFor(input.locale);
  const started = input.change === "started";
  return build(
    input.locale,
    started ? "membership.started" : "membership.ended",
    {
      member: input.memberName,
      plan: input.planName,
      price: money(input.priceCents),
    },
    {
      subject: started
        ? tr("New {p0}: {p1} joined {p2}", {
            p0: input.trial ? tr("trial") : tr("member"),
            p1: oneLine(input.memberName, 40),
            p2: oneLine(input.planName, 40),
          })
        : tr("Membership ended: {p0}", { p0: oneLine(input.memberName, 40) }),
      heading: started
        ? tr("You have a new subscriber")
        : tr("A membership ended"),
      blocks: started
        ? [
            {
              kind: "p",
              text: tr(
                "{memberName} subscribed to {planName} ({p2}/month){p3}.",
                {
                  memberName: input.memberName,
                  planName: input.planName,
                  p2: money(input.priceCents),
                  p3: input.trial
                    ? tr(", starting with a 7-day free trial")
                    : "",
                },
              ),
            },
            {
              kind: "p",
              text: tr("Say hello and give them their first Task."),
            },
          ]
        : [
            {
              kind: "p",
              text: tr("{memberName}'s {planName} membership has ended.", {
                memberName: input.memberName,
                planName: input.planName,
              }),
            },
          ],
      button: { label: tr("See your members"), url: `${input.siteUrl}/plans` },
      footer: tr("You're getting this because you offer memberships on GYMX2."),
    },
  );
}

export type CommunityEmailType =
  "like" | "comment" | "reply" | "progress_reply" | "announcement" | "removed";

const COMMUNITY_FOOTER =
  "Choose which Community emails you get in Profile, Notifications on GYMX2.";

// One email per new Community notification. Repeats (more likes on the same post while the first
// is unread) don't send again; see community-notify.ts.
export function communityEmail(input: {
  locale?: Locale;
  siteUrl: string;
  type: CommunityEmailType;
  actorName: string;
  // The comment, the announcement or the removal reason, when there is one.
  snippet: string;
  link: string;
}): Email {
  const tr = trFor(input.locale);
  const actor = input.actorName;
  const short = oneLine(actor, 60);
  const snippet =
    input.snippet.length > 500
      ? `${input.snippet.slice(0, 499)}…`
      : input.snippet;
  const quote: Block[] = snippet ? [{ kind: "quote", text: snippet }] : [];
  const url = `${input.siteUrl}${input.link}`;
  const vars = { name: actor };
  switch (input.type) {
    case "like":
      return build(input.locale, "community.like", vars, {
        subject: tr("{short} liked your post", { short }),
        heading: tr("{actor} liked your post", { actor }),
        blocks: [
          {
            kind: "p",
            text: tr("Your post is getting some love in the GYMX2 Community."),
          },
        ],
        button: { label: tr("See your post"), url },
        footer: `${tr("We send one email per post until you've seen it.")} ${tr(COMMUNITY_FOOTER)}`,
      });
    case "comment":
      return build(input.locale, "community.comment", vars, {
        subject: tr("{short} commented on your post", { short }),
        heading: tr("{actor} commented on your post", { actor }),
        blocks: quote,
        button: { label: tr("Reply on GYMX2"), url },
        footer: tr(COMMUNITY_FOOTER),
      });
    case "progress_reply":
      return build(input.locale, "community.progress_reply", vars, {
        subject: tr("{short} commented on your progress", { short }),
        heading: tr("{actor} commented on your progress post", { actor }),
        blocks: quote,
        button: { label: tr("See the comment"), url },
        footer: tr(COMMUNITY_FOOTER),
      });
    case "reply":
      return build(input.locale, "community.reply", vars, {
        subject: tr("{short} replied to your comment", { short }),
        heading: tr("{actor} replied to your comment", { actor }),
        blocks: quote,
        button: { label: tr("Reply on GYMX2"), url },
        footer: tr(COMMUNITY_FOOTER),
      });
    case "announcement":
      return build(input.locale, "community.announcement", vars, {
        subject: tr("New announcement from {short}", { short }),
        heading: tr("{actor} posted an announcement", { actor }),
        blocks: quote,
        button: { label: tr("Read it on GYMX2"), url },
        footer: `${tr("You're getting this because you're in {actor}'s community.", { actor })} ${tr(COMMUNITY_FOOTER)}`,
      });
    case "removed":
      return build(input.locale, "community.removed", vars, {
        subject: tr("Something you posted was removed"),
        heading: tr("Something you posted was removed from Community"),
        blocks: [
          {
            kind: "p",
            text: tr(
              "It was removed because it broke the GYMX2 community guidelines.",
            ),
          },
          ...(snippet
            ? [
                {
                  kind: "lines",
                  lines: [tr("Reason: {snippet}", { snippet })],
                } as Block,
              ]
            : []),
        ],
        button: { label: tr("Read the Terms"), url: `${input.siteUrl}/terms` },
        footer: tr(
          "Reply to support@gymx2.com if you think this was a mistake.",
        ),
      });
  }
}
