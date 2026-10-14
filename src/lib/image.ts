const MAX = 512;

/**
 * Bereitet ein Profilbild zum Hochladen vor: transparenten Rand abschneiden (bei freigestellten Bildern),
 * auf höchstens 512 px verkleinern, als WebP speichern (Safari kann das teils nicht, dann PNG).
 * Die Transparenz bleibt erhalten.
 */
export async function prepareAvatar(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Dieses Bildformat geht leider nicht. Nimm PNG, WebP oder JPG.');
  }

  // Zuerst auf eine Arbeitsgröße bringen, dann den durchsichtigen Rand suchen
  const work = fit(bitmap.width, bitmap.height, 1024);
  const a = canvas(work.w, work.h);
  a.ctx.drawImage(bitmap, 0, 0, work.w, work.h);
  const box = opaqueBox(a.ctx, work.w, work.h);

  const out = fit(box.w, box.h, MAX);
  const b = canvas(out.w, out.h);
  b.ctx.drawImage(a.el, box.x, box.y, box.w, box.h, 0, 0, out.w, out.h);

  const webp = await toBlob(b.el, 'image/webp', 0.9);
  if (webp?.type === 'image/webp') return webp;
  const png = await toBlob(b.el, 'image/png');
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
