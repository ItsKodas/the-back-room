// @vitest-environment jsdom
import type { ChatMessage } from "@backroom/shared";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GuessLog } from "./GuessLog.js";
import { seat, viewOf } from "./testView.js";

afterEach(cleanup);

const line = (over: Partial<ChatMessage>): ChatMessage => ({ seatId: "s2", name: "Cy", text: "tower", at: 1, ...over });

const send = (text: string) => {
  const box = screen.getByRole("textbox");
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter" });
};

describe("the guess log", () => {
  it("shows your guess the moment you send it, marked as not yet heard", () => {
    const onSay = vi.fn();
    const { container } = render(<GuessLog log={[]} seatId="s1" state={viewOf()} error={null} onSay={onSay} />);
    send("castle");
    expect(onSay).toHaveBeenCalledWith("castle");
    const pending = container.querySelector(".sc-log__pending");
    expect(pending?.textContent).toContain("castle");
  });

  it("swaps the pending line for the table's own when it comes back, rather than showing it twice", () => {
    const { container, rerender } = render(<GuessLog log={[]} seatId="s1" state={viewOf()} error={null} onSay={() => {}} />);
    send("castle");
    rerender(<GuessLog log={[line({ seatId: "s1", name: "Bo", text: "castle", kind: "guess" })]} seatId="s1" state={viewOf()} error={null} onSay={() => {}} />);
    expect(container.querySelector(".sc-log__pending")).toBeNull();
    expect(screen.getAllByText("castle")).toHaveLength(1);
  });

  it("turns your correct guess into 'You got it', and the word is nowhere on the page", () => {
    const { container, rerender } = render(<GuessLog log={[]} seatId="s1" state={viewOf()} error={null} onSay={() => {}} />);
    send("lighthouse");
    rerender(<GuessLog log={[line({ seatId: "s1", name: "Bo", text: "got it", kind: "got" })]} seatId="s1" state={viewOf()} error={null} onSay={() => {}} />);
    expect(screen.getByText("You got it")).toBeInTheDocument();
    expect(container.textContent).not.toContain("lighthouse");
  });

  it("says somebody else got it by name", () => {
    render(<GuessLog log={[line({ name: "Priya", text: "got it", kind: "got" })]} seatId="s1" state={viewOf()} error={null} onSay={() => {}} />);
    expect(screen.getByText("Priya got it")).toBeInTheDocument();
  });

  it("tells you a guess was close", () => {
    render(<GuessLog log={[line({ seatId: "s1", text: "lighthose", kind: "close" })]} seatId="s1" state={viewOf()} error={null} onSay={() => {}} />);
    expect(screen.getByText(/you're close/)).toBeInTheDocument();
  });

  it("drops a pending guess the table refused", () => {
    const { container, rerender } = render(<GuessLog log={[]} seatId="s1" state={viewOf()} error={null} onSay={() => {}} />);
    send("castle");
    rerender(<GuessLog log={[]} seatId="s1" state={viewOf()} error="Easy on the chat." onSay={() => {}} />);
    expect(container.querySelector(".sc-log__pending")).toBeNull();
  });

  it("gives up on a pending guess nobody answered", () => {
    vi.useFakeTimers();
    const { container } = render(<GuessLog log={[]} seatId="s1" state={viewOf()} error={null} onSay={() => {}} />);
    send("castle");
    // Inside act, so the state the timer sets is rendered before the assertion reads it.
    act(() => {
      vi.advanceTimersByTime(8_000);
    });
    expect(container.querySelector(".sc-log__pending")).toBeNull();
    vi.useRealTimers();
  });

  it("has no box to type in for somebody drawing alone", () => {
    const state = viewOf({ you: seat("s0", { drawing: true }) });
    render(<GuessLog log={[]} seatId="s0" state={state} error={null} onSay={() => {}} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText(/You're drawing/)).toBeInTheDocument();
  });

  it("offers a drawing pair a line to each other, by name", () => {
    const seats = [seat("s0", { drawing: true, name: "Sam" }), seat("s1", { drawing: true }), seat("s2")];
    const state = viewOf({ seats, you: seats[1] ?? null, turn: { drawers: ["s0", "s1"], picker: "s0", team: 0, startedAt: 1 } });
    render(<GuessLog log={[]} seatId="s1" state={state} error={null} onSay={() => {}} />);
    expect(screen.getByRole("textbox")).toHaveAttribute("placeholder", "Say something to Sam");
  });

  it("swaps the pending line even once the chat log is capped at 60 lines", () => {
    // useTableSocket caps the room's chat at 60 lines (`.slice(-60)`), so a length-based
    // cursor stops advancing the moment the cap is hit — this reproduces that shape.
    const filler = Array.from({ length: 60 }, (_, index) => line({ seatId: "sX", text: `filler${index}`, at: index }));
    const { container, rerender } = render(
      <GuessLog log={filler} seatId="s1" state={viewOf()} error={null} onSay={() => {}} />,
    );
    send("castle");
    const capped = [...filler.slice(1), line({ seatId: "s1", name: "Bo", text: "castle", kind: "guess", at: 61 })];
    rerender(<GuessLog log={capped} seatId="s1" state={viewOf()} error={null} onSay={() => {}} />);
    expect(container.querySelector(".sc-log__pending")).toBeNull();
    expect(screen.getAllByText("castle")).toHaveLength(1);
  });

  it("removes only one of two identical pending guesses when one is confirmed", () => {
    const { container, rerender } = render(<GuessLog log={[]} seatId="s1" state={viewOf()} error={null} onSay={() => {}} />);
    send("castle");
    send("castle");
    rerender(<GuessLog log={[line({ seatId: "s1", name: "Bo", text: "castle", kind: "guess" })]} seatId="s1" state={viewOf()} error={null} onSay={() => {}} />);
    expect(container.querySelectorAll(".sc-log__pending")).toHaveLength(1);
  });

  it("shrugs off a table line that matches no pending guess of yours", () => {
    const { container } = render(
      <GuessLog log={[line({ seatId: "s1", text: "nomatch", kind: "guess" })]} seatId="s1" state={viewOf()} error={null} onSay={() => {}} />,
    );
    expect(container.querySelector(".sc-log__pending")).toBeNull();
  });

  it("tolerates an error arriving with no pending guess to drop", () => {
    render(<GuessLog log={[]} seatId="s1" state={viewOf()} error="Easy on the chat." onSay={() => {}} />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("clears its pending timer when it unmounts before the timer fires", () => {
    vi.useFakeTimers();
    const { unmount } = render(<GuessLog log={[]} seatId="s1" state={viewOf()} error={null} onSay={() => {}} />);
    send("castle");
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});
