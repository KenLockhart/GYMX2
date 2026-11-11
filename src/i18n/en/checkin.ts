export const checkin = {
  title: "Weekly check-in",
  intro: (week: string) =>
    `A minute to tell your coaches how your week went. Only you and the coaches you've joined see it. Week of ${week}.`,
  joinFirst: "Join a coach first and your check-ins will go to them.",
  findCoach: "Find a coach",
  alreadyDone:
    "You've checked in this week. You can still change it until Sunday.",
  scales: {
    energy: { label: "Energy", low: "Drained", high: "Full of energy" },
    sleep: { label: "Sleep", low: "Poor", high: "Great" },
    stress: { label: "Stress", low: "Calm", high: "Overwhelmed" },
    motivation: { label: "Motivation", low: "Struggling", high: "Fired up" },
  } as Record<string, { label: string; low: string; high: string }>,
  wins: "Wins this week",
  hard: "What was hard",
  question: "A question for your coach (optional)",
  saving: "Saving...",
  update: "Update check-in",
  submit: "Check in",
  past: "Past check-ins",
  weekOf: (week: string) => `Week of ${week}`,
  winsLine: (text: string) => `Wins: ${text}`,
  hardLine: (text: string) => `Hard: ${text}`,
  askedLine: (text: string) => `You asked: ${text}`,
  yourCoach: "Your coach",
};

export const progress = {
  title: "Your progress",
  intro:
    "Only you and GYMX2 admins see your points, level and streak. Everyone can see your badges.",
  newBadges: (n: number) => (n > 1 ? "New badges:" : "New badge:"),
  level: (n: number) => `Level ${n}`,
  toNextLevel: "Progress to the next level",
  points: (n: number) => `${n} points`,
  toNext: (points: number, next: string) => `${points} to ${next}`,
  topLevel: "Top level reached",
  streak: "Streak",
  days: (n: number) => (n === 1 ? `${n} day` : `${n} days`),
  best: (days: string) => `Best: ${days}`,
  keepGoing: " · Do something today to keep it going",
  streakCoach:
    "Counts days you publish videos, give Tasks, schedule sessions or message members.",
  streakMember:
    "Counts days you finish a Task, write a Memo, RSVP to a session or message your coach.",
  challenges: "This week's challenges",
  challengesStatus: (done: number, total: number) =>
    `${done} of ${total} done · Resets Monday · Finish all four for ⚔️ Weekly Warrior`,
  done: "Done ✓",
  badges: "Badges",
  earnedCount: (earned: number, total: number) =>
    `${earned} of ${total} earned`,
  earned: (date: string) => `Earned ${date}`,
  share: "Share",
  howPoints: "How points work",
  pointsCoach:
    "Video published 3 · new member joins you 3 · session scheduled 2 · Task given 1 · message sent 1.",
  pointsMember:
    "Task finished 3 · session RSVP 2 · message sent 1 · Memo written 1.",
  levels: "Levels:",
  goTasks: "Go to your Tasks",
};
