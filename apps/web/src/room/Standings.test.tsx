// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RAIL_PLACES, Standings } from "./Standings.js";

afterEach(() => vi.unstubAllGlobals());

describe("who's ahead, from the front door", () => {
  it("shows the top three and your own place", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          sort: "chips",
          total: 40,
          rows: [
            {
              id: "a",
              name: "Ada",
              avatar: null,
              accentColor: null,
              chips: 900,
              stats: { rounds: 0, roundsWon: 0, chipsWon: 0, chipsStaked: 0 },
            },
            {
              id: "b",
              name: "Bram",
              avatar: null,
              accentColor: null,
              chips: 500,
              stats: { rounds: 0, roundsWon: 0, chipsWon: 0, chipsStaked: 0 },
            },
            {
              id: "c",
              name: "Cyd",
              avatar: null,
              accentColor: null,
              chips: 100,
              stats: { rounds: 0, roundsWon: 0, chipsWon: 0, chipsStaked: 0 },
            },
          ],
          you: {
            row: {
              id: "z",
              name: "You",
              avatar: null,
              accentColor: null,
              chips: 5,
              stats: { rounds: 0, roundsWon: 0, chipsWon: 0, chipsStaked: 0 },
            },
            rank: 12,
          },
        }),
      })),
    );

    const { container } = render(
      <MemoryRouter>
        <Standings />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Ada")).toBeTruthy();
    expect(container.querySelector(".standings__you")?.textContent).toBe("You are 12 of 40");
    expect(screen.getByRole("link").getAttribute("href")).toBe("/leaderboard");
    // Not in the list, so pinned under it at your real place rather than left off.
    const below = container.querySelector(".standings__below .standings__place--you");
    expect(below?.querySelector("b")?.textContent).toBe("12");
    expect(below?.textContent).toContain("You");
  });

  it("lists no more than the rail holds, and does not pin you twice when you are in it", async () => {
    const rows = Array.from({ length: 40 }, (_, index) => ({
      id: `p${index}`,
      name: `Player ${index}`,
      avatar: null,
      accentColor: null,
      chips: 10_000 - index,
      stats: { rounds: 0, roundsWon: 0, chipsWon: 0, chipsStaked: 0 },
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ sort: "chips", total: 40, rows, you: { row: rows[3], rank: 4 } }),
      })),
    );

    const { container } = render(
      <MemoryRouter>
        <Standings />
      </MemoryRouter>,
    );

    await screen.findByText("Player 0");
    expect(container.querySelectorAll(".standings__place")).toHaveLength(RAIL_PLACES);
    expect(container.querySelector(".standings__below")).toBeNull();
    expect(container.querySelectorAll(".standings__place--you")).toHaveLength(1);
  });

  it("still points at the board when nobody is signed in", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
    render(
      <MemoryRouter>
        <Standings />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/sign in/i)).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toBe("/leaderboard");
  });

  it("ranks the places the way the board does, ties and all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          sort: "chips",
          total: 4,
          rows: [
            {
              id: "a",
              name: "Ada",
              avatar: null,
              accentColor: null,
              chips: 900_000,
              stats: { rounds: 0, roundsWon: 0, chipsWon: 0, chipsStaked: 0 },
            },
            {
              id: "b",
              name: "Bram",
              avatar: null,
              accentColor: null,
              chips: 500_000,
              stats: { rounds: 0, roundsWon: 0, chipsWon: 0, chipsStaked: 0 },
            },
            {
              id: "c",
              name: "Cyd",
              avatar: null,
              accentColor: null,
              chips: 500_000,
              stats: { rounds: 0, roundsWon: 0, chipsWon: 0, chipsStaked: 0 },
            },
            {
              id: "d",
              name: "Dan",
              avatar: null,
              accentColor: null,
              chips: 100_000,
              stats: { rounds: 0, roundsWon: 0, chipsWon: 0, chipsStaked: 0 },
            },
          ],
          you: null,
        }),
      })),
    );

    const { container } = render(
      <MemoryRouter>
        <Standings />
      </MemoryRouter>,
    );

    await screen.findByText("Ada");
    // Bram and Cyd are tied on chips: the board gives them both rank 2, so
    // the front door has to agree rather than counting list position.
    const ranks = Array.from(container.querySelectorAll(".standings__place b")).map((b) => b.textContent);
    expect(ranks).toEqual(["1", "2", "2", "4"]);
  });

  it("says nothing about being signed out while the first answer is still on its way", () => {
    // A fetch that never resolves during the assertions below: this is the
    // window a slow connection sits in before the server has said anything.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );

    render(
      <MemoryRouter>
        <Standings />
      </MemoryRouter>,
    );

    expect(screen.queryByText(/sign in/i)).toBeNull();
    expect(screen.getByRole("link").getAttribute("href")).toBe("/leaderboard");
  });

  it("says it is still asking rather than leaving an empty card on the first load", () => {
    // Same never-resolving fetch as above: this is the state a first load sits
    // in before anything is known, and it must say something rather than
    // render an empty bordered box under the "Who's ahead" heading.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );

    render(
      <MemoryRouter>
        <Standings />
      </MemoryRouter>,
    );

    // The card carries its own heading now, so non-empty text alone would pass
    // with nothing under it; the wait has to be said in words.
    expect(screen.getByText("Counting.")).toBeTruthy();
  });

  it("cannot say a total smaller than your own rank", async () => {
    // `total` is estimated and can lag the exact rank computed for `you`; the
    // reader's own standing must never contradict itself like "12 of 8".
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          sort: "chips",
          total: 8,
          rows: [
            {
              id: "a",
              name: "Ada",
              avatar: null,
              accentColor: null,
              chips: 900,
              stats: { rounds: 0, roundsWon: 0, chipsWon: 0, chipsStaked: 0 },
            },
          ],
          you: {
            row: {
              id: "z",
              name: "You",
              avatar: null,
              accentColor: null,
              chips: 5,
              stats: { rounds: 0, roundsWon: 0, chipsWon: 0, chipsStaked: 0 },
            },
            rank: 12,
          },
        }),
      })),
    );

    const { container } = render(
      <MemoryRouter>
        <Standings />
      </MemoryRouter>,
    );

    await screen.findByText("Ada");
    expect(container.querySelector(".standings__you")?.textContent).toBe("You are 12 of 12");
  });
});
