import { describe, expect, it } from "vitest";
import {
  ADMIN_NAV,
  allDestinations,
  initials,
  isActive,
  menuGroups,
  primaryNav,
  type Role,
} from "./nav";

const roles: Role[] = ["member", "coach", "moderator", "admin"];

describe("primaryNav", () => {
  it("keeps the top bar short for every role", () => {
    for (const role of roles)
      expect(primaryNav(role).length).toBeLessThanOrEqual(8);
  });
  it("matches the design for admins and adds Coaches or Members by role", () => {
    expect(primaryNav("admin").map((i) => i.label)).toEqual([
      "Dashboard",
      "Tasks",
      "Calendar",
      "Library",
      "Armory",
      "Community",
      "Programs",
    ]);
    expect(primaryNav("member").some((i) => i.href === "/coaches")).toBe(true);
    expect(primaryNav("coach").some((i) => i.href === "/members")).toBe(true);
  });
});

describe("menus", () => {
  it("never lists a page twice for a role", () => {
    for (const role of roles) {
      const hrefs = [
        ...primaryNav(role),
        ...menuGroups(role).flatMap((g) => g.items),
      ].map((i) => i.href);
      expect(new Set(hrefs).size).toBe(hrefs.length);
    }
  });
  it("shows admin and moderation links only to the right roles", () => {
    const has = (role: Role, href: string) =>
      allDestinations(role).some((i) => i.href === href);
    expect(has("member", "/admin")).toBe(false);
    expect(has("member", "/moderation")).toBe(false);
    expect(has("moderator", "/moderation")).toBe(true);
    expect(has("coach", "/moderation")).toBe(true);
    expect(has("admin", "/admin/users")).toBe(true);
    expect(has("coach", "/admin/users")).toBe(false);
  });
  it("puts every admin page in the sidebar once", () => {
    const hrefs = [
      ADMIN_NAV.overview,
      ...ADMIN_NAV.groups.flatMap((g) => g.items),
    ].map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("isActive", () => {
  it("matches sections but not roots too eagerly", () => {
    expect(isActive("/calendar/intros", "/calendar")).toBe(true);
    expect(isActive("/calendarx", "/calendar")).toBe(false);
    expect(isActive("/admin/users", "/admin")).toBe(false);
    expect(isActive("/profile/coach", "/profile")).toBe(false);
    expect(isActive("/admin", "/admin")).toBe(true);
  });
});

describe("initials", () => {
  it("takes first and last initials and drops a Coach prefix", () => {
    expect(initials("James Hart")).toBe("JH");
    expect(initials("Coach Jasmine")).toBe("J");
    expect(initials("  ")).toBe("?");
  });
});
