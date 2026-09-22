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
