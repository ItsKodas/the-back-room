// @vitest-environment jsdom
import type { TableView } from "@backroom/game-uno";
import { label, officialRules } from "@backroom/game-uno";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Centre, Hand, line, RoundModal, Seats, scatter, seatPosition, stillNeeds, Toasts } from "./Felt.js";
import { dealt } from "./fixtures.js";
import { BotSpeedField, RulesForm } from "./RulesForm.js";
import type { Intent } from "./useIntent.js";

const idle: Intent = {
  played: null,
  drawing: null,
  pressed: null,
  ready: null,
  busy: false,
  play: () => undefined,
  draw: () => undefined,
  press: () => undefined,
  setReady: () => undefined,
};

afterEach(() => {
  vi.useRealTimers();
});

const live = (keys: HTMLElement[]) => keys.filter((key) => key.getAttribute("aria-disabled") !== "true");

describe("the hand", () => {
  it("shows every card you hold, and only the ones that will go are live", async () => {
    const { view } = await dealt();
    const toAct = view().toAct as string;
    const state = view(toAct);
    render(<Hand state={state} seatId={toAct} intent={idle} onPick={() => undefined} onRefused={() => undefined} />);
    const keys = screen.getAllByRole("button");
    expect(keys).toHaveLength(state.hand?.cards.length ?? -1);
    expect(live(keys)).toHaveLength(state.hand?.playable.length ?? -1);
  });

  it("plays a live card on the press, and shakes one that will not go without asking", async () => {
    const { view } = await dealt();
    const toAct = view().toAct as string;
    const state = view(toAct);
    const hand = state.hand;
    if (hand === null) throw new Error("no hand");
    const good = hand.cards.find((card) => hand.playable.includes(card.id));
    const bad = hand.cards.find((card) => !hand.playable.includes(card.id) && !hand.jumpable.includes(card.id));
    const onPick = vi.fn();
    const onRefused = vi.fn();
    const { container } = render(<Hand state={state} seatId={toAct} intent={idle} onPick={onPick} onRefused={onRefused} />);
    if (bad !== undefined) {
      const dead = screen.getAllByRole("button").find((key) => key.getAttribute("aria-disabled") === "true");
      fireEvent.click(dead as HTMLElement);
      expect(onPick).not.toHaveBeenCalled();
      expect(onRefused).toHaveBeenCalledTimes(1);
      expect(container.querySelector(".uno-hand__card.is-shake")).not.toBe(null);
    }
    if (good !== undefined) {
      const key = live(screen.getAllByRole("button"))[0] as HTMLElement;
      fireEvent.click(key);
      expect(onPick).toHaveBeenCalledTimes(1);
    }
  });

  it("dims the cards that cannot go on your own turn, and not on anybody else's", async () => {
    const { view } = await dealt();
    const toAct = view().toAct as string;
    const other = toAct === "me" ? "them" : "me";
    const mine = render(
      <Hand state={view(toAct)} seatId={toAct} intent={idle} onPick={() => undefined} onRefused={() => undefined} />,
    );
    const dim = mine.container.querySelectorAll(".is-dim").length;
    expect(dim).toBe((view(toAct).hand?.cards.length ?? 0) - (view(toAct).hand?.playable.length ?? 0));
    mine.unmount();
    const theirs = render(
      <Hand state={view(other)} seatId={other} intent={idle} onPick={() => undefined} onRefused={() => undefined} />,
    );
    expect(theirs.container.querySelectorAll(".is-dim")).toHaveLength(0);
  });

  it("takes a played card out of the hand on the press", async () => {
    const { view } = await dealt();
    const state = view();
    const card = state.hand?.cards[0];
    if (card === undefined) throw new Error("no cards");
    render(
      <Hand
        state={state}
        seatId="me"
        intent={{ ...idle, played: { card, color: null }, busy: true }}
        onPick={() => undefined}
        onRefused={() => undefined}
      />,
    );
    expect(screen.getAllByRole("img").length).toBe((state.hand?.cards.length ?? 0) - 1);
  });

  it("draws one face-down card while a draw is on its way, and none once the hand has grown", async () => {
    const { view } = await dealt();
    const state = view();
    const held = state.hand?.cards.length ?? 0;
    const props = { state, seatId: "me", onPick: () => undefined, onRefused: () => undefined };
    const { rerender } = render(<Hand {...props} intent={{ ...idle, drawing: held, busy: true }} />);
    expect(screen.getByLabelText("A card on its way")).toBeTruthy();
    rerender(<Hand {...props} intent={{ ...idle, drawing: held - 1, busy: true }} />);
    expect(screen.queryByLabelText("A card on its way")).toBe(null);
  });
});

describe("the seats round the oval", () => {
  it("puts you at the bottom and the rest round the rim", () => {
    const you = seatPosition(0, 4, false);
    expect(you.x).toBeCloseTo(50);
    expect(you.y).toBeCloseTo(95);
    const across = seatPosition(2, 4, false);
    expect(across.y).toBeCloseTo(5);
  });

  it("keeps every seat on a phone inside the table's width", () => {
    for (let count = 2; count <= 8; count += 1) {
      for (let place = 0; place < count; place += 1) {
        const { x } = seatPosition(place, count, true);
        expect(x).toBeGreaterThanOrEqual(16);
        expect(x).toBeLessThanOrEqual(84);
      }
    }
  });

  it("names every seat, marks the dealer, and shows each hand only as a count", async () => {
    const { view } = await dealt();
    const state = view("me");
    const { container } = render(
      <Seats state={state} seatId="me" portrait={false} catching={false} onCatch={() => undefined} />,
    );
    expect(screen.getByText("You")).toBeTruthy();
    expect(screen.getByText("Them")).toBeTruthy();
    expect(container.querySelectorAll(".uno-tag--dealer")).toHaveLength(1);
    // The fan is backs only: nobody's cards are on their plate.
    expect(container.querySelectorAll(".uno-seats .uno-card--back").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".uno-seats [role='img']")).toHaveLength(0);
  });

  it("offers a catch only on the seat the table says can be caught", async () => {
    const { view } = await dealt();
    const state: TableView = { ...view("me"), catchable: "them" };
    const onCatch = vi.fn();
    render(<Seats state={state} seatId="me" portrait={false} catching={false} onCatch={onCatch} />);
    fireEvent.click(screen.getByRole("button", { name: "Catch!" }));
    expect(onCatch).toHaveBeenCalledWith("them");
  });
});

describe("the piles", () => {
  it("scatters each card in the same place every time it is drawn", () => {
    expect(scatter(17)).toEqual(scatter(17));
    for (let id = 0; id < 200; id += 1) {
      const { r, x, y } = scatter(id);
      expect(Math.abs(r)).toBeLessThanOrEqual(15);
      expect(Math.abs(x)).toBeLessThanOrEqual(5);
      expect(Math.abs(y)).toBeLessThanOrEqual(4);
    }
  });

  it("puts a card you play on top of the pile on the press, in the colour you picked", async () => {
    const { view } = await dealt();
    const state = view();
    const card = state.hand?.cards[0];
    if (card === undefined) throw new Error("no cards");
    const { container } = render(
      <Centre state={state} seatId="me" intent={{ ...idle, played: { card, color: "blue" }, busy: true }} onDraw={() => undefined} />,
    );
    const slots = container.querySelectorAll(".uno-discard .uno-pile__slot");
    expect(slots[slots.length - 1]?.querySelector("[role='img']")?.getAttribute("aria-label")).toBe(label(card));
    expect(container.querySelector(".uno-discard")?.getAttribute("data-color")).toBe(
      card.color === "wild" ? "blue" : card.color,
    );
  });
});

describe("what just happened", () => {
  it("does not replay effects that were there before the page opened, and toasts the next one", async () => {
    vi.useFakeTimers();
    const { view } = await dealt();
    const state = view();
    const before = state.effects.at(-1)?.seq ?? 0;
    const { container, rerender } = render(<Toasts state={state} error={null} errorKey={0} />);
    expect(container.querySelectorAll(".uno-toast")).toHaveLength(0);
    rerender(
      <Toasts
        state={{ ...state, effects: [...state.effects, { seq: before + 1, kind: "skip", text: "Skipped!", seat: null }] }}
        error={null}
        errorKey={0}
      />,
    );
    expect(screen.getByText("Skipped!").className).toContain("uno-toast--skip");
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(screen.queryByText("Skipped!")).toBe(null);
  });

  it("says a refusal as a toast, and the same refusal twice as two", async () => {
    const { view } = await dealt();
    const state = view();
    const { container, rerender } = render(<Toasts state={state} error="Not your turn." errorKey={1} />);
    rerender(<Toasts state={state} error="Not your turn." errorKey={2} />);
    expect(container.querySelectorAll(".uno-toast--error")).toHaveLength(2);
  });
});

describe("the end of a round", () => {
  it("waits a beat, then shows every hand and what it scored", async () => {
    vi.useFakeTimers();
    const { view } = await dealt();
    const base = view("me");
    const state: TableView = {
      ...base,
      phase: "between",
      lastRound: { round: 1, winner: "me", handPoints: { me: 0, them: 23 }, gained: { me: 23 }, gameOver: false, champion: null },
    };
    render(<RoundModal state={state} seatId="me" />);
    expect(screen.queryByRole("dialog")).toBe(null);
    act(() => {
      vi.advanceTimersByTime(1_200);
    });
    expect(screen.getByRole("dialog").textContent).toContain("You win round 1!");
    expect(screen.getByText("+23")).toBeTruthy();
  });
});

describe("the line across the top", () => {
  it("says whose turn it is, and that it is yours", async () => {
    const { view } = await dealt();
    const toAct = view().toAct as string;
    const mine = view(toAct);
    if (mine.step === "playing") {
      expect(line(mine, toAct)).toMatch(/^Your turn|^Answer/);
    }
    const other = toAct === "me" ? "them" : "me";
    expect(line(view(other), other)).toMatch(/turn|colour|faces|thinking|deciding/);
  });
});

describe("the host's rules", () => {
  it("sets a game mode in one press and a single rule in another", () => {
    const onChange = vi.fn();
    render(<RulesForm rules={officialRules()} onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "Rabbids" }));
    expect(onChange.mock.calls[0]?.[0].rabbids).toBe(true);
    fireEvent.click(screen.getByLabelText(/Jump-in/));
    expect(onChange.mock.calls[1]?.[0].jumpIn).toBe(true);
  });

  it("marks the preset the rules match, and no preset once a rule has moved off it", () => {
    const { rerender } = render(<RulesForm rules={officialRules()} onChange={() => undefined} />);
    expect(screen.getByRole("radio", { name: "Official" }).getAttribute("aria-checked")).toBe("true");
    rerender(<RulesForm rules={{ ...officialRules(), jumpIn: true }} onChange={() => undefined} />);
    expect(screen.getAllByRole("radio").every((one) => one.getAttribute("aria-checked") === "false")).toBe(true);
    expect(screen.getByText("changed")).toBeTruthy();
  });

  it("lays every rule out, as the tabletop did, rather than folding them away", () => {
    render(<RulesForm rules={officialRules()} onChange={() => undefined} />);
    expect(screen.getByLabelText(/Stacking/)).toBeTruthy();
    expect(screen.getByLabelText(/Hurry Up! time limit/)).toBeTruthy();
  });

  it("picks the bot speed", () => {
    const onChange = vi.fn();
    render(<BotSpeedField value="normal" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Bot speed"), { target: { value: "turbo" } });
    expect(onChange).toHaveBeenCalledWith("turbo");
  });
});

describe("what a card still needs", () => {
  it("asks for the colour first and the target after", () => {
    expect(stillNeeds(["color", "target"], {})).toBe("color");
    expect(stillNeeds(["color", "target"], { color: "red" })).toBe("target");
    expect(stillNeeds(["color", "target"], { color: "red", target: "x" })).toBe(null);
    expect(stillNeeds([], {})).toBe(null);
  });
});
