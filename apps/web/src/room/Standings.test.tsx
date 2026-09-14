// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Standings } from "./Standings.js";

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
              stats: { games: 0, wins: 0, chipsWon: 0, chipsStaked: 0 },
            },
            {
              id: "b",
              name: "Bram",
              avatar: null,
              accentColor: null,
              chips: 500,
              stats: { games: 0, wins: 0, chipsWon: 0, chipsStaked: 0 },
            },
            {
              id: "c",
              name: "Cyd",
              avatar: null,
              accentColor: null,
              chips: 100,
              stats: { games: 0, wins: 0, chipsWon: 0, chipsStaked: 0 },
            },
          ],
          you: {
            row: {
              id: "z",
              name: "You",
              avatar: null,
              accentColor: null,
              chips: 5,
              stats: { games: 0, wins: 0, chipsWon: 0, chipsStaked: 0 },
            },
            rank: 12,
          },
        }),
      })),
    );

    render(
      <MemoryRouter>
        <Standings />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Ada")).toBeTruthy();
    expect(screen.getByText(/12/)).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toBe("/leaderboard");
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

  it("ranks the top three the way the board does, ties and all", async () => {
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
              stats: { games: 0, wins: 0, chipsWon: 0, chipsStaked: 0 },
            },
            {
              id: "b",
              name: "Bram",
              avatar: null,
              accentColor: null,
              chips: 500_000,
              stats: { games: 0, wins: 0, chipsWon: 0, chipsStaked: 0 },
            },
            {
              id: "c",
              name: "Cyd",
              avatar: null,
              accentColor: null,
              chips: 500_000,
              stats: { games: 0, wins: 0, chipsWon: 0, chipsStaked: 0 },
            },
            {
              id: "d",
              name: "Dan",
              avatar: null,
              accentColor: null,
              chips: 100_000,
              stats: { games: 0, wins: 0, chipsWon: 0, chipsStaked: 0 },
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
    expect(ranks).toEqual(["1", "2", "2"]);
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

    expect(screen.getByRole("link").textContent?.trim()).not.toBe("");
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
              stats: { games: 0, wins: 0, chipsWon: 0, chipsStaked: 0 },
            },
          ],
          you: {
            row: {
              id: "z",
              name: "You",
              avatar: null,
              accentColor: null,
              chips: 5,
              stats: { games: 0, wins: 0, chipsWon: 0, chipsStaked: 0 },
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
