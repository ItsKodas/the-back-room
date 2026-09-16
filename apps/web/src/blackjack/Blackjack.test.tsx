// @vitest-environment jsdom
import type { TableView } from "@backroom/game-blackjack";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../game/useAccount.js";
import { useAccount } from "../game/useAccount.js";
import { opensForFun } from "../table/TableSetup.js";
import type { TableSocketHook } from "../table/useTableSocket.js";
import { useTableSocket } from "../table/useTableSocket.js";
import { Blackjack } from "./Blackjack.js";
import { settledHand, theirTurn, view, yourTurn } from "./fixtures.js";

vi.mock("../table/useTableSocket.js", () => ({ useTableSocket: vi.fn() }));
vi.mock("../game/useAccount.js", () => ({ useAccount: vi.fn() }));
vi.mock("../nav/NavContext.js", () => ({ useNav: vi.fn() }));
vi.mock("../game/audio.js", async (original) => ({
  ...(await original<typeof import("../game/audio.js")>()),
  play: vi.fn(),
  preload: vi.fn(async () => {}),
  unlock: vi.fn(),
}));

/*
 * What a new table opens as.
 *
 * The bug this pins was invisible: the panel defaulted to play money for
 * everybody, because it decided at mount and the account had not come back
 * yet. A profile that has not arrived is indistinguishable from a guest, and
 * the host only found out when the table they had opened would not take a
 * chip.
 */
describe("what a new table plays for", () => {
  it("opens for chips once the account is known", () => {
    expect(opensForFun(null, false)).toBe(false);
  });

  it("opens for play money for somebody with no account", () => {
    expect(opensForFun(null, true)).toBe(true);
  });

  it("follows the account until the host picks, rather than freezing at mount", () => {
    // The whole bug in one line: guest is true while the profile is on its
    // way and false once it lands, and the default has to move with it.
    expect(opensForFun(null, true)).toBe(true);
    expect(opensForFun(null, false)).toBe(false);
  });

  it("keeps what the host picked, whatever the account says", () => {
    // Including a signed-in host deliberately opening a for-fun table, which
    // is the case a default that merely watched the account would undo.
    expect(opensForFun(true, false)).toBe(true);
    expect(opensForFun(false, false)).toBe(false);
    expect(opensForFun(true, true)).toBe(true);
  });
});

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

function socket(state: TableView | null, over: Partial<TableSocketHook<TableView>> = {}): TableSocketHook<TableView> {
  return {
    state,
    listed: true,
    seatId: "a",
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
    landed: [],
    stakes: [],
    taunt: vi.fn(),
    ...over,
  };
}

function tree() {
  return (
    <MemoryRouter initialEntries={["/blackjack/HG4ME"]}>
      <Routes>
        <Route path="/blackjack/:code" element={<Blackjack />} />
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

const slabs = (container: HTMLElement) => [...container.querySelectorAll<HTMLButtonElement>(".slab")];

describe("the table's one slab", () => {
  it("is Ready, lit, while betting", () => {
    const { container } = show(socket(view()));
    const [ready, ...more] = slabs(container);
    expect(more).toHaveLength(0);
    expect(ready?.disabled).toBe(false);
    expect(ready?.textContent).toMatch(/^Ready/);
  });

  it("is Hit, lit, on your turn", () => {
    const { container } = show(socket(yourTurn()));
    const [hit, ...more] = slabs(container);
    expect(more).toHaveLength(0);
    expect(hit?.disabled).toBe(false);
    expect(hit?.textContent).toMatch(/^Hit/);
  });

  it("is out, saying whose turn it is, while somebody else acts", () => {
    const { container } = show(socket(theirTurn()));
    const [turn, ...more] = slabs(container);
    expect(more).toHaveLength(0);
    expect(turn?.disabled).toBe(true);
    expect(turn?.textContent).toMatch(/^Bo's turn/);
  });

  it("is out, counting to the next hand, once the hand is over", () => {
    const { container } = show(socket(settledHand()));
    const [next, ...more] = slabs(container);
    expect(more).toHaveLength(0);
    expect(next?.disabled).toBe(true);
    expect(next?.textContent).toMatch(/^Next hand/);
  });

  it("is not there at all for somebody watching", () => {
    const { container } = show(socket(yourTurn(), { seatId: null }));
    expect(slabs(container)).toHaveLength(0);
  });
});

describe("the page at a table", () => {
  it("is the fitted page, with the felt scrolling inside itself", () => {
    const { container } = show(socket(view()));
    expect(container.querySelector("main")?.classList.contains("play--fit")).toBe(true);
    expect(container.querySelector(".bj__cloth.table-scroll")).not.toBeNull();
  });

  it("shows a refusal over the board rather than as a strip", () => {
    const { container } = show(socket(view(), { error: "Last call — you can only take chips back now.", errorKey: 1 }));
    expect(screen.getByRole("alert").textContent).toContain("Last call");
    expect(container.querySelector(".play__error")).toBeNull();
  });

  it("keeps what the table said in a log, and has no event strip", () => {
    const { container } = show(socket(view({ lastEvent: "Ada is ready", eventSeq: 3 })));
    expect(container.querySelector(".play__event")).toBeNull();
    expect(screen.getByRole("list", { name: "Activity" }).textContent).toContain("Ada is ready");
  });

  it("opens talk from a key on the felt, not an inline panel", () => {
    const { container } = show(socket(view()));
    expect(container.querySelector(".table-talk-corner .talk-key")).not.toBeNull();
    expect(container.querySelector(".play__talk")).toBeNull();
  });

  it("keeps the rules card within reach", () => {
    show(socket(yourTurn()));
    expect(screen.getByRole("button", { name: "How it pays" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "How it pays" }).textContent).toContain("Blackjack pays");
  });
});

describe("the host's Table key", () => {
  it("is there for the host", () => {
    show(socket(view({ hostId: "a" })));
    expect(screen.getByRole("button", { name: "Table" })).toBeTruthy();
  });

  it("is not there for anybody else", () => {
    show(socket(view({ hostId: "b" })));
    expect(screen.queryByRole("button", { name: "Table" })).toBeNull();
  });
});

describe("Ready lands on the press", () => {
  /*
   * A socket whose act never answers, standing in for a bad connection: the
   * round trip is long enough that a version showing only the table's own
   * word would sit on "Ready" for a whole frame's worth of somebody's evening.
   */
  it("says Waiting the moment Ready is pressed, before the table replies", () => {
    show(socket(view()));

    fireEvent.click(screen.getByRole("button", { name: /^Ready/ }));

    expect(screen.getByRole("button", { name: /^Waiting/ })).toBeTruthy();
  });

  it("takes the press back on a refusal", () => {
    const { rerender } = show(socket(view()));
    fireEvent.click(screen.getByRole("button", { name: /^Ready/ }));
    expect(screen.getByRole("button", { name: /^Waiting/ })).toBeTruthy();

    vi.mocked(useTableSocket).mockReturnValue(
      socket(view(), { error: "Last call — you can only take chips back now.", errorKey: 1 }) as TableSocketHook<unknown>,
    );
    rerender(tree());

    expect(screen.getByRole("button", { name: /^Ready/ })).toBeTruthy();
  });
});

describe("talk and a sheet", () => {
  it("keep only one dialog open: opening the rules card while talk is open closes talk", () => {
    show(socket(view()));
    fireEvent.click(screen.getByRole("button", { name: "Table talk" }));
    expect(screen.queryAllByRole("dialog")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "How it pays" }));

    expect(screen.queryAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("How it pays");
  });
});
