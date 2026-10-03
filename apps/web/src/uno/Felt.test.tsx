// @vitest-environment jsdom
import { officialRules } from "@backroom/game-uno";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Hand, line, stillNeeds } from "./Felt.js";
import { dealt } from "./fixtures.js";
import { RulesForm } from "./RulesForm.js";
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

describe("the hand", () => {
  it("shows every card you hold, and lets you press only the ones that will go", async () => {
    const { view } = await dealt();
    const state = view(view().toAct);
    const onPick = vi.fn();
    render(<Hand state={state} intent={idle} onPick={onPick} />);
    const keys = screen.getAllByRole("button");
    expect(keys).toHaveLength(state.hand?.cards.length ?? -1);
    const live = keys.filter((key) => !(key as HTMLButtonElement).disabled);
    expect(live).toHaveLength(state.hand?.playable.length ?? -1);
  });

  it("takes a played card out of the hand on the press", async () => {
    const { view } = await dealt();
    const state = view();
    const card = state.hand?.cards[0];
    if (card === undefined) throw new Error("no cards");
    render(<Hand state={state} intent={{ ...idle, played: { card, color: null }, busy: true }} onPick={() => undefined} />);
    expect(screen.getAllByRole("img").length).toBe((state.hand?.cards.length ?? 0) - 1);
  });

  it("draws one face-down card while a draw is on its way, and none once the hand has grown", async () => {
    const { view } = await dealt();
    const state = view();
    const held = state.hand?.cards.length ?? 0;
    const { rerender } = render(<Hand state={state} intent={{ ...idle, drawing: held, busy: true }} onPick={() => undefined} />);
    expect(screen.getByLabelText("A card on its way")).toBeTruthy();
    rerender(<Hand state={state} intent={{ ...idle, drawing: held - 1, busy: true }} onPick={() => undefined} />);
    expect(screen.queryByLabelText("A card on its way")).toBe(null);
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

describe("the line under the felt", () => {
  it("says whose turn it is, and that it is yours", async () => {
    const { view } = await dealt();
    const toAct = view().toAct as string;
    const mine = view(toAct);
    if (mine.step === "playing") {
      expect(line(mine, toAct)).toMatch(/^Your turn|^Answer/);
    }
    const other = toAct === "me" ? "them" : "me";
    expect(line(view(other), other)).toMatch(/turn|colour/);
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
  });
});
