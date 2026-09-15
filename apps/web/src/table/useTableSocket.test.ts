// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (arg: unknown) => void>();
const fake = {
  on: (event: string, run: (arg: unknown) => void) => {
    handlers.set(event, run);
  },
  emit: vi.fn(),
  close: vi.fn(),
  connect: vi.fn(),
  // Mirrors socket.io's own flag: false once a middleware refusal has given
  // up on reconnecting, true while a transport failure is still being retried.
  active: true,
};
const made = vi.fn(() => fake);

vi.mock("socket.io-client", () => ({ io: (...args: unknown[]) => made(...args) }));

import { useTableSocket } from "./useTableSocket.js";

describe("what a table window tells the server about itself", () => {
  beforeEach(() => {
    handlers.clear();
    made.mockClear();
    window.sessionStorage.clear();
    fake.active = true;
  });

  it("names its game and its window in the handshake", () => {
    renderHook(() => useTableSocket("blackjack", () => {}));
    const options = made.mock.calls[0]?.[1] as {
      auth?: { game?: string; window?: string };
    };
    expect(options.auth?.game).toBe("blackjack");
    expect(options.auth?.window).toBe(window.sessionStorage.getItem("backroom.window"));
  });

  it("holds a refusal apart from a disconnection", async () => {
    /*
     * They look nothing alike to a player and must not render alike: one says
     * wait, the other says go and close a tab.
     */
    const { result } = renderHook(() => useTableSocket("blackjack", () => {}));
    // A middleware refusal is one socket.io has given up retrying.
    fake.active = false;
    handlers.get("connect_error")?.(
      new Error("You already have Blackjack open in another window."),
    );
    await waitFor(() =>
      expect(result.current.taken).toBe(
        "You already have Blackjack open in another window.",
      ),
    );
    expect(result.current.connected).toBe(false);
  });

  it("asks again when told to, because socket.io will not on its own", async () => {
    const { result } = renderHook(() => useTableSocket("blackjack", () => {}));
    fake.active = false;
    handlers.get("connect_error")?.(new Error("You already have Blackjack open in another window."));
    await waitFor(() => expect(result.current.taken).not.toBeNull());
    result.current.retry();
    expect(fake.connect).toHaveBeenCalled();
    await waitFor(() => expect(result.current.taken).toBeNull());
  });

  it("leaves a dropped connection alone, because it is not a refusal", async () => {
    /*
     * connect_error also fires for an ordinary transport failure, and
     * socket.io keeps retrying those on its own — `active` stays true. That
     * is nothing this window did wrong, so it must not be shown as one.
     */
    const { result } = renderHook(() => useTableSocket("blackjack", () => {}));
    fake.active = true;
    handlers.get("connect_error")?.(new Error("xhr poll error"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.taken).toBeNull();
  });

  it("leaves a table that has been closed, and says why", async () => {
    const onLeave = vi.fn();
    const { result } = renderHook(() => useTableSocket("blackjack", onLeave));
    handlers.get("room:state")?.({ game: "blackjack", code: "ABCDE", listed: true, taunts: [], seats: [] });
    await waitFor(() => expect(result.current.state).not.toBeNull());

    handlers.get("room:closed")?.({ code: "ABCDE", reason: "empty" });

    await waitFor(() => expect(onLeave).toHaveBeenCalledTimes(1));
    expect(result.current.state).toBeNull();
    expect(result.current.error).toMatch(/closed/i);
    expect(fake.emit).not.toHaveBeenCalledWith("lobby:leave");
  });

  it("ignores the close of a table it is not at", async () => {
    const onLeave = vi.fn();
    renderHook(() => useTableSocket("blackjack", onLeave));
    handlers.get("room:state")?.({ game: "blackjack", code: "ABCDE", listed: true, taunts: [], seats: [] });
    handlers.get("room:closed")?.({ code: "ZZZZZ", reason: "empty" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onLeave).not.toHaveBeenCalled();
  });
});
