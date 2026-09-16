// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ControlsProps } from "./Controls.js";
import { Controls } from "./Controls.js";
import { pairTurn, seat, settledHand, splitTurn, theirTurn, view, yourTurn } from "./fixtures.js";

function controls(over: Partial<ControlsProps> = {}) {
  const state = over.state ?? view();
  const props: ControlsProps = {
    state,
    me: state.seats[0] ?? null,
    mine: 0,
    ready: false,
    chips: 12_400,
    move: null,
    left: 20,
    turnLeft: 12,
    isHost: false,
    taunt: (
      <button type="button" className="key">
        Taunt
      </button>
    ),
    onStake: vi.fn(),
    onReady: vi.fn(),
    onDeal: vi.fn(),
    onMove: vi.fn(),
    ...over,
  };
  const utils = render(<Controls {...props} />);
  return { ...utils, props };
}

const slabs = (container: HTMLElement) => [...container.querySelectorAll<HTMLButtonElement>(".slab")];

describe("the controls while betting", () => {
  it("light one slab, Ready, on Space", () => {
    const { container } = controls();
    const [ready, ...more] = slabs(container);
    expect(more).toHaveLength(0);
    expect(ready?.disabled).toBe(false);
    expect(ready?.textContent).toMatch(/^Ready/);
    expect(ready?.getAttribute("aria-keyshortcuts")).toBe("Space");
    expect(ready?.textContent).toContain("cards out 0:20");
  });

  it("stack a chip onto the stake already shown, and take the lot back", () => {
    const state = view({ seats: [seat("a", "Ada", { bet: 500 }), seat("b", "Bo")] });
    const { props } = controls({ state, me: state.seats[0] ?? null, mine: 500 });
    fireEvent.click(screen.getByRole("button", { name: "Add 100" }));
    fireEvent.click(screen.getByRole("button", { name: "Take it back" }));
    expect(vi.mocked(props.onStake).mock.calls).toEqual([[600], [0]]);
  });

  it("say on a chip why it cannot be added", () => {
    const state = view({ seats: [seat("a", "Ada", { bet: 9_500 }), seat("b", "Bo")] });
    controls({ state, me: state.seats[0] ?? null, mine: 9_500 });
    const over = screen.getByRole("button", { name: "1,000 more is past the 10,000 limit" }) as HTMLButtonElement;
    expect(over.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Add 500" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("take nothing more at last call, and say so on the slab", () => {
    const { container } = controls({ left: 3 });
    const chips = [...container.querySelectorAll<HTMLButtonElement>(".bj__chip")];
    expect(chips).toHaveLength(5);
    expect(chips.every((chip) => chip.disabled)).toBe(true);
    expect(slabs(container)[0]?.textContent).toContain("last call 0:03");
  });

  it("hold Ready shut on a stake under the minimum, and say what the minimum is", () => {
    const state = view({ minBet: 250, seats: [seat("a", "Ada", { bet: 100 }), seat("b", "Bo")] });
    const { container } = controls({ state, me: state.seats[0] ?? null, mine: 100 });
    const ready = slabs(container)[0];
    expect(ready?.disabled).toBe(true);
    expect(ready?.textContent).toContain("at least 250");
  });

  it("un-ready on a second press", () => {
    const state = view({ seats: [seat("a", "Ada", { bet: 500, ready: true }), seat("b", "Bo")] });
    const { container, props } = controls({ state, me: state.seats[0] ?? null, mine: 500, ready: true });
    const waiting = slabs(container)[0];
    expect(waiting?.textContent).toMatch(/^Waiting…/);
    if (waiting !== undefined) {
      fireEvent.click(waiting);
    }
    expect(props.onReady).toHaveBeenCalledWith(false);
  });

  it("offer Deal now to the host and nobody else", () => {
    const { unmount } = controls({ isHost: true });
    expect(screen.getByRole("button", { name: "Deal now" })).toBeTruthy();
    unmount();
    controls({ isHost: false });
    expect(screen.queryByRole("button", { name: "Deal now" })).toBeNull();
  });
});

describe("the controls on your turn", () => {
  it("light Hit on Space, with Stand, Double and Split on their own letters", () => {
    const state = yourTurn();
    const { container } = controls({ state, me: state.seats[0] ?? null });
    const [hit, ...more] = slabs(container);
    expect(more).toHaveLength(0);
    expect(hit?.disabled).toBe(false);
    expect(hit?.textContent).toMatch(/^Hit/);
    expect(hit?.getAttribute("aria-keyshortcuts")).toBe("Space");
    expect(screen.getByRole("button", { name: /^Stand/ }).getAttribute("aria-keyshortcuts")).toBe("S");
    expect(screen.getByRole("button", { name: /^Double/ }).getAttribute("aria-keyshortcuts")).toBe("D");
    expect(screen.getByRole("button", { name: /^Split/ }).getAttribute("aria-keyshortcuts")).toBe("P");
  });

  it("put the cost on Double and the reason on Split", () => {
    const state = yourTurn();
    controls({ state, me: state.seats[0] ?? null });
    const double = screen.getByRole("button", { name: /^Double/ }) as HTMLButtonElement;
    expect(double.querySelector(".bj__cost")?.textContent).toBe("+500");
    const split = screen.getByRole("button", { name: /^Split/ }) as HTMLButtonElement;
    expect(split.disabled).toBe(true);
    expect(split.textContent).toContain("no pair");
  });

  it("split a pair at the price of the hand", () => {
    const state = pairTurn();
    const { props } = controls({ state, me: state.seats[0] ?? null });
    const split = screen.getByRole("button", { name: /^Split/ });
    expect(split.textContent).toContain("+500");
    fireEvent.click(split);
    expect(props.onMove).toHaveBeenCalledWith("split");
  });

  it("say which hand after a split, and why Double and Split are out", () => {
    const state = splitTurn();
    const { container } = controls({ state, me: state.seats[0] ?? null });
    expect(screen.getByRole("button", { name: /^Stand/ }).textContent).toContain("hand 2");
    expect(slabs(container)[0]?.textContent).toContain("hand 2");
    expect(screen.getByRole("button", { name: /^Double/ }).textContent).toContain("3 cards");
    expect(screen.getByRole("button", { name: /^Split/ }).textContent).toContain("once a seat");
  });

  it("hold Hit down, busy, from the press until the table answers", () => {
    const state = yourTurn();
    const { container } = controls({ state, me: state.seats[0] ?? null, move: "hit" });
    const hit = slabs(container)[0];
    expect(hit?.classList.contains("is-busy")).toBe(true);
    expect(hit?.disabled).toBe(true);
    expect(hit?.textContent).toContain("a card is coming");
    expect((screen.getByRole("button", { name: /^Stand/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("the controls while somebody else acts", () => {
  it("say whose turn it is on a slab nobody can press, with the taunt beside it", () => {
    const state = theirTurn();
    const { container } = controls({ state, me: state.seats[0] ?? null, turnLeft: 9 });
    const [turn, ...more] = slabs(container);
    expect(more).toHaveLength(0);
    expect(turn?.disabled).toBe(true);
    expect(turn?.textContent).toMatch(/^Bo's turn/);
    expect(turn?.textContent).toContain("0:09");
    expect(screen.getByRole("button", { name: "Taunt" })).toBeTruthy();
  });

  it("count down to the next hand once this one is over", () => {
    const state = settledHand();
    const { container } = controls({ state, me: state.seats[0] ?? null, left: 5 });
    const next = slabs(container)[0];
    expect(next?.disabled).toBe(true);
    expect(next?.textContent).toMatch(/^Next hand/);
    expect(next?.textContent).toContain("in 5s");
  });

  it("give somebody watching a note, not buttons", () => {
    const { container } = controls({ state: yourTurn(), me: null });
    expect(slabs(container)).toHaveLength(0);
    expect(container.textContent).toContain("stood behind the table");
  });
});
