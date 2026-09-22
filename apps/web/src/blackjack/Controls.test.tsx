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

  it("set the stake from a key rather than adding to it, and take the lot back", () => {
    const state = view({ seats: [seat("a", "Ada", { bet: 500 }), seat("b", "Bo")] });
    const { props } = controls({ state, me: state.seats[0] ?? null, mine: 500 });
    fireEvent.click(screen.getByRole("radio", { name: "Bet 1,000" }));
    fireEvent.click(screen.getByRole("button", { name: "Take it back" }));
    // A thousand, not fifteen hundred: a key is the stake, not another chip on it.
    expect(vi.mocked(props.onStake).mock.calls).toEqual([[1_000], [0]]);
  });

  it("light the key the stake is sitting on", () => {
    const state = view({ seats: [seat("a", "Ada", { bet: 1_000 }), seat("b", "Bo")] });
    controls({ state, me: state.seats[0] ?? null, mine: 1_000 });
    expect(screen.getByRole("radio", { name: "Bet 1,000" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Bet 500" })).toHaveAttribute("aria-checked", "false");
  });

  it("say on a key that the bank is what stops it", () => {
    const state = view({ maxBet: 1_000, seats: [seat("a", "Ada"), seat("b", "Bo")] });
    controls({ state, me: state.seats[0] ?? null });
    const over = screen.getByRole("radio", { name: "5,000 is past what the bank covers (1,000)" }) as HTMLButtonElement;
    expect(over.disabled).toBe(true);
    expect((screen.getByRole("radio", { name: "Bet 1,000" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("say on a key when it is the balance that stops it", () => {
    const state = view({ maxBet: 100_000, seats: [seat("a", "Ada"), seat("b", "Bo")] });
    controls({ state, me: state.seats[0] ?? null, chips: 600 });
    const over = screen.getByRole("radio", { name: "You do not have 1,000 to bet" }) as HTMLButtonElement;
    expect(over.disabled).toBe(true);
  });

  it("offer a key the bank can cover past the old flat ten thousand", () => {
    const state = view({ maxBet: 50_000, seats: [seat("a", "Ada"), seat("b", "Bo")] });
    controls({ state, me: state.seats[0] ?? null, chips: 100_000 });
    expect((screen.getByRole("radio", { name: "Bet 25,000" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("let chips come off at last call but nothing more go on", () => {
    const state = view({ seats: [seat("a", "Ada", { bet: 1_000 }), seat("b", "Bo")] });
    const { props } = controls({ state, me: state.seats[0] ?? null, mine: 1_000, left: 3 });
    expect((screen.getByRole("radio", { name: "Last call: 5,000 cannot go on now" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Bet 500" }));
    expect(vi.mocked(props.onStake).mock.calls).toEqual([[500]]);
  });

  it("say last call on the slab", () => {
    const { container } = controls({ left: 3 });
    expect(slabs(container)[0]?.textContent).toContain("last call 0:03");
  });

  it("take a figure of your own that no key carries", () => {
    const state = view({ maxBet: 50_000, seats: [seat("a", "Ada"), seat("b", "Bo")] });
    const { props } = controls({ state, me: state.seats[0] ?? null, chips: 100_000 });
    const box = screen.getByRole("textbox", { name: "Custom bet" });
    fireEvent.change(box, { target: { value: "3200" } });
    fireEvent.click(screen.getByRole("button", { name: "Bet it" }));
    expect(vi.mocked(props.onStake).mock.calls).toEqual([[3_200]]);
  });

  it("bet nothing on a keystroke, only on the press", () => {
    const state = view({ maxBet: 50_000, seats: [seat("a", "Ada"), seat("b", "Bo")] });
    const { props } = controls({ state, me: state.seats[0] ?? null, chips: 100_000 });
    // Typing three thousand goes through a three and a thirty on the way.
    fireEvent.change(screen.getByRole("textbox", { name: "Custom bet" }), { target: { value: "3000" } });
    expect(props.onStake).not.toHaveBeenCalled();
  });

  it("hold a figure of your own the way a key holds", () => {
    const state = view({ maxBet: 50_000, seats: [seat("a", "Ada", { bet: 3_200 }), seat("b", "Bo")] });
    controls({ state, me: state.seats[0] ?? null, mine: 3_200, chips: 100_000 });
    expect(screen.getByRole("button", { name: "Held" })).toBeInTheDocument();
  });

  it("refuse a figure of your own the bank cannot cover", () => {
    const state = view({ maxBet: 4_000, seats: [seat("a", "Ada"), seat("b", "Bo")] });
    const { props } = controls({ state, me: state.seats[0] ?? null, chips: 100_000 });
    fireEvent.change(screen.getByRole("textbox", { name: "Custom bet" }), { target: { value: "9000" } });
    expect((screen.getByRole("button", { name: "Bet it" }) as HTMLButtonElement).disabled).toBe(true);
    expect(props.onStake).not.toHaveBeenCalled();
  });

  it("say what the box will take", () => {
    const state = view({ maxBet: 50_000, seats: [seat("a", "Ada"), seat("b", "Bo")] });
    controls({ state, me: state.seats[0] ?? null, chips: 100_000 });
    expect(screen.getByRole("textbox", { name: "Custom bet" })).toHaveAttribute("placeholder", "100 – 50,000");
  });

  it("say the bank is empty rather than offer a range that is not one", () => {
    const state = view({ maxBet: 0, seats: [seat("a", "Ada"), seat("b", "Bo")] });
    controls({ state, me: state.seats[0] ?? null });
    expect(screen.getByRole("textbox", { name: "Custom bet" })).toHaveAttribute(
      "placeholder",
      "The bank cannot cover a hand yet",
    );
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
