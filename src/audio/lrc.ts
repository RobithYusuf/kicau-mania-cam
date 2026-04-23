import type { LyricEntry } from "../types";

/** Parse standar LRC: [mm:ss.xx]text */
export function parseLRC(text: string): LyricEntry[] {
  const lines = text.split(/\r?\n/);
  const items: LyricEntry[] = [];
  const reTime = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

  for (const line of lines) {
    reTime.lastIndex = 0;
    const stamps: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = reTime.exec(line)) !== null) {
      const min = parseInt(m[1]!, 10);
      const sec = parseInt(m[2]!, 10);
      const frac = m[3] ? parseInt(m[3].padEnd(3, "0"), 10) / 1000 : 0;
      stamps.push(min * 60 + sec + frac);
    }
    const lyric = line.replace(reTime, "").trim();
    if (!lyric || stamps.length === 0) continue;
    for (const t of stamps) items.push({ t, text: lyric, duration: 0 });
  }
  items.sort((a, b) => a.t - b.t);
  for (let i = 0; i < items.length; i++) {
    const nextT = i + 1 < items.length ? items[i + 1]!.t : items[i]!.t + 0.6;
    items[i]!.duration = Math.min(1.2, Math.max(0.25, nextT - items[i]!.t - 0.05));
  }
  return items;
}

export async function loadLRC(url: string): Promise<LyricEntry[]> {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error("http " + r.status);
    return parseLRC(await r.text());
  } catch (e) {
    console.warn("[LRC] load failed:", e);
    return [];
  }
}
