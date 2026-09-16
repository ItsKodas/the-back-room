// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { useTableSocket } from "./useTableSocket.js";

describe("what a table window tells the server about itself", () => {
  beforeEach(() => {
    handlers.clear();
    made.mockClear();
    window.sessionStorage.clear();
    fake.active = true;
  });

  afterEach(() => {
    vi.useRealTimers();
    fake.emit.mockClear();
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

  it("counts the same refusal twice as two refusals", async () => {
    /*
     * React will not re-render for a string it already has, so a table that
     * says the same no twice would otherwise say it once and then go quiet.
     */
    const { result } = renderHook(() => useTableSocket("blackjack", () => {}));
    handlers.get("room:error")?.("Last call — you can only take chips back now.");
    await waitFor(() => expect(result.current.errorKey).toBe(1));
    handlers.get("room:error")?.("Last call — you can only take chips back now.");
    await waitFor(() => expect(result.current.errorKey).toBe(2));
    expect(result.current.error).toBe("Last call — you can only take chips back now.");
  });

  it("counts a refused join as a refusal", async () => {
    const { result } = renderHook(() => useTableSocket("blackjack", () => {}));
    result.current.join("Ada", "ABCDE");
    const call = fake.emit.mock.calls.find((args) => args[0] === "lobby:join");
    const ack = call?.[2] as (result: { ok: false; error: string }) => void;
    ack({ ok: false, error: "No table with that code." });
    await waitFor(() => expect(result.current.errorKey).toBe(1));
  });

  it("does not count a closed table as a refusal", async () => {
    // A notice, not a no: the player lands on a page that shows it as a strip.
    const { result } = renderHook(() => useTableSocket("blackjack", () => {}));
    handlers.get("room:state")?.({ game: "blackjack", code: "ABCDE", listed: true, taunts: [], seats: [] });
    await waitFor(() => expect(result.current.state).not.toBeNull());
    handlers.get("room:closed")?.({ code: "ABCDE", reason: "empty" });
    await waitFor(() => expect(result.current.error).toMatch(/closed/i));
    expect(result.current.errorKey).toBe(0);
  });

  it("gives a repeated refusal its own four seconds", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTableSocket("blackjack", () => {}));
    act(() => handlers.get("room:error")?.("Not your turn."));
    act(() => vi.advanceTimersByTime(3_000));
    act(() => handlers.get("room:error")?.("Not your turn."));
    act(() => vi.advanceTimersByTime(3_000));
    // Six seconds after the first, three after the second: still showing.
    expect(result.current.error).toBe("Not your turn.");
    act(() => vi.advanceTimersByTime(1_100));
    expect(result.current.error).toBeNull();
  });
});

describe("relays", () => {
  beforeEach(() => {
    handlers.clear();
    made.mockClear();
    window.sessionStorage.clear();
    fake.active = true;
  });

  it("hands each one to whoever is listening, without re-rendering the table for it", () => {
    /*
     * A partner's line arrives twenty times a second. Through React state that
     * is twenty renders of the whole felt a second on somebody's phone.
     */
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useTableSocket("scribble", () => {});
    });
    const heard: unknown[] = [];
    const stop = result.current.onRelay((relay) => heard.push(relay));
    const before = renders;

    handlers.get("room:relay")?.({ seatId: "s1", payload: { kind: "clear" } });
    expect(heard).toEqual([{ seatId: "s1", payload: { kind: "clear" } }]);
    expect(renders).toBe(before);

    stop();
    handlers.get("room:relay")?.({ seatId: "s1", payload: { kind: "clear" } });
    expect(heard).toHaveLength(1);
  });
});

describe("errors", () => {
  beforeEach(() => {
    handlers.clear();
    made.mockClear();
    window.sessionStorage.clear();
    fake.active = true;
  });

  it("hands every room:error to whoever is listening, and stops once they unsubscribe", () => {
    const { result } = renderHook(() => useTableSocket("scribble", () => {}));
    const heard: string[] = [];
    const stop = result.current.onError((message) => heard.push(message));

    handlers.get("room:error")?.("The napkin's full.");
    handlers.get("room:error")?.("The napkin's full.");
    expect(heard).toEqual(["The napkin's full.", "The napkin's full."]);

    stop();
    handlers.get("room:error")?.("The napkin's full.");
    expect(heard).toHaveLength(2);
  });
});
