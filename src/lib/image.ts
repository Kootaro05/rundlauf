/** Einheitliches Format aller Profilbilder: Hochformat 4:5 */
export const AVATAR_ASPECT = 4 / 5;
const OUT_W = 512;
const OUT_H = Math.round(OUT_W / AVATAR_ASPECT);
const SOURCE_MAX = 1600;

/**
 * Lädt ein Bild zum Zuschneiden: durchsichtigen Rand abschneiden (bei freigestellten Bildern)
 * und auf eine handliche Größe bringen. Die Transparenz bleibt erhalten.
 */
export async function loadForCrop(file: File): Promise<HTMLCanvasElement> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Dieses Bildformat geht leider nicht. Nimm PNG, WebP oder JPG.');
  }
  const work = fit(bitmap.width, bitmap.height, SOURCE_MAX);
  const a = canvas(work.w, work.h);
  a.ctx.drawImage(bitmap, 0, 0, work.w, work.h);
  const box = opaqueBox(a.ctx, work.w, work.h);
  const b = canvas(box.w, box.h);
  b.ctx.drawImage(a.el, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  return b.el;
}

/** Lage des Bildes im Zuschnitt-Rahmen, in Pixeln des Rahmens (Breite frameW, Höhe frameW / AVATAR_ASPECT) */
export interface Crop {
  x: number;
  y: number;
  scale: number;
}

/** Rendert den gewählten Ausschnitt als 512 × 640 px, WebP (Safari teils nur PNG). */
export async function exportCrop(source: HTMLCanvasElement, crop: Crop, frameW: number): Promise<Blob> {
  const k = OUT_W / frameW;
  const out = canvas(OUT_W, OUT_H);
  out.ctx.imageSmoothingQuality = 'high';
  out.ctx.drawImage(source, crop.x * k, crop.y * k, source.width * crop.scale * k, source.height * crop.scale * k);
  const webp = await toBlob(out.el, 'image/webp', 0.9);
  if (webp?.type === 'image/webp') return webp;
  const png = await toBlob(out.el, 'image/png');
  if (!png) throw new Error('Das Bild konnte nicht verarbeitet werden.');
  return png;
}

function fit(w: number, h: number, max: number) {
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

function canvas(w: number, h: number) {
  const el = document.createElement('canvas');
  el.width = w;
  el.height = h;
  return { el, ctx: el.getContext('2d', { willReadFrequently: true })! };
}

/** Kleinstes Rechteck, das alle nicht durchsichtigen Pixel enthält. Ohne Transparenz: das ganze Bild. */
function opaqueBox(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const px = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (px[(y * w + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return { x: 0, y: 0, w, h };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

const toBlob = (el: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>((resolve) => el.toBlob(resolve, type, quality));
