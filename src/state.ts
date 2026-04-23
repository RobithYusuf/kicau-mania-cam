import type { Box, Settings } from "./types";

export const SETTINGS_KEY = "kicau-mania-settings";

function loadSettings(): Partial<Settings> {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") as Partial<Settings>; }
  catch { return {}; }
}

export const settings: Settings = Object.assign(
  { camera: true, lyric: true, cat: true, jj: true, music: true, debug: false } as Settings,
  loadSettings(),
);

export function saveSettings(): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/** Singleton runtime state — mutable, shared across modules */
export const state = {
  // App lifecycle
  running: false,

  // Score
  score: 0,

  // Face
  baselinePitch: null as number | null,
  smoothedPitch: 0,
  smoothedMouthGap: 0.1,
  lastFaceBox: null as Box | null,
  lastFaceSeenAt: 0,
  lastMouthClosedAt: 0,

  // Motion
  motionLeft: 0,
  motionRight: 0,
  smoothedMotion: 0,
  motionValue: 0,
  centroidX: 0.5,
  smoothedCentroid: 0.5,
  centroidValid: false,
  prevFrame: null as ImageData | null,
  handMovingLatch: false,

  // Hand (MediaPipe Tasks Vision — HandLandmarker)
  handPresent: false,
  handX: 0.5,              // image-space normalized (0-1) untuk overlay display
  handLastSeenAt: 0,
  handSource: "none" as "mp" | "motion" | "none",
  handsReady: false,
  handsLoadFailed: false,

  // World-space wrist coords (meter-ish, origin di hand center, Z ke kamera)
  wristWorldX: 0,
  wristWorldY: 0,
  wristWorldZ: 0,
  wristVelX: 0,            // EMA velocity (per frame, meter)
  wristVelZ: 0,
  wristPrevX: 0,
  wristPrevZ: 0,
  wristSampleCount: 0,     // untuk warm-up (skip velocity pertama)

  // Swing lateral — zero-crossing + peak tracking
  lastSwingSide: null as "L" | "R" | null,
  lastSwingAt: 0,
  swingDir: 0 as -1 | 0 | 1,    // arah velocity saat ini (-1 kiri, +1 kanan)
  swingPeak: 0,                   // peak |velocity| sejak arah terakhir berubah
  swingLatch: false,              // (tidak dipakai di zero-crossing, legacy untuk UI)

  // Swing forward (depth via world Z)
  fwdDir: 0 as -1 | 0 | 1,
  fwdPeak: 0,
  forwardLatch: false,

  // Audio + beat
  bassAvg: 0,
  bassPeak: 0,
  lastBeatAt: 0,
  currentBassNorm: 0,

  // UI throttle
  lastUiUpdateAt: 0,
  lastDbgLogAt: 0,
  gesturePrev: false,

  // Debug
  debug: false,
};

/** Tuning constants */
export const cfg = {
  pitchThreshold: 12,
  mouthClosedRatio: 0.045,
  motionOnAt: 5,           // lowered from 7 — engage latch more easily
  motionOffAt: 3,          // lowered from 4.5
  motionStrongMul: 2.2,
  swingCooldownMs: 60,     // rapid swing (80ms gap) legit, naikkan kalau ada false double
  swingLeftAt: 0.37,       // lebih lebar lagi untuk jarak jauh
  swingRightAt: 0.63,
  beatCooldownMs: 140,
  mouthGraceMs: 700,       // longer grace — was 400
  faceGraceMs: 500,

  // Audio gating
  musicGraceMs: 900,
  musicTargetVolume: 0.9,
  minPlayMs: 2500,
} as const;

export const MAX_LYRIC_PARTICLES = 5;
export const MAX_CAT_PARTICLES = 5;
export const MAX_SUBMIT_SCORE = 5000;
export const NAME_PATTERN = /^[A-Za-z0-9_\- .]{1,20}$/;

// Apply persisted debug setting
state.debug = settings.debug;
