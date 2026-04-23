/* Web Audio AudioBufferSourceNode untuk seamless loop + gain control + analyser tap */
import { state, cfg } from "../state";

let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let freqData: Uint8Array<ArrayBuffer> | null = null;
let bufferGain: GainNode | null = null;
let bufferSrc: AudioBufferSourceNode | null = null;
let audioBuffer: AudioBuffer | null = null;
let bufferStartCtxT = 0;
let lastBufferOffset = 0;
let pauseTimer: ReturnType<typeof setTimeout> | null = null;
let lastMusicState: "stopped" | "playing" = "stopped";
let musicStartedAt = 0;

export interface AudioPlayer {
  ensureContext(): Promise<void>;
  loadBuffer(url: string): Promise<void>;
  isPlaying(): boolean;
  currentTime(): number;
  drive(shouldPlay: boolean, reason: string): void;
  stopAll(): void;
  getAnalyser(): AnalyserNode | null;
  getFreqData(): Uint8Array<ArrayBuffer> | null;
}

export const audioPlayer: AudioPlayer = {
  async ensureContext() {
    if (!audioCtx) {
      const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
        || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtx = new Ctx();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.4;
      freqData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      analyser.connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") {
      try { await audioCtx.resume(); } catch (e) { console.warn("[AUDIO] resume failed:", e); }
    }
  },

  async loadBuffer(url: string) {
    if (!audioCtx) await this.ensureContext();
    if (audioBuffer) return;
    const r = await fetch(url);
    const ab = await r.arrayBuffer();
    audioBuffer = await audioCtx!.decodeAudioData(ab);
    if (state.debug) console.log(`[AUDIO] buffer decoded ${audioBuffer.duration.toFixed(2)}s`);
  },

  isPlaying() { return !!bufferSrc; },

  currentTime() {
    if (!bufferSrc || !audioCtx || !audioBuffer) return 0;
    const elapsed = audioCtx.currentTime - bufferStartCtxT;
    return elapsed % audioBuffer.duration;
  },

  drive(shouldPlay, reason) {
    if (!audioCtx || !audioBuffer) return;
    const now = performance.now();

    if (shouldPlay) {
      if (pauseTimer) { clearTimeout(pauseTimer); pauseTimer = null; }
      if (!bufferSrc) {
        musicStartedAt = now;
        startBuffer(lastBufferOffset);
        if (bufferGain) {
          try { bufferGain.gain.cancelScheduledValues(audioCtx.currentTime); } catch { /* */ }
          bufferGain.gain.value = cfg.musicTargetVolume;
        }
        if (state.debug && lastMusicState !== "playing") {
          console.log(`[MUSIC] PLAY (${reason}) offset=${lastBufferOffset.toFixed(2)}`);
          lastMusicState = "playing";
        }
      } else if (bufferGain) {
        try { bufferGain.gain.cancelScheduledValues(audioCtx.currentTime); } catch { /* */ }
        bufferGain.gain.value = cfg.musicTargetVolume;
      }
    } else {
      if (!bufferSrc || pauseTimer) return;
      const sinceStart = now - musicStartedAt;
      const extraDelay = Math.max(0, cfg.minPlayMs - sinceStart);
      const totalGrace = cfg.musicGraceMs + extraDelay;
      pauseTimer = setTimeout(() => {
        pauseTimer = null;
        lastBufferOffset = audioPlayer.currentTime();
        stopBuffer();
        if (state.debug && lastMusicState !== "stopped") {
          console.log(`[MUSIC] PAUSED at offset=${lastBufferOffset.toFixed(2)}`);
          lastMusicState = "stopped";
        }
      }, totalGrace);
    }
  },

  stopAll() {
    if (pauseTimer) { clearTimeout(pauseTimer); pauseTimer = null; }
    stopBuffer();
    lastBufferOffset = 0;
  },

  getAnalyser() { return analyser; },
  getFreqData() { return freqData; },
};

function startBuffer(offset: number): void {
  if (!audioCtx || !audioBuffer) {
    console.warn("[ANIM/AUDIO] startBuffer: missing", { ctx: !!audioCtx, buffer: !!audioBuffer });
    return;
  }
  stopBuffer();
  const src = audioCtx.createBufferSource();
  src.buffer = audioBuffer;
  src.loop = true;
  if (!bufferGain) {
    bufferGain = audioCtx.createGain();
    bufferGain.gain.value = cfg.musicTargetVolume;
    bufferGain.connect(audioCtx.destination);
    bufferGain.connect(analyser!);
  }
  src.connect(bufferGain);
  bufferSrc = src;
  bufferStartCtxT = audioCtx.currentTime - offset;
  src.start(0, offset);
}

function stopBuffer(): void {
  if (bufferSrc) {
    try { bufferSrc.stop(); bufferSrc.disconnect(); } catch { /* */ }
    bufferSrc = null;
  }
}
