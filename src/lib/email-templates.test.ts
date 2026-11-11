import { describe, expect, it } from "vitest";
import {
  customizeEmail,
  communityEmail,
  accountDeletedEmail,
  escapeHtml,
  flaggedMessageEmail,
  refundEmail,
  sessionReminderEmail,
  streakReminderEmail,
  taskDueEmail,
  weeklyDigestEmail,
  newMessageEmail,
  newSaleEmail,
  orderShippedEmail,
  sessionEmail,
  trackingUrl,
} from "./email-templates";

const siteUrl = "https://gymx2.com";

describe("escapeHtml", () => {
  it("escapes markup", () => {
    expect(escapeHtml(`<b>"Tom" & 'Jo'</b>`)).toBe(
      "&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jo&#39;&lt;/b&gt;",
    );
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
    expect(email.text).toContain(
      "Sam bought Rep the Brand Tee (size M) for $55.94.",
    );
    expect(email.text).toContain("Sam Smith\n1 Main St\nAtlanta, GA 30301");
    expect(email.text).toContain("GYMX2's fee is $5.00.");
    expect(email.html).toContain("https://gymx2.com/armory/sales");
  });

  it("skips shipping and fees when not needed", () => {
    const email = newSaleEmail({
      ...gear,
      needsShipping: false,
      feeCents: 0,
      size: null,
      addressLines: [],
    });
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
    expect(email.text).toContain(
      "Track your package: https://www.ups.com/track?tracknum=1Z999AA10123456784",
    );
  });

  it("works without tracking", () => {
    const email = orderShippedEmail({
      siteUrl,
      itemTitle: "Tee",
      sellerName: "Ken",
      size: null,
      tracking: null,
    });
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
    const email = newMessageEmail({
      siteUrl,
      senderName: "Ken",
      body: "a".repeat(800),
      conversationPath: "/m",
    });
    expect(email.text).toContain(`${"a".repeat(499)}…`);
    expect(email.text).not.toContain("a".repeat(500));
  });

  it("keeps the subject on one line", () => {
    const email = newMessageEmail({
      siteUrl,
      senderName: "Ken\nBcc: x",
      body: "hi",
      conversationPath: "/m",
    });
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
    expect(email.text).toContain(
      "When: Mon, Nov 9, 6:00 PM – 7:00 PM EST\nWhere: Main gym",
    );
    expect(email.text).toContain("https://gymx2.com/calendar/s1");
  });

  it("says when a session changed", () => {
    expect(sessionEmail({ ...base, change: "updated" }).subject).toBe(
      "Session changed: Leg day",
    );
  });

  it("cancels without asking for an RSVP", () => {
    const email = sessionEmail({
      ...base,
      change: "cancelled",
      meetingUrl: "https://zoom.us/j/1",
    });
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
    expect(email.text).toContain(
      "Coach Ken (coach) sent a message that mentions: phone number, payment app.",
    );
    expect(email.text).toContain("> Venmo me, 404-555-0123");
    expect(email.text).toContain("https://gymx2.com/admin/messages/c/m");
  });
});

describe("refundEmail", () => {
  const base = {
    siteUrl,
    itemTitle: "Tee",
    amountCents: 3500,
    buyerName: "Sam",
    orderCancelled: true,
  };

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

describe("reminder emails", () => {
  it("reminds about one session by name", () => {
    const email = sessionReminderEmail({
      siteUrl,
      name: "Sam",
      sessions: [
        {
          id: "s1",
          title: "Leg day",
          when: "Tue, Nov 10, 7:00 AM EST",
          where: "Main gym",
          coachName: "Ken",
        },
      ],
    });
    expect(email.subject).toBe("Tomorrow: Leg day");
    expect(email.text).toContain(
      "Leg day with Ken\nTue, Nov 10, 7:00 AM EST\nMain gym",
    );
    expect(email.text).toContain("https://gymx2.com/calendar/s1");
  });

  it("counts several Tasks", () => {
    const email = taskDueEmail({
      siteUrl,
      name: "Sam",
      tasks: [
        { title: "Squats", coachName: "Ken" },
        { title: "Breathwork", coachName: "Ken" },
      ],
    });
    expect(email.subject).toBe("2 Tasks are due tomorrow");
    expect(email.text).toContain("Squats (from Ken)\nBreathwork (from Ken)");
  });

  it("nudges a streak", () => {
    expect(
      streakReminderEmail({ siteUrl, name: "Sam", days: 6, coach: false })
        .subject,
    ).toBe("🔥 Keep your 6-day streak alive");
  });

  it("sums up the week", () => {
    const email = weeklyDigestEmail({
      siteUrl,
      name: "Sam",
      level: "Warrior",
      points: 180,
      toNext: 220,
      nextLevel: "Elite",
      streak: 4,
      lastWeekDone: 3,
      challengeCount: 4,
      newBadges: ["💪 Strong Body"],
      challenges: ["Finish 3 Tasks"],
      upcoming: ["Leg day · Tue, Nov 10, 7:00 AM EST"],
    });
    expect(email.text).toContain(
      "last week you finished 3 of 4 challenges. New badges: 💪 Strong Body.",
    );
    expect(email.text).toContain("Level: Warrior (180 points, 220 to Elite)");
    expect(email.text).toContain("Coming up:");
  });
});

describe("admin email wording", () => {
  it("rewords subject, heading, opening, button and adds a note with placeholders", async () => {
    const { checkinReminderEmail, customizeEmail } =
      await import("./email-templates");
    const original = checkinReminderEmail({
      siteUrl: "https://gymx2.com",
      name: "Jordan",
    });
    expect(original.key).toBe("reminder.checkin");
    const custom = customizeEmail(original, {
      subject: "{name}, how was your week?",
      heading: "",
      intro: "Hey {name}! Two minutes, then back to life. {unknown}",
      button_label: "Do my check-in",
      note: "Reply to your coach if anything's up.",
    });
    expect(custom.subject).toBe("Jordan, how was your week?");
    expect(custom.html).toContain("Time for your weekly check-in");
    expect(custom.html).toContain(
      "Hey Jordan! Two minutes, then back to life. {unknown}",
    );
    expect(custom.html).not.toContain("take a minute to rate");
    expect(custom.html).toContain("Do my check-in");
    expect(custom.text).toContain(
      "Reply to your coach if anything&#39;s up.".replace("&#39;", "'"),
    );
    expect(custom.html).toContain("https://gymx2.com/checkin");
  });

  it("escapes admin text and keeps defaults when nothing is set", async () => {
    const { liveNowEmail, customizeEmail } = await import("./email-templates");
    const original = liveNowEmail({
      siteUrl: "https://gymx2.com",
      name: "J",
      coachName: "Ken",
      title: "HIIT",
      sessionId: "s",
    });
    expect(customizeEmail(original, null)).toBe(original);
    const custom = customizeEmail(original, {
      heading: "<b>Live</b>",
      subject: "",
      intro: "",
      button_label: "",
      note: "",
    });
    expect(custom.html).toContain("&lt;b&gt;Live&lt;/b&gt;");
    expect(custom.subject).toBe(original.subject);
  });
});

describe("email catalog", () => {
  it("has a sample for every automatic email and every key is unique", async () => {
    const { EMAIL_CATALOG } = await import("./email-catalog");
    const keys = EMAIL_CATALOG.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const entry of EMAIL_CATALOG) {
      expect(entry.sample("https://gymx2.com").key).toBe(entry.key);
    }
  });
});

describe("communityEmail", () => {
  const base = {
    siteUrl: "https://gymx2.com",
    actorName: "Jordan <b>",
    link: "/community/post/abc",
  };

  it("words each type and links to the post", () => {
    const comment = communityEmail({
      ...base,
      type: "comment",
      snippet: "Nice work",
    });
    expect(comment.key).toBe("community.comment");
    expect(comment.subject).toBe("Jordan <b> commented on your post");
    expect(comment.html).toContain("https://gymx2.com/community/post/abc");
    expect(comment.text).toContain("> Nice work");
    expect(
      communityEmail({ ...base, type: "reply", snippet: "" }).subject,
    ).toContain("replied to your comment");
    expect(
      communityEmail({ ...base, type: "announcement", snippet: "Hi" }).subject,
    ).toBe("New announcement from Jordan <b>");
    expect(communityEmail({ ...base, type: "like", snippet: "" }).key).toBe(
      "community.like",
    );
  });

  it("escapes names and text in the HTML", () => {
    const email = communityEmail({
      ...base,
      type: "comment",
      snippet: "<script>x</script>",
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("Jordan <b>");
    expect(email.html).toContain("Jordan &lt;b&gt;");
  });

  it("shows a removal reason and never names who removed it", () => {
    const email = communityEmail({
      ...base,
      actorName: "Mod Mia",
      type: "removed",
      snippet: "Spam link",
    });
    expect(email.text).toContain("Reason: Spam link");
    expect(email.text).not.toContain("Mod Mia");
    expect(email.html).toContain("https://gymx2.com/terms");
  });

  it("can be reworded by admins with the actor's name", () => {
    const email = customizeEmail(
      communityEmail({ ...base, type: "comment", snippet: "Hey" }),
      {
        subject: "{name} said something",
      },
    );
    expect(email.subject).toBe("Jordan <b> said something");
  });
});

describe("emails in Spanish", () => {
  it("writes the whole email in the recipient's language", () => {
    const email = newMessageEmail({
      locale: "es",
      siteUrl: "https://gymx2.com",
      senderName: "Ana",
      body: "Hola",
      conversationPath: "/messages/x",
    });
    expect(email.subject).toBe("Nuevo mensaje de Ana");
    expect(email.text).toContain("Ana te envió un mensaje");
    expect(email.text).toContain("Responder en GYMX2");
    expect(email.locale).toBe("es");
  });

  it("stays in English by default", () => {
    const email = newMessageEmail({
      siteUrl: "https://gymx2.com",
      senderName: "Ana",
      body: "Hi",
      conversationPath: "/messages/x",
    });
    expect(email.subject).toBe("New message from Ana");
  });
});
