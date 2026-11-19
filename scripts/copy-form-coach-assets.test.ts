import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { copyFormCoachAssets } from "./copy-form-coach-assets.mjs";

const SDK_PACKAGE = "@mediapipe/tasks-vision";
const SDK_VERSION = "1.2.3";
const RELEASE_VERSION = "1.2.3-assets1";
const SDK_INTEGRITY =
  "sha512-sxJyfhbN+EamexhaaCmUlw7v8vWWMum7VDsORe6d4c8Dk/xlI4qiIgoSw9cE9hpvYhVRRVLIA8y605FbqWkNeQ==";
const SDK_ROOT = "node_modules/@mediapipe/tasks-vision";
const MODULE_PATH = `${SDK_ROOT}/vision_bundle.mjs`;
const WASM_PATHS = [
  `${SDK_ROOT}/wasm/vision_wasm_internal.js`,
  `${SDK_ROOT}/wasm/vision_wasm_internal.wasm`,
  `${SDK_ROOT}/wasm/vision_wasm_module_internal.js`,
  `${SDK_ROOT}/wasm/vision_wasm_module_internal.wasm`,
];
const MODEL_PATHS = [
  "assets/form-coach/models/pose_landmarker_lite.task",
  "assets/form-coach/models/pose_landmarker_full.task",
];
const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const CANONICAL_NOTICE_BLOB = execFileSync("git", ["show", "HEAD:assets/form-coach/THIRD_PARTY_NOTICES.md"], {
  cwd: REPOSITORY_ROOT,
});
const CANONICAL_NOTICE_SHA256 = "990FC65872D97964D2C68AD4AA3906610D9D43B9290B390A744F5466D083994B";

const temporaryRoots: string[] = [];

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex").toUpperCase();
}

async function writeFixtureFile(root: string, relativePath: string, bytes: Buffer) {
  const target = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
  return target;
}

async function writeJson(root: string, relativePath: string, value: unknown) {
  await writeFixtureFile(root, relativePath, Buffer.from(`${JSON.stringify(value, null, 2)}\n`));
}

async function makeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "form-coach-assets-test-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, "public"));

  const contents = new Map<string, Buffer>();
  const sourcePaths = [MODULE_PATH, ...WASM_PATHS, ...MODEL_PATHS];
  for (const [index, sourcePath] of sourcePaths.entries()) {
    contents.set(sourcePath, Buffer.from(`synthetic asset ${index + 1}\n`));
  }
  contents.set("assets/form-coach/THIRD_PARTY_NOTICES.md", CANONICAL_NOTICE_BLOB);

  for (const [sourcePath, bytes] of contents) {
    await writeFixtureFile(root, sourcePath, bytes);
  }

  const record = (sourcePath: string) => {
    const bytes = contents.get(sourcePath);
    if (!bytes) throw new Error(`Missing synthetic source ${sourcePath}`);
    return { sourcePath, sizeBytes: bytes.length, sha256: sha256(bytes) };
  };
  const manifest = {
    schemaVersion: 1,
    sdk: {
      package: SDK_PACKAGE,
      version: SDK_VERSION,
      integrity: SDK_INTEGRITY,
      license: "Apache-2.0",
      moduleEntry: record(MODULE_PATH),
      wasmFiles: WASM_PATHS.map((sourcePath) => ({
        ...record(sourcePath),
        filesetMode: "synthetic-test",
      })),
    },
    models: MODEL_PATHS.map((file, index) => ({
      name: index === 0 ? "Pose Landmarker Lite" : "Pose Landmarker Full",
      file,
      license: "Apache-2.0",
      sizeBytes: record(file).sizeBytes,
      sha256: record(file).sha256,
    })),
  };
  const projectPackage = { dependencies: { [SDK_PACKAGE]: SDK_VERSION } };
  const lockfile = {
    packages: {
      "": { dependencies: { [SDK_PACKAGE]: SDK_VERSION } },
      [`node_modules/${SDK_PACKAGE}`]: { version: SDK_VERSION, integrity: SDK_INTEGRITY },
    },
  };

  await writeJson(root, "package.json", projectPackage);
  await writeJson(root, "package-lock.json", lockfile);
  await writeJson(root, `${SDK_ROOT}/package.json`, {
    name: SDK_PACKAGE,
    version: SDK_VERSION,
    license: "Apache-2.0",
  });
  await writeJson(root, "assets/form-coach/asset-manifest.json", manifest);

  return { root, contents, manifest };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("copyFormCoachAssets", () => {
  it("copies the four pinned WASM files, both models, and notices atomically and is idempotent", async () => {
    const { root, contents, manifest } = await makeFixture();
    const first = await copyFormCoachAssets({ repoRoot: root });

    expect(first.copied).toBe(true);
    expect(first.outputPath).toBe(`public/form-coach-assets/${RELEASE_VERSION}`);
    expect(first.assets).toHaveLength(7);
    for (const asset of first.assets) {
      const relative = asset.publicPath.replace(`/form-coach-assets/${RELEASE_VERSION}/`, "");
      const expectedSource = [
        ...WASM_PATHS.map((sourcePath) => ({ sourcePath, relative: `wasm/${path.posix.basename(sourcePath)}` })),
        ...MODEL_PATHS.map((sourcePath) => {
          const model = manifest.models.find((entry) => entry.file === sourcePath);
          if (!model) throw new Error(`Missing synthetic model record ${sourcePath}`);
          return {
            sourcePath,
            relative: `models/sha256-${model.sha256}/${path.posix.basename(sourcePath)}`,
          };
        }),
        {
          sourcePath: "assets/form-coach/THIRD_PARTY_NOTICES.md",
          relative: `notices/sha256-${sha256(contents.get("assets/form-coach/THIRD_PARTY_NOTICES.md")!)}/THIRD_PARTY_NOTICES.md`,
        },
      ].find((entry) => entry.relative === relative);
      expect(expectedSource).toBeDefined();
      expect(await readFile(path.join(root, "public", ...asset.publicPath.slice(1).split("/")))).toEqual(
        contents.get(expectedSource!.sourcePath),
      );
    }

    const second = await copyFormCoachAssets({ repoRoot: root });
    expect(second.copied).toBe(false);
    expect(second.assets).toEqual(first.assets);
  });

  it("fails closed when the lockfile names a different SDK version", async () => {
    const { root } = await makeFixture();
    const lockPath = path.join(root, "package-lock.json");
    const lockfile = JSON.parse(await readFile(lockPath, "utf8"));
    lockfile.packages[`node_modules/${SDK_PACKAGE}`].version = "1.2.4";
    await writeJson(root, "package-lock.json", lockfile);

    await expect(copyFormCoachAssets({ repoRoot: root })).rejects.toThrow(/lockfile|package pin/i);
    await expect(readFile(path.join(root, "public", "form-coach-assets"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not publish anything when a pinned source file is missing", async () => {
    const { root } = await makeFixture();
    await rm(path.join(root, ...WASM_PATHS[1].split("/")));

    await expect(copyFormCoachAssets({ repoRoot: root })).rejects.toThrow();
    await expect(readFile(path.join(root, "public", "form-coach-assets"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a modified model instead of copying changed bytes", async () => {
    const { root } = await makeFixture();
    await writeFixtureFile(root, MODEL_PATHS[0], Buffer.from("tampered model bytes"));

    await expect(copyFormCoachAssets({ repoRoot: root })).rejects.toThrow(/pinned size and SHA-256/i);
    await expect(readFile(path.join(root, "public", "form-coach-assets"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("uses the canonical tracked LF notice blob and rejects modified notice bytes", async () => {
    expect(sha256(CANONICAL_NOTICE_BLOB)).toBe(CANONICAL_NOTICE_SHA256);
    expect(CANONICAL_NOTICE_BLOB.includes(Buffer.from("\r\n"))).toBe(false);

    const { root } = await makeFixture();
    const noticePath = path.join(root, ..."assets/form-coach/THIRD_PARTY_NOTICES.md".split("/"));
    await writeFile(noticePath, Buffer.concat([CANONICAL_NOTICE_BLOB, Buffer.from("tampered\n")]));

    await expect(copyFormCoachAssets({ repoRoot: root })).rejects.toThrow(/third-party notices differ/i);
    await expect(readFile(path.join(root, "public", "form-coach-assets"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a manifest source path escape before creating the public output", async () => {
    const { root, manifest } = await makeFixture();
    manifest.sdk.wasmFiles[0].sourcePath = "../../outside/vision_wasm_internal.js";
    await writeJson(root, "assets/form-coach/asset-manifest.json", manifest);

    await expect(copyFormCoachAssets({ repoRoot: root })).rejects.toThrow(/allowlisted SDK files|unsafe path/i);
    await expect(readFile(path.join(root, "public", "form-coach-assets"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves a stale stage directory and fails rather than overwriting unexpected release files", async () => {
    const { root } = await makeFixture();
    const assetRoot = path.join(root, "public", "form-coach-assets");
    const staleStage = path.join(assetRoot, ".stage-unowned");
    await mkdir(staleStage, { recursive: true });
    await writeFile(path.join(staleStage, "sentinel.txt"), "leave this untouched");

    const first = await copyFormCoachAssets({ repoRoot: root });
    expect(first.copied).toBe(true);
    expect(await readFile(path.join(staleStage, "sentinel.txt"), "utf8")).toBe("leave this untouched");

    const unowned = path.join(root, "public", "form-coach-assets", RELEASE_VERSION, "unowned.txt");
    await writeFile(unowned, "do not overwrite or remove");
    await expect(copyFormCoachAssets({ repoRoot: root })).rejects.toThrow(/unexpected files/i);
    expect(await readFile(unowned, "utf8")).toBe("do not overwrite or remove");
  });

  it("rejects a public-output junction to an outside directory without touching it", async () => {
    const { root } = await makeFixture();
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "form-coach-assets-outside-"));
    temporaryRoots.push(outsideRoot);
    const sentinel = path.join(outsideRoot, "keep.txt");
    await writeFile(sentinel, "outside sentinel");
    const outputLink = path.join(root, "public", "form-coach-assets");
    await symlink(outsideRoot, outputLink, process.platform === "win32" ? "junction" : "dir");

    await expect(copyFormCoachAssets({ repoRoot: root })).rejects.toThrow(/symlink\/reparse point/i);
    expect(await readFile(sentinel, "utf8")).toBe("outside sentinel");
    await rm(outputLink, { recursive: true, force: true });
  });
});
