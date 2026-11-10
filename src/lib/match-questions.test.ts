import { describe, expect, it } from "vitest";
import {
  answerLabel,
  answersSchema,
  coreAnswered,
  QUESTIONS,
  readAnswers,
} from "./match-questions";

describe("compatibility questionnaire", () => {
  it("has the six spec questions plus the love language as core questions", () => {
    expect(QUESTIONS.filter((q) => q.core).map((q) => q.key)).toEqual([
      "motivation",
      "accountability",
      "experience",
      "goals",
      "training_mode",
      "relationship",
      "love_primary",
    ]);
    expect(new Set(QUESTIONS.map((q) => q.key)).size).toBe(QUESTIONS.length);
  });

  it("lets every question be skipped", () => {
    expect(answersSchema.safeParse({}).success).toBe(true);
  });

  it("accepts only listed options and caps multi-choice answers", () => {
    expect(answersSchema.safeParse({ motivation: "encouraging" }).success).toBe(
      true,
    );
    expect(answersSchema.safeParse({ motivation: "yelling" }).success).toBe(
      false,
    );
    expect(
      answersSchema.safeParse({
        goals: ["lose_fat", "strength", "habits", "endurance"],
      }).success,
    ).toBe(false);
    expect(
      answersSchema.safeParse({ goals: ["lose_fat", "strength"] }).success,
    ).toBe(true);
  });

  it("keeps valid answers from a partly outdated set", () => {
    expect(readAnswers({ motivation: "calm", budget: "a million" })).toEqual({
      motivation: "calm",
    });
  });

  it("labels answers and counts core questions", () => {
    expect(answerLabel("goals", ["lose_fat", "strength"])).toBe(
      "Lose body fat, Get stronger",
    );
    expect(answerLabel("budget", undefined)).toBeNull();
    expect(coreAnswered({ motivation: "calm", goals: [] })).toEqual({
      done: 1,
      total: 7,
    });
  });
});
