import { describe, expect, it } from "vitest";
import { profileSchema, safeRedirectPath, setRoleSchema, signUpSchema } from "./validation";

const profile = {
  display_name: "Sam",
  bio: "",
  coach_requested: false,
  instagram_url: "",
  tiktok_url: "",
  youtube_url: "",
  x_url: "",
  website_url: "",
};

describe("safeRedirectPath", () => {
  it("keeps same-site paths", () => {
    expect(safeRedirectPath("/profile")).toBe("/profile");
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "", null, undefined])(
    "rejects %s",
    (path) => {
      expect(safeRedirectPath(path)).toBe("/dashboard");
    },
  );
});

describe("signUpSchema", () => {
  const valid = {
    display_name: " Sam ",
    email: " Sam@Example.TEST ",
    password: "long-enough",
    coach_requested: false,
  };

  it("normalizes the name and email", () => {
    const result = signUpSchema.parse(valid);
    expect(result.display_name).toBe("Sam");
    expect(result.email).toBe("sam@example.test");
  });

  it("rejects short passwords", () => {
    expect(signUpSchema.safeParse({ ...valid, password: "short" }).success).toBe(false);
  });
});

describe("profileSchema", () => {
  it("stores empty social links as null", () => {
    expect(profileSchema.parse(profile).instagram_url).toBeNull();
  });

  it("accepts https links", () => {
    const url = "https://instagram.com/sam";
    expect(profileSchema.parse({ ...profile, instagram_url: url }).instagram_url).toBe(url);
  });

  it.each(["http://instagram.com/sam", "javascript:alert(1)", "instagram.com/sam"])(
    "rejects %s",
    (url) => {
      expect(profileSchema.safeParse({ ...profile, instagram_url: url }).success).toBe(false);
    },
  );
});

describe("setRoleSchema", () => {
  it("rejects unknown roles", () => {
    const result = setRoleSchema.safeParse({
      user_id: "2f1b6c1e-8f4a-4d7e-9a57-1c1d2e3f4a5b",
      role: "owner",
    });
    expect(result.success).toBe(false);
  });
});
