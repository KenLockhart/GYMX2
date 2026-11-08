// Gamification: points, levels, streaks, weekly challenges and badges.
// Everything here is worked out from dates and counts, so it's easy to test and never reads content.

import { localDayKey } from "./calendar";
import { COACH_POINTS, MEMBER_POINTS } from "./leaderboard";

// Days, streaks and weeks follow Eastern time, so "today" matches the site's home time zone.
export const GAME_TIME_ZONE = "America/New_York";

export const PILLARS = [
  { value: "mind", label: "Mind" },
  { value: "body", label: "Body" },
  { value: "spirit", label: "Spirit" },
] as const;
export type Pillar = (typeof PILLARS)[number]["value"];

export function isPillar(value: unknown): value is Pillar {
  return PILLARS.some((pillar) => pillar.value === value);
}

export function pillarLabel(value: string | null | undefined) {
  return PILLARS.find((pillar) => pillar.value === value)?.label ?? null;
}

// ---- Activity -------------------------------------------------------------------------------

export type MemberActivity = {
  completions: { at: string; pillar: Pillar | null }[]; // tasks finished
  memoDays: string[]; // memo dates, already "YYYY-MM-DD"
  going: string[]; // when they replied "Going" to a session
  messages: string[]; // when they sent a message
  purchases: number;
  coaches: number; // coaches they've joined
};

export type CoachActivity = {
  videos: string[]; // when each published video was added
  given: { at: string; pillar: Pillar | null }[]; // one per member given a task
  sessions: string[]; // when each session was scheduled
  messages: string[];
  members: number; // members who joined them
  sales: number;
};

// ---- Days and streaks -----------------------------------------------------------------------

export function dayKey(iso: string) {
  return localDayKey(iso, GAME_TIME_ZONE);
}

function shiftDay(key: string, days: number) {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// The current streak counts back from today, or from yesterday if today has nothing yet,
// so a streak doesn't look broken first thing in the morning.
export function streaks(days: Iterable<string>, now = new Date()) {
  const active = new Set(days);
  const today = dayKey(now.toISOString());

  let current = 0;
  let cursor = active.has(today) ? today : shiftDay(today, -1);
  while (active.has(cursor)) {
    current += 1;
    cursor = shiftDay(cursor, -1);
  }

  let best = 0;
  for (const day of active) {
    if (active.has(shiftDay(day, -1))) continue; // not the start of a run
    let length = 1;
    while (active.has(shiftDay(day, length))) length += 1;
    best = Math.max(best, length);
  }

  return {
    current,
    best: Math.max(best, current),
    activeToday: active.has(today),
  };
}

// Weeks start on Monday.
export function weekStartKey(now = new Date()) {
  const today = dayKey(now.toISOString());
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 is Sunday
  return shiftDay(today, -((weekday + 6) % 7));
}

// ---- Points and levels ----------------------------------------------------------------------

export const LEVELS = [
  { name: "Rookie", from: 0 },
  { name: "Contender", from: 50 },
  { name: "Warrior", from: 150 },
  { name: "Elite", from: 400 },
  { name: "Champion", from: 1000 },
  { name: "Legend", from: 2500 },
] as const;

export function levelFor(points: number) {
  let index = 0;
  while (index + 1 < LEVELS.length && points >= LEVELS[index + 1].from)
    index += 1;
  const level = LEVELS[index];
  const next = LEVELS[index + 1] ?? null;
  return {
    number: index + 1,
    name: level.name,
    next: next?.name ?? null,
    toNext: next ? next.from - points : 0,
    // How far through this level, from 0 to 1. Legend is always full.
    progress: next ? (points - level.from) / (next.from - level.from) : 1,
  };
}

// ---- Weekly challenges ----------------------------------------------------------------------

export type Challenge = {
  key: string;
  title: string;
  goal: number;
  done: number;
};

function countSince<T>(rows: T[], since: string, day: (row: T) => string) {
  return rows.filter((row) => day(row) >= since).length;
}

export function memberChallenges(
  activity: MemberActivity,
  now = new Date(),
): Challenge[] {
  const week = weekStartKey(now);
  const thisWeek = activity.completions.filter((row) => dayKey(row.at) >= week);
  const pillars = new Set(
    thisWeek.flatMap((row) => (row.pillar ? [row.pillar] : [])),
  );
  return [
    { key: "tasks", title: "Finish 3 Tasks", goal: 3, done: thisWeek.length },
    {
      key: "pillars",
      title: "Train Mind, Body and Spirit",
      goal: 3,
      done: pillars.size,
    },
    {
      key: "memos",
      title: "Write 3 Memos",
      goal: 3,
      done: countSince(activity.memoDays, week, (day) => day),
    },
    {
      key: "sessions",
      title: "Show up to a session",
      goal: 1,
      done: countSince(activity.going, week, dayKey),
    },
  ];
}

export function coachChallenges(
  activity: CoachActivity,
  now = new Date(),
): Challenge[] {
  const week = weekStartKey(now);
  return [
    {
      key: "tasks",
      title: "Give 5 Tasks",
      goal: 5,
      done: countSince(activity.given, week, (row) => dayKey(row.at)),
    },
    {
      key: "sessions",
      title: "Schedule 2 sessions",
      goal: 2,
      done: countSince(activity.sessions, week, dayKey),
    },
    {
      key: "videos",
      title: "Publish a video",
      goal: 1,
      done: countSince(activity.videos, week, dayKey),
    },
    {
      key: "messages",
      title: "Send 10 messages",
      goal: 10,
      done: countSince(activity.messages, week, dayKey),
    },
  ];
}

export function allChallengesDone(challenges: Challenge[]) {
  return (
    challenges.length > 0 &&
    challenges.every((challenge) => challenge.done >= challenge.goal)
  );
}

// ---- Badges ---------------------------------------------------------------------------------

type MemberStats = {
  tasks: number;
  pillarTasks: Record<Pillar, number>;
  sessions: number;
  memos: number;
  messages: number;
  purchases: number;
  coaches: number;
  bestStreak: number;
  weekComplete: boolean;
};

type CoachStats = {
  videos: number;
  given: number;
  pillarsTaught: number;
  sessions: number;
  messages: number;
  members: number;
  sales: number;
  bestStreak: number;
  weekComplete: boolean;
};

export type Badge = {
  key: string;
  name: string;
  description: string;
  icon: string;
};

type BadgeRule<S> = Badge & { earned: (stats: S) => boolean };

export const MEMBER_BADGES: BadgeRule<MemberStats>[] = [
  {
    key: "joined_coach",
    name: "Team Up",
    description: "Join a coach",
    icon: "🤝",
    earned: (s) => s.coaches >= 1,
  },
  {
    key: "first_task",
    name: "First Rep",
    description: "Finish your first Task",
    icon: "✅",
    earned: (s) => s.tasks >= 1,
  },
  {
    key: "tasks_10",
    name: "Dialed In",
    description: "Finish 10 Tasks",
    icon: "🔟",
    earned: (s) => s.tasks >= 10,
  },
  {
    key: "tasks_50",
    name: "Machine",
    description: "Finish 50 Tasks",
    icon: "⚙️",
    earned: (s) => s.tasks >= 50,
  },
  {
    key: "mind_5",
    name: "Sharp Mind",
    description: "Finish 5 Mind Tasks",
    icon: "🧠",
    earned: (s) => s.pillarTasks.mind >= 5,
  },
  {
    key: "body_5",
    name: "Strong Body",
    description: "Finish 5 Body Tasks",
    icon: "💪",
    earned: (s) => s.pillarTasks.body >= 5,
  },
  {
    key: "spirit_5",
    name: "Lifted Spirit",
    description: "Finish 5 Spirit Tasks",
    icon: "🔥",
    earned: (s) => s.pillarTasks.spirit >= 5,
  },
  {
    key: "balanced",
    name: "Mind • Body • Spirit",
    description: "Finish 3 Tasks in each pillar",
    icon: "🔺",
    earned: (s) =>
      s.pillarTasks.mind >= 3 &&
      s.pillarTasks.body >= 3 &&
      s.pillarTasks.spirit >= 3,
  },
  {
    key: "streak_7",
    name: "On a Roll",
    description: "Be active 7 days in a row",
    icon: "📅",
    earned: (s) => s.bestStreak >= 7,
  },
  {
    key: "streak_30",
    name: "Unstoppable",
    description: "Be active 30 days in a row",
    icon: "🏆",
    earned: (s) => s.bestStreak >= 30,
  },
  {
    key: "first_session",
    name: "Showed Up",
    description: "Say you're going to a session",
    icon: "📍",
    earned: (s) => s.sessions >= 1,
  },
  {
    key: "sessions_10",
    name: "Regular",
    description: "Go to 10 sessions",
    icon: "🎟️",
    earned: (s) => s.sessions >= 10,
  },
  {
    key: "memos_10",
    name: "Journaler",
    description: "Write 10 Memos",
    icon: "📓",
    earned: (s) => s.memos >= 10,
  },
  {
    key: "first_purchase",
    name: "Geared Up",
    description: "Buy something in the Armory",
    icon: "🛡️",
    earned: (s) => s.purchases >= 1,
  },
  {
    key: "week_complete",
    name: "Weekly Warrior",
    description: "Finish every weekly challenge",
    icon: "⚔️",
    earned: (s) => s.weekComplete,
  },
];

export const COACH_BADGES: BadgeRule<CoachStats>[] = [
  {
    key: "first_video",
    name: "Lights, Camera",
    description: "Publish your first video",
    icon: "🎬",
    earned: (s) => s.videos >= 1,
  },
  {
    key: "videos_10",
    name: "Library Builder",
    description: "Publish 10 videos",
    icon: "📚",
    earned: (s) => s.videos >= 10,
  },
  {
    key: "members_5",
    name: "Crew",
    description: "Have 5 members join you",
    icon: "👥",
    earned: (s) => s.members >= 5,
  },
  {
    key: "members_25",
    name: "Squad Leader",
    description: "Have 25 members join you",
    icon: "🏟️",
    earned: (s) => s.members >= 25,
  },
  {
    key: "tasks_given_25",
    name: "Program Designer",
    description: "Give 25 Tasks",
    icon: "📋",
    earned: (s) => s.given >= 25,
  },
  {
    key: "whole_athlete",
    name: "Whole Athlete Coach",
    description: "Give Tasks in Mind, Body and Spirit",
    icon: "🔺",
    earned: (s) => s.pillarsTaught >= 3,
  },
  {
    key: "sessions_10",
    name: "Session Host",
    description: "Schedule 10 sessions",
    icon: "🗓️",
    earned: (s) => s.sessions >= 10,
  },
  {
    key: "first_sale",
    name: "Open for Business",
    description: "Make your first Armory sale",
    icon: "💵",
    earned: (s) => s.sales >= 1,
  },
  {
    key: "sales_10",
    name: "Merchant",
    description: "Make 10 Armory sales",
    icon: "💰",
    earned: (s) => s.sales >= 10,
  },
  {
    key: "streak_7",
    name: "On a Roll",
    description: "Be active 7 days in a row",
    icon: "📅",
    earned: (s) => s.bestStreak >= 7,
  },
  {
    key: "streak_30",
    name: "Unstoppable",
    description: "Be active 30 days in a row",
    icon: "🏆",
    earned: (s) => s.bestStreak >= 30,
  },
  {
    key: "week_complete",
    name: "Weekly Warrior",
    description: "Finish every weekly challenge",
    icon: "⚔️",
    earned: (s) => s.weekComplete,
  },
];

const ALL_BADGES = new Map<string, Badge>(
  [...MEMBER_BADGES, ...COACH_BADGES].map(
    ({ key, name, description, icon }) => [
      key,
      { key, name, description, icon },
    ],
  ),
);

export function badgeInfo(key: string): Badge | null {
  return ALL_BADGES.get(key) ?? null;
}

// ---- Putting it together --------------------------------------------------------------------

export type Progress = {
  points: number;
  level: ReturnType<typeof levelFor>;
  streak: ReturnType<typeof streaks>;
  challenges: Challenge[];
  badges: (Badge & { earned: boolean })[];
  earnedKeys: string[];
};

export function memberProgress(
  activity: MemberActivity,
  now = new Date(),
): Progress {
  const pillarTasks = { mind: 0, body: 0, spirit: 0 } satisfies Record<
    Pillar,
    number
  >;
  for (const row of activity.completions)
    if (row.pillar) pillarTasks[row.pillar] += 1;

  const streak = streaks(
    [
      ...activity.completions.map((row) => dayKey(row.at)),
      ...activity.memoDays,
      ...activity.going.map(dayKey),
      ...activity.messages.map(dayKey),
    ],
    now,
  );
  const challenges = memberChallenges(activity, now);
  const stats: MemberStats = {
    tasks: activity.completions.length,
    pillarTasks,
    sessions: activity.going.length,
    memos: activity.memoDays.length,
    messages: activity.messages.length,
    purchases: activity.purchases,
    coaches: activity.coaches,
    bestStreak: streak.best,
    weekComplete: allChallengesDone(challenges),
  };
  const points =
    stats.tasks * MEMBER_POINTS.tasks +
    stats.sessions * MEMBER_POINTS.sessions +
    stats.messages * MEMBER_POINTS.messages +
    stats.memos * MEMBER_POINTS.memos;

  const badges = MEMBER_BADGES.map(({ earned, ...badge }) => ({
    ...badge,
    earned: earned(stats),
  }));
  return {
    points,
    level: levelFor(points),
    streak,
    challenges,
    badges,
    earnedKeys: badges
      .filter((badge) => badge.earned)
      .map((badge) => badge.key),
  };
}

export function coachProgress(
  activity: CoachActivity,
  now = new Date(),
): Progress {
  const streak = streaks(
    [
      ...activity.videos.map(dayKey),
      ...activity.given.map((row) => dayKey(row.at)),
      ...activity.sessions.map(dayKey),
      ...activity.messages.map(dayKey),
    ],
    now,
  );
  const challenges = coachChallenges(activity, now);
  const stats: CoachStats = {
    videos: activity.videos.length,
    given: activity.given.length,
    pillarsTaught: new Set(
      activity.given.flatMap((row) => (row.pillar ? [row.pillar] : [])),
    ).size,
    sessions: activity.sessions.length,
    messages: activity.messages.length,
    members: activity.members,
    sales: activity.sales,
    bestStreak: streak.best,
    weekComplete: allChallengesDone(challenges),
  };
  const points =
    stats.videos * COACH_POINTS.videos +
    stats.members * COACH_POINTS.newMembers +
    stats.sessions * COACH_POINTS.sessions +
    stats.given * COACH_POINTS.tasks +
    stats.messages * COACH_POINTS.messages;

  const badges = COACH_BADGES.map(({ earned, ...badge }) => ({
    ...badge,
    earned: earned(stats),
  }));
  return {
    points,
    level: levelFor(points),
    streak,
    challenges,
    badges,
    earnedKeys: badges
      .filter((badge) => badge.earned)
      .map((badge) => badge.key),
  };
}
