import { describe, expect, it } from "vitest";
import { describeFlags, detectFlags } from "./message-flags";

describe("detectFlags", () => {
  it.each([
    ["Call 404-555-0123 tonight", "phone"],
    ["my cell is (404) 555 0123", "phone"],
    ["+1 404.555.0123", "phone"],
    ["4045550123", "phone"],
    ["email me at coach.ken@gmail.com", "email"],
    ["ken (at) gmail (dot) com", "email"],
    ["Just Venmo me", "payment"],
    ["send it on cash app", "payment"],
    ["My cashtag is $KenFit", "payment"],
    ["Zelle works", "payment"],
    ["paypal.me/kenfit", "payment"],
    ["you can pay me directly", "payment"],
    ["add me on WhatsApp", "off_platform"],
    ["text me later", "off_platform"],
    ["DM me on insta", "off_platform"],
    ["let's work outside the app", "off_platform"],
    ["we can train off GYMX2", "off_platform"],
    ["skip the fees and save money", "off_platform"],
  ])("flags %s", (body, flag) => {
    expect(detectFlags(body)).toContain(flag);
  });

  it.each([
    "Great session today! Drink water.",
    "The program is $49.99 in the Armory",
    "Do 3 sets of 12 reps at 135 lbs",
    "See you at 6:30 on 11/10/2026",
    "Message me here if you have questions",
    "Text me here anytime",
    "Watch the video on YouTube for form tips",
  ])("leaves %s alone", (body) => {
    expect(detectFlags(body)).toEqual([]);
  });

  it("reports every kind found, in a fixed order", () => {
    expect(detectFlags("Venmo me or text me at 404-555-0123")).toEqual(["phone", "payment", "off_platform"]);
  });
});

describe("describeFlags", () => {
  it("lists labels", () => {
    expect(describeFlags(["phone", "payment"])).toBe("Phone number, Payment app");
  });
});
