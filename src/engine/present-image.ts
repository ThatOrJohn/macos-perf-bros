/**
 * Presents a hi-res PixelCanvas as a real pixel image (Kitty graphics, or
 * Sixel where that's all the terminal has) through OpenTUI's ImageRenderable.
 *
 * Frames are nearest-neighbor pre-scaled by an integer factor so the
 * terminal's own scaling (often smooth) doesn't blur the pixel art, and are
 * published through a NativeImagePool, which is built for per-frame updates.
 */
import { ImageRenderable, NativeImagePool, type CliRenderer, type ImageRenderProtocol } from "@opentui/core";
import type { PixelCanvas } from "./canvas.ts";

export interface ImagePresenterOptions {
  protocol?: Exclude<ImageRenderProtocol, "auto" | "blocks">;
  /** Fixed pre-scale factor; default picks from the terminal's pixel size. */
  scale?: number;
}

export class ImagePresenter {
  readonly view: ImageRenderable;
  private pool?: NativeImagePool;
  private buf?: Uint8Array;
  private scale = 0;
  private dims = "";
  /** Frames handed to the view, and frames the pool had no free slot for. */
  published = 0;
  dropped = 0;
  /** Last published canvas; identical frames are not re-sent to the terminal. */
  private last = new Int32Array(0);

  constructor(private readonly renderer: CliRenderer, private readonly opts: ImagePresenterOptions = {}) {
    this.view = new ImageRenderable(renderer, {
      id: "hires-view",
      width: "100%",
      height: "100%",
      fit: "fit",
      protocol: opts.protocol ?? "kitty",
    });
  }

  /** Integer pre-scale so the image is close to (not above) the terminal's pixel size. */
  private pickScale(w: number, h: number): number {
    if (this.opts.scale) return this.opts.scale;
    const res = this.renderer.resolution;
    if (!res || res.width <= 0) return 2;
    return Math.max(1, Math.min(4, Math.floor(Math.min(res.width / w, res.height / h))));
  }

  present(cv: PixelCanvas): void {
    const k = this.pickScale(cv.w, cv.h);
    const W = cv.w * k;
    const H = cv.h * k;
    const dims = `${W}x${H}`;
    // Each publish re-sends the whole image to the terminal: skip unchanged frames.
    if (dims === this.dims && sameInts(this.last, cv.px)) return;
    if (this.last.length !== cv.px.length) this.last = new Int32Array(cv.px.length);
    this.last.set(cv.px);
    if (dims !== this.dims) {
      this.pool?.dispose();
      this.pool = new NativeImagePool({ width: W, height: H, capacity: 3 });
      this.buf = new Uint8Array(W * H * 4);
      this.scale = k;
      this.dims = dims;
    }
    const buf = this.buf!;
    const src = cv.px;
    // Fill the first row of each scaled block, then copy it down k-1 times.
    for (let y = 0; y < cv.h; y++) {
      const rowStart = y * k * W * 4;
      let o = rowStart;
      for (let x = 0; x < cv.w; x++) {
        const c = src[y * cv.w + x]!;
        const r = (c >> 16) & 255;
        const g = (c >> 8) & 255;
        const b = c & 255;
        for (let i = 0; i < k; i++) {
          buf[o++] = r;
          buf[o++] = g;
          buf[o++] = b;
          buf[o++] = 255;
        }
      }
      for (let i = 1; i < k; i++) buf.copyWithin(rowStart + i * W * 4, rowStart, rowStart + W * 4);
    }
    // publishRgba returns a retained handle, and a pool image stays busy while
    // any handle is alive. The view retains its own reference, so release ours
    // now; otherwise all `capacity` images stay busy, publish returns null from
    // the 4th frame on, and the picture freezes.
    const img = this.pool!.publishRgba(buf);
    if (!img) {
      this.dropped++;
      return;
    }
    this.view.source = img;
    img.dispose();
    this.published++;
  }

  dispose(): void {
    this.pool?.dispose();
  }

  get currentScale(): number {
    return this.scale;
  }
}

function sameInts(a: Int32Array, b: Int32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
