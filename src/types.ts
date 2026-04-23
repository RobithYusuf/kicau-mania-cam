export interface Box { x: number; y: number; width: number; height: number; }
export interface Pt2 { x: number; y: number; }

export interface LyricEntry { t: number; text: string; duration: number; }

export interface ExpressionResult { label: string; score: number; }

export interface FaceResult {
  box: Box;
  landmarks: Pt2[];
  pitch: number;
  mouthGap: number;
  expression: ExpressionResult | null;
}

export interface MotionResult {
  smoothed: number;
  centroidX: number;
  centroidValid: boolean;
}

export interface HandResult {
  present: boolean;
  x: number;        // 0..1 user-perspective
  source: "mp" | "motion" | "none";
}

export interface GestureFlags {
  active: boolean;
  reason: string;
  mouthClosed: boolean;
  handMoving: boolean;
}

export interface Settings {
  camera: boolean;
  lyric: boolean;
  cat: boolean;
  jj: boolean;
  music: boolean;
  debug: boolean;
}

export interface LeaderEntry {
  name: string;
  score: number;
  date?: string;
  updated_at?: string;
  ip?: string;
}
