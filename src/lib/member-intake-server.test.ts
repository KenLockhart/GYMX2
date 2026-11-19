import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getMemberCoachIntakeClearance } from "@/lib/member-intake-server";

const coachId = "11111111-1111-4111-8111-111111111111";
const intakeId = "22222222-2222-4222-8222-222222222222";

function fakeUser(options: {
  access?: Record<string, unknown> | null;
  intake?: Record<string, unknown> | null;
  historyCount?: number;
  pending?: unknown[];
  errorTable?: string;
} = {}) {
  const reads: { table: string; columns: unknown[] }[] = [];
  const user = {
    rpc: vi.fn(async () => ({ data: options.pending ?? [], error: null })),
    from: vi.fn((table: string) => {
      const result = table === "intake_coach_access"
        ? options.access ?? null
        : table === "member_intakes"
          ? options.intake ?? null
          : null;
      const count = table === "member_intake_history" ? options.historyCount ?? 0 : null;
      const error = options.errorTable === table ? { code: "XX000" } : null;
      const query: Record<string, (...args: unknown[]) => unknown> = {};
      query.select = (...args) => {
        reads.push({ table, columns: args });
        return query;
      };
      query.eq = () => query;
      query.maybeSingle = async () => ({ data: result, error });
      query.then = (...args) => {
        const resolve = args[0];
        return Promise.resolve({ count, error }).then(
          typeof resolve === "function"
            ? (resolve as (value: unknown) => unknown)
            : undefined,
        );
      };
      return query;
    }),
  };
  return { user, reads };
}

describe("member coach intake access check", () => {
  it("requires an explicit exact-coach grant and complete submission", async () => {
    const { user, reads } = fakeUser({
      access: { intake_id: intakeId },
      intake: { id: intakeId, status: "completed" },
    });

    expect(await getMemberCoachIntakeClearance(user as never, coachId)).toBe("cleared");
    expect(reads.map((read) => [read.table, read.columns[0]])).toEqual([
      ["intake_coach_access", "intake_id"],
      ["member_intakes", "id, status"],
    ]);
  });

  it("keeps prior submitted-history access while a new owner-only draft is edited", async () => {
    const { user } = fakeUser({
      access: { intake_id: intakeId },
      intake: { id: intakeId, status: "draft" },
      historyCount: 1,
    });

    expect(await getMemberCoachIntakeClearance(user as never, coachId)).toBe("cleared");
  });

  it("routes a new coach pair with a confirmed booking to intake", async () => {
    const { user } = fakeUser({
      pending: [{ coach_id: coachId, booking_id: "booking" }],
    });

    expect(await getMemberCoachIntakeClearance(user as never, coachId)).toBe("needs_intake");
  });

  it("requires a confirmed booking when the member has not shared intake with that coach", async () => {
    const { user } = fakeUser({
      pending: [{ coach_id: "33333333-3333-4333-8333-333333333333" }],
    });

    expect(await getMemberCoachIntakeClearance(user as never, coachId)).toBe("needs_booking");
  });

  it("fails closed without reading or returning health answers when an RLS check fails", async () => {
    const { user, reads } = fakeUser({ errorTable: "intake_coach_access" });

    expect(await getMemberCoachIntakeClearance(user as never, coachId)).toBe("unavailable");
    expect(reads).toEqual([{ table: "intake_coach_access", columns: ["intake_id"] }]);
  });
});
