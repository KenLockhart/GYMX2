import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAccount: vi.fn(),
  createClient: vi.fn(),
  enabled: vi.fn(),
  loadSnapshot: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAccount: mocks.requireAccount }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/program-authoring-server", () => ({
  isProgramPaidAuthoringEnabled: mocks.enabled,
  loadProgramAuthoringSnapshot: mocks.loadSnapshot,
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("./editor", () => ({ default: () => <div>Authoring editor</div> }));

import ManageProgramPage from "./page";

const PROGRAM_ID = "10000000-0000-4000-8000-000000000001";
const OWNER_ID = "70000000-0000-4000-8000-000000000007";

const programRow = {
  id: PROGRAM_ID,
  coach_id: OWNER_ID,
  title: "Foundations",
  platform_owned: false,
};

function makeClient() {
  return {
    from(table: string) {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        in: vi.fn(() => query),
        order: vi.fn(() => query),
        maybeSingle: vi.fn(async () => ({ data: table === "programs" ? programRow : null, error: null })),
        then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
          Promise.resolve(resolve({ data: table === "videos" ? [{ id: "video-ready", title: "Ready video" }] : [], error: null })),
      };
      return query;
    },
  };
}

async function renderPage(id = PROGRAM_ID) {
  return renderToStaticMarkup(await ManageProgramPage({ params: Promise.resolve({ id }) }));
}

describe("Program authoring route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled.mockReturnValue(true);
    mocks.requireAccount.mockResolvedValue({ profile: { id: OWNER_ID, role: "coach" } });
    mocks.createClient.mockResolvedValue(makeClient());
    mocks.loadSnapshot.mockResolvedValue({ ok: true, value: {
      programId: PROGRAM_ID,
      published: true,
      platformOwned: false,
      currentContentVersionId: "20000000-0000-4000-8000-000000000002",
      currentOfferVersionId: "30000000-0000-4000-8000-000000000003",
      currentRevisionKind: "free_snapshot",
      currentLessonCount: 0,
      offerKind: "free",
      listPriceCents: 0,
      currency: "usd",
      maxInstallments: 1,
      payoutReady: true,
      draftId: null,
      draftRevision: null,
      draftStale: false,
      lessons: [],
    } });
    mocks.notFound.mockImplementation(() => { throw new Error("NEXT_NOT_FOUND"); });
  });

  it("loads authoring state only after the feature and exact coach owner checks", async () => {
    const html = await renderPage();
    expect(html).toContain("Foundations");
    expect(html).toContain("Authoring editor");
    expect(mocks.loadSnapshot).toHaveBeenCalledWith({ programId: PROGRAM_ID });
  });

  it("does not authenticate or call authoring RPCs while the feature is off", async () => {
    mocks.enabled.mockReturnValue(false);
    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.requireAccount).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.loadSnapshot).not.toHaveBeenCalled();
  });

  it("rejects a different role or owner before loading the snapshot", async () => {
    mocks.requireAccount.mockResolvedValue({ profile: { id: "80000000-0000-4000-8000-000000000008", role: "admin" } });
    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.loadSnapshot).not.toHaveBeenCalled();
  });
});
