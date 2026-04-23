import { MAX_LYRIC_PARTICLES, MAX_CAT_PARTICLES } from "../state";
import { updateChroma, getChromaCanvas } from "./chroma";

interface LyricParticle {
  text: string;
  color: string;
  fontSize: number;
  x: number; y: number;
  life: number;
  maxLife: number;
  rot: number;
  popScale: number;
}
interface CatParticle {
  x: number; y: number;
  scale: number;
  life: number;
  maxLife: number;
  rot: number;
  bob: number;
  popScale: number;
}

const LYRIC_COLORS = ["#ffcc00", "#ff5a1f", "#22c55e", "#ffffff", "#ff3bd6", "#3b82f6"];

export const particles: LyricParticle[] = [];
export const catParticles: CatParticle[] = [];

export function spawnLyric(text: string, durationSec: number, viewW: number, viewH: number): void {
  for (const p of particles) {
    if (p.text === text && p.life < p.maxLife * 0.6) return;
  }
  while (particles.length >= MAX_LYRIC_PARTICLES) particles.shift();

  const color = LYRIC_COLORS[Math.floor(Math.random() * LYRIC_COLORS.length)]!;
  const big = text.length <= 7;
  const fontSize = big ? 38 : 24;
  const margin = 40;

  // Avoid center safe-zone (face & swipe area)
  let x = 0, y = 0;
  for (let tries = 0; tries < 8; tries++) {
    x = margin + Math.random() * (viewW - margin * 2);
    y = margin + Math.random() * (viewH - margin * 2);
    const inSafeX = x > viewW * 0.35 && x < viewW * 0.65;
    const inSafeY = y > viewH * 0.30 && y < viewH * 0.80;
    if (!(inSafeX && inSafeY)) break;
  }

  particles.push({
    text, color, fontSize, x, y,
    life: 0,
    // Min 800ms — supaya cukup terlihat user sebelum hilang
    maxLife: Math.max(800, durationSec * 1000 * 1.2),
    rot: (Math.random() - 0.5) * 0.18,
    popScale: 1.3,
  });
}

export function spawnCatDance(viewW: number, viewH: number): void {
  if (catParticles.length >= MAX_CAT_PARTICLES) return;
  const targetH = viewH * (0.50 + Math.random() * 0.25);
  const scale = targetH / 426;
  const wCat = 240 * scale;
  const hCat = 426 * scale;

  const edge = Math.floor(Math.random() * 4);
  const PAD = 8;
  let x: number, y: number;
  if (edge === 0)      { x = wCat / 2 + Math.random() * (viewW - wCat); y = hCat / 2 + PAD; }
  else if (edge === 1) { x = viewW - wCat / 2 - PAD; y = hCat / 2 + Math.random() * (viewH - hCat); }
  else if (edge === 2) { x = wCat / 2 + Math.random() * (viewW - wCat); y = viewH - hCat / 2 - PAD; }
  else                 { x = wCat / 2 + PAD; y = hCat / 2 + Math.random() * (viewH - hCat); }

  catParticles.push({
    x, y, scale,
    life: 0,
    // Lebih lama: 1.8–3 detik per kucing supaya kelihatan jelas
    maxLife: 1800 + Math.random() * 1200,
    rot: (Math.random() - 0.5) * 0.2,
    bob: Math.random() * Math.PI * 2,
    popScale: 1.2,
  });
}

export function drawCats(ctx: CanvasRenderingContext2D, catSource: HTMLVideoElement, bassNorm: number, dt = 16): void {
  // Always draw cats — kalau video chroma belum ready, pakai emoji 🐱 fallback
  const useChroma = catSource.readyState >= 2;
  if (useChroma) updateChroma(catSource);
  const sprite = getChromaCanvas();
  const cw = sprite.width || 240;
  const ch = sprite.height || 426;

  for (let i = catParticles.length - 1; i >= 0; i--) {
    const p = catParticles[i]!;
    p.life += dt;
    if (p.life > p.maxLife) { catParticles.splice(i, 1); continue; }
    p.bob += 0.1;

    const t = p.life / p.maxLife;
    const alpha = t < 0.15 ? t / 0.15 : (t > 0.8 ? (1 - t) / 0.2 : 1);

    let scaleMul: number;
    if (t < 0.2) scaleMul = p.popScale + (1 - p.popScale) * (t / 0.2);
    else if (t < 0.8) scaleMul = 1 + bassNorm * 0.12;
    else scaleMul = 1 - (t - 0.8) / 0.2 * 0.3;

    const w = cw * p.scale * scaleMul;
    const h = ch * p.scale * scaleMul;
    const bobY = Math.sin(p.bob) * 6;

    ctx.save();
    ctx.translate(ctx.canvas.width - p.x, p.y + bobY);
    ctx.scale(-1, 1);
    ctx.rotate(p.rot);
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.shadowColor = "rgba(255,204,0,0.95)";
    ctx.shadowBlur = 18 + bassNorm * 26;
    if (useChroma && sprite.width > 1) {
      ctx.drawImage(sprite, -w / 2, -h / 2, w, h);
    } else {
      // Fallback: 🐱 emoji ukuran sama dengan cat sprite (selalu visible)
      ctx.font = `${h * 0.85}px "Apple Color Emoji", "Segoe UI Emoji", system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("🐱", 0, 0);
    }
    ctx.restore();
  }
}

export function drawLyrics(ctx: CanvasRenderingContext2D, bassNorm: number, dt = 16): void {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]!;
    p.life += dt;
    if (p.life > p.maxLife) { particles.splice(i, 1); continue; }

    const t = p.life / p.maxLife;
    let alpha: number;
    if (t < 0.12) alpha = t / 0.12;
    else if (t < 0.70) alpha = 1;
    else alpha = 1 - (t - 0.70) / 0.30;

    let scaleMul: number;
    if (t < 0.22) scaleMul = p.popScale + (1 - p.popScale) * (t / 0.22);
    else if (t < 0.70) scaleMul = 1;
    else scaleMul = 1 - (t - 0.70) / 0.30 * 0.4;
    const fontSize = p.fontSize * scaleMul;

    ctx.save();
    ctx.translate(ctx.canvas.width - p.x, p.y);
    ctx.scale(-1, 1);
    ctx.rotate(p.rot);
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.font = `800 ${fontSize}px "Inter", system-ui, -apple-system, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 8 + bassNorm * 14;
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.lineWidth = Math.max(2, fontSize * 0.05);
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    ctx.strokeText(p.text, 0, 0);
    ctx.shadowBlur = 0;
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, 0, 0);
    ctx.restore();
  }
}
