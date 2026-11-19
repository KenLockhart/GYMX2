import { describe, expect, it, vi } from "vitest";
import {
  createDetectorLoader,
  FORM_COACH_ASSET_PATHS,
  FORM_COACH_WASM_BASE_PATH,
  type DetectorCreateOptions,
  type DetectorSdkFacade,
  type PoseDetectorHandle,
} from "./detector-loader";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function detector() {
  return { close: vi.fn() } satisfies PoseDetectorHandle;
}

function facade(overrides: Partial<DetectorSdkFacade> = {}): DetectorSdkFacade {
  return {
    createFileset: vi.fn(async () => ({ wasm: "mock-fileset" })),
    createPoseDetector: vi.fn(async () => detector()),
    ...overrides,
  };
}

function dependencies(sdk: DetectorSdkFacade = facade()) {
  const calls: string[] = [];
  const assetPaths: string[] = [];
  const deps = {
    installRequestGuard: vi.fn(() => {
      calls.push("guard");
    }),
    isAssetAllowed: vi.fn((path: string) => {
      calls.push(`asset:${path}`);
      assetPaths.push(path);
      return true;
    }),
    loadSdk: vi.fn(async () => {
      calls.push("load-sdk");
      return sdk;
    }),
    createGpuCanvas: vi.fn(() => {
      calls.push("gpu-canvas");
      return { kind: "fresh-gpu-canvas" };
    }),
    disposeGpuAttempt: vi.fn(() => {
      calls.push("dispose-gpu");
      return true;
    }),
  };
  return { deps, calls, assetPaths };
}

describe("injected Form Coach detector loader", () => {
  it("keeps import inert and installs the request guard before the injected SDK loader", async () => {
    const sdk = facade();
    const { deps, calls, assetPaths } = dependencies(sdk);
    const loader = createDetectorLoader(deps);

    expect(loader.getState()).toBe("idle");
    expect(calls).toEqual([]);
    expect(deps.loadSdk).not.toHaveBeenCalled();

    const result = await loader.start("lite");
    expect(result.status).toBe("ready");
    expect(loader.getState()).toBe("ready");
    expect(calls[0]).toBe("guard");
    expect(calls.indexOf("load-sdk")).toBeGreaterThan(calls.indexOf(`asset:${FORM_COACH_ASSET_PATHS.liteModel}`));
    expect(assetPaths).toEqual([
      FORM_COACH_ASSET_PATHS.wasmModuleLoader,
      FORM_COACH_ASSET_PATHS.wasmModuleBinary,
      FORM_COACH_ASSET_PATHS.liteModel,
    ]);
    expect(sdk.createFileset).toHaveBeenCalledWith(FORM_COACH_WASM_BASE_PATH, true);
    expect(sdk.createPoseDetector).toHaveBeenCalledWith(
      { wasm: "mock-fileset" },
      expect.objectContaining<Partial<DetectorCreateOptions>>({
        modelAssetPath: FORM_COACH_ASSET_PATHS.liteModel,
        delegate: "GPU",
        runningMode: "VIDEO",
        numPoses: 1,
        outputSegmentationMasks: false,
      }),
    );
  });

  it("rejects an unapproved asset before loading the SDK", async () => {
    const sdk = facade();
    const { deps } = dependencies(sdk);
    deps.isAssetAllowed.mockImplementation((path) => path !== FORM_COACH_ASSET_PATHS.liteModel);
    const loader = createDetectorLoader(deps);

    expect(await loader.start("lite")).toEqual({ status: "failed", code: "asset-not-allowed" });
    expect(deps.loadSdk).not.toHaveBeenCalled();
    expect(sdk.createPoseDetector).not.toHaveBeenCalled();
  });

  it("uses only the selected fixed model path and allows one clean GPU-to-CPU retry", async () => {
    const options: DetectorCreateOptions[] = [];
    const { deps, calls } = dependencies();
    const sdk = facade({
      createPoseDetector: vi.fn(async (_fileset, value) => {
        calls.push(`create-${value.delegate}`);
        options.push(value);
        if (value.delegate === "GPU") throw new Error("unsafe raw error text is not surfaced");
        return detector();
      }),
    });
    deps.loadSdk.mockResolvedValue(sdk);
    const loader = createDetectorLoader(deps);

    const result = await loader.start("full");
    expect(result).toMatchObject({ status: "ready", model: "full", delegate: "CPU" });
    expect(options.map((value) => value.delegate)).toEqual(["GPU", "CPU"]);
    expect(options[0]?.modelAssetPath).toBe(FORM_COACH_ASSET_PATHS.fullModel);
    expect(options[1]?.modelAssetPath).toBe(FORM_COACH_ASSET_PATHS.fullModel);
    expect(options[0]?.gpuCanvas).toBeDefined();
    expect(options[1]?.gpuCanvas).toBeUndefined();
    expect(calls.indexOf("dispose-gpu")).toBeLessThan(calls.indexOf("create-CPU"));
    expect(deps.createGpuCanvas).toHaveBeenCalledTimes(1);
  });

  it("fails closed without CPU retry when GPU cleanup is uncertain", async () => {
    const sdk = facade({
      createPoseDetector: vi.fn(async (_fileset, options) => {
        if (options.delegate === "GPU") throw new Error("private SDK detail");
        return detector();
      }),
    });
    const { deps } = dependencies(sdk);
    deps.disposeGpuAttempt.mockReturnValue(false);
    const loader = createDetectorLoader(deps);

    expect(await loader.start("lite")).toEqual({ status: "failed", code: "gpu-cleanup-failed" });
    expect(sdk.createPoseDetector).toHaveBeenCalledTimes(1);
  });

  it("lets stop win over a pending SDK import and never creates a detector", async () => {
    const sdkDeferred = deferred<DetectorSdkFacade>();
    const loadStarted = deferred<void>();
    const { deps } = dependencies();
    deps.loadSdk.mockImplementation(() => {
      loadStarted.resolve();
      return sdkDeferred.promise;
    });
    const loader = createDetectorLoader(deps);

    const pending = loader.start("lite");
    await loadStarted.promise;
    await loader.stop();
    sdkDeferred.resolve(facade());

    expect(await pending).toEqual({ status: "failed", code: "stopped" });
    expect(loader.getState()).toBe("stopped");
  });

  it("closes a late GPU detector after stop and never attempts CPU", async () => {
    const gpuDeferred = deferred<PoseDetectorHandle>();
    const gpuCreated = deferred<void>();
    const sdk = facade({
      createPoseDetector: vi.fn((_fileset, options) => {
        if (options.delegate === "GPU") {
          gpuCreated.resolve();
          return gpuDeferred.promise;
        }
        return Promise.resolve(detector());
      }),
    });
    const { deps } = dependencies(sdk);
    const loader = createDetectorLoader(deps);
    const pending = loader.start("lite");
    await gpuCreated.promise;
    await loader.stop();
    const lateDetector = detector();
    gpuDeferred.resolve(lateDetector);

    expect(await pending).toEqual({ status: "failed", code: "stopped" });
    expect(lateDetector.close).toHaveBeenCalledTimes(1);
    expect(sdk.createPoseDetector).toHaveBeenCalledTimes(1);
  });

  it("closes a late CPU detector after stop during the one permitted fallback", async () => {
    const cpuDeferred = deferred<PoseDetectorHandle>();
    const cpuCreated = deferred<void>();
    const sdk = facade({
      createPoseDetector: vi.fn((_fileset, options) => {
        if (options.delegate === "GPU") return Promise.reject(new Error("GPU initialization failed"));
        cpuCreated.resolve();
        return cpuDeferred.promise;
      }),
    });
    const { deps } = dependencies(sdk);
    const loader = createDetectorLoader(deps);
    const pending = loader.start("lite");
    await cpuCreated.promise;
    await loader.stop();
    const lateDetector = detector();
    cpuDeferred.resolve(lateDetector);

    expect(await pending).toEqual({ status: "failed", code: "stopped" });
    expect(lateDetector.close).toHaveBeenCalledTimes(1);
    expect(sdk.createPoseDetector).toHaveBeenCalledTimes(2);
  });

  it("closes ready detector resources on explicit stop and refuses reuse", async () => {
    const readyDetector = detector();
    const sdk = facade({ createPoseDetector: vi.fn(async () => readyDetector) });
    const { deps } = dependencies(sdk);
    const loader = createDetectorLoader(deps);
    await loader.start("lite");

    await loader.stop();
    expect(readyDetector.close).toHaveBeenCalledTimes(1);
    expect(deps.disposeGpuAttempt).toHaveBeenCalledTimes(1);
    expect(loader.getState()).toBe("stopped");
    expect(await loader.start("lite")).toEqual({ status: "failed", code: "stopped" });
  });
});
