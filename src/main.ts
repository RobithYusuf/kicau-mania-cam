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
};

// Toggles (debug dihapus dari UI; tetap ada di state untuk dev internal)
const TOGGLE_LABELS: Record<keyof typeof settings, string> = {
  camera: "📹 Kamera",
  lyric: "Lirik",
  cat: "🐱 Kucing",
  jj: "⚡ Efek JJ",
  music: "🔊 Musik",
  debug: "Debug",
};
const toggles: Array<{ id: string; key: keyof typeof settings }> = [
  { id: "optCamera", key: "camera" },
  { id: "optLyric", key: "lyric" },
  { id: "optCat", key: "cat" },
  { id: "optJJ", key: "jj" },
  { id: "optMusic", key: "music" },
];

type CamState = "off" | "loading" | "active" | "denied" | "disabled";
let camState: CamState = "off";
function setCamState(s: CamState): void { camState = s; renderStatusInfo(); }

function renderStatusInfo(): void {
  const el = $("statusInfo");
  const off = toggles.filter(t => !settings[t.key]).map(t => TOGGLE_LABELS[t.key]);
  const offTxt = off.length === 0
    ? `<span style="color: var(--color-ok);">✓ semua fitur aktif</span>`
    : `<span style="color: var(--color-bad);">✕ mati:</span> <b class="text-text">${off.join(" · ")}</b>`;

  let camTxt = "";
  switch (camState) {
    case "off":      camTxt = `<span style="color: var(--color-muted);">📹 belum nyala — klik <b class="text-text">▶ MULAI</b></span>`; break;
    case "loading":  camTxt = `<span style="color: var(--color-accent);">⏳ memuat…</span>`; break;
    case "active":   camTxt = `<span style="color: var(--color-ok);">✓ kamera</span>`; break;
    case "denied":   camTxt = `<span style="color: var(--color-bad);">⚠️ izin kamera ditolak — Allow Camera + reload</span>`; break;
    case "disabled": camTxt = `<span style="color: var(--color-muted);">📹 dimatikan</span>`; break;
  }
  el.innerHTML = `${camTxt} · ${offTxt} · <b class="text-text">⚙ Pengaturan</b>`;
}

for (const t of toggles) {
  const el = $(t.id) as HTMLInputElement;
  // Sync visual checkbox dari settings (DOM `checked` attribute → state.value)
  el.checked = settings[t.key] !== false;
  // Sync settings dari visual juga (kalau user reload dengan localStorage corrupt)
  settings[t.key] = el.checked;
  el.addEventListener("change", () => {
    settings[t.key] = el.checked;
    saveSettings();
    renderStatusInfo();
    if (t.key === "camera") {
      if (!el.checked) {
        setCamState("disabled");
        if (state.running) stopCamera();
      } else {
        if (state.running) void startCamera().catch(() => { /* */ });
        else setCamState("off");
      }
    }
  });
}
renderStatusInfo();
// Force debug off in production UI
state.debug = false;
settings.debug = false;

// Player name persist + debounce + personal best
const NAME_KEY = "kicau-mania-name";
const BEST_KEY = "kicau-mania-best";
const playerNameNav = $("playerNameNav") as unknown as HTMLInputElement;
const nameSaveStatus = $("nameSaveStatus");
const personalBestEl = $("personalBest");

playerNameNav.value = localStorage.getItem(NAME_KEY) || "";

let personalBest = parseInt(localStorage.getItem(BEST_KEY) || "0", 10);
function renderPersonalBest(): void {
  personalBestEl.textContent = personalBest.toLocaleString("id-ID");
}
function bumpPersonalBest(score: number): void {
  if (score > personalBest) {
    personalBest = score;
    localStorage.setItem(BEST_KEY, String(personalBest));
    renderPersonalBest();
  }
}
renderPersonalBest();

let nameSaveTimer: ReturnType<typeof setTimeout> | null = null;
function setSaveStatus(s: "typing" | "saved" | ""): void {
  if (s === "typing")     nameSaveStatus.textContent = "✏️";
  else if (s === "saved") nameSaveStatus.textContent = "✓";
  else                    nameSaveStatus.textContent = "";
  if (s === "saved") setTimeout(() => { nameSaveStatus.textContent = ""; }, 1200);
}

function debouncedSaveName(value: string): void {
  if (nameSaveTimer) clearTimeout(nameSaveTimer);
  setSaveStatus("typing");
  nameSaveTimer = setTimeout(() => {
    const cleaned = value.trim();
    localStorage.setItem(NAME_KEY, cleaned);
    setSaveStatus("saved");
    // Sync nama ke server: pakai skor session aktif KALAU ada, fallback ke personalBest
    // (supaya nama bisa di-update kapan saja meski session tidak aktif)
    const scoreToSync = state.score > 0 ? state.score : personalBest;
    if (cleaned && scoreToSync > 0) void submitGlobalScore(cleaned, scoreToSync);
  }, 500);
}

playerNameNav.addEventListener("input", (e) => debouncedSaveName((e.target as HTMLInputElement).value));

// Collapsible — toggle [data-body] visibility
document.querySelectorAll<HTMLElement>("[data-toggle]").forEach((head) => {
  head.addEventListener("click", () => {
    const body = head.parentElement?.querySelector<HTMLElement>("[data-body]");
    body?.classList.toggle("hidden");
  });
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
  if (!playerNameNav.value && ip) {
    playerNameNav.placeholder = `user_${ip.split(".").slice(-2).join(".")}`;
  }
});

// Leaderboard modal
setupLeaderboardModal({
  btn: $("navLeaderboard"),
  modal: $("leaderboardModal"),
  list: $("leaderboardList") as unknown as HTMLOListElement,
  close: $("closeLeaderboard"),
});

// Privacy modal
const privacyModal = $("privacyModal");
$("privacyBtn").addEventListener("click", () => privacyModal.classList.remove("hidden"));
$("closePrivacy").addEventListener("click", () => privacyModal.classList.add("hidden"));
privacyModal.addEventListener("click", (e) => { if (e.target === privacyModal) privacyModal.classList.add("hidden"); });

// Camera — getUserMedia + onloadedmetadata + play parallel sebisa mungkin
async function startCamera(): Promise<void> {
  setCamState("loading");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720, facingMode: "user" },
      audio: false,
    });
    els.video.srcObject = stream;
    // Tunggu metadata + play paralel (play sering bisa langsung walau metadata belum penuh)
    await Promise.all([
      new Promise<void>((res) => { els.video.onloadedmetadata = () => res(); }),
      els.video.play().catch(() => { /* */ }),
    ]);
    setCamState("active");
  } catch (e) {
    const err = e as Error & { name?: string };
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      setCamState("denied");
    } else {
      setCamState("off");
    }
    els.permHint.classList.remove("hidden");
    throw e;
  }
}
function stopCamera(): void {
  const s = els.video.srcObject as MediaStream | null;
  s?.getTracks().forEach((t) => t.stop());
  els.video.srcObject = null;
  setCamState(settings.camera ? "off" : "disabled");
}

// Render score
function renderScore(): void { els.hudScoreVal.textContent = String(state.score); }

// Swing scoring + auto-sync via periodic flush (anti rate-limit spam)
let lastActivityAt = 0;
let lastSubmittedScore = 0;
let submitFlushTimer: ReturnType<typeof setInterval> | null = null;
const AUTO_STOP_IDLE_MS = 15000;
const SUBMIT_FLUSH_MS = 5000;        // flush score ke server max tiap 5 detik

function addPoint(side: "L" | "R"): void {
  state.score += 1;
  lastActivityAt = performance.now();
  flashBigText(side === "L" ? "KICAU ⬅" : "KICAU ➡");
  renderScore();
  bumpPersonalBest(state.score);
  // TIDAK submit per swing — periodic flush yang handle (tiap 5s kalau berubah)
}

function startSubmitFlush(): void {
  if (submitFlushTimer) return;
  submitFlushTimer = setInterval(() => {
    if (!state.running) return;
    if (state.score === 0) return;
    if (state.score === lastSubmittedScore) return;
    const name = playerNameNav.value.trim() || playerNameNav.placeholder || "Anonim";
    lastSubmittedScore = state.score;
    void submitGlobalScore(name, state.score);
  }, SUBMIT_FLUSH_MS);
}

function stopSubmitFlush(): void {
  if (submitFlushTimer) { clearInterval(submitFlushTimer); submitFlushTimer = null; }
}

function checkAutoStop(): void {
  if (!state.running) return;
  if (state.score === 0) return;
  if (lastActivityAt === 0) return;
  const idle = performance.now() - lastActivityAt;
  if (idle > AUTO_STOP_IDLE_MS) {
    flashBigText("⏸ AUTO STOP — IDLE", 1500);
    stop(); // stop() sekarang force-submit final score
  }
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

  // Face detect + render frame siap parallel: detectFace async di background,
  // canvas sync + clear langsung jalan supaya ngga delay
  const detPromise = detectFace(els.video);
  const ctx = els.overlay.getContext("2d")!;
  syncCanvasSize();
  ctx.clearRect(0, 0, els.overlay.width, els.overlay.height);
  const det = await detPromise;

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
    els.faceStatus.style.color = "var(--color-ok)";
  } else {
    const faceGraceLeft = cfg.faceGraceMs - (nowMs - state.lastFaceSeenAt);
    if (faceGraceLeft > 0) {
      els.faceStatus.textContent = `Grace ${(faceGraceLeft / 1000).toFixed(1)}s`;
      els.faceStatus.style.color = "var(--color-accent)";
    } else {
      els.faceStatus.textContent = "—";
      els.faceStatus.style.color = "var(--color-bad)";
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

  // Musik LANGSUNG play setelah MULAI (tidak nunggu gesture) → animasi & lirik
  // selalu sinkron berjalan. Gesture hanya untuk scoring kicau swing.
  if (settings.music) audioPlayer.drive(state.running, reason);
  else audioPlayer.drive(false, "music-toggle-off");

  if (gestureActive && !state.gesturePrev) flashBigText("KICAU MANIA");
  state.gesturePrev = gestureActive;

  detectBeat();
  tickLyricSync();

  // Render
  ctx.save();
  if (settings.jj) applyShake(ctx);
  if (settings.cat) drawCats(ctx, els.catSource, state.currentBassNorm);
  if (settings.lyric) drawLyrics(ctx, state.currentBassNorm);
  ctx.restore();
  if (settings.jj) drawFlash(ctx);
  tickEffects();

  handleSwing(gestureActive);
  checkAutoStop();

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

// Lifecycle — semua resource di-load PARALLEL via Promise.all (no sequential await)
async function start(): Promise<void> {
  els.startBtn.disabled = true;
  els.loading.classList.remove("hidden");

  try {
    // Load semua resource paralel: face models, MediaPipe, audio buffer, camera
    await Promise.all([
      faceReady() ? Promise.resolve() : loadFaceModels("./models"),
      setupHands().catch((e) => { console.warn("hands setup:", e); }),
      audioPlayer.ensureContext().then(() => audioPlayer.loadBuffer("./audio/kicau-mania.mp3")),
      settings.camera ? startCamera() : Promise.resolve(),
    ]);

    els.loading.classList.add("hidden");

    // Reset session state
    state.score = 0;
    state.baselinePitch = null;
    state.smoothedPitch = 0;
    state.prevFrame = null;
    lyricCursor = 0;
    lastLyricTriggered = -1;
    lastActivityAt = 0;
    lastSubmittedScore = 0;
    renderScore();

    state.running = true;
    els.stopBtn.disabled = false;
    startSubmitFlush();

    // Cat source play fire-and-forget (tidak block tick)
    void els.catSource.play().catch(() => { /* */ });
    void tick();
  } catch (e) {
    console.error("[START] failed:", e);
    els.startBtn.disabled = false;
    els.loading.classList.add("hidden");
  }
}

function stop(): void {
  stopSubmitFlush();
  if (state.score > 0 && state.score > lastSubmittedScore) {
    bumpPersonalBest(state.score);
    const name = playerNameNav.value.trim() || playerNameNav.placeholder || "Anonim";
    void submitGlobalScore(name, state.score, true);
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

// Debug helper — inspect app internal state via console
(window as unknown as { KM: object }).KM = {
  state, settings, particles, catParticles,
  get audio() { return { isPlaying: audioPlayer.isPlaying(), currentTime: audioPlayer.currentTime() }; },
  get lrc() { return { count: LYRIC_TIMELINE.length, cursor: lyricCursor, lastTriggered: lastLyricTriggered, lastAudioT }; },
  get camera() { return { state: camState, srcObj: !!els.video.srcObject, vw: els.video.videoWidth }; },
  forceSpawn() {
    onLyricTrigger("KICAU", 0.5);
    return "spawned";
  },
};
