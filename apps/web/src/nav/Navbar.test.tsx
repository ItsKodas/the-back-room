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

describe("the menu on a phone", () => {
  beforeEach(() => {
    vi.mocked(play).mockClear();
  });

  function bar(props: Partial<Parameters<typeof Navbar>[0]> = {}) {
    return render(
      <MemoryRouter>
        <Navbar account={account(false)} {...props} />
      </MemoryRouter>,
    );
  }

  it("opens from the chips and says so", () => {
    const { container } = bar();
    const trigger = screen.getByRole("button", { name: "Menu" });
    const menu = container.querySelector(".nav__menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(menu?.hasAttribute("data-open")).toBe(false);

    fireEvent.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(menu?.hasAttribute("data-open")).toBe(true);
    expect(vi.mocked(play).mock.calls).toEqual([["open"]]);
  });

  it("shuts on Escape, handing focus back, and on a press anywhere else", () => {
    bar();
    const trigger = screen.getByRole("button", { name: "Menu" });

    fireEvent.click(trigger);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("stays open for a press inside it", () => {
    bar();
    const trigger = screen.getByRole("button", { name: "Menu" });
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole("group", { name: "Sound" }));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("holds the table's code and way out, the desk and the sound, not the bar", () => {
    const { container } = render(
      <MemoryRouter>
        <Navbar account={account(true)} table={{ code: "ABCDE", onLeave: () => {} }} />
      </MemoryRouter>,
    );
    const menu = container.querySelector(".nav__menu");
    expect(menu?.contains(screen.getByRole("button", { name: "Leave table" }))).toBe(true);
    expect(menu?.contains(screen.getByRole("link", { name: "Admin desk" }))).toBe(true);
    expect(menu?.contains(screen.getByRole("group", { name: "Sound" }))).toBe(true);
    // The light is not in the menu: it is the bar's far corner.
    expect(menu?.querySelector(".nav__link")).toBeNull();
  });
});

describe("the connection light", () => {
  it("says the table cannot hear you with colour, not a word on the bar", () => {
    render(
      <MemoryRouter>
        <Navbar account={account(false)} connected={false} />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/offline/i)).toBeNull();
    expect(screen.getByRole("img", { name: "Offline" })).toBeTruthy();
  });
});

describe("signing in, for a guest", () => {
  function guest(available: boolean) {
    render(
      <MemoryRouter>
        <Navbar account={{ ...account(false), profile: null, available }} />
      </MemoryRouter>,
    );
  }

  it("is a key that leads to Discord", () => {
    guest(true);
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/auth/discord");
  });

  it("is still a key where the server cannot sign anybody in, only one that is down", () => {
    guest(false);
    const key = screen.getByRole("button", { name: "Sign in" });
    expect(key).toHaveProperty("disabled", true);
    expect(key.getAttribute("title")).toBe("Sign-in is not set up on this server");
    expect(screen.queryByText(/playing as a guest/i)).toBeNull();
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
