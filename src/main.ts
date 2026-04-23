/* eslint-disable no-console */
import "./style-import"; // ensure CSS bundled
import { state, settings, saveSettings, cfg, MAX_LYRIC_PARTICLES, MAX_CAT_PARTICLES } from "./state";
import { loadFaceModels, detectFace, isReady as faceReady } from "./tracking/face";
import { setupHands, runHandsOnce } from "./tracking/hands";
import { computeMotion } from "./tracking/motion";
import { audioPlayer } from "./audio/buffer-player";
import { detectBeat } from "./audio/beat";
import { loadLRC } from "./audio/lrc";
import { spawnLyric, spawnCatDance, drawCats, drawLyrics, particles, catParticles } from "./render/particles";
import { triggerJJ, applyShake, drawFlash, tickEffects, setBigTextEl, flashBigText } from "./render/effects";
import { initSupabase, detectIP, submitGlobalScore } from "./leaderboard/supabase";
import { saveLocal } from "./leaderboard/local";
import { setupLeaderboardModal } from "./leaderboard/modal";
import type { LyricEntry } from "./types";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const els = {
  video: $("video") as unknown as HTMLVideoElement,
  overlay: $("overlay") as unknown as HTMLCanvasElement,
  loading: $("loading"),
  permHint: $("permissionHint"),
  bigText: $("bigText"),
  hudScoreVal: $("hudScoreVal"),
  faceStatus: $("faceStatus"),
  pitchValue: $("pitchValue"),
  exprValue: $("expressionValue"),
  comboValue: $("comboValue"),
  startBtn: $("startBtn") as HTMLButtonElement,
  stopBtn: $("stopBtn") as HTMLButtonElement,
  bgMusic: $("bgMusic") as unknown as HTMLAudioElement,
  catSource: $("catSource") as unknown as HTMLVideoElement,
  playerName: $("playerName") as unknown as HTMLInputElement,
};

// Toggles
const toggles: Array<{ id: string; key: keyof typeof settings }> = [
  { id: "optLyric", key: "lyric" },
  { id: "optCat", key: "cat" },
  { id: "optJJ", key: "jj" },
  { id: "optMusic", key: "music" },
  { id: "optDebug", key: "debug" },
];
for (const t of toggles) {
  const el = $(t.id) as HTMLInputElement;
  el.checked = settings[t.key];
  el.addEventListener("change", () => {
    settings[t.key] = el.checked;
    if (t.key === "debug") state.debug = el.checked;
    saveSettings();
  });
}

// Player name persist
const NAME_KEY = "kicau-mania-name";
els.playerName.value = localStorage.getItem(NAME_KEY) || "";
els.playerName.addEventListener("input", () => {
  localStorage.setItem(NAME_KEY, els.playerName.value.trim());
});

// Collapsible
document.querySelectorAll<HTMLElement>("[data-toggle]").forEach((head) => {
  head.addEventListener("click", () => head.parentElement?.classList.toggle("collapsed"));
});

// Big text overlay
setBigTextEl(els.bigText);

// LRC
let LYRIC_TIMELINE: LyricEntry[] = [];
let lyricCursor = 0;
let lastLyricTriggered = -1;
let lastAudioT = 0;

loadLRC("./audio/kicau-mania.lrc").then((tl) => {
  LYRIC_TIMELINE = tl;
  if (state.debug) console.log("[INIT] LRC loaded", tl.length);
});

// Supabase + IP
initSupabase();
detectIP().then((ip) => {
  if (!els.playerName.value && ip) {
    els.playerName.placeholder = `user_${ip.split(".").slice(-2).join(".")}`;
  }
});

// Leaderboard modal
setupLeaderboardModal({
  btn: $("leaderboardBtn"),
  modal: $("leaderboardModal"),
  list: $("leaderboardList") as unknown as HTMLOListElement,
  close: $("closeLeaderboard"),
  tabLocal: $("tabLocal"),
  tabGlobal: $("tabGlobal"),
  exportBtn: $("exportLb"),
  clearBtn: $("clearLb"),
});
// Tombol leaderboard di navbar juga membuka modal yang sama
$("navLeaderboard").addEventListener("click", () => $("leaderboardBtn").click());

// Camera
async function startCamera(): Promise<void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720, facingMode: "user" },
      audio: false,
    });
    els.video.srcObject = stream;
    await new Promise<void>((res) => { els.video.onloadedmetadata = () => res(); });
    await els.video.play();
  } catch (e) {
    els.permHint.classList.remove("hidden");
    throw e;
  }
}
function stopCamera(): void {
  const s = els.video.srcObject as MediaStream | null;
  s?.getTracks().forEach((t) => t.stop());
  els.video.srcObject = null;
}

// Render score
function renderScore(): void { els.hudScoreVal.textContent = String(state.score); }

// Swing scoring
function addPoint(side: "L" | "R"): void {
  state.score += 1;
  flashBigText(side === "L" ? "KICAU ⬅" : "KICAU ➡");
  renderScore();
}

function handleSwing(gestureActive: boolean): void {
  const now = performance.now();
  let src: "mp" | "motion" | "none" = "none";
  let hx: number | null = null;
  if (state.handPresent) { src = "mp"; hx = state.handX; }
  else if (state.centroidValid) { src = "motion"; hx = state.centroidX; }
  state.handSource = src;

  const prevC = state.smoothedCentroid;
  if (hx !== null) {
    const a = src === "mp" ? 0.15 : 0.5;
    state.smoothedCentroid = state.smoothedCentroid * a + hx * (1 - a);
  } else {
    state.smoothedCentroid = state.smoothedCentroid * 0.92 + 0.5 * 0.08;
  }
  const c = state.smoothedCentroid;
  const velocity = c - prevC;

  // Velocity-based fast trigger
  if (gestureActive && Math.abs(velocity) > 0.15 && state.handPresent) {
    if (now - state.lastSwingAt > cfg.swingCooldownMs) {
      const side = velocity > 0 ? "R" : "L";
      if (side !== state.lastSwingSide) {
        state.lastSwingAt = now;
        state.lastSwingSide = side;
        addPoint(side);
        return;
      }
    }
  }
  // Zone-based
  let side: "L" | "R" | null = null;
  if (c < cfg.swingLeftAt) side = "L";
  else if (c > cfg.swingRightAt) side = "R";
  const canSwing = state.handPresent || state.centroidValid;
  if (gestureActive && side && side !== state.lastSwingSide && canSwing) {
    if (now - state.lastSwingAt > cfg.swingCooldownMs) {
      if (state.lastSwingSide !== null) addPoint(side);
      state.lastSwingAt = now;
      state.lastSwingSide = side;
    }
  }
  if (!gestureActive && now - state.lastSwingAt > 1500) state.lastSwingSide = null;
}

// LRC sync
function tickLyricSync(): void {
  if (LYRIC_TIMELINE.length === 0) return;
  if (!audioPlayer.isPlaying()) return;
  const t = audioPlayer.currentTime();
  if (Math.abs(t - lastAudioT) > 0.5) {
    lyricCursor = 0;
    while (lyricCursor < LYRIC_TIMELINE.length && LYRIC_TIMELINE[lyricCursor]!.t < t - 0.1) lyricCursor++;
    lastLyricTriggered = -1;
  }
  lastAudioT = t;
  while (lyricCursor < LYRIC_TIMELINE.length) {
    const item = LYRIC_TIMELINE[lyricCursor]!;
    if (item.t > t) break;
    if (t - item.t > 0.4) { lyricCursor++; continue; }
    if (item.t !== lastLyricTriggered) {
      lastLyricTriggered = item.t;
      onLyricTrigger(item.text, item.duration);
    }
    lyricCursor++;
    break;
  }
}

function onLyricTrigger(text: string, durationSec: number): void {
  const viewW = els.overlay.width || 1280;
  const viewH = els.overlay.height || 720;
  if (settings.lyric) spawnLyric(text, durationSec, viewW, viewH);
  if (settings.cat) {
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) spawnCatDance(viewW, viewH);
  }
  if (settings.jj) triggerJJ();
}

// Main tick
function syncCanvasSize(): void {
  const v = els.video, c = els.overlay;
  if (c.width !== v.videoWidth || c.height !== v.videoHeight) {
    c.width = v.videoWidth || 1280;
    c.height = v.videoHeight || 720;
  }
}

async function tick(): Promise<void> {
  if (!state.running) return;

  const det = await detectFace(els.video);
  const ctx = els.overlay.getContext("2d")!;
  syncCanvasSize();
  ctx.clearRect(0, 0, els.overlay.width, els.overlay.height);

  let mouthClosed = false;
  const nowMs = performance.now();
  if (det) {
    state.lastFaceSeenAt = nowMs;
    state.lastFaceBox = det.box;
    if (state.baselinePitch === null) state.baselinePitch = det.pitch;
    state.smoothedPitch = state.smoothedPitch * 0.7 + (det.pitch - state.baselinePitch) * 0.3;
    state.smoothedMouthGap = state.smoothedMouthGap * 0.85 + det.mouthGap * 0.15;
    mouthClosed = state.smoothedMouthGap < cfg.mouthClosedRatio;
    if (mouthClosed) state.lastMouthClosedAt = nowMs;
    els.faceStatus.textContent = "Terdeteksi ✓";
    els.faceStatus.style.color = "var(--ok)";
  } else {
    const faceGraceLeft = cfg.faceGraceMs - (nowMs - state.lastFaceSeenAt);
    if (faceGraceLeft > 0) {
      els.faceStatus.textContent = `Grace ${(faceGraceLeft / 1000).toFixed(1)}s`;
      els.faceStatus.style.color = "var(--accent)";
    } else {
      els.faceStatus.textContent = "—";
      els.faceStatus.style.color = "var(--bad)";
    }
  }

  const mouthClosedWithGrace = mouthClosed || (nowMs - state.lastMouthClosedAt < cfg.mouthGraceMs);

  // MediaPipe Hands
  runHandsOnce(els.video);

  // Motion
  state.motionValue = computeMotion(els.video);
  if (state.motionValue < state.smoothedMotion) {
    state.smoothedMotion = state.smoothedMotion * 0.2 + state.motionValue * 0.8;
  } else {
    state.smoothedMotion = state.smoothedMotion * 0.6 + state.motionValue * 0.4;
  }
  if (!state.handMovingLatch && state.smoothedMotion >= cfg.motionOnAt) state.handMovingLatch = true;
  else if (state.handMovingLatch && state.smoothedMotion < cfg.motionOffAt) state.handMovingLatch = false;
  const handMoving = state.handMovingLatch;
  const veryStrongMotion = state.smoothedMotion > cfg.motionOnAt * 2.5;

  // Strict gesture: WAJIB hand present (block head-only false positive)
  const gestureActive = state.handPresent && handMoving && (mouthClosedWithGrace || veryStrongMotion);

  const reason = gestureActive ? "hand+mouth"
    : !state.handPresent ? "no-hand"
    : !handMoving ? "hand-still"
    : !mouthClosedWithGrace ? "mouth-open"
    : "?";

  if (settings.music) audioPlayer.drive(gestureActive, reason);
  else audioPlayer.drive(false, "music-toggle-off");

  if (gestureActive && !state.gesturePrev) flashBigText("KICAU MANIA");
  state.gesturePrev = gestureActive;

  detectBeat();
  if (gestureActive) tickLyricSync();

  // Render
  ctx.save();
  if (settings.jj) applyShake(ctx);
  if (settings.cat) drawCats(ctx, els.catSource, state.currentBassNorm);
  if (settings.lyric) drawLyrics(ctx, state.currentBassNorm);
  ctx.restore();
  if (settings.jj) drawFlash(ctx);
  tickEffects();

  handleSwing(gestureActive);

  // UI throttle
  if (nowMs - state.lastUiUpdateAt > 250) {
    state.lastUiUpdateAt = nowMs;
    const cShow = state.smoothedCentroid.toFixed(2);
    const zone = state.smoothedCentroid < cfg.swingLeftAt ? "⬅"
      : state.smoothedCentroid > cfg.swingRightAt ? "➡" : "·";
    els.pitchValue.textContent = `c=${cShow} ${zone} ${state.handSource} (${state.lastSwingSide || "-"})`;
    if (det) {
      els.exprValue.textContent = (mouthClosed ? "🤐" : "👄") +
        " (" + (Math.round(state.smoothedMouthGap * 1000) / 10) + "%)";
    }
    els.comboValue.textContent =
      (state.handPresent ? "✋" : "🚫") + " " +
      (mouthClosed ? "🤐" : (mouthClosedWithGrace ? "🤐…" : "👄")) +
      " r=" + reason;
  }

  // Debug log
  if (state.debug && nowMs - state.lastDbgLogAt > 500) {
    state.lastDbgLogAt = nowMs;
    console.log(`[DBG] face=${!!det} hand=${state.handPresent} motion=${state.smoothedMotion.toFixed(1)} c=${state.smoothedCentroid.toFixed(2)} gesture=${gestureActive} reason=${reason} score=${state.score}`);
  }

  requestAnimationFrame(() => { void tick(); });
}

// Lifecycle
async function start(): Promise<void> {
  els.startBtn.disabled = true;
  try {
    if (!faceReady()) {
      els.loading.classList.remove("hidden");
      await loadFaceModels("./models");
      await setupHands();
      els.loading.classList.add("hidden");
    }
    await audioPlayer.ensureContext();
    await audioPlayer.loadBuffer("./audio/kicau-mania.mp3");
    await startCamera();

    // Reset session
    state.score = 0;
    state.baselinePitch = null;
    state.smoothedPitch = 0;
    state.prevFrame = null;
    lyricCursor = 0;
    lastLyricTriggered = -1;
    renderScore();

    state.running = true;
    els.stopBtn.disabled = false;

    void els.catSource.play().catch(() => { /* */ });
    void tick();
  } catch (e) {
    console.error(e);
    els.startBtn.disabled = false;
    els.loading.classList.add("hidden");
  }
}

function stop(): void {
  if (state.score > 0) {
    const name = els.playerName.value.trim() || els.playerName.placeholder.replace("placeholder", "Anonim") || "Anonim";
    saveLocal(name, state.score);
    void submitGlobalScore(name, state.score);
  }
  state.running = false;
  els.stopBtn.disabled = true;
  els.startBtn.disabled = false;
  stopCamera();
  audioPlayer.stopAll();
  els.catSource.pause();
  particles.length = 0;
  catParticles.length = 0;
}

els.startBtn.addEventListener("click", () => { void start(); });
els.stopBtn.addEventListener("click", stop);
