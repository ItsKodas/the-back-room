// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { play } from "../game/audio.js";
import type { Account } from "../game/useAccount.js";
import { Navbar } from "./Navbar.js";

vi.mock("../game/audio.js", async (original) => ({
  ...(await original<typeof import("../game/audio.js")>()),
  play: vi.fn(),
  unlock: vi.fn(),
}));

afterEach(cleanup);

function account(admin: boolean): Account {
  return {
    profile: {
      id: "u1",
      name: "Ada",
      avatar: null,
      accentColor: null,
      chips: 65_200,
      stats: { rounds: 0, roundsWon: 0, chipsWon: 0, chipsStaked: 0 },
      byGame: {},
    },
    available: true,
    loading: false,
    admin,
    refresh: () => {},
    setChips: () => {},
    signOut: () => {},
  };
}

function show(admin: boolean) {
  render(
    <MemoryRouter>
      <Navbar account={account(admin)} />
    </MemoryRouter>,
  );
}

describe("the way to the admin desk", () => {
  it("is on the bar for an admin, and leads to the desk", () => {
    show(true);
    expect(screen.getByRole("link", { name: "Admin desk" }).getAttribute("href")).toBe("/admin");
  });

  it("is not there for anybody else", () => {
    show(false);
    expect(screen.queryByRole("link", { name: "Admin desk" })).toBeNull();
  });
});

describe("the sign, as the way home", () => {
  beforeEach(() => {
    vi.mocked(play).mockClear();
  });

  function at(path: string) {
    render(
      <MemoryRouter initialEntries={[path]}>
        <Navbar account={account(false)} />
      </MemoryRouter>,
    );
    return screen.getByRole("link", { name: "The Back Room" });
  }

  it("sounds the door shutting behind you when you leave a game for the room", () => {
    fireEvent.click(at("/greed"));
    expect(vi.mocked(play).mock.calls).toEqual([["close"]]);
  });

  it("says nothing when you are already in the room", () => {
    // Nothing shut: the page did not go anywhere.
    fireEvent.click(at("/"));
    expect(play).not.toHaveBeenCalled();
  });
});
