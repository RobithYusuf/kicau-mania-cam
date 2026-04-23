import { state, cfg } from "../state";
import { audioPlayer } from "./buffer-player";

export interface BeatResult { onset: boolean; energy: number; }

/** Bass onset detection via FFT analyser (low-freq bins). */
export function detectBeat(): BeatResult {
  const analyser = audioPlayer.getAnalyser();
  const freqData = audioPlayer.getFreqData();
  if (!analyser || !freqData || !audioPlayer.isPlaying()) {
    state.currentBassNorm = Math.max(0, state.currentBassNorm - 0.05);
    return { onset: false, energy: 0 };
  }
  analyser.getByteFrequencyData(freqData as Uint8Array<ArrayBuffer>);
  let sum = 0;
  const N = 6;
  for (let i = 0; i < N; i++) sum += freqData[i]!;
  const energy = sum / (N * 255);

  state.bassAvg = state.bassAvg * 0.92 + energy * 0.08;
  state.bassPeak = Math.max(state.bassPeak * 0.995, energy);
  state.currentBassNorm = Math.min(1, energy / (state.bassPeak + 0.001));

  const now = performance.now();
  const threshold = state.bassAvg * 1.35 + 0.04;
  const onset = energy > threshold && (now - state.lastBeatAt) > cfg.beatCooldownMs;
  if (onset) state.lastBeatAt = now;
  return { onset, energy };
}
