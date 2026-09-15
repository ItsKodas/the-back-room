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
  return {
    calls,
    connected,
    connect: vi.fn(() => calls.push("connect")),
    disconnect: vi.fn(() => calls.push("disconnect")),
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

  it("does nothing once the table has been left", () => {
    const { doc, become } = page();
    const down = socket(false);
    const stop = rejoinOnReturn(down, doc, () => 0);

    stop();
    become("hidden");
    become("visible");

    expect(down.calls).toEqual([]);
  });
});
