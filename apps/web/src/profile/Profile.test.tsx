// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../game/useAccount.js";

const account = vi.hoisted(() => ({ current: null as Account | null }));
vi.mock("../game/useAccount.js", () => ({ useAccount: () => account.current }));

import { Profile } from "./Profile.js";

function signedIn(overrides: Partial<Account["profile"]> = {}): Account {
  return {
    profile: {
      id: "u1",
      name: "Koda",
      avatar: null,
      accentColor: null,
      chips: 10_000,
      stats: { rounds: 47, roundsWon: 19, chipsWon: 4200 },
      byGame: {
        greed: { bestTurn: 3050, farkles: 62, hotDice: 11 },
        blackjack: { busts: 3 },
      },
      ...overrides,
    },
    available: true,
    loading: false,
    refresh: () => {},
    signOut: () => {},
  } as Account;
}

function show(state: Account) {
  account.current = state;
  return render(
    <MemoryRouter>
      <Profile />
    </MemoryRouter>,
  );
}

afterEach(() => {
  account.current = null;
});

describe("a player's page", () => {
  it("asks a guest to sign in rather than showing them an empty one", () => {
    show({ ...signedIn(), profile: null });
    expect(screen.getByText(/sign in to keep a balance/i)).toBeDefined();
  });

  it("shows the four figures every game can answer", () => {
    show(signedIn());
    expect(screen.getByText("games played")).toBeDefined();
    expect(screen.getByText("won")).toBeDefined();
    expect(screen.getByText("chips won")).toBeDefined();
    // 19 of 47, rounded.
    expect(screen.getByText("40%")).toBeDefined();
  });

  it("keeps each game's own words under that game", () => {
    show(signedIn());
    /*
     * The whole point of the split: "best turn" and "farkles" are Greed's
     * words and blackjack has no answer for them, so they must not appear
     * among the figures that belong to the player.
     */
    const greed = screen.getByText("Greed").closest(".housing") as HTMLElement;
    expect(within(greed).getByText("best turn")).toBeDefined();
    expect(within(greed).getByText("farkles")).toBeDefined();

    const blackjack = screen.getByText("Blackjack").closest(".housing") as HTMLElement;
    expect(within(blackjack).getByText("busts")).toBeDefined();
    expect(within(blackjack).queryByText("farkles")).toBeNull();
  });

  it("falls back to a game's own key when nobody has named the figure", () => {
    // A new game can start recording figures before anyone writes them a label.
    show(signedIn({ byGame: { roulette: { nearMisses: 4 } } }));
    expect(screen.getByText("nearMisses")).toBeDefined();
    expect(screen.getByText("roulette")).toBeDefined();
  });

  it("shows the balance in the colour reserved for money", () => {
    const { container } = show(signedIn());
    const purse = container.querySelector(".purse__count");
    expect(purse?.textContent).toBe("10,000");
  });

  it("sends you to the jar instead of offering a top-up", () => {
    show(signedIn());
    expect(screen.queryByRole("button", { name: /claim daily/i })).toBeNull();
    const link = screen.getByRole("link", { name: /jar/i });
    expect(link.getAttribute("href")).toBe("/tips");
  });
});
