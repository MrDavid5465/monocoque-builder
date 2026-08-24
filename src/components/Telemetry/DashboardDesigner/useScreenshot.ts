import { toPng } from 'html-to-image';
import { RefObject } from 'react';
import { ComponentNode } from '../../../types/dashboard';
import { getAbsoluteNodeBounds } from './components/utils';

export async function captureCanvasScreenshot(
  canvasRef: RefObject<HTMLDivElement>,
  canvasWidth: number,
  canvasHeight: number,
  options?: { width?: number; height?: number }
): Promise<string | null> {
  if (!canvasRef.current) return null;
  const thumbW = options?.width ?? 400;
  const el = canvasRef.current;

  // html-to-image works by serializing the DOM into an SVG data URI, then
  // loading THAT as an <img> to draw onto a canvas — a large dashboard's
  // sprite sheets get inlined into that SVG as base64 (this app has sprite
  // textures up to 10240×5120px, confirmed via a separate WebGL resize
  // warning), which occasionally fails that <img> load outright (observed
  // live: "Screenshot capture failed: Event" — a raw failed-image-load
  // Event, not a real Error, consistent with an oversized/slow data URI
  // rather than a deterministic bug). A one-shot retry after a short delay
  // is cheap and safe for what's already a best-effort feature (a failed
  // capture just skips the thumbnail upload, never blocks the actual save),
  // and transient failures like this typically succeed on the next attempt.
  const attempt = () => toPng(el, {
    width: canvasWidth,
    height: canvasHeight,
    pixelRatio: thumbW / canvasWidth,
    cacheBust: true,
    style: {
      // Capture the inner canvas element at its natural CSS size (e.g.
      // 1280×800), ignoring the CSS `zoom` applied for fit-to-container
      // display. pixelRatio scales the output down to thumbnail width.
      // position:static removes the absolute offsetX/offsetY so content
      // starts at (0,0).
      zoom: '1',
      position: 'static',
      left: '0',
      top: '0',
      transform: 'none',
      // The edit-mode-only canvas-edge outline (see Canvas.tsx's innerRef
      // style) shouldn't show up in a saved thumbnail — a thumbnail
      // represents how the dashboard looks in kiosk/live view, which
      // never has it.
      outline: 'none',
    } as Partial<CSSStyleDeclaration>,
  });

  try {
    return await attempt();
  } catch (e) {
    console.warn('Screenshot capture failed, retrying once:', e);
    try {
      await new Promise(r => setTimeout(r, 300));
      return await attempt();
    } catch (e2) {
      console.error('Screenshot capture failed on retry:', e2);
      return null;
    }
  }
}

// Crops a bounding box region from an already-loaded Image into a thumbnail data URL.
// Returns null if the bounds fall entirely outside the image.
function cropThumbnail(
  img: HTMLImageElement,
  bounds: { x: number; y: number; w: number; h: number },
  imgScale: number,
  thumbSize: number,
): string | null {
  if (bounds.w <= 0 || bounds.h <= 0) return null;

  const srcX = Math.max(0, Math.round(bounds.x * imgScale));
  const srcY = Math.max(0, Math.round(bounds.y * imgScale));
  const srcW = Math.min(img.width - srcX, Math.round(bounds.w * imgScale));
  const srcH = Math.min(img.height - srcY, Math.round(bounds.h * imgScale));
  if (srcW <= 0 || srcH <= 0) return null;

  const aspect = srcW / srcH;
  const thumbW = aspect >= 1 ? thumbSize : Math.round(thumbSize * aspect);
  const thumbH = aspect >= 1 ? Math.round(thumbSize / aspect) : thumbSize;

  const canvas = document.createElement('canvas');
  canvas.width = thumbW;
  canvas.height = thumbH;
  canvas.getContext('2d')!.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, thumbW, thumbH);
  return canvas.toDataURL('image/png');
}

// Captures ONE screenshot of the canvas then crops a thumbnail for every node
// (including nested children). Returns a Map<nodeId, dataUrl>. Nodes whose
// bounds fall outside the canvas or that have no valid size are omitted —
// callers should fall back to an icon for missing entries.
export async function captureAllNodeThumbnails(
  getCanvasEl: () => HTMLDivElement | null,
  nodes: ComponentNode[],
  canvasWidth: number,
  canvasHeight: number,
  thumbSize: number = 32,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const el = getCanvasEl();
  if (!el || canvasWidth <= 0 || canvasHeight <= 0) return result;

  const ref = { current: el } as RefObject<HTMLDivElement>;
  const CAPTURE_W = Math.min(canvasWidth, 800);
  const fullDataUrl = await captureCanvasScreenshot(ref, canvasWidth, canvasHeight, { width: CAPTURE_W });
  if (!fullDataUrl) return result;

  const allBounds = getAbsoluteNodeBounds(nodes);
  const imgScale = CAPTURE_W / canvasWidth;

  await new Promise<void>(resolve => {
    const img = new Image();
    img.onload = () => {
      for (const [id, bounds] of allBounds.entries()) {
        const thumb = cropThumbnail(img, bounds, imgScale, thumbSize);
        if (thumb) result.set(id, thumb);
      }
      resolve();
    };
    img.onerror = () => resolve();
    img.src = fullDataUrl;
  });

  return result;
}

// Captures a thumbnail for a single node (e.g. when saving a template).
// Returns null if the canvas element isn't available or bounds are invalid —
// callers should fall back to an icon.
export async function captureNodeThumbnail(
  getCanvasEl: () => HTMLDivElement | null,
  node: ComponentNode,
  canvasWidth: number,
  canvasHeight: number,
  thumbSize: number = 80,
): Promise<string | null> {
  const el = getCanvasEl();
  if (!el || canvasWidth <= 0 || canvasHeight <= 0) return null;

  const bounds = getAbsoluteNodeBounds([node]).get(node.id);
  if (!bounds || bounds.w <= 0 || bounds.h <= 0) return null;

  const ref = { current: el } as RefObject<HTMLDivElement>;
  const CAPTURE_W = Math.min(canvasWidth, 800);
  const fullDataUrl = await captureCanvasScreenshot(ref, canvasWidth, canvasHeight, { width: CAPTURE_W });
  if (!fullDataUrl) return null;

  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(cropThumbnail(img, bounds, CAPTURE_W / canvasWidth, thumbSize));
    img.onerror = () => resolve(null);
    img.src = fullDataUrl;
  });
}

export async function captureDayNightThumbnails(
  canvasRef: RefObject<HTMLDivElement>,
  canvasWidth: number,
  canvasHeight: number,
  dayNightEnabled: boolean,
  setDayNightPreview: (isDark: boolean) => void
): Promise<{ thumbnailDay?: string; thumbnailNight?: string }> {
  if (!dayNightEnabled) {
    const thumb = await captureCanvasScreenshot(canvasRef, canvasWidth, canvasHeight);
    return { thumbnailDay: thumb ?? undefined };
  }

  setDayNightPreview(false);
  await new Promise(r => setTimeout(r, 50));
  const thumbnailDay = await captureCanvasScreenshot(canvasRef, canvasWidth, canvasHeight);

  setDayNightPreview(true);
  await new Promise(r => setTimeout(r, 50));
  const thumbnailNight = await captureCanvasScreenshot(canvasRef, canvasWidth, canvasHeight);

  setDayNightPreview(false);
  return { thumbnailDay: thumbnailDay ?? undefined, thumbnailNight: thumbnailNight ?? undefined };
}
