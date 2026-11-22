import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildFormCoachWorker } from "./build-form-coach-worker.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("offline Form Coach Worker bundle", () => {
  it("publishes a complete hashed ESM namespace and a matching manifest", async () => {
    const result = await buildFormCoachWorker(repositoryRoot);
    expect(result.workerUrl).toMatch(/^\/form-coach-worker\/[a-f0-9]{64}\/worker\.js$/);
    expect(result.bundleHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.fileCount).toBeGreaterThanOrEqual(2);

    const manifestPath = path.join(repositoryRoot, "public/form-coach-assets/form-coach-worker/manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    expect(manifest).toMatchObject({
      version: 1,
      sdkVersion: "1.2.3",
      workerUrl: result.workerUrl,
      bundleHash: result.bundleHash,
    });
    expect(manifest.files).toHaveLength(result.fileCount);
    expect(manifest.files.map(({ path: relativePath }) => relativePath)).toContain("worker.js");

    const namespaceRoot = path.join(repositoryRoot, "public/form-coach-assets/form-coach-worker", result.bundleHash);
    for (const entry of manifest.files) {
      expect(entry.path).not.toMatch(/(^|\/)\.\.($|\/)/);
      const bytes = await fs.readFile(path.join(namespaceRoot, ...entry.path.split("/")));
      const digest = createHash("sha256").update(bytes).digest("hex");
      expect(digest).toBe(entry.sha256);
    }
  });
});
