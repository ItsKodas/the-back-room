// @vitest-environment jsdom
import type { SeatView, TableView } from "@backroom/game-poker";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../game/useAccount.js";
import { useAccount } from "../game/useAccount.js";
import type { TableSocketHook } from "../table/useTableSocket.js";
import { useTableSocket } from "../table/useTableSocket.js";
import { Felt } from "./Felt.js";
import { Poker } from "./Poker.js";
import { account as accountFixture, seat, stub, view } from "./fixtures.js";

/** The one account every bare `<Felt>` render below reads its balance from. */
const ACCOUNT = accountFixture();

vi.mock("../table/useTableSocket.js", () => ({ useTableSocket: vi.fn() }));
vi.mock("../game/useAccount.js", () => ({ useAccount: vi.fn() }));
vi.mock("../nav/NavContext.js", () => ({ useNav: vi.fn() }));
vi.mock("../game/audio.js", async (original) => ({
  ...(await original<typeof import("../game/audio.js")>()),
  play: vi.fn(),
  preload: vi.fn(async () => {}),
  unlock: vi.fn(),
}));

/**
 * The felt, given a table.
 *
 * These render the real components against a real view rather than checking
 * pieces of arithmetic, because the mistakes worth catching here are the ones
 * that only exist once the two are put together: a felt reading a field the
 * view does not have, somebody else's cards arriving face up, or a control
 * offered to a seat that is not allowed to press it.
 */

/*
 * The end of a hand, on screen.
 *
 * A number changing in two places says who won and says it to nobody who was
 * not already looking at both. These are the three things that say it out
 * loud: the pot travelling to the seat, the seat lighting up, and a line in
 * the middle naming them.
 */
describe("when the pot is won", () => {
  const ended = (paid: TableView["paid"], seats: SeatView[]) =>
    view({ street: "showdown", pot: 0, paid, paidAt: 1_700_000_000_000, seats });

  it("says who won, how much, and with what", () => {
    const table = stub();
    const mine = seat({ id: "s1", name: "Ada" });
    const { container } = render(
      <Felt
        table={table}
        seatId="s1"
        state={ended(
          [{ pot: 0, seatId: "s1", name: "Ada", chips: 1_240, said: "aces and kings" }],
          [mine, seat({ id: "s2", name: "Bram" })],
        )}
        account={ACCOUNT}
      />,
    );

    // Scoped to the announcement: the winner's name is also on their seat, and
    // it being in both places is the point rather than a duplicate.
    const said = container.querySelector(".pk__won")?.textContent ?? "";
    expect(said).toContain("Ada");
    expect(said).toContain("wins 1,240");
    expect(said).toContain("aces and kings");
  });

  it("pushes one heap of chips per winner, and lands each on its own seat", () => {
    /*
     * A split pot is two heaps going two ways, which is the clearest way to
     * say a pot was split — one heap arriving somewhere in the middle of two
     * seats would say nothing.
     */
    const table = stub();
    const { container } = render(
      <Felt
        table={table}
        seatId="s1"
        state={ended(
          [
            { pot: 0, seatId: "s1", name: "Ada", chips: 600, said: "a straight" },
            { pot: 0, seatId: "s2", name: "Bram", chips: 600, said: "a straight" },
          ],
          [seat({ id: "s1", name: "Ada" }), seat({ id: "s2", name: "Bram" })],
        )}
        account={ACCOUNT}
      />,
    );

    const sweeps = [...container.querySelectorAll(".pk__sweep")];
    expect(sweeps).toHaveLength(2);
    // Each is aimed somewhere different, which is what makes it a split.
    const aims = sweeps.map((one) => (one as HTMLElement).style.getPropertyValue("--seat"));
    expect(new Set(aims).size).toBe(2);
  });

  it("pushes nothing while a hand is still being played", () => {
    const table = stub();
    const { container } = render(
      <Felt
        table={table}
        seatId="s1"
        state={view({ street: "flop", seats: [seat({ id: "s1", name: "Ada" })] })}
        account={ACCOUNT}
      />,
    );
    expect(container.querySelectorAll(".pk__sweep")).toHaveLength(0);
    expect(container.querySelector(".pk__won")).toBeNull();
  });

  it("marks the seat that took it", () => {
    const table = stub();
    const { container } = render(
      <Felt
        table={table}
        seatId="s2"
        state={ended(
          [{ pot: 0, seatId: "s1", name: "Ada", chips: 400, said: null }],
          [seat({ id: "s1", name: "Ada" }), seat({ id: "s2", name: "Bram" })],
        )}
        account={ACCOUNT}
      />,
    );
    const won = container.querySelectorAll(".pk__seat--won");
    expect(won).toHaveLength(1);
    expect(won[0]?.querySelector(".pk__name")?.textContent).toBe("Ada");
  });

  it("aims nothing at a winner who has already left the table", () => {
    // The payout names a seat; the seat may be gone by the time it is drawn.
    const table = stub();
    const { container } = render(
      <Felt
        table={table}
        seatId="s2"
        state={ended(
          [{ pot: 0, seatId: "gone", name: "Ada", chips: 400, said: null }],
          [seat({ id: "s2", name: "Bram" })],
        )}
        account={ACCOUNT}
      />,
    );
    expect(container.querySelectorAll(".pk__sweep")).toHaveLength(0);
    // Still said out loud, though — somebody won it.
    expect(screen.getByText("wins 400")).toBeTruthy();
  });
});

/*
 * Chips moving, which is most of what a table does.
 *
 * A stake is pushed out from the person who put it up and the street's stakes
 * are swept into the middle — both are things that happen, and a number
 * appearing where there was not one before says neither of them.
 */
describe("chips going in and out", () => {
  it("draws a stake for each seat that has one out", () => {
    const table = stub();
    const { container } = render(
      <Felt
        table={table}
        seatId="s1"
        state={view({
          street: "flop",
          seats: [
            seat({ id: "s1", name: "Ada", committed: 100 }),
            seat({ id: "s2", name: "Bram", committed: 250 }),
            seat({ id: "s3", name: "Cass" }),
          ],
        })}
        account={ACCOUNT}
      />,
    );
    // Two out, one with nothing in front of them.
    expect(container.querySelectorAll(".pk__bet")).toHaveLength(2);
  });

  it("makes a stake that grows a new element, so it is pushed out again", () => {
    /*
     * Keyed on the amount as well as the seat. Without that a raise is a number
     * changing in place, which is the one thing this is here to stop.
     */
    const table = stub();
    const at = (chips: number) =>
      view({ street: "flop", seats: [seat({ id: "s1", name: "Ada", committed: chips })] });

    const shown = render(<Felt table={table} seatId="s1" state={at(100)} account={ACCOUNT} />);
    const first = shown.container.querySelector(".pk__bet");
    shown.rerender(<Felt table={table} seatId="s1" state={at(300)} account={ACCOUNT} />);
    const second = shown.container.querySelector(".pk__bet");

    expect(second).not.toBe(first);
    expect(second?.textContent).toContain("300");
  });

  it("draws the street's stakes going in, one from each seat that had one", () => {
    const table = stub();
    const { container } = render(
      <Felt
        table={table}
        seatId="s1"
        state={view({
          street: "turn",
          sweptAt: 1_700_000_000_000,
          swept: [
            { pot: 0, seatId: "s1", chips: 100 },
            { pot: 0, seatId: "s2", chips: 100 },
          ],
          seats: [seat({ id: "s1", name: "Ada" }), seat({ id: "s2", name: "Bram" })],
        })}
        account={ACCOUNT}
      />,
    );
    expect(container.querySelectorAll(".pk__gather")).toHaveLength(2);
  });

  it("gathers nothing from a seat that has since left", () => {
    const table = stub();
    const { container } = render(
      <Felt
        table={table}
        seatId="s1"
        state={view({
          street: "turn",
          sweptAt: 1_700_000_000_000,
          swept: [{ pot: 0, seatId: "gone", chips: 100 }],
          seats: [seat({ id: "s1", name: "Ada" })],
        })}
        account={ACCOUNT}
      />,
    );
    expect(container.querySelectorAll(".pk__gather")).toHaveLength(0);
  });
});

/*
 * Announcing a hand with side pots.
 *
 * A side pot is a separate thing won by separate people for separate reasons.
 * Said all at once, the main pot's winner and a short stack's consolation get
 * the same breath; said one at a time, everybody who won something gets the
 * felt to themselves for a moment.
 */
describe("one winner at a time", () => {
  const twoPots = () =>
    view({
      street: "showdown",
      pot: 0,
      paidAt: 1_700_000_000_000,
      paid: [
        { pot: 0, seatId: "s1", name: "Ada", chips: 900, said: "a flush" },
        { pot: 1, seatId: "s2", name: "Bram", chips: 300, said: "two pair" },
      ],
      seats: [seat({ id: "s1", name: "Ada" }), seat({ id: "s2", name: "Bram" })],
    });

  it("announces the main pot first, and only the main pot", () => {
    const table = stub();
    const { container } = render(<Felt table={table} seatId="s1" state={twoPots()} account={ACCOUNT} />);

    const said = container.querySelector(".pk__won")?.textContent ?? "";
    expect(said).toContain("Ada");
    expect(said).not.toContain("Bram");
    // And only that pot's chips are travelling.
    expect(container.querySelectorAll(".pk__sweep")).toHaveLength(1);
  });

  it("gives the moment to one seat at a time", () => {
    const table = stub();
    const { container } = render(<Felt table={table} seatId="s1" state={twoPots()} account={ACCOUNT} />);
    const lit = [...container.querySelectorAll(".pk__seat--spotlit")];
    expect(lit).toHaveLength(1);
    expect(lit[0]?.querySelector(".pk__name")?.textContent).toBe("Ada");
  });

  it("moves on to the side pot on its own clock", async () => {
    vi.useFakeTimers();
    try {
      const table = stub();
      const { container } = render(<Felt table={table} seatId="s1" state={twoPots()} account={ACCOUNT} />);
      expect(container.querySelector(".pk__won")?.textContent).toContain("Ada");

      await act(async () => {
        vi.advanceTimersByTime(2_500);
      });

      const said = container.querySelector(".pk__won")?.textContent ?? "";
      expect(said).toContain("Bram");
      expect(said).not.toContain("Ada");
      const lit = [...container.querySelectorAll(".pk__seat--spotlit")];
      expect(lit[0]?.querySelector(".pk__name")?.textContent).toBe("Bram");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays on the last pot rather than running off the end", async () => {
    /*
     * The table holds the showdown open for as long as the announcements take,
     * so the final one has to still be there when the felt clears — not blank
     * because the sequence walked past it.
     */
    vi.useFakeTimers();
    try {
      const table = stub();
      const { container } = render(<Felt table={table} seatId="s1" state={twoPots()} account={ACCOUNT} />);
      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });
      expect(container.querySelector(".pk__won")?.textContent).toContain("Bram");
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks a seat with what it won in total, across both pots", () => {
    // The announcement is per pot; the seat is the whole hand.
    const table = stub();
    const { container } = render(
      <Felt
        table={table}
        seatId="s1"
        state={view({
          street: "showdown",
          paidAt: 1_700_000_000_000,
          paid: [
            { pot: 0, seatId: "s1", name: "Ada", chips: 900, said: "a flush" },
            { pot: 1, seatId: "s1", name: "Ada", chips: 300, said: "a flush" },
          ],
          seats: [seat({ id: "s1", name: "Ada" })],
        })}
        account={ACCOUNT}
      />,
    );
    expect(container.querySelector(".pk__seat--won .pk__says")?.textContent).toContain("a flush");
  });
});

/*
 * The page around the felt: talk kept off it until asked for, what the table
 * said kept as a log rather than flashed, and a refusal taking the middle of
 * the board instead of a strip above it.
 *
 * Rendered as the whole page rather than the felt alone, because none of this
 * is the felt's to know — talk being shut, an unread count, a refusal in the
 * middle rather than a strip are all decisions `Poker` makes around it.
 */
describe("the page around the felt", () => {
  const account: Account = accountFixture();

  function socket(
    state: TableView | null,
    over: Partial<TableSocketHook<TableView>> = {},
  ): TableSocketHook<TableView> {
    return { ...stub(), state, seatId: "s1", ...over };
  }

  function tree() {
    return (
      <MemoryRouter initialEntries={["/poker/ABCDE"]}>
        <Routes>
          <Route path="/poker/:code" element={<Poker />} />
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeAll(() => {
    // jsdom lays nothing out, so it has no scrolling to do.
    Element.prototype.scrollIntoView = vi.fn();
  });

  const dealt = (over: Partial<TableView> = {}) =>
    view({ seats: [seat({ id: "s1", name: "Ada" }), seat({ id: "s2", name: "Bram" })], ...over });

  it("keeps talk off the page until it is asked for", () => {
    show(socket(dealt()));
    expect(screen.queryByRole("region", { name: /table talk/i })).toBeNull();
    expect(screen.getByRole("button", { name: /table talk/i })).toBeInTheDocument();
  });

  it("counts what somebody else said while talk was shut", () => {
    const { rerender } = show(socket(dealt(), { chat: [] }));

    vi.mocked(useTableSocket).mockReturnValue(
      socket(dealt(), {
        chat: [{ seatId: "other", name: "Ines", text: "nice hand", at: 1 }],
      }) as TableSocketHook<unknown>,
    );
    rerender(tree());

    expect(screen.getByRole("button", { name: /table talk, 1 unread/i })).toBeInTheDocument();
  });

  it("keeps what the table said as a log rather than flashing it", () => {
    const { rerender } = show(socket(dealt({ lastEvent: "Ines raised to 200", eventSeq: 1 })));

    vi.mocked(useTableSocket).mockReturnValue(
      socket(dealt({ lastEvent: "Tam folded", eventSeq: 2 })) as TableSocketHook<unknown>,
    );
    rerender(tree());

    fireEvent.click(screen.getByRole("button", { name: /table talk/i }));
    // The shared sheet's tabs are a segmented toggle rather than ARIA tabs, so
    // this is asked for the way the sheet actually names it.
    fireEvent.click(screen.getByRole("button", { name: "Activity" }));

    // Scoped to the log itself: the readout now says the same last thing the
    // table said too (T2), so the bare text is no longer unique on the page.
    const log = within(screen.getByRole("list", { name: "Activity" }));
    expect(log.getByText("Ines raised to 200")).toBeInTheDocument();
    expect(log.getByText("Tam folded")).toBeInTheDocument();
  });

  it("puts a refusal over the cloth rather than in a strip", () => {
    const { container } = show(socket(dealt(), { error: "Not your turn", errorKey: 1 }));
    expect(screen.getByRole("alert")).toHaveTextContent("Not your turn");
    expect(container.querySelector(".play__error")).toBeNull();
  });
});

/*
 * The rules card and the host's table, behind keys on the felt.
 *
 * Both are dialogs competing for the same rectangle talk already claims, so
 * these also cover the one-scrim rule: whichever opens has to close whatever
 * was already up rather than stacking a second backdrop on top of it.
 */
describe("what's behind the felt's own keys", () => {
  const account: Account = accountFixture();

  function socket(
    state: TableView | null,
    over: Partial<TableSocketHook<TableView>> = {},
  ): TableSocketHook<TableView> {
    return { ...stub(), state, seatId: "s1", ...over };
  }

  function tree() {
    return (
      <MemoryRouter initialEntries={["/poker/ABCDE"]}>
        <Routes>
          <Route path="/poker/:code" element={<Poker />} />
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const dealt = (over: Partial<TableView> = {}) =>
    view({ seats: [seat({ id: "s1", name: "Ada" }), seat({ id: "s2", name: "Bram" })], ...over });

  it("offers the host the table behind a key, and nobody else", () => {
    show(socket(dealt({ hostId: "s1" })));
    expect(screen.getByRole("button", { name: /^table$/i })).toBeInTheDocument();
    // The bots row that used to sit bare on the page is gone from the markup.
    expect(document.querySelector(".pk__bots")).toBeNull();
  });

  it("shows no table key to somebody who is not the host", () => {
    show(socket(dealt({ hostId: "s2" })));
    expect(screen.queryByRole("button", { name: /^table$/i })).toBeNull();
  });

  it("offers bots only where the server would allow them", () => {
    show(socket(dealt({ hostId: "s1", forFun: false })));
    fireEvent.click(screen.getByRole("button", { name: /^table$/i }));
    expect(screen.queryByRole("button", { name: /easy/i })).toBeNull();
  });

  it("offers bots to the host at a table playing for fun", () => {
    show(socket(dealt({ hostId: "s1", forFun: true })));
    fireEvent.click(screen.getByRole("button", { name: /^table$/i }));
    expect(screen.getByRole("button", { name: /easy/i })).toBeInTheDocument();
  });

  it("offers no bots at a table already full to its own ceiling, not the building's", () => {
    /*
     * A six-seat table, filled to six, not the building's ten — the sheet
     * used to gate bots on the building's own ceiling regardless of what the
     * host actually chose, which offered "Add a player" at a table with
     * nowhere for one to sit and threw once pressed.
     */
    const seats = Array.from({ length: 6 }, (_, at) => seat({ id: `s${at + 1}`, name: `P${at + 1}` }));
    show(socket(dealt({ hostId: "s1", forFun: true, maxSeats: 6, seats })));
    fireEvent.click(screen.getByRole("button", { name: /^table$/i }));
    expect(screen.getByText("6 of 6 seated")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /easy/i })).toBeNull();
  });

  it("puts what beats what behind the question key", () => {
    show(socket(dealt()));
    fireEvent.click(screen.getByRole("button", { name: /what beats what/i }));
    expect(screen.getByRole("dialog", { name: /what beats what/i })).toBeInTheDocument();
  });

  it("closes talk when the rules sheet opens, rather than stacking a second scrim", () => {
    const { container } = show(socket(dealt()));
    fireEvent.click(screen.getByRole("button", { name: /table talk/i }));
    expect(screen.getByRole("dialog", { name: /table talk/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /what beats what/i }));
    expect(screen.queryByRole("dialog", { name: /table talk/i })).toBeNull();
    expect(screen.getByRole("dialog", { name: /what beats what/i })).toBeInTheDocument();
    expect(container.querySelectorAll(".talk__scrim, .sheet__scrim")).toHaveLength(1);
  });

  it("closes the rules sheet when the host's table opens", () => {
    show(socket(dealt({ hostId: "s1" })));
    fireEvent.click(screen.getByRole("button", { name: /what beats what/i }));
    expect(screen.getByRole("dialog", { name: /what beats what/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^table$/i }));
    expect(screen.queryByRole("dialog", { name: /what beats what/i })).toBeNull();
    expect(screen.getByRole("dialog", { name: /^table/i })).toBeInTheDocument();
  });
});
