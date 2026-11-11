import { describe, expect, it } from "vitest";
import { allDestinations, menuGroups, type Role } from "../lib/nav";
import { GOALS, EXPERIENCE } from "../lib/onboarding";
import { NOTIFICATION_SETTINGS } from "../lib/notifications";
import { isLocale, localeFromHeader } from "./config";
import { messages } from "./messages";
import { translateServerText } from "./server-text";

describe("localeFromHeader", () => {
  it("picks Spanish for any Spanish variant", () => {
    expect(localeFromHeader("es-MX,es;q=0.9,en;q=0.8")).toBe("es");
    expect(localeFromHeader("es-419")).toBe("es");
  });
  it("respects the order of preference", () => {
    expect(localeFromHeader("en-US,es;q=0.5")).toBe("en");
    expect(localeFromHeader("fr-FR,es;q=0.7,en;q=0.5")).toBe("es");
  });
  it("falls back to English", () => {
    expect(localeFromHeader(null)).toBe("en");
    expect(localeFromHeader("fr-FR,de")).toBe("en");
  });
});

describe("isLocale", () => {
  it("accepts only the supported languages", () => {
    expect(isLocale("es")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("pt")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});

describe("translateServerText", () => {
  it("leaves English alone", () => {
    expect(translateServerText("Profile saved.", "en")).toBe("Profile saved.");
  });
  it("translates known messages and patterns", () => {
    expect(translateServerText("Profile saved.", "es")).toBe(
      "Perfil guardado.",
    );
    expect(
      translateServerText(
        "The Instagram link must be a full address starting with https://",
        "es",
      ),
    ).toBe(
      "El enlace de Instagram debe ser una dirección completa que empiece con https://",
    );
  });
  it("falls back to the English text when there's no translation", () => {
    expect(translateServerText("Something new.", "es")).toBe("Something new.");
  });
});

describe("Spanish coverage", () => {
  const roles: Role[] = ["member", "coach", "moderator"];
  it("names every menu link and group for coaches and members", () => {
    for (const role of roles) {
      for (const entry of allDestinations(role))
        expect(messages.es.nav.links[entry.href], entry.href).toBeTruthy();
      for (const group of menuGroups(role))
        expect(messages.es.nav.groups[group.title], group.title).toBeTruthy();
    }
  });
  it("names every goal, experience level and notification type", () => {
    for (const goal of GOALS)
      expect(messages.es.options.goals[goal.value]).toBeTruthy();
    for (const item of EXPERIENCE)
      expect(messages.es.options.experience[item.value]?.label).toBeTruthy();
    for (const meta of NOTIFICATION_SETTINGS)
      expect(
        messages.es.options.notificationTypes[meta.type]?.label,
      ).toBeTruthy();
  });
  it("keeps English labels in step with the source lists", () => {
    for (const goal of GOALS)
      expect(messages.en.options.goals[goal.value]).toBe(goal.label);
    for (const meta of NOTIFICATION_SETTINGS)
      expect(messages.en.options.notificationTypes[meta.type]?.label).toBe(
        meta.label,
      );
  });
});
