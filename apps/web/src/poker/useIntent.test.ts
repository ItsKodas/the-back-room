// @vitest-environment jsdom
import type { TableView } from "@backroom/game-poker";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useIntent } from "./useIntent.js";

/** Only what the hook reads: whose turn it is. */
const view = (toAct: string | null) => ({ toAct }) as unknown as TableView;

describe("a poker move, before the table has answered", () => {
  it("gives up on a move the table refused", () => {
    const { result, rerender } = renderHook(
      ({ error }: { error: string | null }) => useIntent(view("a"), "a", error),
      { initialProps: { error: null as string | null } },
    );
    act(() => result.current.send("raise", 400));

    rerender({ error: "That raise is below the minimum." });

    expect(result.current.move).toBeNull();
  });

  it("gives up on a move refused in the same words as the last refusal", () => {
    const no = "That raise is below the minimum.";
    const { result, rerender } = renderHook(
      ({ key }: { key: number }) => useIntent(view("a"), "a", no, key),
      { initialProps: { key: 1 } },
    );
    act(() => result.current.send("raise", 400));
    expect(result.current.move).toBe("raise");

    rerender({ key: 2 });

    expect(result.current.move).toBeNull();
    expect(result.current.committed).toBeNull();
  });
});
