import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const SDK_VERSION = "1.2.3";
const ENTRY_PATH = "src/workers/form-coach-pose.worker.ts";
const ASSET_ROOT = "public/form-coach-assets/form-coach-worker";
const MANIFEST_RELATIVE_PATH = `${ASSET_ROOT}/manifest.json`;
const MANIFEST_URL = "/form-coach-assets/form-coach-worker/manifest.json";
const HASH_PATTERN = /^[a-f0-9]{64}$/;

function fail(message) {
  throw new Error(`Form Coach Worker build: ${message}`);
}

function toPortablePath(value) {
  return value.split(path.sep).join("/");
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

async function assertNoLinkedAncestors(root, absolutePath) {
  const relative = path.relative(root, absolutePath);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    fail("an output path escapes the repository.");
  }
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) fail("an output path contains a symlink or reparse point.");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

async function ensureDirectory(root, directory) {
  await assertNoLinkedAncestors(root, directory);
  await fs.mkdir(directory, { recursive: true });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("an output directory is not a regular directory.");
}

async function hashBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function checkExistingNamespace(directory, files) {
  let rootStat;
  try {
    rootStat = await fs.lstat(directory);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail("the hashed output path is not a regular directory.");

  const expected = new Map(files.map((file) => [file.relativePath, file]));
  const found = [];
  async function visit(current, prefix = "") {
    for (const item of await fs.readdir(current, { withFileTypes: true })) {
      const relativePath = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isSymbolicLink()) fail("the hashed output path contains a symlink or reparse point.");
      if (item.isDirectory()) {
        await visit(path.join(current, item.name), relativePath);
      } else if (item.isFile()) {
        found.push(relativePath);
      } else {
        fail("the hashed output path contains an unsupported file type.");
      }
    }
  }
  await visit(directory);
  if (found.length !== expected.size || found.some((name) => !expected.has(name))) {
    fail("the hashed output path contains unexpected or missing files.");
  }
  for (const relativePath of found) {
    const existing = await fs.readFile(path.join(directory, ...relativePath.split("/")));
    const planned = expected.get(relativePath);
    if (existing.length !== planned.bytes.length || (await hashBytes(existing)) !== planned.sha256) {
      fail("an existing hashed Worker file differs from its generated content.");
    }
  }
  return true;
}

async function publishNamespace(root, directory, files) {
  await ensureDirectory(root, path.dirname(directory));
  if (await checkExistingNamespace(directory, files)) return;
  await fs.mkdir(directory);
  for (const file of files) {
    const destination = path.join(directory, ...file.relativePath.split("/"));
    await ensureDirectory(root, path.dirname(destination));
    await fs.writeFile(destination, file.bytes, { flag: "wx" });
  }
}

async function writeManifest(root, absolutePath, contents) {
  await ensureDirectory(root, path.dirname(absolutePath));
  try {
    const stat = await fs.lstat(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink()) fail("the Worker manifest path is not a regular file.");
    const existing = await fs.readFile(absolutePath, "utf8");
    if (existing === contents) return;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await fs.writeFile(absolutePath, contents, "utf8");
}

export async function buildFormCoachWorker(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")) {
  const repositoryRoot = path.resolve(root);
  const entry = path.join(repositoryRoot, ENTRY_PATH);
  const outputRoot = path.join(repositoryRoot, ASSET_ROOT);
  if (!isInside(repositoryRoot, entry) || !isInside(repositoryRoot, outputRoot)) {
    fail("the build input or output path is outside the repository.");
  }
  await assertNoLinkedAncestors(repositoryRoot, entry);
  const entryStat = await fs.lstat(entry);
  if (!entryStat.isFile() || entryStat.isSymbolicLink()) fail("the Worker entry is not a regular file.");

  const result = await build({
    entryPoints: [entry],
    absWorkingDir: repositoryRoot,
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    target: ["es2022"],
    outdir: path.join(repositoryRoot, ".next", "form-coach-worker-build"),
    entryNames: "worker",
    chunkNames: "chunks/[name]-[hash]",
    assetNames: "assets/[name]-[hash]",
    write: false,
    minify: true,
    legalComments: "none",
    sourcemap: false,
    treeShaking: true,
    logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
    metafile: true,
  });

  const files = await Promise.all(result.outputFiles.map(async (output) => {
    const relativePath = toPortablePath(path.relative(path.join(repositoryRoot, ".next", "form-coach-worker-build"), output.path));
    if (
      relativePath.length === 0 ||
      relativePath.startsWith("../") ||
      path.posix.isAbsolute(relativePath) ||
      relativePath.includes("\\")
    ) {
      fail("the bundler emitted a path outside its expected output directory.");
    }
    const bytes = Buffer.from(output.contents);
    return { relativePath, bytes, sha256: await hashBytes(bytes) };
  }));
  if (files.length < 2 || !files.some((file) => file.relativePath === "worker.js")) {
    fail("the ESM build did not produce the Worker entry and a separate SDK chunk.");
  }
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  const hash = createHash("sha256");
  hash.update(`@mediapipe/tasks-vision@${SDK_VERSION}\0`);
  for (const file of files) {
    hash.update(file.relativePath);
    hash.update("\0");
    hash.update(file.sha256);
    hash.update("\0");
  }
  const namespaceHash = hash.digest("hex");
  if (!HASH_PATTERN.test(namespaceHash)) fail("the generated namespace hash is invalid.");

  const namespace = path.join(outputRoot, namespaceHash);
  await publishNamespace(repositoryRoot, namespace, files);
  const manifest = {
    version: 1,
    sdkVersion: SDK_VERSION,
    workerUrl: `/form-coach-worker/${namespaceHash}/worker.js`,
    bundleHash: namespaceHash,
    files: files.map(({ relativePath, sha256 }) => ({ path: relativePath, sha256 })),
  };
  const manifestText = `${JSON.stringify(manifest)}\n`;
  await writeManifest(repositoryRoot, path.join(repositoryRoot, MANIFEST_RELATIVE_PATH), manifestText);

  return { workerUrl: manifest.workerUrl, bundleHash: namespaceHash, fileCount: files.length, manifestUrl: MANIFEST_URL };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const result = await buildFormCoachWorker();
    process.stdout.write(`Form Coach Worker ready: ${result.workerUrl} (${result.fileCount} files, ${result.bundleHash})\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown build error";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
