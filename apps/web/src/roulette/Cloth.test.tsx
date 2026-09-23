// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cloth } from "./Cloth.js";
import { HEIGHT, WIDTH } from "./layout.js";

afterEach(cleanup);

const W = 700;
const H = 250;

beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: W,
    height: H,
    right: W,
    bottom: H,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The middle of a square, in client pixels, for the landscape cloth. */
const at = (x: number, y: number) => ({ clientX: (x / WIDTH) * W, clientY: (y / HEIGHT) * H });

/** Straight up on 1 — column 1, bottom row. Its centre is (1.5, 2.5). */
const ONE = at(1.5, 2.5);
/** Straight up on 2 — same column, middle row. Its centre is (1.5, 1.5). */
const TWO = at(1.5, 1.5);

function draw(props: Partial<Parameters<typeof Cloth>[0]> = {}) {
  return render(<Cloth placed={[]} mine="you" portrait={false} {...props} />);
}

describe("placing a chip", () => {
  it("names the bet on the press without placing it", () => {
    const onPlace = vi.fn();
    draw({ onPlace });
    const cloth = screen.getByRole("group", { name: "The betting cloth" });
    fireEvent.pointerDown(cloth, { ...ONE, button: 0, pointerId: 1 });
    expect(onPlace).not.toHaveBeenCalled();
    // Asserted against the aim label specifically, not the cloth's whole
    // text: the cloth always prints "1" and "35" as square labels on its own,
    // so a loose textContent check would pass even if this label never
    // rendered at all.
    expect(cloth.querySelector(".rl__aim-name")?.textContent).toBe("1, pays 35 to 1");
  });

  it("places on the lift", () => {
    const onPlace = vi.fn();
    draw({ onPlace });
    const cloth = screen.getByRole("group", { name: "The betting cloth" });
    fireEvent.pointerDown(cloth, { ...ONE, button: 0, pointerId: 1 });
    fireEvent.pointerUp(cloth, { ...ONE, button: 0, pointerId: 1 });
    expect(onPlace).toHaveBeenCalledWith("straight:1");
  });

  it("follows a slide, and places where the finger ended", () => {
    const onPlace = vi.fn();
    draw({ onPlace });
    const cloth = screen.getByRole("group", { name: "The betting cloth" });
    fireEvent.pointerDown(cloth, { ...ONE, button: 0, pointerId: 1 });
    fireEvent.pointerMove(cloth, { ...TWO, pointerId: 1 });
    fireEvent.pointerUp(cloth, { ...TWO, button: 0, pointerId: 1 });
    expect(onPlace).toHaveBeenCalledTimes(1);
    expect(onPlace).toHaveBeenCalledWith("straight:2");
  });

  it("takes back instead when the press is held", () => {
    const onPlace = vi.fn();
    const onTake = vi.fn();
    draw({ onPlace, onTake });
    const cloth = screen.getByRole("group", { name: "The betting cloth" });
    fireEvent.pointerDown(cloth, { ...ONE, button: 0, pointerId: 1 });
    // The hold timer's callback sets state outside any RTL-wrapped event, so
    // the flush has to be asked for explicitly — the same pattern this repo
    // already uses for Plinko's hold and Stake's settle.
    act(() => vi.advanceTimersByTime(600));
    expect(cloth.textContent).toContain("Release to take it back");
    fireEvent.pointerUp(cloth, { ...ONE, button: 0, pointerId: 1 });
    expect(onTake).toHaveBeenCalledWith("straight:1");
    expect(onPlace).not.toHaveBeenCalled();
  });

  it("does nothing when the press is cancelled", () => {
    const onPlace = vi.fn();
    const onTake = vi.fn();
    draw({ onPlace, onTake });
    const cloth = screen.getByRole("group", { name: "The betting cloth" });
    fireEvent.pointerDown(cloth, { ...ONE, button: 0, pointerId: 1 });
    fireEvent.pointerCancel(cloth, { ...ONE, pointerId: 1 });
    expect(onPlace).not.toHaveBeenCalled();
    expect(onTake).not.toHaveBeenCalled();
  });

  it("does nothing at all when the cloth is shut", () => {
    const onPlace = vi.fn();
    draw({ onPlace, disabled: true });
    const cloth = screen.getByRole("group", { name: "The betting cloth" });
    fireEvent.pointerDown(cloth, { ...ONE, button: 0, pointerId: 1 });
    fireEvent.pointerUp(cloth, { ...ONE, button: 0, pointerId: 1 });
    expect(onPlace).not.toHaveBeenCalled();
  });

  it("does nothing at all when the cloth shuts mid-press", () => {
    const onPlace = vi.fn();
    const onTake = vi.fn();
    const { rerender } = draw({ onPlace, onTake });
    const cloth = screen.getByRole("group", { name: "The betting cloth" });
    fireEvent.pointerDown(cloth, { ...ONE, button: 0, pointerId: 1 });
    // The betting window can shut on the table's own clock while a finger is
    // still down — disabled is not only ever true before a press starts.
    rerender(
      <Cloth placed={[]} mine="you" portrait={false} onPlace={onPlace} onTake={onTake} disabled />,
    );
    fireEvent.pointerUp(cloth, { ...ONE, button: 0, pointerId: 1 });
    expect(onPlace).not.toHaveBeenCalled();
    expect(onTake).not.toHaveBeenCalled();
  });

  it("never places on its way to taking off with the right button", () => {
    const onPlace = vi.fn();
    const onTake = vi.fn();
    draw({ onPlace, onTake });
    const cloth = screen.getByRole("group", { name: "The betting cloth" });
    fireEvent.pointerDown(cloth, { ...ONE, button: 2, pointerId: 1 });
    fireEvent.pointerUp(cloth, { ...ONE, button: 2, pointerId: 1 });
    fireEvent.contextMenu(cloth, ONE);
    expect(onPlace).not.toHaveBeenCalled();
    expect(onTake).toHaveBeenCalledWith("straight:1");
  });

  it("ignores a second finger while the first is already pressing", () => {
    const onPlace = vi.fn();
    draw({ onPlace });
    const cloth = screen.getByRole("group", { name: "The betting cloth" });
    fireEvent.pointerDown(cloth, { ...ONE, button: 0, pointerId: 1 });
    // A resting thumb elsewhere on the cloth: reported as its own pointer,
    // with button 0 exactly like a real finger, while pointer 1's press is
    // still live.
    fireEvent.pointerDown(cloth, { ...TWO, button: 0, pointerId: 2 });
    // Lifting the second, ignored finger must not place — it never owned a
    // press to place.
    fireEvent.pointerUp(cloth, { ...TWO, button: 0, pointerId: 2 });
    expect(onPlace).not.toHaveBeenCalled();
    // The first finger's press survived the second one untouched.
    fireEvent.pointerUp(cloth, { ...ONE, button: 0, pointerId: 1 });
    expect(onPlace).toHaveBeenCalledTimes(1);
    expect(onPlace).toHaveBeenCalledWith("straight:1");
  });

  it("keeps the first press on its own timer despite a second finger", () => {
    const onPlace = vi.fn();
    const onTake = vi.fn();
    draw({ onPlace, onTake });
    const cloth = screen.getByRole("group", { name: "The betting cloth" });
    fireEvent.pointerDown(cloth, { ...ONE, button: 0, pointerId: 1 });
    fireEvent.pointerDown(cloth, { ...TWO, button: 0, pointerId: 2 });
    act(() => vi.advanceTimersByTime(600));
    // The hold is pointer 1's alone: it names pointer 1's spot as a
    // take-back, not pointer 2's — an orphaned timer keyed to the wrong
    // finger's bet is exactly the bug this scoping closes.
    expect(cloth.querySelector(".rl__aim-name")?.textContent).toBe("Release to take it back");
    fireEvent.pointerUp(cloth, { ...ONE, button: 0, pointerId: 1 });
    expect(onTake).toHaveBeenCalledWith("straight:1");
    expect(onPlace).not.toHaveBeenCalled();
  });

  it("does not let a cancelled second finger disturb the first press", () => {
    const onPlace = vi.fn();
    draw({ onPlace });
    const cloth = screen.getByRole("group", { name: "The betting cloth" });
    fireEvent.pointerDown(cloth, { ...ONE, button: 0, pointerId: 1 });
    fireEvent.pointerDown(cloth, { ...TWO, button: 0, pointerId: 2 });
    fireEvent.pointerCancel(cloth, { ...TWO, pointerId: 2 });
    fireEvent.pointerUp(cloth, { ...ONE, button: 0, pointerId: 1 });
    expect(onPlace).toHaveBeenCalledWith("straight:1");
  });
});

describe("pushing the cloth about", () => {
  /** A touch, which is the only kind of pointer any of this answers to. */
  const finger = (id: number, where: { clientX: number; clientY: number }) => ({
    ...where,
    button: 0,
    pointerId: id,
    pointerType: "touch",
  });

  /** Two fingers apart and then further apart: a pinch, as a browser sends one. */
  function pinchOpen(cloth: Element) {
    fireEvent.pointerDown(cloth, finger(1, at(6, 2)));
    fireEvent.pointerDown(cloth, finger(2, at(8, 3)));
    for (let step = 1; step <= 4; step += 1) {
      fireEvent.pointerMove(cloth, finger(1, at(6 - step * 0.5, 2 - step * 0.2)));
      fireEvent.pointerMove(cloth, finger(2, at(8 + step * 0.5, 3 + step * 0.2)));
    }
    fireEvent.pointerUp(cloth, finger(1, at(4, 1.2)));
    fireEvent.pointerUp(cloth, finger(2, at(10, 3.8)));
  }

  it("gives the press up when a second finger arrives, and bets nothing", () => {
    /*
     * The rule the cloth has always had, kept: a resting thumb can never
     * become the bet a pointing finger was naming. What is new is that the
     * thumb is now the start of a pinch rather than nothing at all — so it
     * ends the press rather than being ignored beside it, which is the
     * stricter of the two and not the looser.
     */
    const onPlace = vi.fn();
    const onTake = vi.fn();
    draw({ onPlace, onTake });
    const cloth = screen.getByRole("group", { name: "The betting cloth" });
    pinchOpen(cloth);
    expect(onPlace).not.toHaveBeenCalled();
    expect(onTake).not.toHaveBeenCalled();
  });

  it("offers the way back only once there is board off screen", () => {
    draw();
    const cloth = screen.getByRole("group", { name: "The betting cloth" });
    expect(screen.queryByRole("button", { name: "Whole board" })).toBeNull();
    pinchOpen(cloth);
    const back = screen.getByRole("button", { name: "Whole board" });
    fireEvent.click(back);
    expect(screen.queryByRole("button", { name: "Whole board" })).toBeNull();
  });

  it("moves the board rather than betting when a finger travels, once zoomed in", () => {
    const onPlace = vi.fn();
    draw({ onPlace });
    const cloth = screen.getByRole("group", { name: "The betting cloth" });
    pinchOpen(cloth);
    onPlace.mockClear();

    fireEvent.pointerDown(cloth, finger(1, ONE));
    // Well past the ten pixels that separate a firm tap from a push.
    fireEvent.pointerMove(cloth, finger(1, { clientX: ONE.clientX + 80, clientY: ONE.clientY }));
    fireEvent.pointerUp(cloth, finger(1, { clientX: ONE.clientX + 80, clientY: ONE.clientY }));
    expect(onPlace).not.toHaveBeenCalled();
  });

  it("still slides to re-aim while the whole board is on screen", () => {
    /*
     * At the whole-board zoom a drag would move nothing, so it is left doing
     * what it has always done: your own finger covers the square you are
     * choosing, and sliding is how you see past it before you commit.
     */
    const onPlace = vi.fn();
    draw({ onPlace });
    const cloth = screen.getByRole("group", { name: "The betting cloth" });
    fireEvent.pointerDown(cloth, finger(1, ONE));
    fireEvent.pointerMove(cloth, finger(1, TWO));
    fireEvent.pointerUp(cloth, finger(1, TWO));
    expect(onPlace).toHaveBeenCalledWith("straight:2");
  });

  it("counts two quick taps on one square as two chips, not a zoom", () => {
    /*
     * Every map double-taps to zoom and this one deliberately does not: two
     * quick taps on the same square is how a pile gets built, and a gesture
     * that swallowed the second would be the felt taking a bet away.
     */
    const onPlace = vi.fn();
    draw({ onPlace });
    const cloth = screen.getByRole("group", { name: "The betting cloth" });
    for (const round of [0, 1]) {
      void round;
      fireEvent.pointerDown(cloth, finger(1, ONE));
      fireEvent.pointerUp(cloth, finger(1, ONE));
    }
    expect(onPlace).toHaveBeenCalledTimes(2);
    expect(onPlace).toHaveBeenNthCalledWith(2, "straight:1");
    expect(screen.queryByRole("button", { name: "Whole board" })).toBeNull();
  });
});

describe("which way round the cloth goes", () => {
  /**
   * A watcher that answers with the width of whatever element it was pointed
   * at, which is the whole question here.
   *
   * Two rooms: a 700px box, and the 200px a turned cloth draws itself at
   * inside one. Which number the cloth gets back is decided entirely by which
   * element it chose to watch.
   */
  function stubRoom() {
    class Room {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback(
          [
            {
              contentRect: { width: target.classList.contains("rl__cloth") ? 200 : 700 },
            } as ResizeObserverEntry,
          ],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", Room);
  }

  it("asks the room it was given, not the cloth it last drew", () => {
    /*
     * A turned cloth is narrow by construction — it is five squares across
     * where a laid-out one is fourteen. So a cloth that measures *itself* to
     * decide which way round to go can never come back from being turned:
     * one glance at a phone-width box and it is portrait for the rest of the
     * session, on a 1440px desk included. That is not a hypothetical; it is
     * what a wide desktop was shipping.
     *
     * The room is what decides, and a room does not change size when the
     * cloth inside it turns.
     */
    stubRoom();
    // No `portrait` prop: the point is the decision the cloth makes alone.
    const { container } = render(<Cloth placed={[]} mine="you" />);
    expect(container.querySelector(".rl__cloth")?.className).not.toContain("rl__cloth--portrait");
  });

  it("still turns when the room itself is narrow", () => {
    class Narrow {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe() {
        this.callback(
          [{ contentRect: { width: 300 } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", Narrow);
    const { container } = render(<Cloth placed={[]} mine="you" />);
    expect(container.querySelector(".rl__cloth")?.className).toContain("rl__cloth--portrait");
  });
});

describe("reporting what is aimed at", () => {
  it("reports what it is aiming at, so the payout sheet can light a row", () => {
    const onAim = vi.fn();
    draw({ onAim });
    const cloth = screen.getByRole("group", { name: "The betting cloth" });
    fireEvent.pointerDown(cloth, { ...ONE, button: 0, pointerId: 1 });
    expect(onAim).toHaveBeenLastCalledWith("straight");
  });
});
