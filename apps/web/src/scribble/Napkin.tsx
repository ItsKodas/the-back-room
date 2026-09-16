import { GRID_HEIGHT, GRID_WIDTH } from "@backroom/game-scribble";
import type { PointerEvent } from "react";
import { useEffect, useRef } from "react";
import { toGrid } from "./inkBook.js";
import { Raster } from "./raster.js";
import type { InkHandle, Tool } from "./useInk.js";

/**
 * The napkin: a canvas exactly the grid's size, scaled by CSS.
 *
 * Painted from the rasteriser's pixels rather than drawn with canvas lines, so
 * the picture here is the picture on every other device at the table.
 */
export function Napkin({
  ink,
  tool,
  wipe,
}: {
  ink: InkHandle;
  tool: Tool;
  /**
   * Counts clears, so a fresh key re-triggers the wipe sweep on every one
   * rather than only the first. Rendered here rather than beside the napkin
   * in `Scribble.tsx`: `.sc-napkin` is the thing that is already clipped to
   * rounded corners, and a sibling covering the whole stage outlived every
   * clear it ever ran for, parked over whatever sat next to it once its
   * animation reverted to a base state nobody meant to leave on screen.
   */
  wipe?: number;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const raster = useRef<Raster | null>(null);
  /** The pointer currently drawing, so a second finger down mid-stroke cannot steal or start one. */
  const down = useRef<number | null>(null);

  useEffect(() => {
    const context = canvas.current?.getContext("2d") ?? null;
    if (context === null) {
      return;
    }
    raster.current ??= new Raster();
    const pixels = raster.current;
    const image = context.createImageData(GRID_WIDTH, GRID_HEIGHT);
    let frame = 0;
    /*
     * Whether a frame is outstanding, tracked apart from `frame` itself: a
     * synchronous `requestAnimationFrame` (as a test double gives us) runs
     * `draw` before the call returns an id, so if `draw` cleared `frame`
     * directly the assignment below would land after and clobber its own
     * reset, wedging `schedule` shut for good.
     */
    let pending = false;
    let first = true;
    const draw = () => {
      pending = false;
      if (pixels.update(ink.book.marks()) || first) {
        first = false;
        image.data.set(pixels.pixels);
        context.putImageData(image, 0, 0);
      }
    };
    const schedule = () => {
      if (!pending) {
        pending = true;
        frame = requestAnimationFrame(draw);
      }
    };
    schedule();
    const stop = ink.subscribe(schedule);
    return () => {
      stop();
      if (pending) {
        cancelAnimationFrame(frame);
      }
    };
  }, [ink]);

  const at = (event: PointerEvent<HTMLCanvasElement>) =>
    toGrid(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());

  const release = (event: PointerEvent<HTMLCanvasElement>) => {
    if (down.current === event.pointerId) {
      down.current = null;
      ink.end();
    }
  };

  return (
    <div className={`sc-napkin${ink.drawing ? " sc-napkin--live" : ""}`}>
      <canvas
        ref={canvas}
        className="sc-napkin__canvas"
        width={GRID_WIDTH}
        height={GRID_HEIGHT}
        role="img"
        aria-label={ink.drawing ? "The napkin. Draw here." : "The drawing"}
        onPointerDown={(event) => {
          // A pointer already down owns the stroke; a second finger touching
          // down mid-draw must not steal it or start one of its own.
          if (!ink.drawing || down.current !== null) {
            return;
          }
          const [x, y] = at(event);
          if (tool.mode === "fill") {
            ink.fill(tool, x, y);
            return;
          }
          event.currentTarget.setPointerCapture?.(event.pointerId);
          down.current = event.pointerId;
          ink.begin(tool, x, y);
        }}
        onPointerMove={(event) => {
          if (down.current === event.pointerId) {
            const [x, y] = at(event);
            ink.extend(x, y);
          }
        }}
        onPointerUp={release}
        onPointerCancel={release}
        // The browser can take capture away on its own — a scroll, another
        // app grabbing focus — and that ends the stroke exactly like a cancel.
        onLostPointerCapture={release}
      />
      <span className="sc-napkin__print" aria-hidden="true">
        The Back Room
      </span>
      {wipe !== undefined && wipe > 0 ? <span key={wipe} className="sc-napkin__wipe" aria-hidden="true" /> : null}
    </div>
  );
}
