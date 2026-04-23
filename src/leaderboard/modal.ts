import { getLocal, clearLocal } from "./local";
import { fetchGlobal, isSupabaseConfigured, subscribeGlobal } from "./supabase";
import type { LeaderEntry } from "../types";

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHtml(s: string): string { return s.replace(/[&<>"']/g, (c) => ESC[c]!); }

let mode: "local" | "global" = "local";
let modalEl: HTMLElement;
let listEl: HTMLOListElement;

export function setupLeaderboardModal(refs: {
  btn: HTMLElement; modal: HTMLElement; list: HTMLOListElement;
  close: HTMLElement; tabLocal: HTMLElement; tabGlobal: HTMLElement;
  exportBtn: HTMLElement; clearBtn: HTMLElement;
}): void {
  modalEl = refs.modal;
  listEl = refs.list;

  refs.btn.addEventListener("click", () => { render(); modalEl.classList.remove("hidden"); });
  refs.close.addEventListener("click", () => modalEl.classList.add("hidden"));
  modalEl.addEventListener("click", (e) => { if (e.target === modalEl) modalEl.classList.add("hidden"); });

  refs.tabLocal.addEventListener("click", () => setMode("local", refs));
  refs.tabGlobal.addEventListener("click", () => setMode("global", refs));

  refs.exportBtn.addEventListener("click", () => exportJson());
  refs.clearBtn.addEventListener("click", () => {
    if (confirm("Hapus seluruh leaderboard local?")) {
      clearLocal();
      render();
    }
  });

  // Realtime — auto re-render kalau modal terbuka & lagi tab Global
  subscribeGlobal(() => {
    if (mode === "global" && !modalEl.classList.contains("hidden")) render();
  });
}

function setMode(m: "local" | "global", refs: { tabLocal: HTMLElement; tabGlobal: HTMLElement }): void {
  mode = m;
  refs.tabLocal.classList.toggle("active", m === "local");
  refs.tabGlobal.classList.toggle("active", m === "global");
  render();
}

async function render(): Promise<void> {
  if (mode === "global") {
    if (!isSupabaseConfigured()) {
      renderList([], "🌐 Global belum di-config (lihat MAINTENANCE.md)");
      return;
    }
    listEl.innerHTML = '<li class="lb-loading">memuat global…</li>';
    const data = await fetchGlobal(20);
    renderList(data || [], `🌐 Global · ${data?.length || 0} pemain`);
  } else {
    renderList(getLocal().slice(0, 20), "📁 Local · disimpan di browser ini");
  }
}

function renderList(items: LeaderEntry[], sourceTag: string): void {
  const sourceEl = document.querySelector(".lb-source-tag");
  sourceEl?.remove();
  const tag = document.createElement("div");
  tag.className = "lb-source-tag";
  tag.textContent = sourceTag;
  listEl.parentNode?.insertBefore(tag, listEl);

  if (!items || items.length === 0) {
    listEl.innerHTML = '<li class="empty">Belum ada skor. Main dulu!</li>';
    return;
  }
  listEl.innerHTML = items.map((e, i) => {
    const dateRaw = e.date || e.updated_at || "";
    const dateStr = dateRaw ? new Date(dateRaw).toLocaleDateString("id-ID", { day: "2-digit", month: "short" }) : "";
    const safeName = escapeHtml(String(e.name || "").slice(0, 30));
    const safeScore = Math.max(0, Math.min(99999, Number(e.score) || 0));
    return `<li>
      <span class="lb-rank">${i + 1}</span>
      <span class="lb-name">${safeName}</span>
      <span class="lb-score">${safeScore}</span>
      <span class="lb-date">${escapeHtml(dateStr)}</span>
    </li>`;
  }).join("");
}

function exportJson(): void {
  const json = JSON.stringify(getLocal(), null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `kicau-mania-leaderboard-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
