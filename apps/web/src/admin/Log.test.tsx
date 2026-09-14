// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LogEntry } from "./Log.js";
import { Log, describeEntry } from "./Log.js";

const entry = (over: Partial<LogEntry>): LogEntry => ({
  id: "x",
  at: 1_700_000_000_000,
  by: "u",
  byName: "Koda",
  kind: "add",
  amount: 5000,
  affected: 1,
  target: ["u1"],
  parts: null,
  subject: null,
  note: "",
  ...over,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("what a log line says", () => {
  it("says each kind of act in words", () => {
    expect(describeEntry(entry({}))).toBe("Gave 5,000 chips to 1 player");
    expect(describeEntry(entry({ kind: "add", target: "all", affected: 40 }))).toBe(
      "Gave 5,000 chips to everyone (40)",
    );
    expect(describeEntry(entry({ kind: "remove", affected: 3, target: ["a", "b", "c"] }))).toBe(
      "Took 5,000 chips from 3 players",
    );
    expect(describeEntry(entry({ kind: "set", amount: 0 }))).toBe("Set 1 player's balance to 0 chips");
    expect(
      describeEntry(entry({ kind: "reset", parts: ["balance", "stats"], affected: 2, target: ["a", "b"] })),
    ).toBe("Reset balance and stats for 2 players");
    expect(
      describeEntry(
        entry({ kind: "reset", parts: ["balance", "stats", "history"], target: "all", affected: 9 }),
      ),
    ).toBe("Reset balance, stats and history for everyone (9)");
    expect(describeEntry(entry({ kind: "float", amount: 50_000, subject: "roulette" }))).toBe(
      "Floated 50,000 chips into the roulette bank",
    );
    expect(describeEntry(entry({ kind: "empty-banks", amount: 12 }))).toBe("Emptied the banks of 12 chips");
    expect(describeEntry(entry({ kind: "delete-emote", subject: "Smug" }))).toBe("Deleted the emote Smug");
  });
});

describe("the log tab", () => {
  it("loads older entries from the last one shown", async () => {
    const first = Array.from({ length: 50 }, (_, index) => entry({ id: `n${index}`, at: 2000 - index }));
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        const entries = url.includes("before=") ? [entry({ id: "old", at: 10, note: "the oldest" })] : first;
        return { ok: true, status: 200, json: async () => ({ entries }) };
      }),
    );
    render(<Log />);
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(50));
    fireEvent.click(screen.getByRole("button", { name: "Load older" }));
    await waitFor(() => expect(screen.getByText("the oldest")).toBeTruthy());
    // Both halves of the cursor: the time alone skips an entry that shares
    // the last one's millisecond.
    expect(calls[1]).toBe(`/api/admin/log?before=${2000 - 49}&beforeId=n49`);
  });
});

describe("the log tab, when the read fails", () => {
  it("says it could not read the log rather than claiming there is none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: "broke" }) })),
    );

    render(<Log />);

    await waitFor(() => expect(screen.getByText("Could not read the log.")).toBeTruthy());
    expect(screen.queryByText("Nothing yet.")).toBeNull();
  });
});

describe("the log tab, when loading older entries fails", () => {
  it("says so and keeps the entries already shown", async () => {
    const first = Array.from({ length: 50 }, (_, index) => entry({ id: `n${index}`, at: 2000 - index }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("before=")) {
          return { ok: false, status: 500, json: async () => ({ error: "broke" }) };
        }
        return { ok: true, status: 200, json: async () => ({ entries: first }) };
      }),
    );

    render(<Log />);
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(50));
    fireEvent.click(screen.getByRole("button", { name: "Load older" }));

    await waitFor(() => expect(screen.getByText("Could not load older entries.")).toBeTruthy());
    expect(screen.getAllByRole("listitem")).toHaveLength(50);
  });
});

describe("the log tab, pressed twice before the first answer lands", () => {
  it("does not duplicate the older page", async () => {
    const first = Array.from({ length: 50 }, (_, index) => entry({ id: `n${index}`, at: 2000 - index }));
    const calls: string[] = [];
    // The older-page request is held open until the test releases it, so
    // both clicks land while it is still outstanding — a guard that only
    // works "eventually" would still let the second click through.
    let releaseOlder: (() => void) | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url.includes("before=")) {
          return new Promise((resolve) => {
            releaseOlder = () =>
              resolve({
                ok: true,
                status: 200,
                json: async () => ({ entries: [entry({ id: "old", at: 10, note: "the oldest" })] }),
              });
          });
        }
        return { ok: true, status: 200, json: async () => ({ entries: first }) };
      }),
    );

    render(<Log />);
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(50));

    const button = screen.getByRole("button", { name: "Load older" });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(calls.filter((url) => url.includes("before=")).length).toBe(1);

    releaseOlder?.();
    await waitFor(() => expect(screen.getByText("the oldest")).toBeTruthy());

    expect(screen.getAllByRole("listitem")).toHaveLength(51);
    expect(calls.filter((url) => url.includes("before=")).length).toBe(1);
  });
});
