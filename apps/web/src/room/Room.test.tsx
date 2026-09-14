// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Room } from "./Room.js";

const GAMES = [
  {
    id: "greed",
    name: "Greed",
    blurb: "Six dice, bank it or lose it.",
    shape: "table",
    open: true,
    tables: 2,
    seated: 4,
    watching: 0,
  },
  {
    id: "slots",
    name: "Slots",
    blurb: "Five reels, nine lines.",
    shape: "machine",
    open: true,
    tables: 1,
    seated: 1,
    watching: 0,
  },
  {
    id: "tips",
    name: "The Tip Jar",
    blurb: "Nothing to lose.",
    shape: "bar",
    open: true,
    tables: 1,
    seated: 1,
    watching: 0,
  },
  {
    id: "taunts",
    name: "Taunts",
    blurb: "Not about money at all.",
    shape: "party",
    open: true,
    tables: 1,
    seated: 2,
    watching: 0,
  },
];

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/room") {
        return { ok: true, json: async () => ({ games: GAMES }) };
      }
      if (url === "/api/me") {
        return { ok: true, json: async () => ({ signedIn: false, signinAvailable: false }) };
      }
      return { ok: false, json: async () => ({}) };
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function show() {
  return render(
    <MemoryRouter>
      <Room />
    </MemoryRouter>,
  );
}

describe("the room's groups", () => {
  it("keeps the games you sit at in order: tables, machines, then the back", async () => {
    stubFetch();
    show();

    await waitFor(() => {
      expect(screen.getByText("In the back")).toBeTruthy();
    });

    const labels = screen.getAllByText(/^(At the tables|Against the wall|In the back)$/);
    expect(labels.map((node) => node.textContent)).toEqual([
      "At the tables",
      "Against the wall",
      "In the back",
    ]);
  });

  it("puts the board and the bar in a strip above the tables, not in a section of their own", async () => {
    stubFetch();
    const { container } = show();

    const jar = await screen.findByRole("link", { name: /The Tip Jar/ });
    const front = container.querySelector(".room__front");
    expect(front?.contains(jar)).toBe(true);
    expect(front?.querySelector(".standings")).toBeTruthy();
    // A tile or a cabinet is a game you sit down at; the jar is neither.
    expect(jar.classList.contains("cabinet")).toBe(false);

    const tables = screen.getByText("At the tables");
    expect(front?.compareDocumentPosition(tables)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
