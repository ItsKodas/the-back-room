// @vitest-environment jsdom
import type { SeatView, TableView } from "@backroom/game-poker";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TableSocketHook } from "../table/useTableSocket.js";
import { Actions, Felt } from "./Poker.js";

/**
 * The felt, given a table.
 *
 * These render the real components against a real view rather than checking
 * pieces of arithmetic, because the mistakes worth catching here are the ones
 * that only exist once the two are put together: a felt reading a field the
 * view does not have, somebody else's cards arriving face up, or a control
 * offered to a seat that is not allowed to press it.
 */

const seat = (over: Partial<SeatView> & { id: string; name: string }): SeatView => ({
  connected: true,
  waiting: false,
  avatar: null,
  accentColor: null,
  stack: 2_000,
  committed: 0,
  folded: false,
  allIn: false,
  hole: [],
  showed: null,
  isBot: false,
  spoke: null,
  ...over,
});

const view = (over: Partial<TableView> = {}): TableView => ({
  you: null,
  code: "ABCDE",
  street: "preflop",
  board: [],
  pot: 30,
  toAct: null,
  turnEndsAt: null,
  turnMs: 30_000,
  button: null,
  smallBlindId: null,
  bigBlindId: null,
  smallBlind: 10,
  bigBlind: 20,
  paid: [],
  paidAt: null,
  swept: [],
  sweptAt: null,
  lastEvent: null,
  watching: 0,
  seats: [],
  forFun: false,
  entry: 2_000,
  canShow: false,
  canTakeOff: false,
  hostId: null,
  ...over,
});

/** A socket that records what it was asked to send and does nothing else. */
function stub(): TableSocketHook<TableView> & { sent: Record<string, unknown>[] } {
  const sent: Record<string, unknown>[] = [];
  return {
    sent,
    state: null,
    listed: true,
    seatId: null,
    error: null,
    connected: true,
    busy: false,
    chat: [],
    say: vi.fn(),
    addBot: vi.fn(),
    setListed: vi.fn(),
    create: vi.fn(),
    join: vi.fn(),
    watch: vi.fn(),
    leave: vi.fn(),
    act: (action: Record<string, unknown>) => {
      sent.push(action);
    },
  };
}

describe("the felt", () => {
  it("renders a dealt hand without reaching for a field a poker seat has not got", () => {
    /*
     * Blunt, and worth it. The first version of this screen borrowed
     * blackjack's sound hook, which reads `seat.hands` and a dealer — a poker
     * seat has neither, and it typechecked because the view was cast. What
     * that costs is not a wrong number but a blank screen.
     */
    const table = stub();
    render(
      <Felt
        table={table}
        seatId="s1"
        state={view({
          street: "flop",
          board: [
            { rank: "A", suit: "hearts" },
            { rank: "K", suit: "clubs" },
            { rank: "7", suit: "diamonds" },
          ],
          seats: [
            seat({ id: "s1", name: "Ada", hole: [{ rank: "Q", suit: "spades" }, null] }),
            seat({ id: "s2", name: "Bram", hole: [null, null] }),
          ],
        })}
      />,
    );

    expect(screen.getByText("Ada")).toBeTruthy();
    expect(screen.getByText("Bram")).toBeTruthy();
  });

  it("keeps everybody else's hole cards face down and turns your own up", () => {
    const table = stub();
    const { container } = render(
      <Felt
        table={table}
        seatId="s1"
        state={view({
          seats: [
            seat({
              id: "s1",
              name: "Ada",
              hole: [
                { rank: "A", suit: "spades" },
                { rank: "K", suit: "diamonds" },
              ],
            }),
            seat({ id: "s2", name: "Bram", hole: [null, null] }),
          ],
        })}
      />,
    );

    const mine = container.querySelectorAll(".pk__seat--you .card");
    expect(mine).toHaveLength(2);
    expect([...mine].every((card) => card.classList.contains("card--down"))).toBe(false);

    // Bram's two, and both of them backs.
    const theirs = [...container.querySelectorAll(".pk__seat")]
      .filter((one) => !one.classList.contains("pk__seat--you"))
      .flatMap((one) => [...one.querySelectorAll(".card")]);
    expect(theirs).toHaveLength(2);
    expect(theirs.every((card) => card.classList.contains("card--down"))).toBe(true);
  });

  it("puts your own seat at the bottom whoever you are", () => {
    /*
     * Every other seat is somebody you are looking at, and yours is the one
     * you are looking from. Rotated rather than sorted, so the player on your
     * left is still on your left.
     */
    const table = stub();
    const seats = [
      seat({ id: "s1", name: "Ada" }),
      seat({ id: "s2", name: "Bram" }),
      seat({ id: "s3", name: "Cass" }),
    ];
    const { container } = render(
      <Felt table={table} seatId="s3" state={view({ seats })} />,
    );

    const names = [...container.querySelectorAll(".pk__seat .pk__name")].map(
      (one) => one.textContent,
    );
    // Cass first, then the table carries on in its own order from there.
    expect(names).toEqual(["Cass", "Ada", "Bram"]);
    expect(container.querySelector(".pk__seat--you .pk__name")?.textContent).toBe("Cass");
  });
});

describe("what you are offered", () => {
  const acting = (own: TableView["you"], me: Partial<SeatView> = {}) => {
    const table = stub();
    const mine = seat({ id: "s1", name: "Ada", ...me });
    render(
      <Actions
        table={table}
        state={view({ toAct: "s1", you: own, seats: [mine, seat({ id: "s2", name: "Bram" })] })}
        me={mine}
        intent={{ move: null, committed: null, send: vi.fn() }}
      />,
    );
    return table;
  };

  it("offers a check when nothing is owed, and a call when something is", () => {
    acting({ toCall: 0, minRaiseTo: 40, maxRaiseTo: 2_000, canRaise: true });
    expect(screen.getByRole("button", { name: "Check" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Call/ })).toBeNull();
  });

  it("says what a call costs rather than what it comes to", () => {
    // The number a player needs is what leaves their stack, not the total they
    // will have put in — those differ every time they have already bet.
    acting({ toCall: 80, minRaiseTo: 200, maxRaiseTo: 2_000, canRaise: true }, { committed: 20 });
    expect(screen.getByRole("button", { name: "Call 80" })).toBeTruthy();
  });

  it("takes the slider's ends from the table rather than working them out", () => {
    /*
     * The smallest legal raise depends on the size of the last one, which is
     * nowhere in the view. A felt that guessed it would spend half the slider
     * on amounts the table refuses.
     */
    acting({ toCall: 100, minRaiseTo: 400, maxRaiseTo: 2_000, canRaise: true });
    const slider = screen.getByRole("slider") as HTMLInputElement;
    expect(slider.min).toBe("400");
    expect(slider.max).toBe("2000");
  });

  it("offers no raise to somebody who cannot cover one", () => {
    acting({ toCall: 100, minRaiseTo: 400, maxRaiseTo: 2_000, canRaise: false });
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.queryByRole("button", { name: /Raise/ })).toBeNull();
  });

  it("calls all in rather than for more than is there", () => {
    // Owing more than you have is not a call, and sending one would be
    // refused. The button says what pressing it actually does.
    acting({ toCall: 900, minRaiseTo: 1_000, maxRaiseTo: 500, canRaise: false }, { stack: 500 });
    expect(screen.getByRole("button", { name: "All in 500" })).toBeTruthy();
  });

  it("offers the buy-in, and only that, to somebody with nothing in front of them", () => {
    const table = stub();
    const mine = seat({ id: "s1", name: "Ada", stack: 0 });
    render(
      <Actions
        table={table}
        state={view({ street: "waiting", seats: [mine] })}
        me={mine}
        intent={{ move: null, committed: null, send: vi.fn() }}
      />,
    );
    expect(screen.getByRole("button", { name: /Sit down/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Fold" })).toBeNull();
  });

  it("reads the two-line buttons as words with spaces in them", () => {
    /*
     * The figure sits under the word, and two spans with nothing between them
     * give an accessible name of "Call80" — which is what a screen reader says
     * out loud. The label is written once rather than left to how the markup
     * happens to sit, so what it looks like and what it reads as cannot drift.
     */
    acting({ toCall: 80, minRaiseTo: 200, maxRaiseTo: 2_000, canRaise: true }, { committed: 20 });
    expect(screen.getByRole("button", { name: "Call 80" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Raise to 200" })).toBeTruthy();
  });

  it("does not dress the raise up as the button to press", () => {
    /*
     * A lit raise beside a plain call is the felt lobbying. The eye goes to
     * the bright control and the press follows it, which is a table talking
     * somebody into more money than they came to put in. Both are the
     * player's decision and both look like one.
     */
    acting({ toCall: 80, minRaiseTo: 200, maxRaiseTo: 2_000, canRaise: true }, { committed: 20 });
    const call = screen.getByRole("button", { name: "Call 80" });
    const raise = screen.getByRole("button", { name: "Raise to 200" });
    expect(raise.className).toBe(call.className);
  });

  it("gives somebody watching no controls at all", () => {
    const table = stub();
    render(
      <Actions
        table={table}
        state={view()}
        me={null}
        intent={{ move: null, committed: null, send: vi.fn() }}
      />,
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText(/watching/i)).toBeTruthy();
  });
});

describe("deciding before your turn", () => {
  const idle = { move: null, committed: null, send: vi.fn() };

  /** The bar while somebody else is thinking, and a way to hand the turn over. */
  function waiting(mineOver: Partial<SeatView> = {}) {
    const table = stub();
    const mine = seat({
      id: "s1",
      name: "Ada",
      hole: [
        { rank: "A", suit: "spades" },
        { rank: "K", suit: "diamonds" },
      ],
      ...mineOver,
    });
    const at = (own: TableView["you"], toAct: string) =>
      view({ toAct, you: own, street: "flop", seats: [mine, seat({ id: "s2", name: "Bram" })] });

    const shown = render(
      <Actions table={table} state={at(null, "s2")} me={mine} intent={idle} />,
    );
    const yourTurn = (own: NonNullable<TableView["you"]>) =>
      shown.rerender(<Actions table={table} state={at(own, "s1")} me={mine} intent={idle} />);
    return { table, yourTurn };
  }

  it("offers the choices while it is somebody else's turn", () => {
    waiting();
    for (const label of ["Fold", "Check / Fold", "Check", "Call any", "Bet pot"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });

  it("offers nothing to somebody who has folded out of the hand", () => {
    // Arming a move for a hand you are not in is arming nothing.
    waiting({ folded: true });
    expect(screen.queryByRole("button", { name: "Call any" })).toBeNull();
  });

  it("checks a free turn and folds one that costs something", () => {
    const free = waiting();
    fireEvent.click(screen.getByRole("button", { name: "Check / Fold" }));
    free.yourTurn({ toCall: 0, minRaiseTo: 40, maxRaiseTo: 2_000, canRaise: true });
    expect(free.table.sent).toEqual([{ type: "check" }]);

    cleanup();

    const owed = waiting();
    fireEvent.click(screen.getByRole("button", { name: "Check / Fold" }));
    owed.yourTurn({ toCall: 200, minRaiseTo: 400, maxRaiseTo: 2_000, canRaise: true });
    expect(owed.table.sent).toEqual([{ type: "fold" }]);
  });

  it("drops an armed check rather than turning it into a call", () => {
    /*
     * The one that would cost somebody a stack. You arm a check, somebody bets
     * behind you, and the nearest thing still legal is to call — which is a
     * different decision, and nobody made it. So it lapses, and the turn goes
     * back to the person whose turn it is.
     */
    const { table, yourTurn } = waiting();
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    yourTurn({ toCall: 600, minRaiseTo: 1_200, maxRaiseTo: 2_000, canRaise: true });

    expect(table.sent).toEqual([]);
    expect(screen.getByRole("button", { name: "Call 600" })).toBeTruthy();
  });

  it("calls whatever it has come to when that is what was asked for", () => {
    const { table, yourTurn } = waiting();
    fireEvent.click(screen.getByRole("button", { name: "Call any" }));
    yourTurn({ toCall: 600, minRaiseTo: 1_200, maxRaiseTo: 2_000, canRaise: true });
    expect(table.sent).toEqual([{ type: "call" }]);
  });

  it("un-arms when the same choice is pressed twice", () => {
    const { table, yourTurn } = waiting();
    const fold = screen.getByRole("button", { name: "Fold" });
    fireEvent.click(fold);
    fireEvent.click(fold);
    yourTurn({ toCall: 200, minRaiseTo: 400, maxRaiseTo: 2_000, canRaise: true });
    expect(table.sent).toEqual([]);
  });

  it("lets an arming lapse when the next card comes out", () => {
    /*
     * A pre-selection is about the decision in front of you. Once there is a
     * new card there is a new decision, and a move chosen against the old one
     * is not an answer to it.
     */
    const table = stub();
    const mine = seat({
      id: "s1",
      name: "Ada",
      hole: [
        { rank: "A", suit: "spades" },
        { rank: "K", suit: "diamonds" },
      ],
    });
    const at = (street: TableView["street"], own: TableView["you"], toAct: string) =>
      view({ street, toAct, you: own, seats: [mine, seat({ id: "s2", name: "Bram" })] });

    const shown = render(
      <Actions table={table} state={at("flop", null, "s2")} me={mine} intent={idle} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Fold" }));
    // The turn card, and now it is your go.
    shown.rerender(
      <Actions
        table={table}
        state={at("turn", { toCall: 0, minRaiseTo: 40, maxRaiseTo: 2_000, canRaise: true }, "s1")}
        me={mine}
        intent={idle}
      />,
    );
    expect(table.sent).toEqual([]);
  });
});

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
      />,
    );

    const sweeps = [...container.querySelectorAll(".pk__sweep")];
    expect(sweeps).toHaveLength(2);
    // Each is aimed somewhere different, which is what makes it a split.
    const aims = sweeps.map((one) => (one as HTMLElement).style.getPropertyValue("--sin"));
    expect(new Set(aims).size).toBe(2);
  });

  it("pushes nothing while a hand is still being played", () => {
    const table = stub();
    const { container } = render(
      <Felt
        table={table}
        seatId="s1"
        state={view({ street: "flop", seats: [seat({ id: "s1", name: "Ada" })] })}
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

    const shown = render(<Felt table={table} seatId="s1" state={at(100)} />);
    const first = shown.container.querySelector(".pk__bet");
    shown.rerender(<Felt table={table} seatId="s1" state={at(300)} />);
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
      />,
    );
    expect(container.querySelectorAll(".pk__gather")).toHaveLength(0);
  });
});

describe("whose turn it is", () => {
  it("rings the seat being waited on, and only that one", () => {
    const table = stub();
    const { container } = render(
      <Felt
        table={table}
        seatId="s1"
        state={view({
          street: "flop",
          toAct: "s2",
          turnEndsAt: Date.now() + 20_000,
          seats: [seat({ id: "s1", name: "Ada" }), seat({ id: "s2", name: "Bram" })],
        })}
      />,
    );
    const rings = container.querySelectorAll(".turn-ring");
    expect(rings).toHaveLength(1);
    expect(rings[0]?.closest(".pk__seat")?.querySelector(".pk__name")?.textContent).toBe("Bram");
  });

  it("starts the ring part drained for somebody who arrived mid-turn", () => {
    /*
     * The turn's length is in the view for exactly this: a ring that always
     * began full would tell a player who just refreshed that they have a whole
     * turn left when they have five seconds.
     */
    const table = stub();
    const { container } = render(
      <Felt
        table={table}
        seatId="s1"
        state={view({
          street: "flop",
          toAct: "s1",
          turnEndsAt: Date.now() + 6_000,
          turnMs: 30_000,
          seats: [seat({ id: "s1", name: "Ada" })],
        })}
      />,
    );
    const ring = container.querySelector(".turn-ring") as HTMLElement;
    const whole = Number(ring.style.getPropertyValue("--ring"));
    const from = Number(ring.style.getPropertyValue("--ring-from"));
    // A fifth of the turn left means four fifths of the ring already gone.
    expect(from / whole).toBeGreaterThan(0.7);
    expect(from / whole).toBeLessThan(0.9);
  });

  it("says nothing when nobody is being waited on", () => {
    const table = stub();
    const { container } = render(
      <Felt
        table={table}
        seatId="s1"
        state={view({ street: "waiting", toAct: null, seats: [seat({ id: "s1", name: "Ada" })] })}
      />,
    );
    expect(container.querySelectorAll(".turn-ring")).toHaveLength(0);
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
    const { container } = render(<Felt table={table} seatId="s1" state={twoPots()} />);

    const said = container.querySelector(".pk__won")?.textContent ?? "";
    expect(said).toContain("Ada");
    expect(said).not.toContain("Bram");
    // And only that pot's chips are travelling.
    expect(container.querySelectorAll(".pk__sweep")).toHaveLength(1);
  });

  it("gives the moment to one seat at a time", () => {
    const table = stub();
    const { container } = render(<Felt table={table} seatId="s1" state={twoPots()} />);
    const lit = [...container.querySelectorAll(".pk__seat--spotlit")];
    expect(lit).toHaveLength(1);
    expect(lit[0]?.querySelector(".pk__name")?.textContent).toBe("Ada");
  });

  it("moves on to the side pot on its own clock", async () => {
    vi.useFakeTimers();
    try {
      const table = stub();
      const { container } = render(<Felt table={table} seatId="s1" state={twoPots()} />);
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
      const { container } = render(<Felt table={table} seatId="s1" state={twoPots()} />);
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
      />,
    );
    expect(container.querySelector(".pk__seat--won .pk__says")?.textContent).toContain("a flush");
  });
});
