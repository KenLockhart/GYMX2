# Form Coach reference capture UI

`src/components/form-coach/reference-capture.tsx` is a reusable client component for a future coach authoring screen. It is intentionally unwired: no route imports it yet.

The caller supplies a `baseTemplate`, a caller-owned `liveStream`, an `enabled` eligibility flag, and an optional `onReferenceBuilt` callback. `enabled` defaults to `false`. The component never calls `getUserMedia`; the authoring screen owns camera permission and the stream. The component asks the existing `startFormCoachReferenceCapture` runtime to start only after the coach presses **Start capture**. The callback prop is intended to come from a client-side authoring wrapper because Next.js client-component props crossing directly from a Server Component must be serializable.

The flow is one-way for each local session: capture, pause, review, select three to five clean logical repetitions, and build a numeric template. The current runtime has no resume operation, so review is final for that run. **Discard capture** clears a final review or built result and stops the old session; **Start a new capture** also discards the old state before starting a fresh generation. Stopping or discarding pauses and detaches the component's video element, but the caller owns the supplied stream and its tracks remain untouched. Source stream, eligibility, or base-template changes stop the old session and clear its local UI state. The component never stops caller-owned stream tracks.

This slice accepts a caller-supplied live stream only. Local-file capture is deferred and is not implemented here.

The UI keeps only the runtime's allowlisted numeric candidate summaries in React state. Raw frames, pose landmarks, and rep curves stay in the existing local worker/store. A successful build passes the runtime-validated `ExerciseTemplate` numeric aggregate to `onReferenceBuilt`; this UI does not save, upload, publish, create an assessment, or request a summary. It does not use `MediaRecorder` or create an encoded recording. Text and controls describe local reference reps, not saved video.

The component has been tested with synthetic streams, a mocked runtime, and ReactDOM-mounted interactions, including disposal from review and ready, cancellation during pending video/runtime/build work, disable/unmount cleanup, stale callback fencing, selection limits, and malformed runtime replies. No real camera, browser model load, pose performance, server persistence, or provider workflow has been exercised by this UI slice.
