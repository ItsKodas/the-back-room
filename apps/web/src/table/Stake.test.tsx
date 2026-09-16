// @vitest-environment jsdom
import { LETTER_RULESET } from "@backroom/rules";
import type { RoomView, SeatView } from "@backroom/shared";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STAKE_SETTLE_MS, Stake } from "./Stake.js";

function seat(over: Partial<SeatView> = {}): SeatView {
  return {
    id: "me",
    name: "Koda",
    score: 0,
    onBoard: false,
    connected: true,
    isHost: true,
    isBot: false,
    signedIn: true,
    waiting: false,
    avatar: null,
    accentColor: null,
    ...over,
  };
}

function room(over: Partial<RoomView> = {}): RoomView {
  return {
    code: "XKQ37",
    status: "lobby",
    seats: [seat(), seat({ id: "them", name: "Mara", isHost: false })],
    watching: 0,
    turn: null,
    ruleset: LETTER_RULESET,
    buyIn: 0,
    pot: 0,
    winnerIds: [],
    lastEvent: null,
    ...over,
  };
}

function stake(props: Partial<Parameters<typeof Stake>[0]> = {}) {
  const onSet = vi.fn();
  render(<Stake room={room()} editable signedIn chips={10_000} onSet={onSet} {...props} />);
  return onSet;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the stake", () => {
  it("runs from 1 to everything the host holds", () => {
    stake({ chips: 7_250 });
    const slider = screen.getByRole("slider", { name: "Stake" });
    expect(slider.getAttribute("min")).toBe("1");
    expect(slider.getAttribute("max")).toBe("7250");
  });

  it("never runs past the most a table can stake", () => {
    stake({ chips: 5_000_000 });
    expect(screen.getByRole("slider", { name: "Stake" }).getAttribute("max")).toBe("1000000");
  });

  it("sends a drag once it comes to rest, not for every step of it", () => {
    const onSet = stake();
    const slider = screen.getByRole("slider", { name: "Stake" });
    fireEvent.change(slider, { target: { value: "100" } });
    fireEvent.change(slider, { target: { value: "800" } });
    fireEvent.change(slider, { target: { value: "2400" } });
    // The figure is the host's own, so it shows at once.
    expect((screen.getByRole("textbox", { name: "Stake in chips" }) as HTMLInputElement).value).toBe("2,400");
    expect(onSet).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(STAKE_SETTLE_MS));
    expect(onSet.mock.calls).toEqual([[2400]]);
  });

  it("takes a figure typed in, once it is entered", () => {
    const onSet = stake();
    const box = screen.getByRole("textbox", { name: "Stake in chips" });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "3500" } });
    fireEvent.blur(box);
    act(() => vi.advanceTimersByTime(0));
    expect(onSet.mock.calls).toEqual([[3500]]);
  });

  it("holds a typed figure to what the host can put up", () => {
    const onSet = stake({ chips: 2_000 });
    const box = screen.getByRole("textbox", { name: "Stake in chips" });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "99999" } });
    fireEvent.blur(box);
    act(() => vi.advanceTimersByTime(0));
    expect(onSet.mock.calls).toEqual([[2000]]);
  });

  it("leaves the stake alone when nothing was typed", () => {
    const onSet = stake({ room: room({ buyIn: 500 }) });
    const box = screen.getByRole("textbox", { name: "Stake in chips" });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "" } });
    fireEvent.blur(box);
    act(() => vi.advanceTimersByTime(STAKE_SETTLE_MS));
    expect(onSet).not.toHaveBeenCalled();
  });

  it("goes back to playing for fun", () => {
    const onSet = stake({ room: room({ buyIn: 500 }) });
    const fun = screen.getByRole("button", { name: "For fun" });
    expect(fun.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(fun);
    act(() => vi.advanceTimersByTime(0));
    expect(onSet.mock.calls).toEqual([[0]]);
    expect(fun.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows the host's stake to everybody else without letting them move it", () => {
    stake({ editable: false, room: room({ buyIn: 1_200 }) });
    expect(screen.getByRole("slider", { name: "Stake" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("textbox", { name: "Stake in chips" })).toHaveProperty("disabled", true);
    expect((screen.getByRole("textbox", { name: "Stake in chips" }) as HTMLInputElement).value).toBe("1,200");
  });

  it("is not offered at a table with a bot at it", () => {
    stake({ room: room({ seats: [seat(), seat({ id: "bot", isBot: true })] }) });
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.getByText(/Bots play for free/)).toBeTruthy();
  });
});
