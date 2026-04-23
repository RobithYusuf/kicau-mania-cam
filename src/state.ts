import type { Box, Settings } from "./types";

export const SETTINGS_KEY = "kicau-mania-settings";

export const settings: Settings = Object.assign(
  { camera: true, lyric: true, cat: true, jj: true, music: true, debug: false } as Settings,
  JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") as Partial<Settings>,
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

  // Hand (MediaPipe)
  handPresent: false,
  handX: 0.5,
  handLastSeenAt: 0,
  handSource: "none" as "mp" | "motion" | "none",
  handsReady: false,

  // Swing
  lastSwingSide: null as "L" | "R" | null,
  lastSwingAt: 0,
  swingVelocity: 0,        // smoothed velocity for peak detection

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
  swingCooldownMs: 120,    // slightly faster — was 140
  swingLeftAt: 0.40,       // wider zone — was 0.42
  swingRightAt: 0.60,      // wider zone — was 0.58
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
