import type { LeaderEntry } from "../types";

const LB_KEY = "kicau-mania-leaderboard";

export function getLocal(): LeaderEntry[] {
  try { return JSON.parse(localStorage.getItem(LB_KEY) || "[]") as LeaderEntry[]; }
  catch { return []; }
}

function setLocal(list: LeaderEntry[]): void {
  localStorage.setItem(LB_KEY, JSON.stringify(list));
}

export function saveLocal(name: string, score: number): void {
  const list = getLocal();
  list.push({ name, score, date: new Date().toISOString() });
  list.sort((a, b) => b.score - a.score);
  setLocal(list.slice(0, 100));
}

export function clearLocal(): void { setLocal([]); }
