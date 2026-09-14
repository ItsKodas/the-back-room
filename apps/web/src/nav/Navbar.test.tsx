// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { Account } from "../game/useAccount.js";
import { Navbar } from "./Navbar.js";

afterEach(cleanup);

function account(admin: boolean): Account {
  return {
    profile: {
      id: "u1",
      name: "Ada",
      avatar: null,
      accentColor: null,
      chips: 65_200,
      stats: { games: 0, wins: 0, chipsWon: 0 },
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
