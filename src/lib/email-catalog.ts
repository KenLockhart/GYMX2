// Every automatic email GYMX2 sends, for the admin email editor. Each entry builds a sample
// with example details so admins can preview their wording.
import {
  accountDeletedEmail,
  affiliateDecisionEmail,
  affiliatePayoutEmail,
  checkinReminderEmail,
  communityEmail,
  flaggedMessageEmail,
  liveNowEmail,
  membershipChangeEmail,
  newMessageEmail,
  newSaleEmail,
  orderShippedEmail,
  refundEmail,
  sessionEmail,
  sessionReminderEmail,
  streakReminderEmail,
  taskDueEmail,
  weeklyDigestEmail,
  type Email,
} from "./email-templates";

export type EmailGroup =
  | "Orders"
  | "Messages"
  | "Community"
  | "Sessions"
  | "Reminders"
  | "Memberships"
  | "Affiliates"
  | "Account";

export type CatalogEntry = {
  key: string;
  name: string;
  group: EmailGroup;
  to: string;
  when: string;
  // Optional emails can be turned off entirely; order, safety and account emails always send.
  optional: boolean;
  sample: (siteUrl: string) => Email;
};

const session = {
  coachName: "Coach Ken",
  title: "Saturday HIIT",
  when: "Sat, Nov 14 · 9:00–10:00 AM ET",
  location: "Lake Eola Park",
  meetingUrl: null,
  sessionId: "sample",
};

export const EMAIL_CATALOG: CatalogEntry[] = [
  {
    key: "sale.ship",
    name: "New order to ship",
    group: "Orders",
    to: "Seller (coach or admin)",
    when: "Someone buys gear that needs shipping",
    optional: false,
    sample: (siteUrl) =>
      newSaleEmail({
        siteUrl,
        itemTitle: "Rep the Brand Tee",
        buyerName: "Jordan Smith",
        amountCents: 4995,
        feeCents: 500,
        size: "L",
        shippingName: "Jordan Smith",
        addressLines: ["123 Main St", "Orlando, FL 32801"],
        needsShipping: true,
      }),
  },
  {
    key: "sale.digital",
    name: "You made a sale",
    group: "Orders",
    to: "Seller (coach or admin)",
    when: "Someone buys a digital item or link",
    optional: false,
    sample: (siteUrl) =>
      newSaleEmail({
        siteUrl,
        itemTitle: "12-Week Meal Plan",
        buyerName: "Jordan Smith",
        amountCents: 1999,
        feeCents: 200,
        size: null,
        shippingName: null,
        addressLines: [],
        needsShipping: false,
      }),
  },
  {
    key: "order.shipped",
    name: "Your order shipped",
    group: "Orders",
    to: "Buyer",
    when: "The seller marks gear as shipped",
    optional: false,
    sample: (siteUrl) =>
      orderShippedEmail({
        siteUrl,
        itemTitle: "Rep the Brand Tee",
        sellerName: "Coach Ken",
        size: "L",
        tracking: "1Z999AA10123456784",
      }),
  },
  {
    key: "refund.buyer",
    name: "Refund (to buyer)",
    group: "Orders",
    to: "Buyer",
    when: "An order is refunded",
    optional: false,
    sample: (siteUrl) =>
      refundEmail({
        siteUrl,
        audience: "buyer",
        itemTitle: "Rep the Brand Tee",
        amountCents: 4995,
        buyerName: "Jordan Smith",
        orderCancelled: true,
      }),
  },
  {
    key: "refund.seller",
    name: "Order refunded (to seller)",
    group: "Orders",
    to: "Seller",
    when: "An order is refunded",
    optional: false,
    sample: (siteUrl) =>
      refundEmail({
        siteUrl,
        audience: "seller",
        itemTitle: "Rep the Brand Tee",
        amountCents: 4995,
        buyerName: "Jordan Smith",
        orderCancelled: true,
      }),
  },
  {
    key: "message.new",
    name: "New message",
    group: "Messages",
    to: "Coach or member",
    when: "The first unread message in a conversation (if they get updates)",
    optional: true,
    sample: (siteUrl) =>
      newMessageEmail({
        siteUrl,
        senderName: "Coach Ken",
        body: "Great work this week! Ready for Saturday?",
        conversationPath: "/messages",
      }),
  },
  {
    key: "community.comment",
    name: "Comment on your post",
    group: "Community",
    to: "The post's author, if they chose email",
    when: "Someone comments on their post (off by default)",
    optional: true,
    sample: (siteUrl) =>
      communityEmail({
        siteUrl,
        type: "comment",
        actorName: "Jordan Smith",
        snippet: "This is awesome, great form on that last set!",
        link: "/community/post/sample",
      }),
  },
  {
    key: "community.reply",
    name: "Reply to your comment",
    group: "Community",
    to: "The comment's author, if they chose email",
    when: "Someone replies to their comment (off by default)",
    optional: true,
    sample: (siteUrl) =>
      communityEmail({
        siteUrl,
        type: "reply",
        actorName: "Jordan Smith",
        snippet: "Same here, let's go!",
        link: "/community/post/sample",
      }),
  },
  {
    key: "community.progress_reply",
    name: "Comment on your progress",
    group: "Community",
    to: "The progress post's author, if they chose email",
    when: "Someone comments on their progress post (off by default)",
    optional: true,
    sample: (siteUrl) =>
      communityEmail({
        siteUrl,
        type: "progress_reply",
        actorName: "Coach Ken",
        snippet: "Huge difference since September. Proud of you.",
        link: "/community/post/sample",
      }),
  },
  {
    key: "community.like",
    name: "Likes on your post",
    group: "Community",
    to: "The post's author, if they chose email",
    when: "The first new like on a post since they last checked (off by default)",
    optional: true,
    sample: (siteUrl) =>
      communityEmail({
        siteUrl,
        type: "like",
        actorName: "Jordan Smith",
        snippet: "",
        link: "/community/post/sample",
      }),
  },
  {
    key: "community.announcement",
    name: "Coach announcement",
    group: "Community",
    to: "Members of the coach's community",
    when: "Their coach posts an announcement (on by default)",
    optional: true,
    sample: (siteUrl) =>
      communityEmail({
        siteUrl,
        type: "announcement",
        actorName: "Coach Ken",
        snippet:
          "New 6-week strength challenge starts Monday. Check-ins every Friday.",
        link: "/community/post/sample",
      }),
  },
  {
    key: "community.removed",
    name: "Post or comment removed",
    group: "Community",
    to: "The author",
    when: "A moderator, coach or admin removes their post or comment (on by default)",
    optional: true,
    sample: (siteUrl) =>
      communityEmail({
        siteUrl,
        type: "removed",
        actorName: "GYMX2",
        snippet: "Sharing a payment link",
        link: "/community",
      }),
  },
  {
    key: "message.flagged",
    name: "Flagged message",
    group: "Messages",
    to: "Admins",
    when: "A message mentions phone numbers, emails or payment apps",
    optional: false,
    sample: (siteUrl) =>
      flaggedMessageEmail({
        siteUrl,
        coachName: "Coach Ken",
        memberName: "Jordan Smith",
        fromCoach: true,
        reasons: "a phone number",
        body: "Text me at 555-0100 and we'll sort it out.",
        reviewPath: "/admin/messages",
      }),
  },
  {
    key: "session.invited",
    name: "Session invitation",
    group: "Sessions",
    to: "Invited members",
    when: "A coach adds them to a session",
    optional: true,
    sample: (siteUrl) =>
      sessionEmail({ siteUrl, change: "invited", ...session }),
  },
  {
    key: "session.updated",
    name: "Session changed",
    group: "Sessions",
    to: "Invited members",
    when: "A coach changes a session's time or place",
    optional: true,
    sample: (siteUrl) =>
      sessionEmail({ siteUrl, change: "updated", ...session }),
  },
  {
    key: "session.cancelled",
    name: "Session cancelled",
    group: "Sessions",
    to: "Invited members",
    when: "A coach cancels a session",
    optional: true,
    sample: (siteUrl) =>
      sessionEmail({ siteUrl, change: "cancelled", ...session }),
  },
  {
    key: "live.now",
    name: "Coach is live",
    group: "Sessions",
    to: "Invited members",
    when: "A coach starts a live session",
    optional: true,
    sample: (siteUrl) =>
      liveNowEmail({
        siteUrl,
        name: "Jordan",
        coachName: "Coach Ken",
        title: "Saturday HIIT",
        sessionId: "sample",
      }),
  },
  {
    key: "reminder.session",
    name: "Session tomorrow",
    group: "Reminders",
    to: "Members going to a session",
    when: "Each morning, for sessions the next day",
    optional: true,
    sample: (siteUrl) =>
      sessionReminderEmail({
        siteUrl,
        name: "Jordan",
        sessions: [
          {
            id: "sample",
            title: "Saturday HIIT",
            when: session.when,
            where: session.location,
            coachName: "Coach Ken",
          },
        ],
      }),
  },
  {
    key: "reminder.task",
    name: "Task due tomorrow",
    group: "Reminders",
    to: "Members",
    when: "Each morning, for Tasks due the next day",
    optional: true,
    sample: (siteUrl) =>
      taskDueEmail({
        siteUrl,
        name: "Jordan",
        tasks: [{ title: "20-minute mobility flow", coachName: "Coach Ken" }],
      }),
  },
  {
    key: "reminder.streak",
    name: "Streak about to end",
    group: "Reminders",
    to: "Members and coaches",
    when: "Evenings, when a streak of 3+ days hasn't been kept up today",
    optional: true,
    sample: (siteUrl) =>
      streakReminderEmail({ siteUrl, name: "Jordan", days: 5, coach: false }),
  },
  {
    key: "reminder.checkin",
    name: "Weekly check-in",
    group: "Reminders",
    to: "Members with a coach",
    when: "Sunday evening, if they haven't checked in that week",
    optional: true,
    sample: (siteUrl) => checkinReminderEmail({ siteUrl, name: "Jordan" }),
  },
  {
    key: "digest.weekly",
    name: "Weekly summary",
    group: "Reminders",
    to: "Members and coaches",
    when: "Monday mornings",
    optional: true,
    sample: (siteUrl) =>
      weeklyDigestEmail({
        siteUrl,
        name: "Jordan",
        level: "Regular",
        points: 182,
        toNext: 218,
        nextLevel: "Athlete",
        streak: 6,
        lastWeekDone: 2,
        challengeCount: 3,
        newBadges: ["First Steps"],
        challenges: ["Finish 3 Tasks", "Check in 5 days", "Go to a session"],
        upcoming: ["Sat, Nov 14: Saturday HIIT"],
      }),
  },
  {
    key: "membership.started",
    name: "New subscriber",
    group: "Memberships",
    to: "Coach",
    when: "A member starts a membership",
    optional: false,
    sample: (siteUrl) =>
      membershipChangeEmail({
        siteUrl,
        change: "started",
        memberName: "Jordan Smith",
        planName: "Premium",
        priceCents: 4900,
        trial: true,
      }),
  },
  {
    key: "membership.ended",
    name: "Membership ended",
    group: "Memberships",
    to: "Coach",
    when: "A membership ends",
    optional: false,
    sample: (siteUrl) =>
      membershipChangeEmail({
        siteUrl,
        change: "ended",
        memberName: "Jordan Smith",
        planName: "Premium",
        priceCents: 4900,
        trial: false,
      }),
  },
  {
    key: "affiliate.approved",
    name: "Affiliate approved",
    group: "Affiliates",
    to: "Applicant",
    when: "An admin approves an affiliate",
    optional: false,
    sample: (siteUrl) =>
      affiliateDecisionEmail({
        siteUrl,
        name: "Jordan",
        approved: true,
        link: `${siteUrl}/r/JORDAN`,
        terms: [
          "You earn 10% of Armory sales",
          "A bonus when someone you refer makes their first purchase",
        ],
      }),
  },
  {
    key: "affiliate.declined",
    name: "Affiliate declined",
    group: "Affiliates",
    to: "Applicant",
    when: "An admin declines an affiliate",
    optional: false,
    sample: (siteUrl) =>
      affiliateDecisionEmail({
        siteUrl,
        name: "Jordan",
        approved: false,
        link: "",
        terms: [],
      }),
  },
  {
    key: "affiliate.payout",
    name: "Affiliate payout",
    group: "Affiliates",
    to: "Affiliate",
    when: "Commissions are paid out",
    optional: false,
    sample: (siteUrl) =>
      affiliatePayoutEmail({
        siteUrl,
        name: "Jordan",
        amountCents: 2450,
        count: 4,
      }),
  },
  {
    key: "account.deleted",
    name: "Account deleted",
    group: "Account",
    to: "The person who deleted their account",
    when: "Someone deletes their account",
    optional: false,
    sample: (siteUrl) => accountDeletedEmail({ siteUrl, name: "Jordan" }),
  },
];

export const EMAIL_GROUPS: EmailGroup[] = [
  "Orders",
  "Messages",
  "Community",
  "Sessions",
  "Reminders",
  "Memberships",
  "Affiliates",
  "Account",
];

export function catalogEntry(key: string) {
  return EMAIL_CATALOG.find((entry) => entry.key === key) ?? null;
}
