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
    expect(cloth.textContent).toContain("1");
    expect(cloth.textContent).toContain("35");
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
});
