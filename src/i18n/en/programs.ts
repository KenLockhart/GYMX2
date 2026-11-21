export const programs = {
  title: "Programs",
  program: "Program",
  introCoach:
    "Build multi-week programs as a series of days. Members who joined you start one, and a new day unlocks each day.",
  introAdmin: "Create GYMX2 programs and manage every coach's programs.",
  introMember:
    "Programs from coaches you joined and GYMX2. A new day unlocks each day; finishing one is +3 points.",
  new: "New program",
  programTitle: "Title",
  titlePlaceholder: "6-Week Strong Start",
  descriptionOptional: "Description (optional)",
  introVideoOptional: "Program intro video (optional)",
  noIntroVideo: "No intro video",
  introVideoHint:
    "Choose a ready video from your own library. Only this selected intro can be previewed by signed-in members who can view the program.",
  programIntro: "Program introduction",
  introVideoUnavailable: "The intro video isn't available to play right now.",
  platform: "GYMX2",
  description: "Description",
  creating: "Creating...",
  create: "Create and add days",
  none: "No programs yet.",
  aCoach: "A coach",
  started: (n: number) => `${n} started`,
  published: "Published",
  draft: "Draft",
  weeks: (dayCount: number) => {
    if (dayCount === 0) return "No days yet";
    const weeks = Math.ceil(dayCount / 7);
    return dayCount < 7
      ? `${dayCount} ${dayCount === 1 ? "day" : "days"}`
      : `${weeks} ${weeks === 1 ? "week" : "weeks"} · ${dayCount} days`;
  },
  yours: "Your programs",
  noneStarted: "You haven't started one yet.",
  dayOf: (day: number, total: number, done: number) =>
    `Day ${day} of ${total} · ${done} done`,
  fromCoaches: "From your coaches",
  availablePrograms: "Available programs",
  noneNew: "No new programs right now.",
  findCoach: "Find a coach",
  starting: "Starting...",
  startToday: "Start today",
  back: "Back to programs",
  publishedHint: "Members who joined you can see and start it.",
  publishedPlatformHint:
    "Members can find and start this GYMX2 program in the signed-in Programs area.",
  saving: "Saving...",
  saveProgram: "Save program",
  days: (label: string) => `Days · ${label}`,
  dayTitle: (n: number, title: string) => `Day ${n}: ${title}`,
  confirmRemoveDay: (n: number) => `Remove day ${n}?`,
  removing: "Removing...",
  remove: "Remove",
  edit: "Edit",
  addDayN: (n: number) => `Add day ${n}`,
  day: "Day",
  dayTitlePlaceholder: "Full-body strength",
  pillar: "Pillar",
  choose: "Choose",
  instructions: "Instructions",
  videoOptional: "Video (optional)",
  noVideo: "No video",
  saveDay: "Save day",
  addDay: "Add day",
  membersOn: "Members on this program",
  nobody: "Nobody has started it yet.",
  aMember: "A member",
  memberProgress: (day: number, done: number, total: number, percent: number) =>
    `Day ${day} · ${done} of ${total} done (${percent}%)`,
  confirmDelete: (title: string) =>
    `Delete "${title}"? Members lose their progress on it.`,
  deleting: "Deleting...",
  delete: "Delete program",
  byCoach: (coach: string) => `Program · ${coach}`,
  yourCoach: "your coach",
  daysDone: (done: number, total: number) => `${done} of ${total} days done`,
  currentProgress: (done: number, total: number) =>
    `Current version · ${done} of ${total} lessons done`,
  historyProgress: (count: number) =>
    `${count} lessons completed in saved history`,
  upNext: (n: number) => `Up next: day ${n}`,
  caughtUp: "You're caught up",
  watch: (title: string) => `Watch: ${title}`,
  theVideo: "the video",
  unlocks: (date: string) => `Unlocks ${date}`,
  undo: "Undo",
  markDone: "Mark done",
  confirmLeave: (title: string) =>
    `Leave "${title}"? Your progress on it will be lost.`,
  leaving: "Leaving...",
  leave: "Leave program",
};
