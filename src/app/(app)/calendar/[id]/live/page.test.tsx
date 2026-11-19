import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAccount: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  getT: vi.fn(),
  readPrivateLiveSession: vi.fn(),
  readGroupCritiqueSnapshot: vi.fn(),
  getMemberCoachIntakeClearance: vi.fn(),
  redirect: vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); }),
  tables: [] as string[],
}));

vi.mock("@/lib/auth", () => ({ requireAccount: mocks.requireAccount }));
vi.mock("@/lib/member-intake-server", () => ({
  getMemberCoachIntakeClearance: mocks.getMemberCoachIntakeClearance,
}));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/i18n/server", () => ({ getT: mocks.getT }));
vi.mock("./private-actions", () => ({
  readPrivateLiveSession: mocks.readPrivateLiveSession,
}));
vi.mock("@/components/calendar-parts", () => ({
  SessionTime: function SessionTimeStub() {
    return null;
  },
}));
vi.mock("@/components/live-room", () => ({
  LiveRoom: function LiveRoomStub() {
    return null;
  },
}));
vi.mock("@/components/private-live-room", () => ({
  PrivateLiveRoom: function PrivateLiveRoomStub() {
    return null;
  },
  PrivateOneOnOneOffer: function PrivateOneOnOneOfferStub() {
    return null;
  },
}));
vi.mock("@/components/group-critique-room", () => ({
  GroupCritiqueGate: function GroupCritiqueGateStub({
    children,
  }: {
    children?: ReactNode;
  }) {
    return children ?? null;
  },
}));
vi.mock("./group-actions", () => ({
  readGroupCritiqueSnapshot: mocks.readGroupCritiqueSnapshot,
}));

import { LiveRoom } from "@/components/live-room";
import { GroupCritiqueGate } from "@/components/group-critique-room";
import {
  PrivateLiveRoom,
  PrivateOneOnOneOffer,
} from "@/components/private-live-room";
import LivePage from "./page";

const coachId = "11111111-1111-4111-8111-111111111111";
const memberId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";

function queryBuilder(data: unknown) {
  const result = { data, error: null };
  const query: Record<string, (...args: unknown[]) => unknown> = {};
  for (const method of ["select", "eq", "in", "order", "limit"]) {
    query[method] = () => query;
  }
  query.maybeSingle = async () => result;
  query.then = (resolve, reject) =>
    Promise.resolve(result).then(
      resolve as ((value: typeof result) => unknown) | undefined,
      reject as ((reason: unknown) => unknown) | undefined,
    );
  return query;
}

function findElements(root: ReactNode, type: unknown): ReactElement[] {
  if (Array.isArray(root))
    return root.flatMap((child) => findElements(child, type));
  if (!isValidElement(root)) return [];
  const element = root as ReactElement<{ children?: ReactNode }>;
  return [
    ...(element.type === type ? [element] : []),
    ...findElements(element.props.children, type),
  ];
}

function textContent(root: ReactNode): string {
  if (typeof root === "string" || typeof root === "number") return String(root);
  if (Array.isArray(root)) return root.map(textContent).join("");
  if (!isValidElement(root)) return "";
  return textContent(
    (root as ReactElement<{ children?: ReactNode }>).props.children,
  );
}

function session(mode: "broadcast" | "one_on_one") {
  return {
    id: sessionId,
    coach_id: coachId,
    title: "Private lesson",
    starts_at: "2026-11-15T12:00:00.000Z",
    ends_at: "2026-11-15T13:00:00.000Z",
    live_mode: mode,
    session_invites: [{ member_id: memberId, response: "pending" }],
  };
}

function installData(
  mode: "broadcast" | "one_on_one",
  room: Record<string, unknown> | null = null,
) {
  mocks.createClient.mockResolvedValue({
    from: (table: string) => {
      mocks.tables.push(table);
      if (table === "calendar_sessions") return queryBuilder(session(mode));
      if (table === "session_live") return queryBuilder(room);
      if (table === "live_chat_messages") return queryBuilder([]);
      throw new Error(`Unexpected table read: ${table}`);
    },
  });
  mocks.createAdminClient.mockReturnValue({
    from: (table: string) => {
      mocks.tables.push(table);
      if (table !== "profiles") throw new Error(`Unexpected admin read: ${table}`);
      return queryBuilder([
        { id: coachId, display_name: "Coach" },
        { id: memberId, display_name: "Invited member" },
      ]);
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tables.length = 0;
  mocks.requireAccount.mockResolvedValue({ profile: { id: coachId, role: "coach" } });
  mocks.getMemberCoachIntakeClearance.mockResolvedValue("cleared");
  mocks.getT.mockResolvedValue({
    calendar: {
      edit: { back: "Back" },
      live: {
        title: "Live session",
        live: "Live",
        liveWith: (name: string) => `Live with ${name}`,
        notRecorded: "Not recorded",
        private: {
          otherParticipant: "Invited member",
          previousGroupRoom: "A group room must be cleaned up before private video.",
        },
      },
    },
  });
  installData("broadcast");
  mocks.readPrivateLiveSession.mockResolvedValue({
    ok: true,
    mode: "one_on_one",
    grant: {
      grantId: "44444444-4444-4444-8444-444444444444",
      generation: 1,
      state: "offered",
      expiresAt: "2026-11-15T14:00:00.000Z",
      memberCameraAllowed: false,
      coachLive: false,
      memberLive: false,
    },
  });
  mocks.readGroupCritiqueSnapshot.mockResolvedValue({
    ok: true,
    featureEnabled: true,
    snapshot: null,
  });
});

describe("live page mode selection", () => {
  it("offers private video for a single pending invite without adding an RSVP gate", async () => {
    installData("broadcast");

    const element = await LivePage({ params: Promise.resolve({ id: sessionId }) });
    const offers = findElements(element, PrivateOneOnOneOffer);
    expect(offers).toHaveLength(1);
    expect(offers[0].props).toMatchObject({ sessionId, memberId });
    expect(findElements(element, LiveRoom)).toHaveLength(1);
  });

  it("passes a pending sole invite to group controls without requiring a Going RSVP", async () => {
    const snapshot = {
      sessionId,
      generation: 1,
      state: "open",
      joinExpiresAt: "2026-11-15T14:00:00.000Z",
      role: "coach",
      allMembersMuted: false,
      members: [],
    };
    mocks.readGroupCritiqueSnapshot.mockResolvedValue({
      ok: true,
      featureEnabled: true,
      snapshot,
    });

    const element = await LivePage({ params: Promise.resolve({ id: sessionId }) });
    const gates = findElements(element, GroupCritiqueGate);

    expect(gates).toHaveLength(1);
    expect(gates[0].props).toMatchObject({
      sessionId,
      invitees: [{ id: memberId, name: "Invited member" }],
      initialSnapshot: snapshot,
      legacyRoomExists: false,
    });
    expect(findElements(element, PrivateOneOnOneOffer)).toHaveLength(1);
  });

  it("does not read a group room or pass its playback URL for a private session", async () => {
    installData("one_on_one");
    mocks.requireAccount.mockResolvedValue({
      profile: { id: coachId, role: "coach" },
    });

    const element = await LivePage({ params: Promise.resolve({ id: sessionId }) });
    const privateRooms = findElements(element, PrivateLiveRoom);

    expect(privateRooms).toHaveLength(1);
    expect(privateRooms[0].props).toMatchObject({
      sessionId,
      memberId,
      memberName: "Invited member",
    });
    expect(privateRooms[0].props).not.toHaveProperty("playbackUrl");
    expect(mocks.tables).not.toContain("session_live");
    expect(findElements(element, LiveRoom)).toHaveLength(0);
  });

  it("loads a private offer for the sole invited member even while their RSVP is pending", async () => {
    installData("one_on_one");
    mocks.requireAccount.mockResolvedValue({
      profile: { id: memberId, role: "member" },
    });

    const element = await LivePage({ params: Promise.resolve({ id: sessionId }) });
    const privateRooms = findElements(element, PrivateLiveRoom);

    expect(privateRooms).toHaveLength(1);
    expect(privateRooms[0].props).toMatchObject({
      me: memberId,
      canChat: true,
      initialSnapshot: {
        mode: "one_on_one",
        grant: { state: "offered", memberCameraAllowed: false },
      },
    });
    expect(mocks.tables).not.toContain("session_live");
  });

  it("routes an invited member with pending intake through their internal live return path", async () => {
    installData("broadcast");
    mocks.requireAccount.mockResolvedValue({ profile: { id: memberId, role: "member" } });
    mocks.getMemberCoachIntakeClearance.mockResolvedValue("needs_intake");

    await expect(LivePage({ params: Promise.resolve({ id: sessionId }) }))
      .rejects.toThrow(`NEXT_REDIRECT:/intake?coach=${coachId}&returnTo=${encodeURIComponent(`/calendar/${sessionId}/live`)}`);
    expect(mocks.readGroupCritiqueSnapshot).not.toHaveBeenCalled();
    expect(mocks.readPrivateLiveSession).not.toHaveBeenCalled();
  });

  it("sends a member without a confirmed booking back to session RSVP before live access", async () => {
    installData("broadcast");
    mocks.requireAccount.mockResolvedValue({ profile: { id: memberId, role: "member" } });
    mocks.getMemberCoachIntakeClearance.mockResolvedValue("needs_booking");

    await expect(LivePage({ params: Promise.resolve({ id: sessionId }) }))
      .rejects.toThrow(`NEXT_REDIRECT:/calendar/${sessionId}`);
    expect(mocks.readGroupCritiqueSnapshot).not.toHaveBeenCalled();
  });

  it("keeps the coach recovery room available when a closed private session has multiple invites", async () => {
    mocks.requireAccount.mockResolvedValue({
      profile: { id: coachId, role: "coach" },
    });
    mocks.createClient.mockResolvedValue({
      from: (table: string) => {
        mocks.tables.push(table);
        if (table === "calendar_sessions") {
          const value = {
            ...session("one_on_one"),
            session_invites: [
              { member_id: memberId, response: "pending" },
              {
                member_id: "55555555-5555-4555-8555-555555555555",
                response: "pending",
              },
            ],
          };
          return queryBuilder(value);
        }
        if (table === "live_chat_messages") return queryBuilder([]);
        throw new Error(`Unexpected table read: ${table}`);
      },
    });
    mocks.createAdminClient.mockReturnValue({
      from: (table: string) => {
        mocks.tables.push(table);
        if (table !== "profiles") throw new Error(`Unexpected admin read: ${table}`);
        return queryBuilder([
          { id: coachId, display_name: "Coach" },
          { id: memberId, display_name: "Invited member" },
          {
            id: "55555555-5555-4555-8555-555555555555",
            display_name: "Second invited member",
          },
        ]);
      },
    });
    mocks.readPrivateLiveSession.mockResolvedValue({
      ok: true,
      mode: "one_on_one",
      grant: null,
    });

    const element = await LivePage({ params: Promise.resolve({ id: sessionId }) });
    const privateRooms = findElements(element, PrivateLiveRoom);

    expect(privateRooms).toHaveLength(1);
    expect(privateRooms[0].props).toMatchObject({
      memberId: null,
      initialSnapshot: { mode: "one_on_one", grant: null },
    });
    expect(mocks.tables).not.toContain("session_live");
  });

  it("explains why private video is unavailable when a prior group room remains", async () => {
    installData("broadcast", {
      playback_url: "https://group.example/playback",
      live_started_at: "2026-11-15T12:00:00.000Z",
      live_ended_at: "2026-11-15T12:30:00.000Z",
    });

    const element = await LivePage({ params: Promise.resolve({ id: sessionId }) });

    expect(findElements(element, PrivateOneOnOneOffer)).toHaveLength(0);
    expect(textContent(element)).toContain(
      "A group room must be cleaned up before private video.",
    );
  });
});
