// @vitest-environment jsdom
import type { RoomView, TurnView } from "@backroom/shared";
import { render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActivityLog, useActivity } from "./Activity.js";

function room(code: string, lastEvent: string | null, rollSeq = 0): RoomView {
  return { code, lastEvent, turn: { rollSeq } as TurnView } as unknown as RoomView;
}

function log(initial: RoomView | null) {
  return renderHook(({ view }) => useActivity(view), { initialProps: { view: initial } });
}

const texts = (entries: ReturnType<typeof useActivity>) => entries.map((entry) => entry.text);

describe("the activity log", () => {
  it("keeps every line the table says, oldest first", () => {
    const { result, rerender } = log(room("AAAAA", "Koda goes first"));
    rerender({ view: room("AAAAA", "Koda rolled 6", 1) });
    rerender({ view: room("AAAAA", "Koda banked 600", 1) });
    expect(texts(result.current)).toEqual(["Koda goes first", "Koda rolled 6", "Koda banked 600"]);
  });

  it("counts the same words after another throw as a second line", () => {
    const { result, rerender } = log(room("AAAAA", "Koda rolled 5", 1));
    rerender({ view: room("AAAAA", "Koda rolled 5", 2) });
    expect(texts(result.current)).toEqual(["Koda rolled 5", "Koda rolled 5"]);
  });

  it("does not repeat a line for an update that says nothing new", () => {
    const { result, rerender } = log(room("AAAAA", "Koda rolled 5", 1));
    // A pick, a join, a clock tick: a new broadcast with the same last line.
    rerender({ view: room("AAAAA", "Koda rolled 5", 1) });
    // A new turn starts the counter again, which is not a throw either.
    rerender({ view: room("AAAAA", "Koda rolled 5", 0) });
    expect(texts(result.current)).toEqual(["Koda rolled 5"]);
  });

  it("starts again at a different table", () => {
    const { result, rerender } = log(room("AAAAA", "Koda goes first"));
    rerender({ view: room("BBBBB", "Mara goes first") });
    expect(texts(result.current)).toEqual(["Mara goes first"]);
  });

  it("has nothing to say until the table does", () => {
    const { result } = log(room("AAAAA", null));
    expect(result.current).toEqual([]);
  });
});

describe("the activity list", () => {
  it("says so when nothing has happened", () => {
    render(<ActivityLog entries={[]} />);
    expect(screen.getByRole("list", { name: "Activity" }).textContent).toContain("Nothing has happened yet.");
  });

  it("shows each line with when it happened", () => {
    render(
      <ActivityLog
        entries={[
          { id: 1, at: Date.UTC(2026, 8, 16, 21, 5), text: "Koda rolled 6" },
          { id: 2, at: Date.UTC(2026, 8, 16, 21, 6), text: "Koda banked 600" },
        ]}
      />,
    );
    const lines = screen.getAllByRole("listitem");
    expect(lines.map((line) => line.querySelector("span")?.textContent)).toEqual(["Koda rolled 6", "Koda banked 600"]);
    expect(lines[0]?.querySelector("time")?.getAttribute("dateTime")).toBe("2026-09-16T21:05:00.000Z");
  });
});
