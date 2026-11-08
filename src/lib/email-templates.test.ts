import { describe, expect, it } from "vitest";
import {
  accountDeletedEmail,
  escapeHtml,
  flaggedMessageEmail,
  refundEmail,
  newMessageEmail,
  newSaleEmail,
  orderShippedEmail,
  sessionEmail,
  trackingUrl,
} from "./email-templates";

const siteUrl = "https://gymx2.com";

describe("escapeHtml", () => {
  it("escapes markup", () => {
    expect(escapeHtml(`<b>"Tom" & 'Jo'</b>`)).toBe("&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jo&#39;&lt;/b&gt;");
  });
});

describe("trackingUrl", () => {
  it.each([
    ["1Z999AA10123456784", "ups.com"],
    [" 1z999aa10123456784 ", "ups.com"],
    ["9400111899223397623910", "usps.com"],
    ["EA123456789US", "usps.com"],
    ["123456789012", "fedex.com"],
  ])("links %s to the carrier", (number, host) => {
    expect(trackingUrl(number)).toContain(host);
  });

  it("gives no link for an unknown format", () => {
    expect(trackingUrl("ABC-123")).toBeNull();
  });
});

describe("newSaleEmail", () => {
  const gear = {
    siteUrl,
    itemTitle: "Rep the Brand Tee",
    buyerName: "Sam",
    amountCents: 5594,
    feeCents: 500,
    size: "M",
    shippingName: "Sam Smith",
    addressLines: ["1 Main St", "Atlanta, GA 30301"],
    needsShipping: true,
  };

  it("tells the seller what to ship and where", () => {
    const email = newSaleEmail(gear);
    expect(email.subject).toBe("New order to ship: Rep the Brand Tee");
    expect(email.text).toContain("Sam bought Rep the Brand Tee (size M) for $55.94.");
    expect(email.text).toContain("Sam Smith\n1 Main St\nAtlanta, GA 30301");
    expect(email.text).toContain("GYMX2's fee is $5.00.");
    expect(email.html).toContain("https://gymx2.com/armory/sales");
  });

  it("skips shipping and fees when not needed", () => {
    const email = newSaleEmail({ ...gear, needsShipping: false, feeCents: 0, size: null, addressLines: [] });
    expect(email.subject).toBe("You made a sale: Rep the Brand Tee");
    expect(email.text).not.toContain("Ship it to");
    expect(email.text).not.toContain("fee");
  });

  it("escapes what people typed", () => {
    const email = newSaleEmail({ ...gear, buyerName: "<script>x</script>" });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });
});

describe("orderShippedEmail", () => {
  it("links to the carrier when it can", () => {
    const email = orderShippedEmail({
      siteUrl,
      itemTitle: "Tee",
      sellerName: "Coach Ken",
      size: "L",
      tracking: "1Z999AA10123456784",
    });
    expect(email.subject).toBe("Your order shipped: Tee");
    expect(email.text).toContain("Coach Ken shipped your Tee (size L).");
    expect(email.text).toContain("Track your package: https://www.ups.com/track?tracknum=1Z999AA10123456784");
  });

  it("works without tracking", () => {
    const email = orderShippedEmail({ siteUrl, itemTitle: "Tee", sellerName: "Ken", size: null, tracking: null });
    expect(email.text).toContain("No tracking number was added.");
    expect(email.text).toContain("https://gymx2.com/armory");
  });
});

describe("newMessageEmail", () => {
  it("quotes the message and links to the conversation", () => {
    const email = newMessageEmail({
      siteUrl,
      senderName: "Coach Ken",
      body: "Great work today.\nSee you Monday.",
      conversationPath: "/messages/abc",
    });
    expect(email.subject).toBe("New message from Coach Ken");
    expect(email.text).toContain("> Great work today.\n> See you Monday.");
    expect(email.text).toContain("https://gymx2.com/messages/abc");
  });

  it("shortens long messages", () => {
    const email = newMessageEmail({ siteUrl, senderName: "Ken", body: "a".repeat(800), conversationPath: "/m" });
    expect(email.text).toContain(`${"a".repeat(499)}…`);
    expect(email.text).not.toContain("a".repeat(500));
  });

  it("keeps the subject on one line", () => {
    const email = newMessageEmail({ siteUrl, senderName: "Ken\nBcc: x", body: "hi", conversationPath: "/m" });
    expect(email.subject).not.toContain("\n");
  });
});

describe("sessionEmail", () => {
  const base = {
    siteUrl,
    coachName: "Coach Ken",
    title: "Leg day",
    when: "Mon, Nov 9, 6:00 PM – 7:00 PM EST",
    location: "Main gym",
    meetingUrl: null,
    sessionId: "s1",
  };

  it("invites with the details and an RSVP link", () => {
    const email = sessionEmail({ ...base, change: "invited" });
    expect(email.subject).toBe("Coach Ken invited you: Leg day");
    expect(email.text).toContain("When: Mon, Nov 9, 6:00 PM – 7:00 PM EST\nWhere: Main gym");
    expect(email.text).toContain("https://gymx2.com/calendar/s1");
  });

  it("says when a session changed", () => {
    expect(sessionEmail({ ...base, change: "updated" }).subject).toBe("Session changed: Leg day");
  });

  it("cancels without asking for an RSVP", () => {
    const email = sessionEmail({ ...base, change: "cancelled", meetingUrl: "https://zoom.us/j/1" });
    expect(email.subject).toBe("Session cancelled: Leg day");
    expect(email.text).not.toContain("Let your coach know");
    expect(email.text).toContain("https://gymx2.com/calendar\n");
  });
});

describe("flaggedMessageEmail", () => {
  it("names who sent it, why, and links to the review", () => {
    const email = flaggedMessageEmail({
      siteUrl,
      coachName: "Coach Ken",
      memberName: "Sam",
      fromCoach: true,
      reasons: "phone number, payment app",
      body: "Venmo me, 404-555-0123",
      reviewPath: "/admin/messages/c/m",
    });
    expect(email.subject).toBe("Flagged message: Coach Ken and Sam");
    expect(email.text).toContain("Coach Ken (coach) sent a message that mentions: phone number, payment app.");
    expect(email.text).toContain("> Venmo me, 404-555-0123");
    expect(email.text).toContain("https://gymx2.com/admin/messages/c/m");
  });
});

describe("refundEmail", () => {
  const base = { siteUrl, itemTitle: "Tee", amountCents: 3500, buyerName: "Sam", orderCancelled: true };

  it("tells the buyer the amount and that nothing will ship", () => {
    const email = refundEmail({ ...base, audience: "buyer" });
    expect(email.subject).toBe("Refund for Tee");
    expect(email.text).toContain("We refunded $35.00 for Tee");
    expect(email.text).toContain("nothing will arrive");
    expect(email.text).toContain("https://gymx2.com/armory/purchases");
  });

  it("tells the seller not to ship a cancelled order", () => {
    const email = refundEmail({ ...base, audience: "seller" });
    expect(email.subject).toBe("Order refunded: Tee");
    expect(email.text).toContain("Please don't send it.");
  });
});

describe("accountDeletedEmail", () => {
  it("confirms the deletion and says what's kept", () => {
    const email = accountDeletedEmail({ siteUrl, name: "Sam" });
    expect(email.subject).toBe("Your GYMX2 account was deleted");
    expect(email.text).toContain("Hi Sam, your GYMX2 account");
    expect(email.text).toContain("without your name attached");
  });
});
