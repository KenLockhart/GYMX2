import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { esPhrases } from "./es-phrases";
import { scanPhrases } from "./phrase-scan";
import { translate } from "./phrases";

const SRC = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory())
      return name === "i18n" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) && !name.includes(".test.") ? [path] : [];
  });
}

describe("phrases", () => {
  it("fills placeholders and falls back to English", () => {
    expect(translate("Buy for {price}", "es", { price: "$5" })).toBe(
      "Comprar por $5",
    );
    expect(translate("Buy for {price}", "en", { price: "$5" })).toBe(
      "Buy for $5",
    );
    expect(translate("Not a phrase we know", "es")).toBe(
      "Not a phrase we know",
    );
  });

  it("has Spanish for every phrase the screens use", () => {
    const missing = new Set<string>();
    for (const file of sourceFiles(SRC))
      for (const phrase of scanPhrases(readFileSync(file, "utf8")))
        if (!(phrase in esPhrases)) missing.add(phrase);
    expect([...missing]).toEqual([]);
  });
});
