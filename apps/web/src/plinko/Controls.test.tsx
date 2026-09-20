// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Controls } from "./Controls.js";
import { HOLD_DELAY_MS, HOLD_EVERY_MS } from "./useHold.js";

function controls(overrides: Partial<Parameters<typeof Controls>[0]> = {}) {
  const props: Parameters<typeof Controls>[0] = {
    risk: "medium",
    onRisk: vi.fn(),
    stake: 50,
    onStake: vi.fn(),
    limit: 1_000,
    why: null,
    canDrop: true,
    onDrop: vi.fn(),
    ...overrides,
  };
  render(<Controls {...props} />);
  return props;
}

describe("the controls", () => {
  it("drops on the one lit key, which says the stake", () => {
    const props = controls();
    fireEvent.click(screen.getByRole("button", { name: /drop · 50/i }));
    expect(props.onDrop).toHaveBeenCalledTimes(1);
  });

  it("will not drop when it cannot", () => {
    controls({ canDrop: false });
    expect(screen.getByRole("button", { name: /drop/i })).toHaveProperty("disabled", true);
  });

  it("doubles within what the bank and balance allow", () => {
    const props = controls({ stake: 400, limit: 600 });
    fireEvent.click(screen.getByRole("button", { name: "Double the stake" }));
    expect(props.onStake).toHaveBeenCalledWith(600);
  });

  it("says why a stake cannot go higher", () => {
    controls({ why: "The bank covers 290 a ball on high." });
    expect(screen.getByRole("status").textContent).toBe("The bank covers 290 a ball on high.");
  });

  it("changes risk", () => {
    const props = controls();
    fireEvent.click(screen.getByRole("button", { name: "High" }));
    expect(props.onRisk).toHaveBeenCalledWith("high");
  });
});

/**
 * The drop key held down.
 *
 * Every question here is about a clock, so it runs on a fake one: whether a
 * press costs one ball or two is not something an eye can settle.
 */
describe("the drop key, held", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  /** The key, and the drop handler behind it. */
  function key() {
    const props = controls();
    return { key: screen.getByRole("button", { name: /^drop/i }), onDrop: props.onDrop };
  }

  it("drops one ball on a pointer press, and one only", () => {
    // A browser sends pointerdown and then click for the same press. The key
    // acts on the first of those, so it has to ignore the second.
    const { key: drop, onDrop } = key();

    fireEvent.pointerDown(drop, { button: 0 });
    fireEvent.pointerUp(drop, { button: 0 });
    fireEvent.click(drop, { detail: 1 });

    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it("keeps dropping while it is held", () => {
    const { key: drop, onDrop } = key();

    fireEvent.pointerDown(drop, { button: 0 });
    act(() => vi.advanceTimersByTime(HOLD_DELAY_MS + HOLD_EVERY_MS * 4));

    expect(onDrop).toHaveBeenCalledTimes(5);
  });

  it("stops the moment it is let go", () => {
    const { key: drop, onDrop } = key();

    fireEvent.pointerDown(drop, { button: 0 });
    act(() => vi.advanceTimersByTime(HOLD_DELAY_MS + HOLD_EVERY_MS));
    const held = onDrop.mock.calls.length;

    fireEvent.pointerUp(drop, { button: 0 });
    act(() => vi.advanceTimersByTime(10_000));

    expect(onDrop).toHaveBeenCalledTimes(held);
  });

  it("stops when the thumb slides off it", () => {
    const { key: drop, onDrop } = key();

    fireEvent.pointerDown(drop, { button: 0 });
    act(() => vi.advanceTimersByTime(HOLD_DELAY_MS + HOLD_EVERY_MS));
    const held = onDrop.mock.calls.length;

    fireEvent.pointerLeave(drop);
    act(() => vi.advanceTimersByTime(10_000));

    expect(onDrop).toHaveBeenCalledTimes(held);
  });

  it("drops one ball for a keyboard press", () => {
    // Space and Enter reach a button as a click with no pointer behind it,
    // which is what `detail: 0` means — and the only click left to act on.
    const { key: drop, onDrop } = key();

    fireEvent.click(drop, { detail: 0 });
    act(() => vi.advanceTimersByTime(10_000));

    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it("ignores a press that is not the primary button", () => {
    const { key: drop, onDrop } = key();

    fireEvent.pointerDown(drop, { button: 2 });
    act(() => vi.advanceTimersByTime(HOLD_DELAY_MS + HOLD_EVERY_MS * 2));

    expect(onDrop).not.toHaveBeenCalled();
  });
});
