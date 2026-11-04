import { describe, expect, it } from "vitest";
import {
  emailLinkTypeSchema,
  memoSchema,
  profileSchema,
  safeRedirectPath,
  setRoleSchema,
  signUpSchema,
  taskSchema,
  videoSchema,
} from "./validation";

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

describe("emailLinkTypeSchema", () => {
  it.each(["email", "recovery"])("accepts %s", (type) => {
    expect(emailLinkTypeSchema.safeParse(type).success).toBe(true);
  });

  it.each(["invite", "magiclink", "", null])("rejects %s", (type) => {
    expect(emailLinkTypeSchema.safeParse(type).success).toBe(false);
  });
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

describe("videoSchema", () => {
  it("requires a title", () => {
    expect(videoSchema.safeParse({ title: "   ", description: "" }).success).toBe(false);
  });
});

describe("taskSchema", () => {
  const valid = {
    video_id: "2f1b6c1e-8f4a-4d7e-9a57-1c1d2e3f4a5b",
    title: "Squats",
    instructions: "",
    due_on: "",
    member_ids: ["3f1b6c1e-8f4a-4d7e-9a57-1c1d2e3f4a5b"],
  };

  it("stores an empty due date as null", () => {
    expect(taskSchema.parse(valid).due_on).toBeNull();
  });

  it("keeps a real due date", () => {
    expect(taskSchema.parse({ ...valid, due_on: "2026-12-01" }).due_on).toBe("2026-12-01");
  });

  it.each(["tomorrow", "2026-13-40"])("rejects the due date %s", (due_on) => {
    expect(taskSchema.safeParse({ ...valid, due_on }).success).toBe(false);
  });

  it("requires a member", () => {
    expect(taskSchema.safeParse({ ...valid, member_ids: [] }).success).toBe(false);
  });
});

describe("memoSchema", () => {
  const valid = { id: "", memo_date: "2026-11-03", body: " Felt good ", shared_with_coaches: false };

  it("trims the note and treats an empty id as a new Memo", () => {
    const result = memoSchema.parse(valid);
    expect(result.body).toBe("Felt good");
    expect(result.id).toBeNull();
  });

  it("rejects an empty note", () => {
    expect(memoSchema.safeParse({ ...valid, body: "  " }).success).toBe(false);
  });
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
