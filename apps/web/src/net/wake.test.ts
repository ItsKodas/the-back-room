import { describe, expect, it, vi } from "vitest";
import { rejoinOnReturn, SERVER_FORGETS_AFTER_MS } from "./wake.js";

function page() {
  const target = new EventTarget() as EventTarget & { visibilityState: DocumentVisibilityState };
  target.visibilityState = "visible";
  const become = (state: DocumentVisibilityState) => {
    target.visibilityState = state;
    target.dispatchEvent(new Event("visibilitychange"));
  };
  return { doc: target as unknown as Document, become };
}

function socket(connected: boolean) {
  const calls: string[] = [];
  const pingListeners: Array<() => void> = [];
  return {
    calls,
    connected,
    connect: vi.fn(() => calls.push("connect")),
    disconnect: vi.fn(() => calls.push("disconnect")),
    io: {
      on: vi.fn((event: "ping", listener: () => void) => {
        if (event === "ping") {
          pingListeners.push(listener);
        }
      }),
      off: vi.fn((event: "ping", listener: () => void) => {
        if (event === "ping") {
          const at = pingListeners.indexOf(listener);
          if (at !== -1) {
            pingListeners.splice(at, 1);
          }
        }
      }),
    },
    /** Fires every listener registered through `io.on("ping", ...)`, as the manager would on a real ping. */
    ping() {
      for (const listener of [...pingListeners]) {
        listener();
      }
    },
  };
}

describe("coming back to the app", () => {
  it("leaves a connection alone after a glance away", () => {
    const { doc, become } = page();
    const live = socket(true);
    let clock = 0;
    rejoinOnReturn(live, doc, () => clock);

    become("hidden");
    clock = 5_000;
    become("visible");

    expect(live.calls).toEqual([]);
  });

  it("starts a fresh connection after long enough that the server has let the old one go", () => {
    /*
     * A phone freezes a backgrounded app without closing its socket, so the
     * client can come back sure it is connected to a server that dropped it a
     * minute ago — and wait out a whole ping timeout before admitting it.
     */
    const { doc, become } = page();
    const live = socket(true);
    let clock = 0;
    rejoinOnReturn(live, doc, () => clock);

    become("hidden");
    clock = SERVER_FORGETS_AFTER_MS;
    become("visible");

    expect(live.calls).toEqual(["disconnect", "connect"]);
  });

  it("leaves a connection alone however long it was hidden, as long as it kept hearing pings", () => {
    /*
     * A desktop tab, or an Android tab in its first minute or so backgrounded,
     * keeps answering the server's pings while hidden — its socket is
     * genuinely still alive. Forcing a disconnect on a socket like that sends
     * a real disconnect packet, which the server treats like the player
     * leaving: a folded hand, a stake left on the felt. This must never
     * happen just because a lot of time passed while the page was hidden.
     */
    const { doc, become } = page();
    const live = socket(true);
    let clock = 0;
    rejoinOnReturn(live, doc, () => clock);

    become("hidden");
    clock = 20_000;
    live.ping();
    clock = 60_000;
    become("visible");

    expect(live.calls).toEqual([]);
  });

  it("reconnects at once when the connection is already down, however short the absence", () => {
    const { doc, become } = page();
    const down = socket(false);
    let clock = 0;
    rejoinOnReturn(down, doc, () => clock);

    become("hidden");
    clock = 1_000;
    become("visible");

    expect(down.calls).toEqual(["connect"]);
  });

  it("does nothing once the table has been left, and stops listening for pings", () => {
    const { doc, become } = page();
    const down = socket(false);
    const stop = rejoinOnReturn(down, doc, () => 0);

    stop();
    become("hidden");
    become("visible");

    expect(down.calls).toEqual([]);
    expect(down.io.off).toHaveBeenCalledWith("ping", expect.any(Function));
    // Firing what would have been the ping listener does nothing further: it
    // was actually removed, not just marked as such.
    down.ping();
    become("hidden");
    become("visible");
    expect(down.calls).toEqual([]);
  });
});
