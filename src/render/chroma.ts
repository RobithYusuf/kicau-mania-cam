/* Chroma-key greenscreen → sprite transparan via offscreen canvas. Cache per video frame. */
const chromaCanvas = document.createElement("canvas");
const chromaCtx = chromaCanvas.getContext("2d", { willReadFrequently: true })!;
let chromaCachedAt = -1;

export function getChromaCanvas(): HTMLCanvasElement { return chromaCanvas; }

export function updateChroma(video: HTMLVideoElement): void {
  if (video.readyState < 2) return;
  if (Math.abs(video.currentTime - chromaCachedAt) < 0.0001) return;
  chromaCachedAt = video.currentTime;

  if (chromaCanvas.width !== video.videoWidth) {
    chromaCanvas.width = video.videoWidth;
    chromaCanvas.height = video.videoHeight;
  }
  chromaCtx.drawImage(video, 0, 0);
  const img = chromaCtx.getImageData(0, 0, chromaCanvas.width, chromaCanvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i]!, g = d[i + 1]!, b = d[i + 2]!;
    const isGreen = g > 90 && g > r * 1.25 && g > b * 1.25;
    if (isGreen) {
      d[i + 3] = 0;
    } else if (g > r && g > b) {
      const excess = g - Math.max(r, b);
      d[i + 1] = Math.max(r, b) + excess * 0.2;
      d[i + 3] = Math.max(0, 255 - excess * 3);
    }
  }
  chromaCtx.putImageData(img, 0, 0);
}
