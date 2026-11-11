export const memos = {
  title: "Memos",
  intro: "Keep short notes on your days.",
  introShare:
    "They're private unless you choose to share one with your coaches.",
  introPrivate: "They're private to you.",
  cancelEditing: "Cancel editing",
  loadError: "We couldn't load your Memos. Please refresh and try again.",
  none: "You haven't written a Memo yet.",
  shared: " · Shared with your coaches",
  edit: "Edit",
  confirmDelete: "Delete this Memo? This can't be undone.",
  delete: "Delete",
  deleting: "Deleting...",
  date: "Date",
  editNote: "Edit your note",
  howToday: "How did today go?",
  share: "Share with my coaches",
  shareHint: "Otherwise only you can read this Memo.",
  saving: "Saving...",
  saveChanges: "Save changes",
  save: "Save Memo",
};

export const notificationsPage = {
  title: "Notifications",
  intro:
    "Likes, comments, replies and announcements from the community. Choose what you get in Profile, Notifications.",
  someone: "Someone",
  nothing:
    "Nothing yet. When people like or comment on your posts, you'll see it here.",
  allCaughtUp: "All caught up.",
  unread: (n: number) => `${n} unread`,
  markAllRead: "Mark all read",
  recent: "Recent",
  today: "Today",
  yesterday: "Yesterday",
  unreadTag: " · unread",
  others: (count: number) =>
    count <= 1 ? "" : count === 2 ? " and 1 other" : ` and ${count - 1} others`,
  like: (name: string, others: string) => `${name}${others} liked your post`,
  comment: (who: string) => `${who} commented on your post`,
  progress_reply: (who: string) => `${who} commented on your progress post`,
  reply: (who: string) => `${who} replied to your comment`,
  announcement: (name: string, count: number) =>
    count > 1
      ? `${name} posted ${count} announcements`
      : `${name} posted an announcement`,
  removed: "A post of yours was removed for breaking the community guidelines",
  mention: (who: string) => `${who} mentioned you`,
  message: (who: string) => `${who} sent you a message`,
};
