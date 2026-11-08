import { describe, expect, it } from "vitest";
import {
  armoryItemSchema,
  emailLinkTypeSchema,
  memoSchema,
  profileSchema,
  safeRedirectPath,
  sessionResponseSchema,
  sessionSchema,
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
  email_updates: true,
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

describe("sessionSchema", () => {
  const valid = {
    id: "",
    title: "Morning run",
    notes: "",
    location: "Main park",
    meeting_url: "",
    starts_at: "2026-11-10T14:00:00.000Z",
    ends_at: "2026-11-10T15:00:00.000Z",
    member_ids: ["3f1b6c1e-8f4a-4d7e-9a57-1c1d2e3f4a5b"],
  };

  it("accepts a new session", () => {
    expect(sessionSchema.parse(valid).id).toBeNull();
  });

  it("must end after it starts", () => {
    const result = sessionSchema.safeParse({ ...valid, ends_at: valid.starts_at });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("The session must end after it starts.");
  });

  it("lasts at most a day", () => {
    expect(sessionSchema.safeParse({ ...valid, ends_at: "2026-11-12T14:00:00.000Z" }).success).toBe(false);
  });

  it.each(["http://meet.example.com", "meet.example.com"])("rejects the meeting link %s", (meeting_url) => {
    expect(sessionSchema.safeParse({ ...valid, meeting_url }).success).toBe(false);
  });

  it("accepts an https meeting link", () => {
    expect(sessionSchema.safeParse({ ...valid, meeting_url: "https://meet.example.com/x" }).success).toBe(true);
  });

  it("needs a start time", () => {
    expect(sessionSchema.safeParse({ ...valid, starts_at: "" }).success).toBe(false);
  });

  it("requires a member", () => {
    expect(sessionSchema.safeParse({ ...valid, member_ids: [] }).success).toBe(false);
  });
});

describe("sessionResponseSchema", () => {
  it.each(["going", "not_going"])("accepts %s", (response) => {
    expect(
      sessionResponseSchema.safeParse({ session_id: "3f1b6c1e-8f4a-4d7e-9a57-1c1d2e3f4a5b", response }).success,
    ).toBe(true);
  });

  it("rejects pending", () => {
    expect(
      sessionResponseSchema.safeParse({ session_id: "3f1b6c1e-8f4a-4d7e-9a57-1c1d2e3f4a5b", response: "pending" })
        .success,
    ).toBe(false);
  });
});

describe("armoryItemSchema", () => {
  const owner = "3f1b6c1e-8f4a-4d7e-9a57-1c1d2e3f4a5b";
  const link = {
    kind: "link",
    id: "",
    category: "gear",
    title: "Bands",
    description: "",
    price_cents: 2499,
    buy_url: "https://shop.example.com/bands",
    image_path: "",
    visible_to_all: false,
  };
  const download = {
    kind: "download",
    id: "",
    category: "ebook",
    title: "Meal plan",
    description: "",
    file_path: `${owner}/abc-plan.pdf`,
    file_name: "plan.pdf",
    image_path: `${owner}/cover.png`,
    visible_to_all: true,
  };

  it("accepts an outside-link item", () => {
    expect(armoryItemSchema.parse(link)).toMatchObject({ id: null, image_path: null });
  });

  it("needs an https shop link", () => {
    expect(armoryItemSchema.safeParse({ ...link, buy_url: "shop.example.com" }).success).toBe(false);
  });

  it("accepts a free download", () => {
    expect(armoryItemSchema.safeParse(download).success).toBe(true);
  });

  it("needs an uploaded file for a download", () => {
    const result = armoryItemSchema.safeParse({ ...download, file_path: "" });
    expect(result.error?.issues[0].message).toBe("Upload the file people will download.");
  });

  it.each(["../etc/passwd", `${owner}/../x.pdf`, `${owner}/a/b.pdf`])("rejects the file path %s", (file_path) => {
    expect(armoryItemSchema.safeParse({ ...download, file_path }).success).toBe(false);
  });

  it("rejects an unknown category", () => {
    expect(armoryItemSchema.safeParse({ ...link, category: "weapons" }).success).toBe(false);
  });

  const paid = { ...download, kind: "paid", price_cents: 1999 };

  it("accepts a paid download", () => {
    expect(armoryItemSchema.safeParse(paid).success).toBe(true);
  });

  const product = {
    kind: "product",
    id: "",
    category: "gear",
    title: "Shirt",
    description: "",
    price_cents: 4995,
    shipping_cents: 599,
    sizes: ["S", "M"],
    image_path: "",
    visible_to_all: true,
  };

  it("accepts gear with sizes and shipping", () => {
    expect(armoryItemSchema.safeParse(product).success).toBe(true);
  });

  it("needs a price for gear", () => {
    expect(armoryItemSchema.safeParse({ ...product, price_cents: null }).success).toBe(false);
  });

  it("allows free shipping", () => {
    expect(armoryItemSchema.safeParse({ ...product, shipping_cents: 0 }).success).toBe(true);
  });

  it.each([null, 50])("needs a paid price of at least $1 (got %s)", (price_cents) => {
    const result = armoryItemSchema.safeParse({ ...paid, price_cents });
    expect(result.error?.issues[0].message).toBe("Enter a price of at least $1.00.");
  });
});
