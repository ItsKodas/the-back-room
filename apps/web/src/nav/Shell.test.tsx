// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App.js";
import { useNav } from "./NavContext.js";
import { Shell } from "./Shell.js";

const ADA = {
  id: "u1",
  name: "Ada",
  avatar: null,
  accentColor: null,
  chips: 65_200,
  stats: { rounds: 0, roundsWon: 0, chipsWon: 0, chipsStaked: 0 },
  byGame: {},
};

function stubFetch() {
  const fetch = vi.fn(async (url: string) => {
    if (url === "/api/me") {
      return { ok: true, json: async () => ({ signedIn: true, signinAvailable: true, profile: ADA }) };
    }
    return { ok: false, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetch);
  return () => fetch.mock.calls.filter(([url]) => url === "/api/me").length;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset["game"];
});

describe("the bar between pages", () => {
  it("is the same bar after walking from the room to your profile", async () => {
    stubFetch();
    const { container } = render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    const pill = await screen.findByTitle("Your profile");
    const bar = container.querySelector("header.nav");

    fireEvent.click(pill);

    /*
     * Checked in the same tick as the click. A page that drew its own bar
     * built a new one here with no account yet, so the pill was gone until
     * /api/me had been asked all over again.
     */
    expect(container.querySelector("header.nav")).toBe(bar);
    expect(screen.getByTitle("Your profile")).toBe(pill);
  });
});

function Game() {
  const navigate = useNavigate();
  useNav({ room: "blackjack", game: "Blackjack" });
  return (
    <main className="play">
      <button type="button" onClick={() => navigate("/game/ABCDE", { replace: true })}>
        sit
      </button>
      <Link to="/">out</Link>
    </main>
  );
}

function Lobby() {
  return (
    <main className="room">
      <Link to="/game">in</Link>
    </main>
  );
}

function showShell(at: string) {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<Lobby />} />
          <Route path="/game" element={<Game />} />
          <Route path="/game/:code" element={<Game />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("what a page puts on the bar", () => {
  it("names the game and paints its room, and takes both away on the way out", async () => {
    stubFetch();
    showShell("/");
    expect(document.querySelector(".nav__game")).toBeNull();

    fireEvent.click(screen.getByText("in"));
    expect(document.querySelector(".nav__game")?.textContent).toBe("Blackjack");
    expect(document.documentElement.dataset["game"]).toBe("blackjack");

    fireEvent.click(screen.getByText("out"));
    expect(document.querySelector(".nav__game")).toBeNull();
    expect(document.documentElement.dataset["game"]).toBeUndefined();
    await act(async () => {});
  });

  it("asks who you are again in another part of the building, not when a table rewrites its address", async () => {
    const asked = stubFetch();
    showShell("/game");
    await act(async () => {});
    const before = asked();

    fireEvent.click(screen.getByText("sit"));
    await act(async () => {});
    expect(asked()).toBe(before);

    fireEvent.click(screen.getByText("out"));
    await act(async () => {});
    expect(asked()).toBe(before + 1);
  });
});
