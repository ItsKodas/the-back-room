// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Haze } from "./Haze.js";

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
