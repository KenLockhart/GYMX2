export const dashboard = {
  title: "Dashboard",
  welcome: (name: string) => `Welcome, ${name}`,
  intro: {
    member:
      "You're in. Join a coach to start getting Tasks and sessions, and keep daily notes in your Memos.",
    coach:
      "You're set up as a coach. Upload videos to your library, give Tasks to your members and schedule sessions.",
    moderator:
      "You help keep GYMX2 Community safe. Reported posts and comments will appear in your review queue.",
    admin:
      "You manage GYMX2. Review coach requests and member roles from the admin area.",
  } as Record<string, string>,
  checkinTitle: "How did your week go?",
  checkinBody:
    "Your weekly check-in takes a minute. Your coach reads every one.",
  checkinButton: "Check in",
  level: (n: number) => `Level ${n}`,
  streak: "Streak",
  days: (n: number) => (n === 1 ? `${n} day` : `${n} days`),
  thisWeek: "This week",
  challenges: (done: number, total: number) => `${done} / ${total} challenges`,
  newBadges: (n: number) =>
    n > 1 ? "New badges! See your progress" : "New badge! See your progress",
  coachRequestPending: "Your coach request is waiting for admin review.",
  seeTasks: "See your Tasks",
  openCalendar: "Open your calendar",
  visitArmory: "Visit the Armory",
  findCoach: "Find a coach",
  giveTask: "Give a Task",
  uploadVideo: "Upload a video",
  scheduleSession: "Schedule a session",
  addToArmory: "Add to the Armory",
  editProfile: "Edit your profile",
  openAdmin: "Open admin",
};
