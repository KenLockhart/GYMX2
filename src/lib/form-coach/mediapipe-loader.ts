import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import type { DetectorCreateOptions, DetectorSdkFacade, PoseDetectorHandle } from "./detector-loader";

type MediaPipeModule = typeof import("@mediapipe/tasks-vision");

/** This dynamic import must remain behind the request guard in the Worker. */
export async function loadMediaPipeSdk(): Promise<DetectorSdkFacade> {
  const vision: MediaPipeModule = await import("@mediapipe/tasks-vision");
  return {
    createFileset(wasmBasePath, useModule) {
      return vision.FilesetResolver.forVisionTasks(wasmBasePath, useModule);
    },
    createPoseDetector(fileset, options: DetectorCreateOptions) {
      const canvas = options.delegate === "GPU" ? (options.gpuCanvas as OffscreenCanvas) : undefined;
      return vision.PoseLandmarker.createFromOptions(fileset as Parameters<typeof PoseLandmarker.createFromOptions>[0], {
        baseOptions: {
          modelAssetPath: options.modelAssetPath,
          delegate: options.delegate,
        },
        ...(canvas ? { canvas } : {}),
        runningMode: options.runningMode,
        numPoses: options.numPoses,
        outputSegmentationMasks: options.outputSegmentationMasks,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      }) as Promise<PoseDetectorHandle & PoseLandmarker>;
    },
  };
}
