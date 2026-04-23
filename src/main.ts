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

let personalBest = (() => {
  const n = parseInt(localStorage.getItem(BEST_KEY) || "0", 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 99999) : 0;
})();
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
  const rawLocalBest = parseInt(localStorage.getItem(BEST_KEY) || "0", 10);
  const localBest = Number.isFinite(rawLocalBest) && rawLocalBest >= 0 ? rawLocalBest : 0;

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

function addPoint(side: "L" | "R" | "F", points: number = 1): void {
  state.score += points;
  lastActivityAt = performance.now();
  const plus = `+${points}`;
  flashBigText(side === "L" ? `KICAU ⬅ ${plus}` : side === "R" ? `KICAU ➡ ${plus}` : `KICAU ! ${plus}`);
  renderScore();
  bumpPersonalBest(state.score);
}

// Swing strength → points mapping. Pakai rawPeak (mm/frame) sebagai ukuran kekuatan.
//   <20mm = swing normal → +1
//   20-50mm = swing kuat → +2
//   >50mm = swing all-out → +3
function swingPoints(rawPeakMm: number): number {
  return rawPeakMm > 50 ? 3 : rawPeakMm > 20 ? 2 : 1;
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

/* Swing detection via zero-crossing + peak velocity.
 *
 * Algoritma: track arah velocity; saat arah berubah (crossing zero), cek peak
 * magnitude selama arah sebelumnya. Kalau peak lewat threshold → 1 swing valid.
 * Setiap direction-reversal = 1 swing, match rhythm swing alami (L→R→L→R).
 *
 * Kelebihan vs velocity-threshold latch:
 * - Tidak ada "dead zone" di tengah swing (latch stuck bikin swing berikutnya miss)
 * - Peak tracking akumulasi frame tercepat → swing lembut tetap ketangkap
 *   asal ada direction reversal
 * - Threshold lebih rendah karena peak > average frame velocity
 */
const SWING_PEAK_THRESH = 0.0055; // 5.5mm/frame peak — filter garuk/fidget, terima swing soft 7mm+
const SWING_DEAD_ZONE   = 0.0005;
const FWD_PEAK_THRESH   = 0.007;  // 7mm — forward lebih strict supaya garuk vertical tidak counted
const FWD_DEAD_ZONE     = 0.001;
const FWD_COOLDOWN_MS   = 450;
let lastForwardSwingAt = 0;

// ── Swing diagnostic instrumentation ──────────────────────────────
// Tracks every direction phase (L→R or R→L) with raw + EMA peak, duration, gap.
// Accessible via window.KM.swingReport() in DevTools console.
interface PhaseRecord {
  seq: number;
  dir: "L" | "R";
  rawPeak: number;      // mm/frame — peak velocity sebelum EMA
  emaPeak: number;      // mm/frame — peak velocity setelah EMA (yang dipakai untuk threshold)
  frames: number;       // jumlah frame di fase ini
  durationMs: number;
  gapSinceLastSwingMs: number;
  counted: boolean;
  rejectReason: "" | "peak-low" | "cooldown";
}
const swingPhases: PhaseRecord[] = [];
let phaseSeq = 0;
let phaseStartMs = 0;
let phaseFrameCount = 0;
let phaseRawPeak = 0;
function resetSwingDiag(): void {
  swingPhases.length = 0;
  phaseSeq = 0;
  phaseStartMs = 0;
  phaseFrameCount = 0;
  phaseRawPeak = 0;
}

function handleSwing(_gestureActive: boolean, swingEligible: boolean): void {
  const now = performance.now();

  // Update smoothed centroid untuk UI (image-space display)
  if (state.handPresent) {
    state.smoothedCentroid = state.smoothedCentroid * 0.15 + state.handX * 0.85;
  } else if (state.centroidValid) {
    state.smoothedCentroid = state.smoothedCentroid * 0.5 + state.centroidX * 0.5;
  } else {
    state.smoothedCentroid = state.smoothedCentroid * 0.92 + 0.5 * 0.08;
  }

  if (!swingEligible || !state.handPresent || state.wristSampleCount < 3) {
    if (!swingEligible && now - state.lastSwingAt > 1500) state.lastSwingSide = null;
    state.swingDir = 0;
    state.swingPeak = 0;
    phaseRawPeak = 0;
    phaseFrameCount = 0;
    return;
  }

  // World velocity (meter per frame). EMA tipis → responsif, lag minim.
  const rawVelX = state.wristWorldX - state.wristPrevX;
  state.wristVelX = state.wristVelX * 0.3 + rawVelX * 0.7;
  const vx = state.wristVelX;
  const absRaw = Math.abs(rawVelX);

  const curDir: -1 | 0 | 1 = vx > SWING_DEAD_ZONE ? 1
    : vx < -SWING_DEAD_ZONE ? -1 : 0;

  if (curDir === 0) {
    // istirahat singkat — jangan reset peak, mungkin mid-swing pause
  } else if (curDir === state.swingDir) {
    // masih arah sama — track peak magnitude (EMA + raw)
    const mag = Math.abs(vx);
    if (mag > state.swingPeak) state.swingPeak = mag;
    if (absRaw > phaseRawPeak) phaseRawPeak = absRaw;
    phaseFrameCount++;
  } else {
    // DIRECTION REVERSAL — arah sebelumnya (swingDir) berakhir.
    const prevDir = state.swingDir;
    const prevPeak = state.swingPeak;
    const prevRawPeak = phaseRawPeak;
    const sincePrev = now - state.lastSwingAt;
    // Pakai rawPeak (bukan emaPeak) karena EMA bocor peak di frame-1 reversal:
    // velocity lama (opposite sign) carry-over ke EMA blend → peak dipotong.
    // Raw velocity jujur, 5mm = swing nyata paling lembut.
    const passedThresh = prevDir !== 0 && prevRawPeak > SWING_PEAK_THRESH;
    const cooldownOk = sincePrev > cfg.swingCooldownMs;

    if (prevDir !== 0) {
      // Record fase yang baru berakhir ke diagnostic log
      const rec: PhaseRecord = {
        seq: ++phaseSeq,
        dir: prevDir === 1 ? "R" : "L",
        rawPeak: phaseRawPeak * 1000,
        emaPeak: prevPeak * 1000,
        frames: phaseFrameCount,
        durationMs: phaseStartMs > 0 ? Math.round(now - phaseStartMs) : 0,
        gapSinceLastSwingMs: Math.round(sincePrev),
        counted: passedThresh && cooldownOk,
        rejectReason: !passedThresh ? "peak-low" : !cooldownOk ? "cooldown" : "",
      };
      swingPhases.push(rec);
      if (swingPhases.length > 500) swingPhases.shift();  // cap memory

      if (import.meta.env.DEV) {
        const tag = rec.counted ? "SWING +1" : `REJECT/${rec.rejectReason}`;
        // eslint-disable-next-line no-console
        console.log(
          `[#${rec.seq}] ${tag} ${rec.dir} rawPk=${rec.rawPeak.toFixed(1)}mm emaPk=${rec.emaPeak.toFixed(1)}mm frames=${rec.frames} dur=${rec.durationMs}ms gap=${rec.gapSinceLastSwingMs}ms`
        );
      }

      if (rec.counted) {
        const side: "L" | "R" = prevDir === 1 ? "R" : "L";
        state.lastSwingAt = now;
        state.lastSwingSide = side;
        addPoint(side, swingPoints(rec.rawPeak));
      }
    }
    // Mulai fase baru — RESET EMA supaya frame berikutnya tidak dicemari
    // velocity arah lama. Tanpa reset: emaPeak frame-1 bisa turun 70% dari raw.
    state.wristVelX = rawVelX;
    state.swingDir = curDir;
    state.swingPeak = Math.abs(rawVelX);
    phaseRawPeak = absRaw;
    phaseFrameCount = 1;
    phaseStartMs = now;
  }

  // Update latch flag untuk UI
  state.swingLatch = state.swingPeak > SWING_PEAK_THRESH;
}

function handleForwardSwing(swingEligible: boolean): void {
  if (!state.handPresent || state.wristSampleCount < 3) {
    state.fwdDir = 0;
    state.fwdPeak = 0;
    return;
  }

  const rawVelZ = state.wristWorldZ - state.wristPrevZ;
  state.wristVelZ = state.wristVelZ * 0.3 + rawVelZ * 0.7;
  const vz = state.wristVelZ;

  // Z negatif = mendekati kamera (forward). Pakai zero-crossing juga.
  const curDir: -1 | 0 | 1 = vz > FWD_DEAD_ZONE ? 1
    : vz < -FWD_DEAD_ZONE ? -1 : 0;
  const now = performance.now();

  if (curDir !== 0 && curDir !== state.fwdDir) {
    // Reversal: cek kalau fase sebelumnya = forward (Z turun) dan peak cukup
    if (state.fwdDir === -1 && state.fwdPeak > FWD_PEAK_THRESH && swingEligible) {
      if (now - lastForwardSwingAt > FWD_COOLDOWN_MS) {
        lastForwardSwingAt = now;
        addPoint("F", swingPoints(state.fwdPeak * 1000));
      }
    }
    // Reset EMA supaya peak arah baru tidak bocor
    state.wristVelZ = rawVelZ;
    state.fwdDir = curDir;
    state.fwdPeak = Math.abs(rawVelZ);
  } else if (curDir === state.fwdDir && curDir !== 0) {
    const mag = Math.abs(vz);
    if (mag > state.fwdPeak) state.fwdPeak = mag;
  }

  state.forwardLatch = state.fwdDir === -1 && state.fwdPeak > FWD_PEAK_THRESH;
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
  catch (e) {
    if (import.meta.env.DEV) console.warn("[TICK] frame error (ignored):", (e as Error).message);
  }

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

  // MediaPipe Tasks Vision — HandLandmarker (sync, per-frame)
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

  // Centroid fallback hanya kalau MP betul-betul gagal load (bukan saat masih inisialisasi)
  const hasHand = state.handPresent || (state.handsLoadFailed && state.centroidValid);
  const gestureActive = hasHand && handMoving && (mouthClosedWithGrace || veryStrongMotion);

  // swingEligible: butuh gesture aktif (tangan + mulut tutup 🤐) supaya garuk/fidget
  // tanpa mulut tutup tidak dihitung swing. Mulut tutup = sinyal "saya lagi main".
  const swingEligible = gestureActive;

  const reason = gestureActive ? "hand+mouth"
    : !hasHand ? "no-hand"
    : !handMoving ? "hand-still"
    : !mouthClosedWithGrace ? "mouth-open"
    : "?";

  const musicDrive = (hasHand && handMoving) || gestureActive;
  if (settings.music) audioPlayer.drive(musicDrive, reason);
  else audioPlayer.drive(false, "music-toggle-off");

  // Reset idle timer begitu user aktif (tangan gerak / musik nyala) — jangan tunggu addPoint
  if (musicDrive && lastActivityAt > 0) lastActivityAt = performance.now();

  if (gestureActive && !state.gesturePrev) flashBigText("KICAU MANIA");
  state.gesturePrev = gestureActive;

  detectBeat();
  tickLyricSync();

  // Kalau musik berhenti (user diam), langsung hapus semua partikel
  if (!audioPlayer.isPlaying()) {
    particles.length = 0;
    catParticles.length = 0;
  }

  // Render — animasi hanya jalan saat musik aktif (gesture terdeteksi)
  const musicPlaying = audioPlayer.isPlaying();
  ctx.save();
  if (settings.jj && musicPlaying) applyShake(ctx);
  if (settings.cat && musicPlaying) drawCats(ctx, els.catSource, state.currentBassNorm);
  if (settings.lyric && musicPlaying) drawLyrics(ctx, state.currentBassNorm);
  ctx.restore();
  if (settings.jj && musicPlaying) drawFlash(ctx);
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
    const vx = (state.wristVelX * 1000).toFixed(1);   // mm/frame (current)
    const pk = (state.swingPeak * 1000).toFixed(1);   // mm/frame (peak since last reversal)
    const dirStr = state.swingDir === -1 ? "←" : state.swingDir === 1 ? "→" : "·";
    els.pitchValue.textContent = `c=${cShow} ${zone} ${state.handSource} v=${vx} pk=${pk}${dirStr}${state.swingLatch ? "!" : ""}`;
    if (det) {
      els.exprValue.textContent = (mouthClosed ? "🤐" : "👄") +
        " (" + (Math.round(state.smoothedMouthGap * 1000) / 10) + "%)";
    }
    els.comboValue.textContent =
      (state.handPresent ? "✋" : "🚫") + " " +
      (mouthClosed ? "🤐" : (mouthClosedWithGrace ? "🤐…" : "👄")) +
      " r=" + reason;
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
      setupHands().catch((e) => {
        if (import.meta.env.DEV) console.warn("hands setup:", e);
      }),
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
    state.wristWorldX = 0;
    state.wristWorldY = 0;
    state.wristWorldZ = 0;
    state.wristPrevX = 0;
    state.wristPrevZ = 0;
    state.wristVelX = 0;
    state.wristVelZ = 0;
    state.wristSampleCount = 0;
    state.swingDir = 0;
    state.swingPeak = 0;
    state.swingLatch = false;
    state.fwdDir = 0;
    state.fwdPeak = 0;
    state.forwardLatch = false;
    state.lastSwingSide = null;
    resetSwingDiag();
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log(`[SESSION START] thresh=${(SWING_PEAK_THRESH*1000).toFixed(1)}mm dead=${(SWING_DEAD_ZONE*1000).toFixed(2)}mm cooldown=${cfg.swingCooldownMs}ms`);
    }
    renderScore();

    state.running = true;
    els.stopBtn.disabled = false;
    els.stopBtn.textContent = "■ STOP";
    els.stopBtn.style.opacity = "1";
    startSubmitFlush();

    void els.catSource.play().catch(() => { /* */ });
    void tick();
  } catch (e) {
    if (import.meta.env.DEV) console.error("[START] failed:", e);
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
    swingPhases() { return swingPhases; },
    swingReport() {
      const counted = swingPhases.filter(p => p.counted);
      const missed = swingPhases.filter(p => !p.counted);
      const peakLow = missed.filter(p => p.rejectReason === "peak-low");
      const cdBlock = missed.filter(p => p.rejectReason === "cooldown");
      const stat = (arr: number[]) => arr.length === 0 ? { min: 0, max: 0, avg: 0, p50: 0 } : {
        min: Math.min(...arr),
        max: Math.max(...arr),
        avg: arr.reduce((a, b) => a + b, 0) / arr.length,
        p50: [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)]!,
      };
      const countedRawPeaks = counted.map(p => p.rawPeak);
      const countedEmaPeaks = counted.map(p => p.emaPeak);
      const missedRawPeaks = peakLow.map(p => p.rawPeak);
      const missedEmaPeaks = peakLow.map(p => p.emaPeak);
      const gapsCounted = counted.map(p => p.gapSinceLastSwingMs);
      const gapsRejected = cdBlock.map(p => p.gapSinceLastSwingMs);

      const summary = {
        total_phases: swingPhases.length,
        counted: counted.length,
        missed_peak_low: peakLow.length,
        missed_cooldown: cdBlock.length,
        score: state.score,
        thresholds: {
          peak_mm: SWING_PEAK_THRESH * 1000,
          dead_zone_mm: SWING_DEAD_ZONE * 1000,
          cooldown_ms: cfg.swingCooldownMs,
        },
        counted_peak_ema_mm: stat(countedEmaPeaks),
        counted_peak_raw_mm: stat(countedRawPeaks),
        missed_peak_ema_mm: stat(missedEmaPeaks),
        missed_peak_raw_mm: stat(missedRawPeaks),
        counted_gap_ms: stat(gapsCounted),
        rejected_cooldown_gap_ms: stat(gapsRejected),
      };
      // eslint-disable-next-line no-console
      console.log("=== SWING REPORT ===");
      // eslint-disable-next-line no-console
      console.table(summary);
      // eslint-disable-next-line no-console
      console.log("Detail phases (terakhir 50):");
      // eslint-disable-next-line no-console
      console.table(swingPhases.slice(-50).map(p => ({
        "#": p.seq, dir: p.dir, counted: p.counted ? "✓" : "✕",
        rejectReason: p.rejectReason || "-",
        rawPk_mm: p.rawPeak.toFixed(1),
        emaPk_mm: p.emaPeak.toFixed(1),
        frames: p.frames,
        dur_ms: p.durationMs,
        gap_ms: p.gapSinceLastSwingMs,
      })));
      return summary;
    },
  };
}
