/* Frame-differencing untuk motion + centroid X. Skip area face bbox supaya
 * gerakan kepala tidak mengacaukan posisi tangan. */
import { state } from "../state";

const DIFF_W = 160, DIFF_H = 90;
const diffCanvas = document.createElement("canvas");
const diffCtx = diffCanvas.getContext("2d", { willReadFrequently: true })!;
diffCanvas.width = DIFF_W;
diffCanvas.height = DIFF_H;

const MOTION_PIXEL_THR = 18;

export function computeMotion(video: HTMLVideoElement): number {
  diffCtx.drawImage(video, 0, 0, DIFF_W, DIFF_H);
  const cur = diffCtx.getImageData(0, 0, DIFF_W, DIFF_H);
  let motionL = 0, motionR = 0, samplesL = 0, samplesR = 0;
  let wSum = 0, xWSum = 0;

  // Scale face box to diff canvas
  let fx1 = -1, fy1 = -1, fx2 = -1, fy2 = -1;
  if (state.lastFaceBox) {
    const sx = DIFF_W / video.videoWidth;
    const sy = DIFF_H / video.videoHeight;
    fx1 = state.lastFaceBox.x * sx;
    fy1 = state.lastFaceBox.y * sy;
    fx2 = (state.lastFaceBox.x + state.lastFaceBox.width) * sx;
    fy2 = (state.lastFaceBox.y + state.lastFaceBox.height) * sy;
  }

  if (state.prevFrame) {
    const a = cur.data, b = state.prevFrame.data;
    const half = DIFF_W / 2;
    for (let y = 0; y < DIFF_H; y += 2) {
      for (let x = 0; x < DIFF_W; x += 2) {
        const i = (y * DIFF_W + x) * 4;
        const d = (Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!)) / 3;
        if (x < half) { motionL += d; samplesL += 1; }
        else { motionR += d; samplesR += 1; }
        const inFace = state.lastFaceBox && x >= fx1 && x <= fx2 && y >= fy1 && y <= fy2;
        if (!inFace && d > MOTION_PIXEL_THR) {
          wSum += d;
          xWSum += d * x;
        }
      }
    }
    motionL = samplesL ? motionL / samplesL : 0;
    motionR = samplesR ? motionR / samplesR : 0;
  }
  state.prevFrame = cur;
  state.motionLeft = motionL;
  state.motionRight = motionR;
  if (wSum > 5) {
    state.centroidX = 1 - (xWSum / wSum / DIFF_W);
    state.centroidValid = true;
  } else {
    state.centroidValid = false;
  }
  return (motionL + motionR) / 2;
}
