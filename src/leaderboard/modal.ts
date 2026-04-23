import { fetchGlobal, isSupabaseConfigured, subscribeGlobal } from "./supabase";
import type { LeaderEntry } from "../types";

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHtml(s: string): string { return s.replace(/[&<>"']/g, (c) => ESC[c]!); }

let modalEl: HTMLElement;
let listEl: HTMLOListElement;

export function setupLeaderboardModal(refs: {
  btn: HTMLElement; modal: HTMLElement; list: HTMLOListElement; close: HTMLElement;
}): void {
  modalEl = refs.modal;
  listEl = refs.list;

  refs.btn.addEventListener("click", () => { void render(); modalEl.classList.remove("hidden"); });
  refs.close.addEventListener("click", () => modalEl.classList.add("hidden"));
  modalEl.addEventListener("click", (e) => { if (e.target === modalEl) modalEl.classList.add("hidden"); });

  // Realtime — re-render saat ada perubahan & modal terbuka
  subscribeGlobal(() => {
    if (!modalEl.classList.contains("hidden")) void render();
  });
}

async function render(): Promise<void> {
  if (!isSupabaseConfigured()) {
    renderList([], "🌐 Global belum di-config (lihat MAINTENANCE.md)");
    return;
  }
  listEl.innerHTML = '<li class="text-center text-muted py-5">memuat…</li>';
  const data = await fetchGlobal(20);
  renderList(data || [], "");
}

function renderList(items: LeaderEntry[], emptyMsg: string): void {
  if (!items || items.length === 0) {
    listEl.innerHTML = `<li class="text-center text-muted py-5">${escapeHtml(emptyMsg || "Belum ada skor. Main dulu!")}</li>`;
    return;
  }
  listEl.innerHTML = items.map((e, i) => {
    const dateRaw = e.date || e.updated_at || "";
    const dateStr = dateRaw ? new Date(dateRaw).toLocaleDateString("id-ID", { day: "2-digit", month: "short" }) : "";
    const safeName = escapeHtml(String(e.name || "").slice(0, 30));
    const safeScore = Math.max(0, Math.min(99999, Number(e.score) || 0));
    return `<li class="lb-row">
      <span class="rank">${i + 1}</span>
      <span class="name">${safeName}</span>
      <span class="score">${safeScore}</span>
      <span class="date">${escapeHtml(dateStr)}</span>
    </li>`;
  }).join("");
}
