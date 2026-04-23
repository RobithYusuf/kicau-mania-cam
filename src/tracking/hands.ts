/* MediaPipe Tasks Vision — HandLandmarker (generation 2, maintained).
 * Pakai world landmarks (3D meter-space, origin di hand center) supaya
 * swing detection bisa pakai velocity nyata, bukan proxy 2D.
 * GPU delegate → cepat + stabil. Model full (bukan lite) → akurat jarak jauh.
 */
import { HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { state } from "../state";

let detector: HandLandmarker | null = null;
let lastVideoTime = -1;

const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export async function setupHands(): Promise<void> {
  try {
    const fileset = await FilesetResolver.forVisionTasks(WASM_ROOT);
    detector = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: "GPU",
      },
      numHands: 2,
      runningMode: "VIDEO",
      minHandDetectionConfidence: 0.4,
      minHandPresenceConfidence: 0.4,
      minTrackingConfidence: 0.4,
    });
    state.handsReady = true;
  } catch (e) {
    if (import.meta.env.DEV) console.warn("[HANDS] setup failed:", e);
    state.handsLoadFailed = true;
  }
}

/** Call per-frame. Synchronous — tidak ada promise async seperti legacy. */
export function runHandsOnce(video: HTMLVideoElement): void {
  if (!detector || !state.running) return;
  if (video.readyState < 2 || video.videoWidth === 0) return;

  const now = performance.now();
  // detectForVideo butuh timestamp monotonically increasing
  if (now <= lastVideoTime) return;
  lastVideoTime = now;

  let res;
  try {
    res = detector.detectForVideo(video, now);
  } catch { return; }

  const imageLms = res.landmarks || [];
  const worldLms = res.worldLandmarks || [];

  if (imageLms.length === 0) {
    if (now - state.handLastSeenAt > 500) state.handPresent = false;
    // Reset sample count supaya velocity pertama saat tangan muncul lagi tidak dipakai
    // (prev coords sudah stale → delta besar = spike palsu)
    state.wristSampleCount = 0;
    return;
  }

  // Pilih tangan yang paling dekat ke center x (kemungkinan besar tangan user yang gerak)
  let bestIdx = 0, bestDist = Infinity;
  for (let i = 0; i < imageLms.length; i++) {
    const palm = imageLms[i]![9]!;  // middle finger MCP as palm center
    const d = Math.abs(palm.x - 0.5);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }

  const img = imageLms[bestIdx]!;
  const world = worldLms[bestIdx];
  const palm = img[9]!;

  // Image-space x untuk overlay (mirror karena video ditampilkan scaleX(-1))
  state.handX = 1 - palm.x;
  state.handPresent = true;
  state.handLastSeenAt = now;
  state.handSource = "mp";

  // World-space wrist (landmark 0) — satuan meter, origin ~hand center.
  // Z negatif = maju ke kamera (di MediaPipe world coords).
  if (world && world[0]) {
    const wrist = world[0];
    state.wristPrevX = state.wristWorldX;
    state.wristPrevZ = state.wristWorldZ;
    state.wristWorldX = wrist.x;
    state.wristWorldY = wrist.y;
    state.wristWorldZ = wrist.z;
    state.wristSampleCount++;
  }
}
