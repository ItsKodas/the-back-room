// @vitest-environment jsdom
import type { Coup, Rank, SeatView, TableView } from "@backroom/game-baccarat";
import { CHIPS, coupFrom, schedule } from "@backroom/game-baccarat";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TableSocketHook } from "../table/useTableSocket.js";
import { Felt } from "./Baccarat.js";

afterEach(cleanup);

/**
 * The felt, given a table.
 *
 * Rendered against a real view rather than checked piecemeal, for the same
 * reason roulette's own felt test is: the mistakes worth catching only exist
 * once the pieces are put together, not in any one of them alone.
 */

const shoe = (...ranks: Rank[]) => ranks.map((rank) => ({ rank, suit: "spades" as const }));

/** Both hands draw a third card, and the coup goes to the banker. */
const BOTH = coupFrom(shoe("2", "2", "3", "2", "6", "5"));

/** Both hands are natural — nobody draws — and the coup goes to the player. */
const NATURAL = coupFrom(shoe("9", "8", "9", "8"));

const seat = (over: Partial<SeatView> & { id: string; name: string }): SeatView => ({
  connected: true,
  waiting: false,
  isBot: false,
  avatar: null,
  accentColor: null,
  staked: 0,
  paid: null,
  purse: null,
  ...over,
});

const view = (over: Partial<TableView> = {}): TableView => ({
  code: "ABCDE",
  phase: "betting",
  deadline: Date.now() + 20_000,
  lastCall: false,
  coup: null,
  dealMs: 0,
  history: [],
  placed: [],
  paid: [],
  winners: [],
  canRepeat: false,
  bank: 1_000_000,
  seats: [seat({ id: "s1", name: "Ada" })],
  you: seat({ id: "s1", name: "Ada" }),
  forFun: false,
  hostId: "s1",
  watching: 0,
  lastEvent: null,
  window: 30_000,
  ...over,
});

const stub = () => {
  const act = vi.fn();
  return {
    table: { act, busy: false, error: null, errorKey: 0 } as unknown as TableSocketHook<TableView>,
    act,
  };
};

describe("the baccarat felt", () => {
  it("shows the three spots and their pay lines", () => {
    render(<Felt table={stub().table} state={view()} seatId="s1" />);
    expect(screen.getByRole("button", { name: /^Player, pays 1 to 1/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Banker, pays 1 to 1, less 5%/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Tie, pays 8 to 1/ })).toBeTruthy();
  });

  it("says the bank is empty before anybody presses anything", () => {
    // A fact about the table, said while betting is still open — not a
    // refusal that only shows up once somebody has tried and failed.
    render(<Felt table={stub().table} state={view({ bank: 0 })} seatId="s1" />);
    expect(screen.getByRole("status").textContent).toMatch(/bank is empty.*nothing to play for yet/i);
  });

  it("offers the house chip set", () => {
    render(<Felt table={stub().table} state={view()} seatId="s1" />);
    for (const value of CHIPS) {
      expect(screen.getByRole("radio", { name: `Bet with ${value.toLocaleString("en-US")}` })).toBeTruthy();
    }
  });

  it("greys the tray down to what a play purse can afford", () => {
    const state = view({ forFun: true, you: seat({ id: "s1", name: "Ada", purse: 60 }) });
    render(<Felt table={stub().table} state={state} seatId="s1" />);
    expect((screen.getByRole("radio", { name: "Bet with 25" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("radio", { name: "Bet with 500" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables "Same again" when there is no last round to repeat', () => {
    render(<Felt table={stub().table} state={view({ canRepeat: false })} seatId="s1" />);
    expect(
      (screen.getByRole("button", { name: /^Put last round/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    cleanup();

    render(<Felt table={stub().table} state={view({ canRepeat: true })} seatId="s1" />);
    expect(
      (screen.getByRole("button", { name: /^Put last round/ }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("announces no outcome while the coup is being dealt", () => {
    const coup: Coup = BOTH;
    const dealMs = schedule(coup).total;
    const state = view({ phase: "dealing", coup, dealMs, deadline: Date.now() + dealMs });
    const { container } = render(<Felt table={stub().table} state={state} seatId="s1" />);
    expect(container.textContent).not.toMatch(/wins/i);
    expect(container.querySelector(".bc__hand--won")).toBeNull();
  });

  it("names the outcome and shows each seat's figure once the coup is settled", () => {
    const coup: Coup = BOTH; // banker 9, player 1 — the banker wins
    const dealMs = schedule(coup).total;
    const state = view({
      phase: "settled",
      coup,
      dealMs,
      deadline: Date.now() + 6_000,
      seats: [seat({ id: "s1", name: "Ada", staked: 200 }), seat({ id: "s2", name: "Bram", staked: 100 })],
      paid: [
        { seatId: "s1", name: "Ada", back: 0, staked: 200 },
        { seatId: "s2", name: "Bram", back: 195, staked: 100 },
      ],
    });
    const { container } = render(<Felt table={stub().table} state={state} seatId="s1" />);
    expect(container.textContent).toMatch(/banker wins/i);
    expect(screen.getByText("-200")).toBeTruthy();
    expect(screen.getByText("+95")).toBeTruthy();
    // The reveal is done by the time the coup is read, so both hands' totals
    // are on screen too.
    expect(container.querySelector(".bc__hand--won.bc__hand--banker")).toBeTruthy();
  });

  /*
   * The hazard this task inherited: Coup.tsx's per-card `open` state never
   * resets to false on its own, which is harmless only if the felt actually
   * discards the previous coup's cards before the next one is dealt. It does,
   * because the table's own view carries `coup: null` for the whole of the
   * betting phase between any two dealt coups (see `Table.beginBetting` in
   * games/baccarat/src/table.ts) — this reproduces the whole cycle and checks
   * that a brand-new coup's first card really does start face down.
   */
  it("does not carry a face-up card over into the next coup", () => {
    vi.useFakeTimers();
    try {
      const now = Date.now();
      vi.setSystemTime(now);

      const totalA = schedule(BOTH).total;
      const settledA = view({ phase: "settled", coup: BOTH, dealMs: totalA, deadline: now + 6_000 });
      const { rerender, container } = render(
        <Felt table={stub().table} state={settledA} seatId="s1" />,
      );
      // Sanity: the first coup really did finish fully revealed.
      expect(container.querySelectorAll(".bc__hand-cards [aria-label]").length).toBeGreaterThan(0);
      expect(container.querySelector(".bc__hand-total")).not.toBeNull();

      const betting = view({ phase: "betting", coup: null, deadline: now + 15_000 });
      rerender(<Felt table={stub().table} state={betting} seatId="s1" />);
      expect(container.querySelectorAll(".bc__hand-cards > *")).toHaveLength(0);

      const totalB = schedule(NATURAL).total;
      const dealingB = view({
        phase: "dealing",
        coup: NATURAL,
        dealMs: totalB,
        deadline: now + totalB,
      });
      rerender(<Felt table={stub().table} state={dealingB} seatId="s1" />);

      // If the previous coup's Place components were still mounted, `open`
      // would still be stuck true from coup A and coup B's first card — a
      // fresh rank — would render open immediately, well before its own
      // turnAt. It must still be a face-down back.
      expect(container.querySelector('[aria-label*=" of "]')).toBeNull();
      expect(container.querySelector('[aria-label="face down"]')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers a watcher no controls at all", () => {
    render(<Felt table={stub().table} state={view({ you: null })} seatId={null} />);
    expect(screen.queryByRole("button", { name: /Take back everything/ })).toBeNull();
    expect(screen.getByText(/Take a seat to play/)).toBeTruthy();
  });

  it("takes a chip when the window is open", () => {
    const { table, act } = stub();
    render(<Felt table={table} state={view()} seatId="s1" />);
    screen.getByRole("button", { name: /^Player, pays 1 to 1/ }).click();
    expect(act).toHaveBeenCalledWith(expect.objectContaining({ type: "place", spotId: "player" }));
  });

  /*
   * Empirically confirmed missing in the running app during task 17: with the
   * server's reply artificially delayed, a clicked spot stayed empty for the
   * whole of that delay — CLAUDE.md's "the chips go down on the press" had no
   * control behind it. `table.act` here never resolves (this stub's `act` is
   * a bare mock, standing in for a stalled round trip), so a chip on screen
   * afterwards can only be this player's own press, not the table's word.
   */
  it("shows a chip on the spot the moment it is pressed, before the table answers", () => {
    const { table } = stub();
    render(<Felt table={table} state={view()} seatId="s1" />);
    // `fireEvent`, not a bare `.click()`: this asserts on a re-render, and
    // only a click routed through React's own act() wrapping is guaranteed
    // to have flushed one by the time the assertion below runs.
    fireEvent.click(screen.getByRole("button", { name: /^Player, pays 1 to 1/ }));
    expect(screen.getByRole("button", { name: /^Player,.*on it/ })).toBeTruthy();
  });

  it("takes nothing once the coup is being dealt", () => {
    const { table, act } = stub();
    const coup: Coup = BOTH;
    const dealMs = schedule(coup).total;
    render(
      <Felt
        table={table}
        state={view({ phase: "dealing", coup, dealMs, deadline: Date.now() + dealMs })}
        seatId="s1"
      />,
    );
    screen.getByRole("button", { name: /^Player, pays 1 to 1/ }).click();
    expect(act).not.toHaveBeenCalled();
  });

  /*
   * The lobby promises "you can deal bots in" for a for-fun table (the same
   * copy roulette and poker carry), and the server fully supports it —
   * `Table.addBot` in games/baccarat/src/table.ts, `botBet` in bot.ts, and
   * `botMove` in adapter.ts all exist for exactly this. Nothing in this file
   * ever called `table.addBot`, so the promise had no control behind it: a
   * player at a for-fun table had no way to fill the empty seats.
   */
  it("lets a seated player deal a bot in at a table playing for fun", () => {
    const { table } = stub();
    const addBot = vi.fn();
    (table as unknown as { addBot: typeof addBot }).addBot = addBot;
    render(<Felt table={table} state={view({ forFun: true })} seatId="s1" />);
    screen.getByRole("button", { name: /normal/i }).click();
    expect(addBot).toHaveBeenCalledWith("normal");
  });

  it("does not offer to deal a bot in at a table playing for chips", () => {
    render(<Felt table={stub().table} state={view({ forFun: false })} seatId="s1" />);
    expect(screen.queryByText(/deal somebody in/i)).toBeNull();
  });

  it("offers a watcher no way to deal a bot in either", () => {
    render(<Felt table={stub().table} state={view({ forFun: true, you: null })} seatId={null} />);
    expect(screen.queryByText(/deal somebody in/i)).toBeNull();
  });
});
