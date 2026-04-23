/* MediaPipe Hands wrapper. Pakai script yang di-load via index.html (bukan ESM)
 * karena CDN package @mediapipe/hands tidak punya ES module export proper. */
import { state } from "../state";

declare const Hands: any;

let detector: any = null;
let inflight = false;

export async function setupHands(cdnPath = "https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240"): Promise<void> {
  if (typeof Hands !== "function") {
    console.warn("[HANDS] global Hands not loaded");
    state.handsLoadFailed = true;  // MP gagal total — aktifkan centroid fallback
    return;
  }
  detector = new Hands({ locateFile: (f: string) => `${cdnPath}/${f}` });
  detector.setOptions({
    maxNumHands: 2,
    modelComplexity: 0,
    minDetectionConfidence: 0.35,
    minTrackingConfidence: 0.30,
  });
  detector.onResults(onResults);
  if (typeof detector.initialize === "function") await detector.initialize();
  state.handsReady = true;
}

interface MpLandmark { x: number; y: number; z?: number; }
interface MpResults { multiHandLandmarks?: MpLandmark[][]; }

function onResults(results: MpResults): void {
  const list = results?.multiHandLandmarks || [];
  if (list.length === 0) {
    state.handPresent = false;
    return;
  }
  let bestDist = -1, bestX: number | null = null, bestScale = 0;
  for (const lm of list) {
    const palm = lm[9]!;
    const distFromCenter = Math.abs(palm.x - 0.5);
    if (distFromCenter > bestDist) {
      bestDist = distFromCenter;
      bestX = palm.x;
      // Hand scale: jarak wrist(0) ke middle_finger_mcp(9) di image coords
      // Makin besar = tangan makin dekat ke kamera (maju)
      const wrist = lm[0]!;
      const dx = wrist.x - palm.x, dy = wrist.y - palm.y;
      bestScale = Math.sqrt(dx * dx + dy * dy);
    }
  }
  if (bestX !== null) {
    state.handX = 1 - bestX;
    state.handScaleRaw = bestScale;
    state.handPresent = true;
    state.handLastSeenAt = performance.now();
    state.handSource = "mp";
  }
}

export async function runHandsOnce(video: HTMLVideoElement): Promise<void> {
  if (!detector || !state.running || inflight) return;
  inflight = true;
  try { await detector.send({ image: video }); } catch { /* */ }
  inflight = false;
  if (performance.now() - state.handLastSeenAt > 700) state.handPresent = false;
}
