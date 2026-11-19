export type FormCoachModel = "lite" | "full";
export type DetectorDelegate = "GPU" | "CPU";
export type DetectorLoaderState = "idle" | "loading" | "ready" | "failed" | "stopped";

const ASSET_ROOT = "/form-coach-assets/1.2.3-assets1";
const LITE_MODEL_HASH = "59929E1D1EE95287735DDD833B19CF4AC46D29BC7AFDDBBF6753C459690D574A";
const FULL_MODEL_HASH = "4EAA5EB7A98365221087693FCC286334CF0858E2EB6E15B506AA4A7ECDCEC4AD";
const NOTICE_HASH = "990FC65872D97964D2C68AD4AA3906610D9D43B9290B390A744F5466D083994B";
export const FORM_COACH_WASM_BASE_PATH = `${ASSET_ROOT}/wasm/`;

/** Public output paths produced by the offline, hash-pinned asset copy step. */
export const FORM_COACH_ASSET_PATHS = Object.freeze({
  wasmClassicLoader: `${ASSET_ROOT}/wasm/vision_wasm_internal.js`,
  wasmClassicBinary: `${ASSET_ROOT}/wasm/vision_wasm_internal.wasm`,
  wasmModuleLoader: `${ASSET_ROOT}/wasm/vision_wasm_module_internal.js`,
  wasmModuleBinary: `${ASSET_ROOT}/wasm/vision_wasm_module_internal.wasm`,
  liteModel: `${ASSET_ROOT}/models/sha256-${LITE_MODEL_HASH}/pose_landmarker_lite.task`,
  fullModel: `${ASSET_ROOT}/models/sha256-${FULL_MODEL_HASH}/pose_landmarker_full.task`,
  notice: `${ASSET_ROOT}/notices/sha256-${NOTICE_HASH}/THIRD_PARTY_NOTICES.md`,
});

export type DetectorCreateOptions = Readonly<{
  modelAssetPath: string;
  delegate: DetectorDelegate;
  runningMode: "VIDEO";
  numPoses: 1;
  outputSegmentationMasks: false;
  /** Only supplied for the GPU attempt; CPU fallback must not reuse it. */
  gpuCanvas?: unknown;
}>;

export interface PoseDetectorHandle {
  close(): void;
}

/** An injected boundary for a future browser-only adapter. This module imports no SDK. */
export interface DetectorSdkFacade {
  createFileset(wasmBasePath: string, useModule: true): Promise<unknown>;
  createPoseDetector(fileset: unknown, options: DetectorCreateOptions): Promise<PoseDetectorHandle>;
}

export type DetectorLoadFailure =
  | "invalid-model"
  | "guard-install-failed"
  | "asset-not-allowed"
  | "sdk-load-failed"
  | "fileset-failed"
  | "gpu-init-failed"
  | "gpu-cleanup-failed"
  | "cpu-init-failed"
  | "already-started"
  | "stopped";

export type DetectorLoadResult =
  | Readonly<{
      status: "ready";
      model: FormCoachModel;
      delegate: DetectorDelegate;
      detector: PoseDetectorHandle;
    }>
  | Readonly<{ status: "failed"; code: DetectorLoadFailure }>;

export interface DetectorLoaderDependencies {
  /** Must install the caller's defense-in-depth request guard before loading the SDK module. */
  installRequestGuard(): void | Promise<void>;
  /** Checks an exact fixed public asset path; it performs no network request. */
  isAssetAllowed(path: string): boolean | Promise<boolean>;
  /** Supplied by a future adapter as an explicit dynamic import; never called on module import. */
  loadSdk(): Promise<DetectorSdkFacade>;
  createGpuCanvas(): unknown;
  /**
   * Confirms all resources for an attempt are released, including partial SDK allocation. Returns
   * false if cleanup is uncertain; the loader then fails closed and must not try CPU in this Worker.
   */
  disposeGpuAttempt(canvas: unknown | null, detector: PoseDetectorHandle | null): boolean | Promise<boolean>;
}

export interface DetectorLoader {
  getState(): DetectorLoaderState;
  start(model: FormCoachModel): Promise<DetectorLoadResult>;
  stop(): Promise<void>;
}

function modelPath(model: FormCoachModel): string | null {
  if (model === "lite") return FORM_COACH_ASSET_PATHS.liteModel;
  if (model === "full") return FORM_COACH_ASSET_PATHS.fullModel;
  return null;
}

/**
 * Creates a single-use, injected detector loader. Importing this module performs no work and has
 * no MediaPipe import. The future Worker must already have an observed restrictive response CSP;
 * this injected guard is defense in depth, not a privacy boundary or proof of local-only traffic.
 */
export function createDetectorLoader(dependencies: DetectorLoaderDependencies): DetectorLoader {
  let state: DetectorLoaderState = "idle";
  let epoch = 0;
  let detector: PoseDetectorHandle | null = null;
  let detectorCanvas: unknown | null = null;

  const getState = () => state;
  const isCurrent = (runEpoch: number) => epoch === runEpoch && state === "loading";

  async function disposeGpuAttempt(
    canvas: unknown | null,
    candidate: PoseDetectorHandle | null,
  ): Promise<boolean> {
    if (canvas === null) return true;
    try {
      return await dependencies.disposeGpuAttempt(canvas, candidate);
    } catch {
      return false;
    }
  }

  function closeDetector(candidate: PoseDetectorHandle | null): boolean {
    if (!candidate) return true;
    try {
      candidate.close();
      return true;
    } catch {
      return false;
    }
  }

  function fail(code: DetectorLoadFailure, runEpoch: number): DetectorLoadResult {
    if (isCurrent(runEpoch)) state = "failed";
    return { status: "failed", code: state === "stopped" ? "stopped" : code };
  }

  async function allowedAssets(paths: readonly string[]): Promise<boolean> {
    for (const path of paths) {
      if (!(await dependencies.isAssetAllowed(path))) return false;
    }
    return true;
  }

  async function makeDetector(
    sdk: DetectorSdkFacade,
    fileset: unknown,
    path: string,
    delegate: DetectorDelegate,
    canvas?: unknown,
  ): Promise<PoseDetectorHandle> {
    return sdk.createPoseDetector(fileset, {
      modelAssetPath: path,
      delegate,
      runningMode: "VIDEO",
      numPoses: 1,
      outputSegmentationMasks: false,
      ...(delegate === "GPU" ? { gpuCanvas: canvas } : {}),
    });
  }

  async function stopStaleAttempt(
    candidate: PoseDetectorHandle | null,
    canvas: unknown | null,
  ): Promise<DetectorLoadResult> {
    const detectorClosed = closeDetector(candidate);
    const resourcesReleased = await disposeGpuAttempt(canvas, candidate);
    return {
      status: "failed",
      code: detectorClosed && resourcesReleased ? "stopped" : "gpu-cleanup-failed",
    };
  }

  async function start(model: FormCoachModel): Promise<DetectorLoadResult> {
    if (state !== "idle") {
      return { status: "failed", code: state === "stopped" ? "stopped" : "already-started" };
    }
    const selectedModelPath = modelPath(model);
    if (!selectedModelPath) {
      state = "failed";
      return { status: "failed", code: "invalid-model" };
    }

    state = "loading";
    const runEpoch = ++epoch;
    try {
      await dependencies.installRequestGuard();
    } catch {
      return fail("guard-install-failed", runEpoch);
    }
    if (!isCurrent(runEpoch)) return { status: "failed", code: "stopped" };

    const requiredPaths = [
      FORM_COACH_ASSET_PATHS.wasmModuleLoader,
      FORM_COACH_ASSET_PATHS.wasmModuleBinary,
      selectedModelPath,
    ];
    try {
      if (!(await allowedAssets(requiredPaths))) return fail("asset-not-allowed", runEpoch);
    } catch {
      return fail("asset-not-allowed", runEpoch);
    }
    if (!isCurrent(runEpoch)) return { status: "failed", code: "stopped" };

    let sdk: DetectorSdkFacade;
    try {
      sdk = await dependencies.loadSdk();
    } catch {
      return fail("sdk-load-failed", runEpoch);
    }
    if (!isCurrent(runEpoch)) return { status: "failed", code: "stopped" };

    let fileset: unknown;
    try {
      fileset = await sdk.createFileset(FORM_COACH_WASM_BASE_PATH, true);
    } catch {
      return fail("fileset-failed", runEpoch);
    }
    if (!isCurrent(runEpoch)) return { status: "failed", code: "stopped" };

    let gpuCanvas: unknown | null = null;
    let gpuDetector: PoseDetectorHandle | null = null;
    try {
      gpuCanvas = dependencies.createGpuCanvas();
      if (gpuCanvas === null || gpuCanvas === undefined) throw new Error("GPU resource unavailable");
      gpuDetector = await makeDetector(sdk, fileset, selectedModelPath, "GPU", gpuCanvas);
    } catch {
      if (!isCurrent(runEpoch)) return stopStaleAttempt(gpuDetector, gpuCanvas);
      const cleaned = await disposeGpuAttempt(gpuCanvas, gpuDetector);
      if (!isCurrent(runEpoch)) {
        return { status: "failed", code: cleaned ? "stopped" : "gpu-cleanup-failed" };
      }
      if (!cleaned) return fail("gpu-cleanup-failed", runEpoch);
      gpuCanvas = null;

      let cpuDetector: PoseDetectorHandle;
      try {
        cpuDetector = await makeDetector(sdk, fileset, selectedModelPath, "CPU");
      } catch {
        return fail("cpu-init-failed", runEpoch);
      }
      if (!isCurrent(runEpoch)) return stopStaleAttempt(cpuDetector, null);
      detector = cpuDetector;
      detectorCanvas = null;
      state = "ready";
      return { status: "ready", model, delegate: "CPU", detector: cpuDetector };
    }

    if (!isCurrent(runEpoch)) return stopStaleAttempt(gpuDetector, gpuCanvas);
    detector = gpuDetector;
    detectorCanvas = gpuCanvas;
    state = "ready";
    return { status: "ready", model, delegate: "GPU", detector: gpuDetector };
  }

  async function stop(): Promise<void> {
    if (state === "stopped" || state === "failed") return;
    epoch += 1;
    state = "stopped";
    const currentDetector = detector;
    const currentCanvas = detectorCanvas;
    detector = null;
    detectorCanvas = null;
    const detectorClosed = closeDetector(currentDetector);
    const resourcesReleased = await disposeGpuAttempt(currentCanvas, currentDetector);
    if (!detectorClosed || !resourcesReleased) state = "failed";
  }

  return { getState, start, stop };
}
