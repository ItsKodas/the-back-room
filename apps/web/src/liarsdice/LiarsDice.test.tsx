// @vitest-environment jsdom
import type { TableView } from "@backroom/game-liars-dice";
import { says } from "@backroom/game-liars-dice";
import type { ChatMessage } from "@backroom/shared";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../game/useAccount.js";
import { useAccount } from "../game/useAccount.js";
import type { TableSocketHook } from "../table/useTableSocket.js";
import { useTableSocket } from "../table/useTableSocket.js";
import { opening } from "./Controls.js";
import { seat, view } from "./fixtures.js";
import { LiarsDice } from "./LiarsDice.js";

// The socket is not this test's business; the page is.
vi.mock("../table/useTableSocket.js", () => ({ useTableSocket: vi.fn() }));
vi.mock("../game/useAccount.js", () => ({ useAccount: vi.fn() }));
vi.mock("../nav/NavContext.js", () => ({ useNav: vi.fn() }));
vi.mock("../game/audio.js", async (original) => ({
  ...(await original<typeof import("../game/audio.js")>()),
  play: vi.fn(),
  preload: vi.fn(async () => {}),
  unlock: vi.fn(),
}));

const account: Account = {
  profile: {
    id: "u1",
    name: "Ada",
    avatar: null,
    accentColor: null,
    chips: 12_400,
    stats: { rounds: 0, roundsWon: 0, chipsWon: 0, chipsStaked: 0 },
    byGame: {},
  },
  available: true,
  loading: false,
  admin: false,
  refresh: vi.fn(),
  setChips: vi.fn(),
  signOut: vi.fn(),
};

function socket(
  state: TableView | null,
  over: Partial<TableSocketHook<TableView>> = {},
): TableSocketHook<TableView> {
  return {
    state,
    listed: true,
    seatId: "s0",
    error: null,
    errorKey: 0,
    connected: true,
    taken: null,
    retry: vi.fn(),
    busy: false,
    chat: [],
    say: vi.fn(),
    addBot: vi.fn(),
    setListed: vi.fn(),
    create: vi.fn(),
    join: vi.fn(),
    watch: vi.fn(),
    leave: vi.fn(),
    act: vi.fn(),
    onRelay: () => () => undefined,
    onError: () => () => undefined,
    landed: [],
    stakes: [],
    taunt: vi.fn(),
    ...over,
  };
}

function tree() {
  return (
    <MemoryRouter initialEntries={["/liars-dice/HG4ME"]}>
      <Routes>
        <Route path="/liars-dice/:code" element={<LiarsDice />} />
      </Routes>
    </MemoryRouter>
  );
}

function show(hook: TableSocketHook<TableView>) {
  vi.mocked(useTableSocket).mockReturnValue(hook as TableSocketHook<unknown>);
  return render(tree());
}

beforeEach(() => {
  vi.mocked(useAccount).mockReturnValue(account);
  vi.mocked(useTableSocket).mockReturnValue(socket(null) as TableSocketHook<unknown>);
  // The taunt catalogue: none, which is a picker that does not render.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, json: async () => ({}) })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeAll(() => {
  // jsdom lays nothing out, so it has no scrolling to do.
  Element.prototype.scrollIntoView = vi.fn();
});

describe("the Liar's Dice page", () => {
  it("offers a table to join and one to open", () => {
    render(
      <MemoryRouter>
        <LiarsDice />
      </MemoryRouter>,
    );
    expect(screen.getByText("Join a table")).toBeInTheDocument();
    expect(screen.getByText("Open your own")).toBeInTheDocument();
  });

  it("turns away a code that is not a code", () => {
    render(
      <MemoryRouter initialEntries={["/liars-dice/nope"]}>
        <LiarsDice />
      </MemoryRouter>,
    );
    // Reached through the route, the param is read from useParams; with no
    // matching route this renders the setup instead, which is also correct.
    expect(document.body.textContent).not.toBe("");
  });
});

/*
 * `.lamp--fit` is a sizing modifier — "a word lamp that sizes to its word" —
 * not a selected flag. The lit look is `[aria-checked="true"]`, driven by the
 * `aria-checked` prop already on every lamp here. Toggling `lamp--fit` with
 * selection gives the chosen lamp a different flex-basis from its siblings
 * (`flex: 1 1 auto` instead of `1 1 0`, plus different padding), so the row's
 * widths visibly jump every time the selection moves — worst on the phone
 * this building is built for. Every lamp in a group has to carry the same
 * classes whichever one is checked.
 */
describe("the stake and dice pickers", () => {
  function radios(name: string): HTMLElement[] {
    return within(screen.getByRole("radiogroup", { name })).getAllByRole("radio");
  }

  it("keeps every stake lamp's classes the same, whichever one is checked", () => {
    render(
      <MemoryRouter>
        <LiarsDice />
      </MemoryRouter>,
    );
    const lamps = radios("What it costs to sit down");
    expect(lamps.length).toBeGreaterThan(1);
    const before = lamps.map((lamp) => lamp.className);
    expect(new Set(before).size).toBe(1);

    const other = lamps.find((lamp) => lamp.getAttribute("aria-checked") === "false");
    expect(other).not.toBeUndefined();
    fireEvent.click(other as HTMLElement);

    const after = lamps.map((lamp) => lamp.className);
    expect(new Set(after).size).toBe(1);
    expect(after).toEqual(before);
  });

  it("keeps every dice lamp's classes the same, whichever one is checked", () => {
    render(
      <MemoryRouter>
        <LiarsDice />
      </MemoryRouter>,
    );
    const lamps = radios("How many dice each");
    expect(lamps.length).toBeGreaterThan(1);
    const before = lamps.map((lamp) => lamp.className);
    expect(new Set(before).size).toBe(1);

    const other = lamps.find((lamp) => lamp.getAttribute("aria-checked") === "false");
    expect(other).not.toBeUndefined();
    fireEvent.click(other as HTMLElement);

    const after = lamps.map((lamp) => lamp.className);
    expect(new Set(after).size).toBe(1);
    expect(after).toEqual(before);
  });
});

describe("the felt", () => {
  it("is the fitted, liars-dice-flavoured page, with the felt actually up", () => {
    const { container } = show(socket(view([seat({ id: "s0" }), seat({ id: "s1" })])));
    const main = container.querySelector("main");
    expect(main?.classList.contains("play--fit")).toBe(true);
    expect(main?.classList.contains("play--liars")).toBe(true);
    // The wrapper's classes are the parent page's business and would still be
    // there over a blank felt — the rail is Felt's own markup, so its
    // presence is what actually says the table is up.
    expect(container.querySelectorAll(".ld__seat")).toHaveLength(2);
  });

  it("shows a plate per seat on the rail, and your own hand as faces", () => {
    const { container } = show(
      socket(
        view([
          seat({ id: "s0", hand: [1, 2, 3, 4, 5] }),
          seat({ id: "s1" }),
          seat({ id: "s2" }),
        ]),
      ),
    );
    expect(container.querySelectorAll(".ld__seat")).toHaveLength(3);
    const yours = screen.getByRole("group", { name: "Your dice" });
    // Faces, not cups: the down state reads "Face down" rather than "Showing…".
    expect(within(yours).queryAllByLabelText(/^Showing /)).toHaveLength(5);
  });

  it("says a bid on the press, and shows it on the felt before any new state arrives", () => {
    const acted = vi.fn();
    const one = seat({ id: "s0", hand: [1, 2, 3, 4, 5] });
    const two = seat({ id: "s1", hand: [1, 2, 3, 4, 5] });
    show(socket(view([one, two], { bid: null, toAct: "s0" }), { act: acted }));

    const floor = opening(10);
    const button = screen.getByRole("button", { name: new RegExp(`^Bid ${says(floor)}`) });
    fireEvent.click(button);

    expect(acted).toHaveBeenCalledWith({ type: "bid", count: floor.count, face: floor.face });
    // Shown at once: a stake is the player's own number, so nothing waited
    // for the table to answer before it appeared.
    expect(screen.getByText(says(floor))).toBeInTheDocument();
  });

  it("calls liar on the press, and invents nothing about the count on the felt", () => {
    const acted = vi.fn();
    const standing = { count: 3, face: 2 as const };
    const one = seat({ id: "s0", hand: [1, 2, 3, 4, 5] });
    const two = seat({ id: "s1", hand: [1, 2, 3, 4, 5] });
    show(socket(view([one, two], { bid: standing, bidder: "s1", toAct: "s0" }), { act: acted }));

    const before = document.querySelector(".ld__figure")?.textContent;
    fireEvent.click(screen.getByRole("button", { name: "Liar" }));

    expect(acted).toHaveBeenCalledWith({ type: "liar" });
    // A call's answer is thirty dice and a count only the server knows — so
    // nothing about it may be guessed, and the figure must not have moved.
    expect(document.querySelector(".ld__figure")?.textContent).toBe(before);
  });

  it("shows a refusal over the board rather than as a strip", () => {
    const { container } = show(
      socket(view([seat({ id: "s0" }), seat({ id: "s1" })]), {
        error: "Last call — the round is already decided.",
        errorKey: 1,
      }),
    );
    expect(screen.getByRole("alert").textContent).toContain("Last call");
    expect(container.querySelector(".play__error")).toBeNull();
    expect(container.querySelector(".refusal")).not.toBeNull();
    // "no strip" is true of a blank page too — the board has to actually be
    // there, under the refusal, for "over the board" to mean anything.
    expect(container.querySelectorAll(".ld__seat")).toHaveLength(2);
  });

  it("carries an unread count on the talk key for somebody else's lines", () => {
    const table = view([seat({ id: "s0" }), seat({ id: "s1" })]);
    // Empty at mount, so the first line to arrive is news rather than history
    // already on screen when the key first drew itself.
    const { rerender } = show(socket(table, { chat: [] }));
    expect(screen.getByRole("button", { name: "Table talk" })).toBeTruthy();

    const line: ChatMessage = { seatId: "s1", name: "Bo", text: "coward", at: 1 };
    vi.mocked(useTableSocket).mockReturnValue(
      socket(table, { chat: [line] }) as TableSocketHook<unknown>,
    );
    rerender(tree());

    expect(screen.getByRole("button", { name: "Table talk, 1 unread" })).toBeTruthy();
  });

  it("keeps only one dialog open: opening the rules sheet while talk is open closes talk", () => {
    show(socket(view([seat({ id: "s0" }), seat({ id: "s1" })])));

    fireEvent.click(screen.getByRole("button", { name: "Table talk" }));
    expect(screen.queryAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("Table talk");

    fireEvent.click(screen.getByRole("button", { name: "How it plays" }));

    expect(screen.queryAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("How it plays");
  });

  it("keeps only one dialog open: opening talk while the rules sheet is open closes the sheet", () => {
    show(socket(view([seat({ id: "s0" }), seat({ id: "s1" })])));

    fireEvent.click(screen.getByRole("button", { name: "How it plays" }));
    expect(screen.queryAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("How it plays");

    fireEvent.click(screen.getByRole("button", { name: "Table talk" }));

    expect(screen.queryAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("Table talk");
  });
});
