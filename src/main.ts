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
import { updateChroma, getChromaCanvas } from "./render/chroma";
import { initSupabase, detectIP, submitGlobalScore, fetchMyEntry } from "./leaderboard/supabase";
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
// Auto-sync nama + best dari Supabase berdasarkan IP — supaya device baru tidak
// tampil sebagai "user baru" kalau IP-nya sudah pernah submit skor
detectIP().then(async (ip) => {
  if (!ip) return;
  playerNameNav.placeholder = `user_${ip.split(".").slice(-2).join(".")}`;
  // Cek apakah IP ini sudah punya entry di server
  const myEntry = await fetchMyEntry();
  if (!myEntry) return;

  const localName = (localStorage.getItem(NAME_KEY) || "").trim();
  const localBest = parseInt(localStorage.getItem(BEST_KEY) || "0", 10);

  // Sync nama: kalau local kosong ATAU server lebih recent dari local best, pakai server
  if (!localName && myEntry.name) {
    playerNameNav.value = myEntry.name;
    localStorage.setItem(NAME_KEY, myEntry.name);
    setSaveStatus("saved");
  }
  // Sync best score: pakai max(local, server)
  if (myEntry.score > localBest) {
    personalBest = myEntry.score;
    localStorage.setItem(BEST_KEY, String(myEntry.score));
    renderPersonalBest();
  }
  // Tampilkan ke status info bahwa data ter-sync
  if (myEntry.name && (myEntry.name === playerNameNav.value || !localName)) {
    flashBigText(`👋 Halo lagi, ${myEntry.name}!`, 2000);
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

function addPoint(side: "L" | "R" | "F"): void {
  state.score += 1;
  lastActivityAt = performance.now();
  flashBigText(side === "L" ? "KICAU ⬅ +1" : side === "R" ? "KICAU ➡ +1" : "KICAU ! +1");
  renderScore();
  bumpPersonalBest(state.score);
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
  const remaining = Math.ceil((AUTO_STOP_IDLE_MS - idle) / 1000);

  if (idle > AUTO_STOP_IDLE_MS) {
    els.stopBtn.textContent = "■ STOP";
    flashBigText("⏸ AUTO STOP — IDLE", 1500);
    stop();
  } else if (remaining <= 10) {
    // Countdown muncul di 10 detik terakhir
    els.stopBtn.textContent = `■ STOP ${remaining}s`;
    els.stopBtn.style.opacity = remaining <= 3 ? "0.6" : "1";
  } else {
    els.stopBtn.textContent = "■ STOP";
    els.stopBtn.style.opacity = "1";
  }
}

function handleSwing(gestureActive: boolean, swingEligible: boolean): void {
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
  const rawVel = c - prevC;

  // Smooth velocity separately to detect peaks more robustly
  const prevVel = state.swingVelocity;
  state.swingVelocity = prevVel * 0.5 + rawVel * 0.5;
  const vel = state.swingVelocity;

  const cooldownOk = now - state.lastSwingAt > cfg.swingCooldownMs;
  const hasSource = state.handPresent || state.centroidValid;

  // 1. Peak/reversal detection: fires at exact moment hand reverses direction.
  //    When velocity changes sign after exceeding a minimum, the prior direction
  //    was a complete swing. More sensitive than zone-based for natural waving.
  if (swingEligible && cooldownOk && hasSource) {
    const reversed = prevVel * vel < -0.0002;
    const hadMomentum = Math.abs(prevVel) > 0.04;
    if (reversed && hadMomentum) {
      const side: "L" | "R" = prevVel < 0 ? "L" : "R"; // swing peaked in prevVel direction
      if (side !== state.lastSwingSide) {
        state.lastSwingAt = now;
        state.lastSwingSide = side;
        addPoint(side);
        return;
      }
    }
  }

  // 2. Zone-based fallback: catches slow wide swings that peak detection misses
  let side: "L" | "R" | null = null;
  if (c < cfg.swingLeftAt) side = "L";
  else if (c > cfg.swingRightAt) side = "R";
  if (swingEligible && side && side !== state.lastSwingSide && hasSource && cooldownOk) {
    if (state.lastSwingSide !== null) addPoint(side);
    state.lastSwingAt = now;
    state.lastSwingSide = side;
  }

  if (!swingEligible && now - state.lastSwingAt > 1500) state.lastSwingSide = null;
}

// Forward swing via hand scale change (wrist↔middleMCP distance as depth proxy).
// Tangan maju ke kamera → ukuran tangan di frame membesar → scale naik di atas baseline.
const SCALE_ON  = 1.20;  // naik 20% dari baseline = maju
const SCALE_OFF = 1.06;  // turun kembali ke 6% = swing selesai
const SCALE_FWD_COOLDOWN_MS = 500;
let lastForwardSwingAt = 0;

function handleForwardSwing(swingEligible: boolean): void {
  if (!state.handPresent || state.handScaleRaw === 0) return;

  // Init baseline di frame pertama
  if (state.handScaleBaseline === 0) {
    state.handScaleBaseline = state.handScaleRaw;
    state.handScaleFast = state.handScaleRaw;
    return;
  }
  // EMA cepat (respons ke gerakan)
  state.handScaleFast = state.handScaleFast * 0.5 + state.handScaleRaw * 0.5;
  // EMA sangat lambat (baseline = ukuran tangan normal user di jarak game)
  state.handScaleBaseline = state.handScaleBaseline * 0.985 + state.handScaleRaw * 0.015;

  const ratio = state.handScaleFast / state.handScaleBaseline;

  if (!state.handScaleForwardLatch && ratio > SCALE_ON) {
    state.handScaleForwardLatch = true;
  }
  if (state.handScaleForwardLatch && ratio < SCALE_OFF) {
    state.handScaleForwardLatch = false;
    const now = performance.now();
    if (swingEligible && now - lastForwardSwingAt > SCALE_FWD_COOLDOWN_MS) {
      lastForwardSwingAt = now;
      addPoint("F");
    }
  }
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
  if (settings.lyric) {
    spawnLyric(text, durationSec, viewW, viewH);
  }
  if (settings.cat) {
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) spawnCatDance(viewW, viewH);
  }
  if (settings.jj) triggerJJ();
}

// Main tick
function syncCanvasSize(): void {
  const c = els.overlay;
  const rect = c.getBoundingClientRect();
  const w = Math.round(rect.width) || 1280;
  const h = Math.round(rect.height) || 720;
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
}

async function tick(): Promise<void> {
  if (!state.running) return;

  // Catch SEMUA error dalam tick → loop tetap jalan walau face-api/MediaPipe gagal
  try { await tickFrame(); }
  catch (e) { console.warn("[TICK] frame error (ignored):", (e as Error).message); }

  // Pastikan next frame ALWAYS scheduled (walau error)
  if (state.running) requestAnimationFrame(() => { void tick(); });
}

async function tickFrame(): Promise<void> {
  // Mulai face detect dulu (async), baru clear+draw setelah selesai
  // supaya clearRect dan drawCats terjadi dalam frame yang sama — tidak ada
  // celah di mana browser paint canvas kosong tanpa animasi.
  const detPromise = detectFace(els.video).catch(() => null);
  const det = await detPromise;

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

  // Kalau MediaPipe Hands tidak tersedia, fallback ke centroid motion (face area sudah dikecualikan)
  const hasHand = state.handPresent || (!state.handsReady && state.centroidValid);
  const gestureActive = hasHand && handMoving && (mouthClosedWithGrace || veryStrongMotion);

  // swingEligible: lebih longgar dari gestureActive — musik gating tetap strict,
  // tapi scoring tidak memerlukan handMovingLatch sudah engage.
  // Syarat: ada tangan DAN (mulut tutup / latch sudah aktif / gerakan sangat kuat)
  const swingEligible = hasHand && (mouthClosedWithGrace || handMoving || veryStrongMotion);

  const reason = gestureActive ? "hand+mouth"
    : !hasHand ? "no-hand"
    : !handMoving ? "hand-still"
    : !mouthClosedWithGrace ? "mouth-open"
    : "?";

  if (settings.music) audioPlayer.drive((hasHand && handMoving) || gestureActive, reason);
  else audioPlayer.drive(false, "music-toggle-off");

  if (gestureActive && !state.gesturePrev) flashBigText("KICAU MANIA");
  state.gesturePrev = gestureActive;

  detectBeat();
  tickLyricSync();

  // Kalau musik berhenti (user diam), langsung hapus semua partikel
  if (!audioPlayer.isPlaying()) {
    particles.length = 0;
    catParticles.length = 0;
  }

  // Render
  ctx.save();
  if (settings.jj) applyShake(ctx);
  if (settings.cat) drawCats(ctx, els.catSource, state.currentBassNorm);
  if (settings.lyric) drawLyrics(ctx, state.currentBassNorm);
  ctx.restore();
  if (settings.jj) drawFlash(ctx);
  tickEffects();

  handleSwing(gestureActive, swingEligible);
  handleForwardSwing(swingEligible);
  checkAutoStop();

  // UI throttle
  if (nowMs - state.lastUiUpdateAt > 250) {
    state.lastUiUpdateAt = nowMs;
    const cShow = state.smoothedCentroid.toFixed(2);
    const zone = state.smoothedCentroid < cfg.swingLeftAt ? "⬅"
      : state.smoothedCentroid > cfg.swingRightAt ? "➡" : "·";
    const scaleRatio = state.handScaleBaseline > 0 ? (state.handScaleFast / state.handScaleBaseline).toFixed(2) : "-";
    els.pitchValue.textContent = `c=${cShow} ${zone} ${state.handSource} (${state.lastSwingSide || "-"}) fwd=${scaleRatio}${state.handScaleForwardLatch ? "!" : ""}`;
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
  // rAF di-handle oleh outer tick() — JANGAN double-schedule di sini
}

// Lifecycle — semua resource di-load PARALLEL via Promise.all (no sequential await)
async function start(): Promise<void> {
  stopIdle();
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
    lastForwardSwingAt = 0;
    state.handScaleBaseline = 0;
    state.handScaleFast = 0;
    state.handScaleForwardLatch = false;
    renderScore();

    state.running = true;
    els.stopBtn.disabled = false;
    els.stopBtn.textContent = "■ STOP";
    els.stopBtn.style.opacity = "1";
    startSubmitFlush();

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
  els.stopBtn.textContent = "■ STOP";
  els.stopBtn.style.opacity = "1";
  els.startBtn.disabled = false;
  stopCamera();
  audioPlayer.stopAll();
  els.catSource.pause();
  particles.length = 0;
  catParticles.length = 0;
  startIdle();
}

// Idle preview — cat breathing loop: fade-in → hold → fade-out → pause → repeat
// Fase (ms): 0..800 fade-in | 800..2800 hold | 2800..3600 fade-out | 3600..5200 pause
const IDLE_PHASE = { fadeIn: 800, hold: 2000, fadeOut: 800, pause: 1600 };
const IDLE_CYCLE = IDLE_PHASE.fadeIn + IDLE_PHASE.hold + IDLE_PHASE.fadeOut + IDLE_PHASE.pause; // 5200ms

interface IdlePos { x: number; y: number; bob: number; bobSpeed: number; }
const idlePositions: IdlePos[] = [];
let idleRunning = false;
let idleRaf = 0;
let idleStartMs = 0;

function initIdlePositions(cw: number, ch: number): void {
  idlePositions.length = 0;
  const pts = [{ x: 0.15, y: 0.55 }, { x: 0.5, y: 0.38 }, { x: 0.82, y: 0.58 }];
  for (const p of pts) {
    idlePositions.push({ x: cw * p.x, y: ch * p.y, bob: Math.random() * Math.PI * 2, bobSpeed: 0.012 + Math.random() * 0.008 });
  }
}

function idleAlpha(nowMs: number): number {
  const elapsed = (nowMs - idleStartMs) % IDLE_CYCLE;
  const { fadeIn, hold, fadeOut } = IDLE_PHASE;
  if (elapsed < fadeIn)                      return elapsed / fadeIn;
  if (elapsed < fadeIn + hold)               return 1;
  if (elapsed < fadeIn + hold + fadeOut)     return 1 - (elapsed - fadeIn - hold) / fadeOut;
  return 0; // pause
}

function tickIdle(): void {
  if (!idleRunning) return;
  const canvas = els.overlay;
  const ctx = canvas.getContext("2d")!;
  const rect = canvas.getBoundingClientRect();
  const rw = Math.round(rect.width) || 640;
  const rh = Math.round(rect.height) || 360;
  if (canvas.width !== rw || canvas.height !== rh) {
    canvas.width = rw; canvas.height = rh;
    initIdlePositions(rw, rh);
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const alpha = idleAlpha(performance.now());
  if (alpha > 0) {
    const src = els.catSource;
    if (src.readyState >= 2) {
      updateChroma(src);
      const sprite = getChromaCanvas();
      if (sprite.width > 1) {
        const catH = canvas.height * 0.42;
        const catW = sprite.width * (catH / sprite.height);
        for (const p of idlePositions) {
          p.bob += p.bobSpeed;
          const bobY = Math.sin(p.bob) * (canvas.height * 0.022);
          const pulse = 1 + Math.sin(p.bob * 1.6) * 0.04;
          ctx.save();
          ctx.globalAlpha = alpha * 0.85; // max 85% opacity — tidak full agar terasa "preview"
          ctx.translate(canvas.width - p.x, p.y + bobY);
          ctx.scale(-1, 1);
          ctx.drawImage(sprite, -catW * pulse / 2, -catH * pulse / 2, catW * pulse, catH * pulse);
          ctx.restore();
        }
      }
    }
  }
  idleRaf = requestAnimationFrame(tickIdle);
}

function startIdle(): void {
  if (idleRunning) return;
  idleRunning = true;
  idleStartMs = performance.now();
  void els.catSource.play().catch(() => { /* */ });
  const rect = els.overlay.getBoundingClientRect();
  initIdlePositions(Math.round(rect.width) || 640, Math.round(rect.height) || 360);
  tickIdle();
}

function stopIdle(): void {
  idleRunning = false;
  cancelAnimationFrame(idleRaf);
  const ctx = els.overlay.getContext("2d");
  ctx?.clearRect(0, 0, els.overlay.width, els.overlay.height);
}

startIdle();

els.startBtn.addEventListener("click", () => { void start(); });
els.stopBtn.addEventListener("click", stop);

// Debug helper — hanya tersedia di dev mode (import.meta.env.DEV)
if (import.meta.env.DEV) {
  (window as unknown as { KM: object }).KM = {
    state, settings, particles, catParticles,
    get audio() { return { isPlaying: audioPlayer.isPlaying(), currentTime: audioPlayer.currentTime() }; },
    get lrc() { return { count: LYRIC_TIMELINE.length, cursor: lyricCursor, lastTriggered: lastLyricTriggered, lastAudioT }; },
    get camera() { return { state: camState, srcObj: !!els.video.srcObject, vw: els.video.videoWidth }; },
    forceSpawn() { onLyricTrigger("KICAU", 0.5); return "spawned"; },
  };
}
