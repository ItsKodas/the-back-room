// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Leaderboard } from "./Leaderboard.js";

const row = (id: string, name: string, chips: number, stats = {}) => ({
  id,
  name,
  avatar: null,
  accentColor: null,
  chips,
  stats: { games: 0, wins: 0, chipsWon: 0, chipsStaked: 0, ...stats },
});

/** A room where the board answers whatever the test says, and remembers asks. */
function stubFetch(board: unknown) {
  const asked: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      asked.push(url);
      if (url.startsWith("/api/leaderboard")) {
        return { ok: true, json: async () => board };
      }
      if (url === "/api/me") {
        return {
          ok: true,
          json: async () => ({
            signedIn: true,
            signinAvailable: true,
            profile: {
              id: "u1",
              name: "Ada",
              avatar: null,
              accentColor: null,
              chips: 900,
              stats: { games: 0, wins: 0, chipsWon: 0 },
              byGame: {},
            },
          }),
        };
      }
      return { ok: false, json: async () => ({}) };
    }),
  );
  return asked;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/*
 * The stub for /api/me always signs somebody named Ada in, and the row for
 * that same player appears on the board itself, so plain `getByText("Ada")`
 * is ambiguous — the navbar prints its own copy of your name beside your
 * balance. `.board__name` is the row's own copy; the sign-in panel note is
 * scoped the same way against the navbar's own "Sign in" link.
 */
const inRow = { selector: ".board__name" };
const inNote = { selector: ".panel__note" };

describe("the leaderboard page", () => {
  it("prints everybody, their chips and their figures", async () => {
    stubFetch({
      sort: "chips",
      total: 2,
      rows: [
        row("u1", "Ada", 900, { games: 4, wins: 3, chipsWon: 400, chipsStaked: 1200 }),
        row("u2", "Bram", 100),
      ],
      you: null,
    });
    render(
      <MemoryRouter>
        <Leaderboard />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Ada", inRow)).toBeTruthy();
    expect(screen.getByText("Bram", inRow)).toBeTruthy();
    // Three wins in four games, said as a rate rather than left to be worked out.
    expect(screen.getByText("75%")).toBeTruthy();
  });

  it("asks the server again when a column is pressed", async () => {
    const asked = stubFetch({ sort: "chips", total: 1, rows: [row("u1", "Ada", 900)], you: null });
    render(
      <MemoryRouter>
        <Leaderboard />
      </MemoryRouter>,
    );
    await screen.findByText("Ada", inRow);

    fireEvent.click(screen.getByRole("button", { name: /staked/i }));

    await waitFor(() => {
      expect(asked.some((url) => url.includes("sort=staked"))).toBe(true);
    });
  });

  it("pins you to the bottom when you are off the end of the board", async () => {
    stubFetch({
      sort: "chips",
      total: 340,
      rows: [row("u9", "Someone", 900)],
      you: { row: row("u1", "Ada", 5), rank: 340 },
    });
    render(
      <MemoryRouter>
        <Leaderboard />
      </MemoryRouter>,
    );

    expect(await screen.findByText("340")).toBeTruthy();
    expect(screen.getByText("Ada", inRow)).toBeTruthy();
  });

  it("never says a negative number are still to come", async () => {
    // `total` is estimated document count and can be stale under the exact
    // row count the page actually holds — here fewer rows than the estimate
    // says exist, which without a floor would print "…-1 more".
    stubFetch({
      sort: "chips",
      total: 1,
      rows: [row("u9", "Someone", 900), row("u8", "Other", 800)],
      you: { row: row("u1", "Ada", 5), rank: 340 },
    });
    render(
      <MemoryRouter>
        <Leaderboard />
      </MemoryRouter>,
    );

    expect(await screen.findByText("…0 more")).toBeTruthy();
  });

  it("keeps the full net and staked figures reachable when they are shortened", async () => {
    stubFetch({
      sort: "chips",
      total: 1,
      rows: [row("u1", "Ada", 900, { games: 4, wins: 3, chipsWon: 1_234_567, chipsStaked: 2_345_678 })],
      you: null,
    });
    render(
      <MemoryRouter>
        <Leaderboard />
      </MemoryRouter>,
    );

    await screen.findByText("Ada", inRow);
    expect(screen.getByText("+1.23M").getAttribute("title")).toBe("+1,234,567 chips");
    expect(screen.getByText("2.35M").getAttribute("title")).toBe("2,345,678 chips");
  });

  it("asks again on a clock, and shows the new order without being reloaded", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let answer = {
      sort: "chips",
      total: 2,
      rows: [row("u1", "Ada", 900), row("u2", "Bram", 100)],
      you: null,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("/api/leaderboard")) {
          return { ok: true, json: async () => answer };
        }
        return { ok: true, json: async () => ({ signedIn: false, signinAvailable: true }) };
      }),
    );

    render(
      <MemoryRouter>
        <Leaderboard />
      </MemoryRouter>,
    );
    await screen.findByText("Ada", inRow);

    answer = { ...answer, rows: [row("u2", "Bram", 5000), row("u1", "Ada", 900)] };
    await vi.advanceTimersByTimeAsync(10_000);

    await waitFor(() => {
      const names = screen.getAllByText(/Ada|Bram/).map((node) => node.textContent);
      expect(names[0]).toBe("Bram");
    });
  });

  it("says to sign in rather than showing an empty board", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/me") {
          return { ok: true, json: async () => ({ signedIn: false, signinAvailable: true }) };
        }
        return { ok: false, status: 401, json: async () => ({ error: "Sign in first." }) };
      }),
    );
    render(
      <MemoryRouter>
        <Leaderboard />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/sign in/i, inNote)).toBeTruthy();
  });
});
