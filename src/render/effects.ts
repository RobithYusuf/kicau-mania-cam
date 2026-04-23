/* JJ effect (shake + flash) + flashBigText overlay */

const JJ_SHAKE_STRENGTH = 14;
let jjShakeT = 0;
let jjFlashT = 0;

export function triggerJJ(): void {
  jjShakeT = 180;
  jjFlashT = 120;
}

export function applyShake(ctx: CanvasRenderingContext2D): void {
  if (jjShakeT <= 0) return;
  const shake = (jjShakeT / 180) * JJ_SHAKE_STRENGTH;
  const sx = (Math.random() - 0.5) * shake * 2;
  const sy = (Math.random() - 0.5) * shake * 2;
  ctx.translate(sx, sy);
}

export function drawFlash(ctx: CanvasRenderingContext2D): void {
  if (jjFlashT <= 0) return;
  ctx.save();
  ctx.globalAlpha = (jjFlashT / 120) * 0.35;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

export function tickEffects(dt = 16): void {
  jjShakeT = Math.max(0, jjShakeT - dt);
  jjFlashT = Math.max(0, jjFlashT - dt);
}

let bigTextEl: HTMLElement | null = null;
let bigTextTimer: ReturnType<typeof setTimeout> | null = null;
export function setBigTextEl(el: HTMLElement): void { bigTextEl = el; }
export function flashBigText(text: string, durationMs = 600): void {
  if (!bigTextEl) return;
  bigTextEl.textContent = text;
  bigTextEl.classList.remove("hidden");
  if (bigTextTimer) clearTimeout(bigTextTimer);
  bigTextTimer = setTimeout(() => bigTextEl?.classList.add("hidden"), durationMs);
}
