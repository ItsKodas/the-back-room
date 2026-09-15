// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BACKING_SCALE, Haze } from "./Haze.js";

/**
 * The haze, run on a clock this file turns by hand.
 *
 * jsdom has no canvas, so the context is a fake that only remembers where it
 * was asked to draw — which is enough, because what matters here is how much
 * work each frame does, not what the pixels are.
 */

let frames: FrameRequestCallback[] = [];
let arcs: Array<{ x: number; y: number }> = [];
let reduced = false;

function fakeContext() {
  return {
    globalCompositeOperation: "source-over",
    fillStyle: "",
    clearRect: () => {},
    setTransform: () => {},
    beginPath: () => {},
    fill: () => {},
    arc: (x: number, y: number) => {
      arcs.push({ x, y });
    },
    createRadialGradient: () => ({ addColorStop: () => {} }),
  };
}

/** Runs the frames that are due, `count` times over. */
function runFrames(count: number) {
  for (let turn = 0; turn < count; turn += 1) {
    const due = frames;
    frames = [];
    for (const callback of due) {
      callback(performance.now() + 16 * (turn + 1));
    }
  }
}

function set(name: string, value: unknown) {
  Object.defineProperty(window, name, { configurable: true, writable: true, value });
}

/** How many times the air's colour has been read off the cascade. */
function colourReads(spy: { mock: { calls: unknown[][] } }): number {
  return spy.mock.calls.filter(([name]) => name === "--gr-color-air-hi").length;
}

beforeEach(() => {
  frames = [];
  arcs = [];
  reduced = false;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => fakeContext() as unknown as CanvasRenderingContext2D,
  );
  set("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  set("cancelAnimationFrame", () => {
    frames = [];
  });
  set("matchMedia", () => ({
    matches: reduced,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  set("devicePixelRatio", 3);
  set("innerWidth", 400);
  set("innerHeight", 800);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete document.documentElement.dataset["game"];
});

describe("the colour of the air", () => {
  it("is read once, not on every frame", () => {
    /*
     * Reading the cascade makes the browser settle every style on the page
     * first — sixty times a second, on every page, for a colour that only
     * changes when somebody walks into another room.
     */
    const reads = vi.spyOn(CSSStyleDeclaration.prototype, "getPropertyValue");
    render(<Haze />);
    runFrames(30);

    expect(colourReads(reads)).toBe(1);
  });

  it("is read again when somebody walks into another room", async () => {
    const reads = vi.spyOn(CSSStyleDeclaration.prototype, "getPropertyValue");
    render(<Haze />);
    runFrames(5);

    document.documentElement.dataset["game"] = "slots";
    // A MutationObserver reports on a microtask.
    await act(async () => {});
    runFrames(5);

    expect(colourReads(reads)).toBe(2);
  });
});

describe("the work each frame does", () => {
  it("fills a canvas a fraction the size of the window, whatever the screen's density", () => {
    /*
     * Every shape on it is a gradient a hundred pixels and more across, which
     * a browser scales up without a visible seam. At a phone's density the old
     * backing store was nine times the pixels for the same picture.
     */
    const { container } = render(<Haze />);
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;

    expect(canvas.width).toBe(Math.round(400 * BACKING_SCALE));
    expect(canvas.height).toBe(Math.round(800 * BACKING_SCALE));
  });

  it("keeps its clouds where they were when a phone's address bar changes the height", () => {
    // That resize fires on every scroll that shows or hides the bar, and
    // re-seeding on it threw every cloud somewhere new mid-scroll.
    render(<Haze />);
    runFrames(1);
    const before = arcs.slice(0, 6);

    arcs = [];
    set("innerHeight", 740);
    window.dispatchEvent(new Event("resize"));
    runFrames(1);
    const after = arcs.slice(0, 6);

    expect(after).toHaveLength(6);
    after.forEach((cloud, index) => {
      expect(Math.abs(cloud.x - (before[index]?.x ?? Number.NaN))).toBeLessThan(5);
      expect(Math.abs(cloud.y - (before[index]?.y ?? Number.NaN))).toBeLessThan(5);
    });
  });

  it("draws once and stops when motion is turned off, and redraws only when something changes", () => {
    reduced = true;
    render(<Haze />);
    runFrames(1);

    expect(arcs).toHaveLength(6);
    expect(frames).toHaveLength(0);

    window.dispatchEvent(new Event("resize"));
    expect(frames).toHaveLength(1);
    runFrames(1);
    expect(arcs).toHaveLength(12);
    expect(frames).toHaveLength(0);
  });
});
