import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MutableRefObject, type PointerEvent } from 'react';
import { AVATAR_ASPECT, exportCrop, type Crop } from '../lib/image';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 5;

/**
 * Zuschneiden wie bei Profilbildern in sozialen Netzwerken: Bild im 4:5-Rahmen verschieben (Finger/Maus)
 * und zoomen (zwei Finger, Mausrad oder Regler). Der Rahmen zeigt den Hintergrund in der Spielerfarbe,
 * so wie das Bild später im Profil steht.
 */
export function AvatarCropper({ source, color, cropRef }: {
  source: HTMLCanvasElement;
  color: string;
  /** Wird mit einer Funktion belegt, die den gewählten Ausschnitt als Bild liefert (aufgerufen beim Speichern) */
  cropRef: MutableRefObject<(() => Promise<Blob>) | null>;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [frameW, setFrameW] = useState(0);
  const [crop, setCrop] = useState<Crop | null>(null);
  const fitScale = useRef(1);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  useEffect(() => {
    let u: string | null = null;
    source.toBlob((b) => {
      if (!b) return;
      u = URL.createObjectURL(b);
      setUrl(u);
    });
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [source]);

  // Start: ganzes Bild sichtbar, unten bündig, waagerecht mittig
  const reset = (w: number) => {
    const h = w / AVATAR_ASPECT;
    const s = Math.min(w / source.width, h / source.height);
    fitScale.current = s;
    setCrop({ scale: s, x: (w - source.width * s) / 2, y: h - source.height * s });
  };
  useLayoutEffect(() => {
    const w = frame.current?.clientWidth ?? 0;
    setFrameW(w);
    reset(w);
  }, [source]);

  /** Zoomt so, dass der Punkt (cx, cy) im Rahmen an seiner Stelle bleibt */
  const zoomTo = (scale: number, cx: number, cy: number) =>
    setCrop((c) => {
      if (!c) return c;
      const s = Math.min(fitScale.current * MAX_ZOOM, Math.max(fitScale.current * MIN_ZOOM, scale));
      return { scale: s, x: cx - (cx - c.x) * (s / c.scale), y: cy - (cy - c.y) * (s / c.scale) };
    });

  // Mausrad: als nicht-passiver Listener, damit die Seite dabei nicht scrollt
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setCrop((c) => {
        if (!c) return c;
        const s = Math.min(fitScale.current * MAX_ZOOM, Math.max(fitScale.current * MIN_ZOOM, c.scale * Math.exp(-e.deltaY * 0.0015)));
        const cx = e.clientX - r.left;
        const cy = e.clientY - r.top;
        return { scale: s, x: cx - (cx - c.x) * (s / c.scale), y: cy - (cy - c.y) * (s / c.scale) };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const up = (e: PointerEvent<HTMLDivElement>) => pointers.current.delete(e.pointerId);
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const ps = pointers.current;
    const prev = ps.get(e.pointerId);
    if (!prev || !crop) return;
    const next = { x: e.clientX, y: e.clientY };
    if (ps.size === 1) {
      // Ein Finger: verschieben
      setCrop((c) => c && { ...c, x: c.x + next.x - prev.x, y: c.y + next.y - prev.y });
    } else if (ps.size === 2) {
      // Zwei Finger: zoomen um die Mitte zwischen den Fingern
      const other = [...ps.entries()].find(([id]) => id !== e.pointerId)![1];
      const before = Math.hypot(prev.x - other.x, prev.y - other.y);
      const after = Math.hypot(next.x - other.x, next.y - other.y);
      const r = e.currentTarget.getBoundingClientRect();
      if (before > 0) zoomTo(crop.scale * (after / before), (next.x + other.x) / 2 - r.left, (next.y + other.y) / 2 - r.top);
    }
    ps.set(e.pointerId, next);
  };

  // Beim Speichern holt sich das Formular hierüber den aktuellen Ausschnitt
  useEffect(() => {
    cropRef.current = crop ? () => exportCrop(source, crop, frameW) : null;
    return () => { cropRef.current = null; };
  }, [crop, frameW, source, cropRef]);

  const zoom = crop ? crop.scale / fitScale.current : 1;
  const frameH = frameW / AVATAR_ASPECT;

  return (
    <div className="stack">
      <div
        ref={frame}
        className="cropper-frame"
        style={{ '--pc': color } as CSSProperties}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        aria-label="Bildausschnitt: zum Verschieben ziehen, zum Zoomen mit zwei Fingern oder dem Mausrad"
        role="img"
      >
        {url && crop && (
          <img
            src={url}
            alt=""
            draggable={false}
            style={{
              width: source.width * crop.scale,
              height: source.height * crop.scale,
              transform: `translate(${crop.x}px, ${crop.y}px)`,
            }}
          />
        )}
      </div>
      <label className="row nowrap cropper-zoom">
        <span className="sub">Zoom</span>
        <input
          id="crop-zoom"
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.01}
          value={zoom}
          onChange={(e) => zoomTo(fitScale.current * Number(e.target.value), frameW / 2, frameH / 2)}
        />
      </label>
      <p className="sub">Ziehen zum Verschieben, mit zwei Fingern, dem Regler oder dem Mausrad zoomen. Gespeichert wird mit „Speichern“.</p>
      <div className="row">
        <button type="button" className="btn small" onClick={() => reset(frameW)}>Ausschnitt zurücksetzen</button>
      </div>
    </div>
  );
}
