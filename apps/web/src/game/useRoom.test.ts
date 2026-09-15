// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
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
  // rejoinOnReturn listens here for the server's pings; nothing in these
  // tests ever fires one, so a no-op pair is all it needs.
  io: { on: vi.fn(), off: vi.fn() },
};
const made = vi.fn(() => fake);

vi.mock("socket.io-client", () => ({ io: (...args: unknown[]) => made(...args) }));

import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { useRoom } from "./useRoom.js";

/** useRoom navigates on leave(), so it needs a router under it even unused here. */
function wrapper({ children }: { children: React.ReactNode }) {
  return createElement(MemoryRouter, null, children);
}

describe("what a Greed window tells the server about itself", () => {
  beforeEach(() => {
    handlers.clear();
    made.mockClear();
    window.sessionStorage.clear();
    fake.active = true;
  });

  it("names greed and its window in the handshake", () => {
    renderHook(() => useRoom(), { wrapper });
    const options = made.mock.calls[0]?.[1] as {
      auth?: { game?: string; window?: string };
    };
    expect(options.auth?.game).toBe("greed");
    expect(options.auth?.window).toBe(window.sessionStorage.getItem("backroom.window"));
  });

  it("holds a refusal apart from a disconnection", async () => {
    /*
     * They look nothing alike to a player and must not render alike: one says
     * wait, the other says go and close a tab.
     */
    const { result } = renderHook(() => useRoom(), { wrapper });
    // A middleware refusal is one socket.io has given up retrying.
    fake.active = false;
    handlers.get("connect_error")?.(new Error("You already have Greed open in another window."));
    await waitFor(() =>
      expect(result.current.taken).toBe("You already have Greed open in another window."),
    );
    expect(result.current.error).toBeNull();
  });

  it("leaves a dropped connection alone, because it is not a refusal", async () => {
    /*
     * connect_error also fires for an ordinary transport failure, and
     * socket.io keeps retrying those on its own — `active` stays true. That
     * is nothing this window did wrong, so it must not be shown as one. This
     * is the one wiring where the old behaviour (a "Cannot reach the server"
     * message) was deleted and then restored, so it is the most likely of the
     * three to regress silently.
     */
    const { result } = renderHook(() => useRoom(), { wrapper });
    fake.active = true;
    handlers.get("connect_error")?.(new Error("xhr poll error"));
    await waitFor(() =>
      expect(result.current.error).toBe("Cannot reach the server. Is it running?"),
    );
    expect(result.current.taken).toBeNull();
  });

  it("leaves a table that has been closed, and says why", async () => {
    const { result } = renderHook(() => useRoom(), { wrapper });
    handlers.get("room:state")?.({ game: "greed", code: "ABCDE", listed: true, taunts: [], seats: [] });
    await waitFor(() => expect(result.current.room).not.toBeNull());

    handlers.get("room:closed")?.({ code: "ABCDE", reason: "empty" });

    await waitFor(() => expect(result.current.room).toBeNull());
    expect(result.current.error).toMatch(/closed/i);
    expect(fake.emit).not.toHaveBeenCalledWith("lobby:leave");
  });

  it("counts the same refusal twice as two, so it can be shown again", () => {
    /*
     * The server turning the same press down twice sends the same words twice,
     * and React does not re-render for a string it already holds — so without a
     * count the second no was silent, and the table looked like it had stopped
     * listening.
     */
    const { result } = renderHook(() => useRoom(), { wrapper });
    act(() => {
      handlers.get("room:error")?.("You need 500 in one turn to get on the board.");
    });
    const first = result.current.errorKey;
    act(() => {
      handlers.get("room:error")?.("You need 500 in one turn to get on the board.");
    });
    expect(result.current.error).toBe("You need 500 in one turn to get on the board.");
    expect(result.current.errorKey).toBe(first + 1);
  });

  it("does not count a dropped connection as a refusal", () => {
    const { result } = renderHook(() => useRoom(), { wrapper });
    act(() => {
      handlers.get("connect_error")?.(new Error("xhr poll error"));
    });
    expect(result.current.errorKey).toBe(0);
  });

  it("ignores the close of a table it is not at", () => {
    /*
     * Each event goes through act so its render has happened before anything
     * is read back. Outside act, React renders on a setImmediate, and the
     * setTimeout(0) this used to wait on could fire first on a busy event
     * loop — leaving `room` null because the table had not yet been drawn,
     * not because the close was mistaken for this one's.
     */
    const { result } = renderHook(() => useRoom(), { wrapper });
    act(() => {
      handlers.get("room:state")?.({ game: "greed", code: "ABCDE", listed: true, taunts: [], seats: [] });
    });
    expect(result.current.room).not.toBeNull();

    act(() => {
      handlers.get("room:closed")?.({ code: "ZZZZZ", reason: "empty" });
    });
    expect(result.current.room).not.toBeNull();
    expect(result.current.error).toBeNull();
  });
});
