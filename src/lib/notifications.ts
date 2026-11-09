// Wording and grouping for the notification center. Shared by the server and the browser.

export type NotificationType =
  | "like"
  | "comment"
  | "reply"
  | "announcement"
  | "progress_reply"
  | "removed"
  | "message"
  | "mention";

export type NotificationDTO = {
  id: string;
  type: NotificationType;
  actorName: string;
  count: number;
  link: string;
  read: boolean;
  updatedAt: string;
};

// The settings people can change, and which channels apply to each.
export const NOTIFICATION_SETTINGS: {
  type: NotificationType;
  label: string;
  hint: string;
  inApp: boolean;
  push: boolean;
  defaultPush: boolean;
}[] = [
  {
    type: "comment",
    label: "Comments on your posts",
    hint: "",
    inApp: true,
    push: true,
    defaultPush: true,
  },
  {
    type: "reply",
    label: "Replies to your comments",
    hint: "",
    inApp: true,
    push: true,
    defaultPush: true,
  },
  {
    type: "progress_reply",
    label: "Comments on your progress posts",
    hint: "",
    inApp: true,
    push: true,
    defaultPush: true,
  },
  {
    type: "announcement",
    label: "Your coaches' announcements",
    hint: "",
    inApp: true,
    push: true,
    defaultPush: true,
  },
  {
    type: "like",
    label: "Likes on your posts",
    hint: "Grouped, so a popular post sends one.",
    inApp: true,
    push: true,
    defaultPush: false,
  },
  {
    type: "removed",
    label: "A post of yours was removed",
    hint: "With the reason, when one was given.",
    inApp: true,
    push: true,
    defaultPush: false,
  },
  {
    type: "message",
    label: "Direct messages",
    hint: "Unread messages also show on Messages in the menu.",
    inApp: false,
    push: true,
    defaultPush: true,
  },
];

const others = (count: number) =>
  count <= 1 ? "" : count === 2 ? " and 1 other" : ` and ${count - 1} others`;

export function describeNotification(
  n: Pick<NotificationDTO, "type" | "actorName" | "count">,
) {
  const who = `${n.actorName}${others(n.count)}`;
  switch (n.type) {
    case "like":
      return `${who} liked your post`;
    case "comment":
      return `${who} commented on your post`;
    case "progress_reply":
      return `${who} commented on your progress post`;
    case "reply":
      return `${who} replied to your comment`;
    case "announcement":
      return n.count > 1
        ? `${n.actorName} posted ${n.count} announcements`
        : `${n.actorName} posted an announcement`;
    case "removed":
      return "A post of yours was removed for breaking the community guidelines";
    case "mention":
      return `${who} mentioned you`;
    case "message":
      return `${who} sent you a message`;
  }
}

// Today, Yesterday, then dates, in the order given (newest first).
export function groupByDay<T extends { updatedAt: string }>(
  items: T[],
  now = new Date(),
) {
  const key = (date: Date) => date.toDateString();
  const today = key(now);
  const yesterday = key(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const groups: { label: string; items: T[] }[] = [];
  for (const item of items) {
    const date = new Date(item.updatedAt);
    const label =
      key(date) === today
        ? "Today"
        : key(date) === yesterday
          ? "Yesterday"
          : date.toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              ...(date.getFullYear() === now.getFullYear()
                ? {}
                : { year: "numeric" }),
            });
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

// Notification links are written by the server, but they're checked before following anyway.
export function safeLink(link: string) {
  return /^\/(?!\/)[\w\-/?=&#.%]*$/.test(link) ? link : "/community";
}
