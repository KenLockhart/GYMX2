import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { constants, createReadStream } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SDK_PACKAGE = "@mediapipe/tasks-vision";
const SDK_VERSION = "1.2.3";
const SDK_INTEGRITY =
  "sha512-sxJyfhbN+EamexhaaCmUlw7v8vWWMum7VDsORe6d4c8Dk/xlI4qiIgoSw9cE9hpvYhVRRVLIA8y605FbqWkNeQ==";
const SDK_ROOT = "node_modules/@mediapipe/tasks-vision";
const MANIFEST_PATH = "assets/form-coach/asset-manifest.json";
const NOTICE_PATH = "assets/form-coach/THIRD_PARTY_NOTICES.md";
const NOTICE_SHA256 = "990FC65872D97964D2C68AD4AA3906610D9D43B9290B390A744F5466D083994B";
const EXPECTED_MODULE_PATH = `${SDK_ROOT}/vision_bundle.mjs`;
const EXPECTED_WASM_PATHS = [
  `${SDK_ROOT}/wasm/vision_wasm_internal.js`,
  `${SDK_ROOT}/wasm/vision_wasm_internal.wasm`,
  `${SDK_ROOT}/wasm/vision_wasm_module_internal.js`,
  `${SDK_ROOT}/wasm/vision_wasm_module_internal.wasm`,
];
const EXPECTED_MODEL_PATHS = [
  "assets/form-coach/models/pose_landmarker_lite.task",
  "assets/form-coach/models/pose_landmarker_full.task",
];
const GENERATED_ROOT = "form-coach-assets";
const RELEASE_VERSION = `${SDK_VERSION}-assets1`;

function fail(message) {
  throw new Error(`Form Coach asset copy refused: ${message}`);
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function parseRepoRelativePath(root, relative, label) {
  if (
    typeof relative !== "string" ||
    relative.length === 0 ||
    relative.includes("\\") ||
    path.posix.isAbsolute(relative)
  ) {
    fail(`${label} must be a normalized repository-relative path.`);
  }

  const segments = relative.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    fail(`${label} contains an unsafe path segment.`);
  }

  const absolute = path.resolve(root, ...segments);
  if (!isInside(root, absolute)) fail(`${label} resolves outside the repository.`);
  return absolute;
}

async function assertNoSymlinkAncestors(root, absolute, { allowMissing = false } = {}) {
  if (!isInside(root, absolute)) fail("a path resolves outside its approved root.");
  const relative = path.relative(root, absolute);
  let cursor = root;

  for (const segment of relative ? relative.split(path.sep) : []) {
    cursor = path.join(cursor, segment);
    let stats;
    try {
      stats = await fs.lstat(cursor);
    } catch (error) {
      if (allowMissing && error?.code === "ENOENT") return;
      throw error;
    }
    if (stats.isSymbolicLink()) fail("a source or destination path contains a symlink/reparse point.");
  }
}

async function readJson(root, relative, label) {
  const absolute = parseRepoRelativePath(root, relative, label);
  await assertNoSymlinkAncestors(root, absolute);
  const realPath = await fs.realpath(absolute);
  if (!isInside(root, realPath)) fail(`${label} resolves outside the repository.`);
  return JSON.parse(await fs.readFile(realPath, "utf8"));
}

async function hashFile(absolute) {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of createReadStream(absolute)) {
    hash.update(chunk);
    sizeBytes += chunk.length;
  }
  return { sha256: hash.digest("hex").toUpperCase(), sizeBytes };
}

async function inspectSource(root, sourcePath, expected, label) {
  const absolute = parseRepoRelativePath(root, sourcePath, label);
  await assertNoSymlinkAncestors(root, absolute);
  const realPath = await fs.realpath(absolute);
  if (!isInside(root, realPath)) fail(`${label} resolves outside the repository.`);

  const stats = await fs.stat(realPath);
  if (!stats.isFile()) fail(`${label} is not a regular file.`);
  const actual = await hashFile(realPath);
  if (actual.sizeBytes !== expected.sizeBytes || actual.sha256 !== expected.sha256.toUpperCase()) {
    fail(`${label} does not match its pinned size and SHA-256.`);
  }
  return { sourcePath: realPath, ...actual };
}

function assertPinnedRecord(record, { sourcePath, label }) {
  if (!record || record.sourcePath !== sourcePath) fail(`${label} source path is not the pinned path.`);
  if (!Number.isSafeInteger(record.sizeBytes) || record.sizeBytes <= 0) fail(`${label} has an invalid byte size.`);
  if (typeof record.sha256 !== "string" || !/^[A-Fa-f0-9]{64}$/.test(record.sha256)) {
    fail(`${label} has an invalid SHA-256 value.`);
  }
}

async function makePlan(root) {
  const [manifest, projectPackage, lockfile, installedPackage, noticeAbsolute] = await Promise.all([
    readJson(root, MANIFEST_PATH, "asset manifest"),
    readJson(root, "package.json", "project package manifest"),
    readJson(root, "package-lock.json", "package lockfile"),
    readJson(root, `${SDK_ROOT}/package.json`, "installed SDK package manifest"),
    (async () => {
      const absolute = parseRepoRelativePath(root, NOTICE_PATH, "third-party notices");
      await assertNoSymlinkAncestors(root, absolute);
      const realPath = await fs.realpath(absolute);
      if (!isInside(root, realPath)) fail("third-party notices resolve outside the repository.");
      return realPath;
    })(),
  ]);

  const sdk = manifest?.sdk;
  if (sdk?.package !== SDK_PACKAGE || sdk.version !== SDK_VERSION || sdk.integrity !== SDK_INTEGRITY) {
    fail("the manifest does not match the approved SDK name, version, and registry integrity.");
  }
  if (sdk.license !== "Apache-2.0" || installedPackage?.license !== "Apache-2.0") {
    fail("the SDK license metadata differs from the reviewed Apache-2.0 pin.");
  }
  if (projectPackage?.dependencies?.[SDK_PACKAGE] !== SDK_VERSION) {
    fail("package.json does not pin the approved SDK version exactly.");
  }

  const lockedSdk = lockfile?.packages?.[`node_modules/${SDK_PACKAGE}`];
  if (
    lockedSdk?.version !== SDK_VERSION ||
    lockedSdk.integrity !== SDK_INTEGRITY ||
    installedPackage?.name !== SDK_PACKAGE ||
    installedPackage.version !== SDK_VERSION
  ) {
    fail("installed SDK metadata and lockfile do not match the approved package pin.");
  }

  if (!sdk.moduleEntry || sdk.moduleEntry.sourcePath !== EXPECTED_MODULE_PATH) {
    fail("the SDK module entry does not match the pinned package path.");
  }
  assertPinnedRecord(sdk.moduleEntry, { sourcePath: EXPECTED_MODULE_PATH, label: "SDK module entry" });
  await inspectSource(root, EXPECTED_MODULE_PATH, sdk.moduleEntry, "SDK module entry");

  if (!Array.isArray(sdk.wasmFiles) || sdk.wasmFiles.length !== EXPECTED_WASM_PATHS.length) {
    fail("the manifest must list exactly the four resolver-required WASM files.");
  }
  const wasmByPath = new Map(sdk.wasmFiles.map((entry) => [entry?.sourcePath, entry]));
  if (wasmByPath.size !== EXPECTED_WASM_PATHS.length || EXPECTED_WASM_PATHS.some((sourcePath) => !wasmByPath.has(sourcePath))) {
    fail("the manifest WASM paths differ from the allowlisted SDK files.");
  }

  const entries = [];
  for (const sourcePath of EXPECTED_WASM_PATHS) {
    const record = wasmByPath.get(sourcePath);
    assertPinnedRecord(record, { sourcePath, label: "SDK WASM file" });
    const inspected = await inspectSource(root, sourcePath, record, "SDK WASM file");
    entries.push({
      ...inspected,
      relativePath: `wasm/${path.posix.basename(sourcePath)}`,
    });
  }

  if (!Array.isArray(manifest.models) || manifest.models.length !== EXPECTED_MODEL_PATHS.length) {
    fail("the manifest must list exactly the reviewed Lite and Full model files.");
  }
  const modelByPath = new Map(manifest.models.map((entry) => [entry?.file, entry]));
  if (modelByPath.size !== EXPECTED_MODEL_PATHS.length || EXPECTED_MODEL_PATHS.some((sourcePath) => !modelByPath.has(sourcePath))) {
    fail("the model paths differ from the two canonical tracked inputs.");
  }

  for (const sourcePath of EXPECTED_MODEL_PATHS) {
    const record = modelByPath.get(sourcePath);
    const label = sourcePath.endsWith("lite.task") ? "Pose Landmarker Lite model" : "Pose Landmarker Full model";
    if (record.license !== "Apache-2.0") fail(`${label} license metadata is missing or changed.`);
    assertPinnedRecord({ ...record, sourcePath: record.file }, { sourcePath, label });
    const inspected = await inspectSource(root, sourcePath, record, label);
    const modelName = path.posix.basename(sourcePath);
    entries.push({
      ...inspected,
      relativePath: `models/sha256-${inspected.sha256}/${modelName}`,
    });
  }

  const noticeStats = await fs.stat(noticeAbsolute);
  if (!noticeStats.isFile()) fail("third-party notices are not a regular file.");
  const noticeHash = await hashFile(noticeAbsolute);
  if (noticeHash.sha256 !== NOTICE_SHA256) fail("third-party notices differ from the reviewed copy.");
  entries.push({
    sourcePath: noticeAbsolute,
    ...noticeHash,
    relativePath: `notices/sha256-${noticeHash.sha256}/THIRD_PARTY_NOTICES.md`,
  });

  const relativePaths = new Set(entries.map((entry) => entry.relativePath));
  if (relativePaths.size !== entries.length) fail("the generated asset plan contains duplicate destination paths.");
  return entries;
}

async function inspectExistingRelease(releaseDirectory, entries) {
  const rootStats = await fs.lstat(releaseDirectory);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    fail("the versioned generated destination is not a regular directory.");
  }

  const foundFiles = [];
  const foundDirectories = [];
  async function walk(directory, prefix = "") {
    const children = await fs.readdir(directory, { withFileTypes: true });
    for (const child of children) {
      const relative = prefix ? `${prefix}/${child.name}` : child.name;
      const absolute = path.join(directory, child.name);
      if (child.isSymbolicLink()) fail("the generated destination contains a symlink/reparse point.");
      if (child.isDirectory()) {
        foundDirectories.push(relative);
        await walk(absolute, relative);
      } else if (child.isFile()) {
        foundFiles.push({ relativePath: relative, absolutePath: absolute });
      } else {
        fail("the generated destination contains a non-file entry.");
      }
    }
  }
  await walk(releaseDirectory);

  const expectedFiles = new Map(entries.map((entry) => [entry.relativePath, entry]));
  if (foundFiles.length !== expectedFiles.size) fail("the existing generated destination contains missing or unexpected files.");
  for (const found of foundFiles) {
    const expected = expectedFiles.get(found.relativePath);
    if (!expected) fail("the existing generated destination contains an unexpected file.");
    const actual = await hashFile(found.absolutePath);
    if (actual.sha256 !== expected.sha256 || actual.sizeBytes !== expected.sizeBytes) {
      fail(`existing generated file ${found.relativePath} has changed; refusing to overwrite it.`);
    }
  }

  const expectedDirectories = new Set();
  for (const relativePath of expectedFiles.keys()) {
    const segments = relativePath.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      expectedDirectories.add(segments.slice(0, index).join("/"));
    }
  }
  if (foundDirectories.length !== expectedDirectories.size || foundDirectories.some((directory) => !expectedDirectories.has(directory))) {
    fail("the existing generated destination contains unexpected directories.");
  }
}

export async function copyFormCoachAssets({ repoRoot = process.cwd() } = {}) {
  const root = await fs.realpath(repoRoot);
  const entries = await makePlan(root);
  const publicDirectory = path.join(root, "public");
  await assertNoSymlinkAncestors(root, publicDirectory);
  const realPublicDirectory = await fs.realpath(publicDirectory);
  if (!isInside(root, realPublicDirectory)) fail("the public directory resolves outside the repository.");

  const assetsRoot = path.join(realPublicDirectory, GENERATED_ROOT);
  await assertNoSymlinkAncestors(realPublicDirectory, assetsRoot, { allowMissing: true });
  try {
    await fs.mkdir(assetsRoot);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const assetsRootStats = await fs.lstat(assetsRoot);
  if (assetsRootStats.isSymbolicLink() || !assetsRootStats.isDirectory()) {
    fail("the generated public asset root is not a regular directory.");
  }
  const realAssetsRoot = await fs.realpath(assetsRoot);
  if (!isInside(realPublicDirectory, realAssetsRoot)) fail("the generated public asset root resolves outside public/.");

  const releaseDirectory = path.join(realAssetsRoot, RELEASE_VERSION);
  await assertNoSymlinkAncestors(realAssetsRoot, releaseDirectory, { allowMissing: true });
  try {
    await fs.lstat(releaseDirectory);
    await inspectExistingRelease(releaseDirectory, entries);
    return {
      copied: false,
      outputPath: path.relative(root, releaseDirectory).split(path.sep).join("/"),
      assets: entries.map(({ relativePath, sha256, sizeBytes }) => ({
        publicPath: `/${GENERATED_ROOT}/${RELEASE_VERSION}/${relativePath}`,
        sha256,
        sizeBytes,
      })),
    };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const stageDirectory = await fs.mkdtemp(path.join(realAssetsRoot, ".stage-"));
  try {
    for (const entry of entries) {
      const destination = path.resolve(stageDirectory, ...entry.relativePath.split("/"));
      if (!isInside(stageDirectory, destination)) fail("a generated destination path escapes the staging directory.");
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(entry.sourcePath, destination, constants.COPYFILE_EXCL);
      const copied = await hashFile(destination);
      if (copied.sha256 !== entry.sha256 || copied.sizeBytes !== entry.sizeBytes) {
        fail(`staged file ${entry.relativePath} changed during copy.`);
      }
    }

    try {
      await fs.rename(stageDirectory, releaseDirectory);
    } catch (error) {
      try {
        await inspectExistingRelease(releaseDirectory, entries);
        return {
          copied: false,
          outputPath: path.relative(root, releaseDirectory).split(path.sep).join("/"),
          assets: entries.map(({ relativePath, sha256, sizeBytes }) => ({
            publicPath: `/${GENERATED_ROOT}/${RELEASE_VERSION}/${relativePath}`,
            sha256,
            sizeBytes,
          })),
        };
      } catch {
        throw error;
      }
    }

    return {
      copied: true,
      outputPath: path.relative(root, releaseDirectory).split(path.sep).join("/"),
      assets: entries.map(({ relativePath, sha256, sizeBytes }) => ({
        publicPath: `/${GENERATED_ROOT}/${RELEASE_VERSION}/${relativePath}`,
        sha256,
        sizeBytes,
      })),
    };
  } finally {
    try {
      const stageParent = await fs.realpath(path.dirname(stageDirectory));
      const stageStats = await fs.lstat(stageDirectory);
      if (
        path.basename(stageDirectory).startsWith(".stage-") &&
        stageParent === realAssetsRoot &&
        !stageStats.isSymbolicLink()
      ) {
        await fs.rm(stageDirectory, { recursive: true, force: true });
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  copyFormCoachAssets()
    .then((result) => {
      const state = result.copied ? "copied" : "verified existing";
      console.log(`[form-coach-assets] ${state} ${result.assets.length} files to ${result.outputPath}`);
      for (const asset of result.assets) console.log(`${asset.publicPath} ${asset.sizeBytes} ${asset.sha256}`);
    })
    .catch((error) => {
      console.error(`[form-coach-assets] ${error instanceof Error ? error.message : "copy failed"}`);
      process.exitCode = 1;
    });
}
