import { fetchGlobal, isSupabaseConfigured, subscribeGlobal } from "./supabase";
import type { LeaderEntry } from "../types";

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHtml(s: string): string { return s.replace(/[&<>"']/g, (c) => ESC[c]!); }

const RANK_BADGE: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };
const FETCH_LIMIT = 50;

let modalEl: HTMLElement;
let listEl: HTMLOListElement;
let metaEl: HTMLElement | null = null;

export function setupLeaderboardModal(refs: {
  btn: HTMLElement; modal: HTMLElement; list: HTMLOListElement; close: HTMLElement;
}): void {
  modalEl = refs.modal;
  listEl = refs.list;
  metaEl = document.getElementById("lbMeta");

  refs.btn.addEventListener("click", () => { void render(); modalEl.classList.remove("hidden"); });
  refs.close.addEventListener("click", () => modalEl.classList.add("hidden"));
  modalEl.addEventListener("click", (e) => { if (e.target === modalEl) modalEl.classList.add("hidden"); });

  subscribeGlobal(() => {
    if (!modalEl.classList.contains("hidden")) void render();
  });
}

async function render(): Promise<void> {
  if (!isSupabaseConfigured()) {
    setMeta("⚠ Global belum di-config");
    renderEmpty("Global leaderboard belum aktif (lihat docs/MAINTENANCE.md)");
    return;
  }
  setMeta("memuat…");
  listEl.innerHTML = '<li class="text-center text-muted py-12 text-xs">⏳ memuat data dari Supabase…</li>';

  const data = await fetchGlobal(FETCH_LIMIT);
  if (!data) {
    setMeta("✕ gagal memuat");
    renderEmpty("Gagal memuat leaderboard. Cek koneksi atau coba lagi nanti.");
    return;
  }

  if (data.total === 0) {
    setMeta("0 pemain");
    renderEmpty("🏁 Belum ada pemain yang submit skor. Jadilah yang pertama!");
    return;
  }

  // Meta info: showing top N of M, top score
  const showing = Math.min(FETCH_LIMIT, data.rows.length);
  const ofText = data.total > FETCH_LIMIT
    ? `top <b class="text-text">${showing}</b> dari <b class="text-text">${data.total.toLocaleString("id-ID")}</b> pemain`
    : `<b class="text-text">${data.total}</b> pemain total`;
  setMeta(`${ofText} · skor tertinggi <b class="text-text" style="color: var(--color-accent);">${data.topScore.toLocaleString("id-ID")}</b>`);

  renderRows(data.rows);
}

function setMeta(html: string): void {
  if (metaEl) metaEl.innerHTML = html;
}

function renderEmpty(msg: string): void {
  listEl.innerHTML = `<li class="text-center text-muted py-12 text-sm px-6 leading-relaxed">${escapeHtml(msg)}</li>`;
}

function relativeTime(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60)        return `${sec}s lalu`;
  const min = Math.floor(sec / 60);
  if (min < 60)        return `${min}m lalu`;
  const hr = Math.floor(min / 60);
  if (hr < 24)         return `${hr}j lalu`;
  const day = Math.floor(hr / 24);
  if (day < 30)        return `${day}h lalu`;
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
}

function getMyName(): string {
  return (localStorage.getItem("kicau-mania-name") || "").trim();
}
function getMyBest(): number {
  return parseInt(localStorage.getItem("kicau-mania-best") || "0", 10);
}

function renderRows(items: LeaderEntry[]): void {
  // Responsive: kolom UPDATED disembunyikan di mobile via CSS
  const GRID = "display:grid;grid-template-columns:48px 1fr 80px 90px;align-items:center;";
  const myName = getMyName();
  const myBest = getMyBest();

  listEl.innerHTML = items.map((e, i) => {
    const rank = i + 1;
    const badge = RANK_BADGE[rank] || `<span class="text-muted font-bold">${rank}</span>`;
    const safeName = escapeHtml(String(e.name || "").slice(0, 30));
    const safeScore = Math.max(0, Math.min(99999, Number(e.score) || 0));
    const updated = relativeTime(e.updated_at || e.date);
    const isTop3 = rank <= 3;

    // Detect "Anda": match name (kalau user sudah set) ATAU score === personal best
    const isMe = (myName && e.name === myName) || (myBest > 0 && safeScore === myBest);

    let tint: string;
    if (isMe)           tint = "rgb(16 185 129 / 0.18)";       // emerald — milikku
    else if (rank === 1) tint = "rgb(245 158 11 / 0.10)";      // gold
    else if (rank === 2) tint = "rgb(161 161 170 / 0.08)";     // silver
    else if (rank === 3) tint = "rgb(180 83 9 / 0.10)";        // bronze
    else                 tint = "transparent";

    const rowStyle = `${GRID}background:linear-gradient(90deg, ${tint}, transparent);`;

    const meBadge = isMe ? `<span class="ml-1.5 text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider" style="background:var(--color-accent);color:#fff;">Anda</span>` : "";

    return `<li class="lb-table-row" style="${rowStyle}">
      <span class="text-center ${isTop3 ? 'text-xl' : 'text-sm'}">${badge}</span>
      <span class="font-semibold text-text truncate pr-3 ${isTop3 ? 'text-base' : 'text-sm'} flex items-center">${safeName}${meBadge}</span>
      <span class="text-right font-black tabular-nums ${isTop3 ? 'text-lg' : 'text-base'}" style="color: var(--color-accent);">${safeScore.toLocaleString('id-ID')}</span>
      <span class="text-right text-[11px] text-muted tabular-nums pl-2">${escapeHtml(updated)}</span>
    </li>`;
  }).join("");
}
