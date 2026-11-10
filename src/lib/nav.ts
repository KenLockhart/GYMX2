// What each role sees in the top bar, the profile menu and the Admin Console sidebar. Icons are
// named here and drawn by the components, so this file works on the server and in tests.

export type Role = "member" | "coach" | "moderator" | "admin";

export type IconName =
  | "dashboard"
  | "tasks"
  | "calendar"
  | "library"
  | "armory"
  | "community"
  | "programs"
  | "coaches"
  | "members"
  | "messages"
  | "memos"
  | "groups"
  | "checkin"
  | "track"
  | "progress"
  | "profile"
  | "coachProfile"
  | "memberships"
  | "insights"
  | "reports"
  | "admin"
  | "affiliate"
  | "purchases"
  | "notifications"
  | "overview"
  | "users"
  | "affiliates"
  | "credentials"
  | "weights"
  | "reviews"
  | "conversations"
  | "emails"
  | "leaderboard"
  | "sales";

export type NavItem = { href: string; label: string; icon: IconName };
export type NavGroup = { title: string; items: NavItem[] };

const item = (href: string, label: string, icon: IconName): NavItem => ({
  href,
  label,
  icon,
});

// The top bar: the handful of places each role visits most.
export function primaryNav(role: Role): NavItem[] {
  const start = [
    item("/dashboard", "Dashboard", "dashboard"),
    item("/tasks", "Tasks", "tasks"),
    item("/calendar", "Calendar", "calendar"),
    item("/library", "Library", "library"),
  ];
  const end = [
    item("/community", "Community", "community"),
    item("/programs", "Programs", "programs"),
  ];
  if (role === "coach")
    return [
      ...start,
      item("/members", "Members", "members"),
      item("/armory", "Armory", "armory"),
      ...end,
    ];
  if (role === "admin")
    return [...start, item("/armory", "Armory", "armory"), ...end];
  return [
    ...start,
    item("/coaches", "Coaches", "coaches"),
    item("/armory", "Armory", "armory"),
    ...end,
  ];
}

// Everything else, grouped in the profile menu.
export function menuGroups(role: Role): NavGroup[] {
  const account: NavGroup = {
    title: "Account",
    items: [
      item("/profile", "Profile and settings", "profile"),
      item("/notifications", "Notifications", "notifications"),
      ...(role === "admin"
        ? []
        : [item("/armory/purchases", "Purchases", "purchases")]),
      ...(role === "admin"
        ? []
        : [item("/affiliate", "Affiliate program", "affiliate")]),
    ],
  };
  if (role === "admin")
    return [
      {
        title: "Admin",
        items: [
          item("/admin", "Admin Console", "admin"),
          item("/moderation", "Community reports", "reports"),
        ],
      },
      {
        title: "More",
        items: [
          item("/groups", "Coach communities", "groups"),
          item("/memos", "Memos", "memos"),
        ],
      },
      account,
    ];
  if (role === "coach")
    return [
      {
        title: "Coaching",
        items: [
          item("/profile/coach", "Coach profile", "coachProfile"),
          item("/plans", "Memberships", "memberships"),
          item("/insights", "Insights", "insights"),
          item("/checkins", "Check-ins", "checkin"),
          item("/groups", "My community", "groups"),
          item("/moderation", "Reports", "reports"),
        ],
      },
      {
        title: "More",
        items: [
          item("/memos", "Memos", "memos"),
          item("/track", "Track", "track"),
          item("/progress", "Progress", "progress"),
        ],
      },
      account,
    ];
  return [
    {
      title: "Your training",
      items: [
        item("/checkin", "Weekly check-in", "checkin"),
        item("/track", "Track", "track"),
        item("/progress", "Progress", "progress"),
        item("/memos", "Memos", "memos"),
        item("/groups", "Coach communities", "groups"),
      ],
    },
    ...(role === "moderator"
      ? [
          {
            title: "Moderation",
            items: [item("/moderation", "Reports", "reports")],
          },
        ]
      : []),
    account,
  ];
}

// Messages live beside the bell. Admins review conversations instead of sending messages.
export function messagesHref(role: Role) {
  return role === "admin" ? "/admin/messages" : "/messages";
}

// The Admin Console sidebar.
export const ADMIN_NAV: { overview: NavItem; groups: NavGroup[] } = {
  overview: item("/admin", "Overview", "overview"),
  groups: [
    {
      title: "People",
      items: [
        item("/admin/users", "Members and roles", "users"),
        item("/admin/affiliates", "Affiliates", "affiliates"),
        item("/admin/coach-profiles", "Coach profiles", "coachProfile"),
        item("/admin/credentials", "Credentials", "credentials"),
      ],
    },
    {
      title: "Operations",
      items: [
        item("/admin/matching", "Match weights", "weights"),
        item("/admin/reviews", "Reviews", "reviews"),
        item("/admin/messages", "Conversations", "conversations"),
        item("/admin/emails", "Emails", "emails"),
      ],
    },
    {
      title: "Insights and reports",
      items: [
        item("/admin/leaderboard", "Leaderboard", "leaderboard"),
        item("/insights", "Coach insights", "insights"),
        item("/admin/reports", "Review and coach reports", "reports"),
        item("/moderation", "Community reports", "community"),
      ],
    },
    {
      title: "Commerce",
      items: [item("/armory/sales", "Armory sales", "sales")],
    },
  ],
};

// Whether a link is the current page: exact for the dashboard-style roots, otherwise the section.
export function isActive(pathname: string, href: string) {
  if (href === "/admin" || href === "/dashboard" || href === "/profile")
    return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

// Every destination for a role, for search.
export function allDestinations(role: Role): NavItem[] {
  const seen = new Set<string>();
  const list = [
    ...primaryNav(role),
    item(
      messagesHref(role),
      role === "admin" ? "Review conversations" : "Messages",
      "messages",
    ),
    ...menuGroups(role).flatMap((g) => g.items),
    ...(role === "admin"
      ? [ADMIN_NAV.overview, ...ADMIN_NAV.groups.flatMap((g) => g.items)]
      : []),
  ];
  return list.filter((entry) =>
    seen.has(entry.href) ? false : (seen.add(entry.href), true),
  );
}

export function initials(name: string) {
  const words = name
    .replace(/^Coach\s+/i, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return (
    (
      (words[0]?.[0] ?? "") +
      (words.length > 1 ? words[words.length - 1][0] : "")
    ).toUpperCase() || "?"
  );
}
