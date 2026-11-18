import { z } from "zod";

export const DAILY_CHECKIN_KEYS = [
  "energy",
  "sleep",
  "stress",
  "motivation",
] as const;

const score = z.coerce.number().int().min(1).max(5);

export const dailyCheckinSchema = z.object({
  energy: score,
  sleep: score,
  stress: score,
  motivation: score,
});

export const dailyCheckinExpectedDaySchema = z.iso.date();

export type DailyCheckinScores = z.infer<typeof dailyCheckinSchema>;

export type MemberDailyCheckin = DailyCheckinScores & {
  id: string;
  member_id: string;
  day: string;
  created_at: string;
  updated_at: string;
};
