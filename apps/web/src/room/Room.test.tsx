// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { play } from "../game/audio.js";
import { Room } from "./Room.js";

vi.mock("../game/audio.js", async (original) => ({
  ...(await original<typeof import("../game/audio.js")>()),
  play: vi.fn(),
  unlock: vi.fn(),
}));

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
  it("keeps the groups in order: the bar, the tables, then the back", async () => {
    stubFetch();
    show();

    await waitFor(() => {
      expect(screen.getByText("In the back")).toBeTruthy();
    });

    const labels = screen.getAllByText(/^(At the bar|At the tables|In the back)$/);
    expect(labels.map((node) => node.textContent)).toEqual(["At the bar", "At the tables", "In the back"]);
  });

  it("puts the machine and the jar together above the tables", async () => {
    stubFetch();
    const { container } = show();

    const jar = await screen.findByRole("link", { name: /The Tip Jar/ });
    const slots = screen.getByRole("link", { name: /Slots/ });
    const wall = container.querySelector(".room__wall");
    expect(wall?.contains(jar)).toBe(true);
    expect(wall?.contains(slots)).toBe(true);

    const tables = screen.getByText("At the tables");
    expect(wall?.compareDocumentPosition(tables)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("keeps the board in the right-hand rail and the floor in the left", () => {
    stubFetch();
    const { container } = show();

    expect(container.querySelector(".rail--right .standings")).toBeTruthy();
    expect(container.querySelector(".rail--left .floor-activity")).toBeTruthy();
    expect(container.querySelector(".room .standings")).toBeNull();
  });
});

describe("walking into a game", () => {
  beforeEach(() => {
    vi.mocked(play).mockClear();
  });

  it("sounds the door opening from every kind of card", async () => {
    stubFetch();
    show();

    for (const name of [/Greed/, /Slots/, /The Tip Jar/, /Taunts/]) {
      vi.mocked(play).mockClear();
      fireEvent.click(await screen.findByRole("link", { name }));
      expect(vi.mocked(play).mock.calls).toEqual([["open"]]);
    }
  });

  it("stays quiet when the click opens a new tab instead of walking in", async () => {
    stubFetch();
    show();
    fireEvent.click(await screen.findByRole("link", { name: /Greed/ }), { ctrlKey: true });
    expect(play).not.toHaveBeenCalled();
  });
});
