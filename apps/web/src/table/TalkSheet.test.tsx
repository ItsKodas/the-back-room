// @vitest-environment jsdom
import type { ChatMessage } from "@backroom/shared";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { TalkPanel, TalkSheet, useTalk } from "./TalkSheet.js";

const said = (seatId: string, text: string, at: number) =>
  ({ seatId, name: seatId, text, at }) as unknown as ChatMessage;

beforeAll(() => {
  // jsdom lays nothing out, so it has no scrolling to do.
  Element.prototype.scrollIntoView = vi.fn();
});

describe("table talk's unread count", () => {
  it("counts what somebody else said while it was shut, and clears when opened", () => {
    const { result, rerender } = renderHook(({ log }) => useTalk(log, "me"), {
      initialProps: { log: [] as ChatMessage[] },
    });
    expect(result.current.unread).toBe(0);

    rerender({ log: [said("them", "bank it", 1), said("me", "no", 2), said("them", "coward", 3)] });
    // Your own line is not news to you.
    expect(result.current.unread).toBe(2);

    act(() => result.current.toggle());
    expect(result.current.unread).toBe(0);

    act(() => result.current.close());
    rerender({
      log: [said("them", "bank it", 1), said("me", "no", 2), said("them", "coward", 3), said("them", "go on", 4)],
    });
    expect(result.current.unread).toBe(1);
  });

  it("starts again rather than going negative when the log belongs to a new table", () => {
    const { result, rerender } = renderHook(({ log }) => useTalk(log, "me"), {
      initialProps: { log: [said("them", "a", 1), said("them", "b", 2)] },
    });
    rerender({ log: [said("them", "hello", 3)] });
    expect(result.current.unread).toBe(1);
  });
});

describe("the lobby's talk panel", () => {
  it("is the same talk under its own heading, with a place to say something", () => {
    render(<TalkPanel log={[said("them", "deal me in", 1)]} seatId="me" onSay={() => {}} />);
    const panel = screen.getByRole("region", { name: "Table talk" });
    expect(panel.textContent).toContain("deal me in");
    expect(screen.getByRole("textbox", { name: "Message" })).toBeTruthy();
  });
});

describe("the talk sheet", () => {
  it("is not there while shut", () => {
    render(<TalkSheet open={false} onClose={() => {}} log={[]} seatId="me" onSay={() => {}} />);
    expect(screen.queryByRole("dialog", { name: "Table talk" })).toBeNull();
  });

  it("shows what was said, and shuts on Escape", () => {
    const onClose = vi.fn();
    render(
      <TalkSheet open onClose={onClose} log={[said("them", "bank it, coward", 1)]} seatId="me" onSay={() => {}} />,
    );
    expect(screen.getByRole("dialog", { name: "Table talk" }).textContent).toContain("bank it, coward");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
