import * as faceapi from "@vladmandic/face-api";
import type { Pt2, FaceResult } from "../types";

let modelsReady = false;

export async function loadFaceModels(modelUrl: string): Promise<void> {
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(modelUrl),
    faceapi.nets.faceLandmark68Net.loadFromUri(modelUrl),
    faceapi.nets.faceExpressionNet.loadFromUri(modelUrl),
  ]);
  modelsReady = true;
}

export function isReady(): boolean { return modelsReady; }

const detectorOptions = new faceapi.TinyFaceDetectorOptions({
  inputSize: 416,
  scoreThreshold: 0.3,
});

export async function detectFace(video: HTMLVideoElement): Promise<FaceResult | null> {
  const det = await faceapi
    .detectSingleFace(video, detectorOptions)
    .withFaceLandmarks()
    .withFaceExpressions();
  if (!det) return null;

  const landmarks = det.landmarks.positions.map((p) => ({ x: p.x, y: p.y }));
  return {
    box: {
      x: det.detection.box.x,
      y: det.detection.box.y,
      width: det.detection.box.width,
      height: det.detection.box.height,
    },
    landmarks,
    pitch: estimatePitchDeg(landmarks),
    mouthGap: mouthInnerGapRatio(landmarks),
    expression: topExpression(det.expressions as unknown as Record<string, number>),
  };
}

function avgPoint(list: Pt2[]): Pt2 {
  let x = 0, y = 0;
  for (const p of list) { x += p.x; y += p.y; }
  return { x: x / list.length, y: y / list.length };
}
function dist(a: Pt2, b: Pt2): number {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Approximate head pitch (positif = dongak ke atas) dari rasio nose-tip vs midEye→chin */
export function estimatePitchDeg(pts: Pt2[]): number {
  const noseTip = pts[30]!;
  const chin = pts[8]!;
  const leftEye = avgPoint(pts.slice(36, 42));
  const rightEye = avgPoint(pts.slice(42, 48));
  const midEye = { x: (leftEye.x + rightEye.x) / 2, y: (leftEye.y + rightEye.y) / 2 };
  const total = dist(midEye, chin);
  if (total < 1) return 0;
  return (0.5 - dist(midEye, noseTip) / total) * 80;
}

/** Mouth-closed: jarak inner lip atas-bawah / tinggi wajah */
export function mouthInnerGapRatio(pts: Pt2[]): number {
  const top = pts[62]!;
  const bot = pts[66]!;
  const chin = pts[8]!;
  const leftEye = avgPoint(pts.slice(36, 42));
  const rightEye = avgPoint(pts.slice(42, 48));
  const midEye = { x: (leftEye.x + rightEye.x) / 2, y: (leftEye.y + rightEye.y) / 2 };
  const faceH = dist(midEye, chin);
  if (faceH < 1) return 0;
  return dist(top, bot) / faceH;
}

function topExpression(map: Record<string, number>): { label: string; score: number } {
  let best = { label: "neutral", score: 0 };
  for (const k of Object.keys(map)) {
    if (map[k]! > best.score) best = { label: k, score: map[k]! };
  }
  return best;
}
