// @vitest-environment jsdom
import type { Face } from "@backroom/game-slots";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REEL_STAGGER_MS, Reel, SPIN_UP_MS } from "./Reel.js";
import { FACE_SIZE } from "./Symbols.js";

/**
 * A reel asked to spin, and the faces that come back.
 *
 * The same problem as a face-down card, and tested the same way. On a machine
 * talking to itself the reply lands inside a frame and none of this is
 * visible; over a real connection, getting it wrong shows the faces before the
 * server has said what they are, which reads as a machine that had decided
 * before you pulled. So it is tested on a clock rather than by eye.
 */
const column: Face[] = ["tumbler", "cigar", "seven"];
const other: Face[] = ["diamond", "diamond", "dice"];

/**
 * Faces at rest under the payline — the answer, as opposed to the strip.
 *
 * The reel draws the real strip going past while it turns, so counting every
 * face on screen no longer says anything. What matters is what has *landed*,
 * and only a settled reel marks its faces final.
 */
function landed(container: HTMLElement): number {
  return container.querySelectorAll("[data-final]").length;
}

/** Faces the reel is bringing into place but has not stopped on yet. */
function arriving(container: HTMLElement): number {
  return container.querySelectorAll("[data-landing]").length;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("a reel", () => {
  it("turns without having landed on anything", () => {
    const { container } = render(<Reel column={undefined} spinning index={0} />);
    expect(container.querySelector(".reel--spinning")).not.toBeNull();
    expect(landed(container)).toBe(0);
    // The strip is on screen and moving, which is what a reel looks like.
    expect(container.querySelector(".reel__strip")).not.toBeNull();
  });

  it("shows what the server sent once it has stopped", () => {
    const { container, rerender } = render(<Reel column={undefined} spinning index={0} />);
    rerender(<Reel column={column} spinning={false} index={0} />);

    act(() => vi.advanceTimersByTime(SPIN_UP_MS + 500));

    expect(landed(container)).toBe(3);
    expect(container.querySelector(".reel--spinning")).toBeNull();
  });

  it("keeps spinning up even when the answer is instant", () => {
    /*
     * The bug this exists to stop. A reply that lands in the same frame as the
     * press must not stop a reel that has not visibly started — two motions
     * fighting over one reel, and a result that looks decided in advance.
     */
    const { container, rerender } = render(<Reel column={undefined} spinning index={0} />);
    rerender(<Reel column={column} spinning={false} index={0} />);

    act(() => vi.advanceTimersByTime(50));

    expect(container.querySelector(".reel--spinning")).not.toBeNull();
    // The answer is on the strip, coming into place — but nothing has landed.
    expect(landed(container)).toBe(0);
    expect(arriving(container)).toBe(3);
  });

  it("stops later the further right it sits", () => {
    // Left to right, so the last reel is the one you hold your breath for.
    const first = render(<Reel column={undefined} spinning index={0} />);
    first.rerender(<Reel column={column} spinning={false} index={0} />);
    const last = render(<Reel column={undefined} spinning index={4} />);
    last.rerender(<Reel column={column} spinning={false} index={4} />);

    act(() => vi.advanceTimersByTime(SPIN_UP_MS + REEL_STAGGER_MS));

    expect(landed(first.container)).toBe(3);
    expect(landed(last.container)).toBe(0);

    act(() => vi.advanceTimersByTime(REEL_STAGGER_MS * 4));
    expect(landed(last.container)).toBe(3);
  });

  it("goes back to the faces it was showing when a spin is refused", () => {
    // The stake comes back, so the glass has to come back with it rather than
    // sitting on a spin that never happened.
    const { container, rerender } = render(<Reel column={column} spinning={false} index={0} />);
    expect(landed(container)).toBe(3);

    rerender(<Reel column={column} spinning index={0} />);
    expect(landed(container)).toBe(0);

    rerender(<Reel column={column} spinning={false} index={0} />);
    act(() => vi.advanceTimersByTime(SPIN_UP_MS + 500));

    expect(landed(container)).toBe(3);
  });

  it("replaces the old faces rather than keeping both", () => {
    const { container, rerender } = render(<Reel column={column} spinning={false} index={0} />);
    rerender(<Reel column={undefined} spinning index={0} />);
    rerender(<Reel column={other} spinning={false} index={0} />);

    act(() => vi.advanceTimersByTime(SPIN_UP_MS + 500));

    expect(landed(container)).toBe(3);
    expect(container.querySelectorAll('[data-final] [data-face="diamond"]')).toHaveLength(2);
  });

  it("does not leave a timer running when it is taken off the page", () => {
    // A spin that resolves after the cabinet has gone would set state on
    // nothing, which React complains about and which hides real bugs.
    const { rerender, unmount } = render(<Reel column={undefined} spinning index={0} />);
    rerender(<Reel column={column} spinning={false} index={0} />);
    unmount();
    expect(() => act(() => vi.advanceTimersByTime(SPIN_UP_MS + 500))).not.toThrow();
  });

  it("stands still showing faces before anybody has pulled anything", () => {
    /*
     * A cabinet at rest shows faces. Showing the spin blur before the player
     * has touched it makes the machine look like it is already running, and
     * makes the first real pull indistinguishable from doing nothing.
     */
    const { container } = render(
      <Reel column={undefined} spinning={false} index={0} resting={column} />,
    );
    expect(container.querySelector(".reel--resting")).not.toBeNull();
    expect(container.querySelector(".reel--spinning")).toBeNull();
    expect(landed(container)).toBe(3);
  });

  it("never goes back to resting once a pull has been made", () => {
    // After the first spin an empty reel means one still out, and showing
    // anything but a blur there would be guessing at the answer.
    const { container, rerender } = render(
      <Reel column={undefined} spinning={false} index={0} resting={column} />,
    );
    rerender(<Reel column={undefined} spinning index={0} resting={column} />);
    rerender(<Reel column={undefined} spinning={false} index={0} resting={column} />);

    expect(container.querySelector(".reel--resting")).toBeNull();
    expect(container.querySelector(".reel--spinning")).not.toBeNull();
  });

  it("still blurs from the very first pull when it has nothing to rest on", () => {
    const { container } = render(<Reel column={undefined} spinning index={0} resting={column} />);
    expect(container.querySelector(".reel--spinning")).not.toBeNull();
    expect(landed(container)).toBe(0);
  });
});

describe("a reel that won", () => {
  it("marks only the rows on a line that paid", () => {
    const { container } = render(
      <Reel column={column} spinning={false} index={0} won={[false, true, false]} />,
    );
    const marked = [...container.querySelectorAll("[data-final][data-won]")];
    expect(marked).toHaveLength(1);
    expect(marked[0]?.querySelector("[data-face]")?.getAttribute("data-face")).toBe(column[1]);
  });

  it("marks nothing before the lines light", () => {
    const { container } = render(<Reel column={column} spinning={false} index={0} />);
    expect(container.querySelectorAll("[data-won]")).toHaveLength(0);
  });
});

describe("the strip going past", () => {
  let animate: ReturnType<typeof vi.fn>;
  /** The element each `animate` call was made on, in order. */
  let targets: Element[];

  beforeEach(() => {
    // jsdom has no Web Animations; this records what the reel asks for, and of what.
    targets = [];
    animate = vi.fn(function (this: Element) {
      targets.push(this);
      return { cancel: () => {} };
    });
    Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
  });

  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, "animate");
  });

  it("is an HTML layer rather than a group inside the drawing, so a phone can slide it without repainting it", () => {
    /*
     * A group inside an SVG has no layer of its own. Every frame of a spin
     * repainted all five reels' faces, gradients and clips on the main thread,
     * which a desktop absorbs and a phone shows as a stutter.
     */
    const { container } = render(<Reel column={undefined} spinning index={0} />);
    const strip = container.querySelector(".reel__strip");

    expect(strip?.namespaceURI).toBe("http://www.w3.org/1999/xhtml");
    expect(strip?.closest("svg")).toBeNull();
    expect(targets[0]).toBe(strip);
  });

  it("draws the faces going past at the same scale as the ones that land", () => {
    const { container } = render(<Reel column={undefined} spinning index={0} />);
    const drawing = container.querySelector(".reel__strip svg");
    const faces = container.querySelectorAll(".reel__strip [data-face]").length;

    expect(faces).toBeGreaterThan(0);
    expect(drawing?.getAttribute("viewBox")).toBe(`0 0 ${FACE_SIZE} ${faces * FACE_SIZE}`);
  });

  it("still tells a screen reader it is spinning", () => {
    const { getByRole } = render(<Reel column={undefined} spinning index={0} />);
    expect(getByRole("img", { name: "Spinning" })).not.toBeNull();
  });

  it("loops by exactly one run of faces, so the wrap has no seam", () => {
    render(<Reel column={undefined} spinning index={0} />);
    const [keyframes, options] = animate.mock.calls[0] as [Keyframe[], KeyframeAnimationOptions];

    // The strip is that run twice over, so one run is half its height.
    expect(keyframes.map((frame) => frame.transform)).toEqual(["translateY(0%)", "translateY(-50%)"]);
    expect(options.iterations).toBe(Number.POSITIVE_INFINITY);
  });

  it("lands past the mark and settles back onto it, the way it always has", () => {
    const { rerender } = render(<Reel column={undefined} spinning index={0} />);
    rerender(<Reel column={column} spinning={false} index={0} />);

    const landing = animate.mock.calls.at(-1) as [Keyframe[], KeyframeAnimationOptions];
    const [keyframes, options] = landing;
    const along = (frame: Keyframe) => Number(/translateY\((-?[\d.]+)%\)/.exec(String(frame.transform))?.[1]);

    expect(keyframes).toHaveLength(4);
    expect(options.fill).toBe("forwards");
    const overshoot = along(keyframes[2] as Keyframe);
    const settled = along(keyframes[3] as Keyframe);
    // Further along the strip is further negative.
    expect(overshoot).toBeLessThan(settled);
    expect(settled).toBeLessThan(0);
  });
});
