// @vitest-environment jsdom
import type { SeatView, TableView } from "@backroom/game-roulette";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { play } from "../game/audio.js";
import type { TableSocketHook } from "../table/useTableSocket.js";
import { Felt } from "./Roulette.js";

/*
 * Sound is stubbed rather than let through, because letting it through costs
 * real time: play() goes and finds a sample, so every simulated chip below
 * loaded one. That fits inside a test's budget on an idle machine and stops
 * fitting once the rest of the suite is running beside it — a flake waiting
 * for a busy afternoon rather than anything true about the felt. Stubbed, the
 * cue is also something this file can ask about, which is how it is pinned.
 */
vi.mock("../game/audio.js", async (original) => ({
  ...(await original<typeof import("../game/audio.js")>()),
  play: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.mocked(play).mockClear();
});

/**
 * The felt, given a table.
 *
 * Rendered against a real view rather than checked piecemeal, because the
 * mistakes worth catching here only exist once the two are put together: a
 * felt reading a field the view has not got, a control offered to somebody who
 * may not press it, or the result on screen before the ball is in.
 */

const RED = "even:1-3-5-7-9-12-14-16-18-19-21-23-25-27-30-32-34-36";

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
  pocket: null,
  history: [],
  winners: [],
  placed: [],
  paid: [],
  bank: 1_000_000,
  seats: [seat({ id: "s1", name: "Ada" })],
  you: seat({ id: "s1", name: "Ada" }),
  forFun: false,
  hostId: "s1",
  watching: 0,
  lastEvent: null,
  window: 30_000,
  canRepeat: false,
  ...over,
});

const stub = () => {
  const act = vi.fn();
  return {
    table: { act, busy: false } as unknown as TableSocketHook<TableView>,
    act,
  };
};

/**
 * The one line under the keys.
 *
 * Queried by class rather than by role: `.rl__said` carries aria-live, not
 * role="status" — Standing already has the page's one status region, and a
 * second would make the one that actually announces something impossible to
 * ask for by role alone.
 */
const said = () => document.querySelector(".rl__said")?.textContent ?? null;

/*
 * Where a question is asked, and why it matters here.
 *
 * `screen.getByRole("button", { name })` computes an accessible name for every
 * button in the document before it can answer. The cloth carries a reachable
 * button for all 157 bets, so a felt has 168 of them and an unscoped question
 * pays for all 168 — measured on this file at 25ms an ask against 0.6ms asked
 * inside the keys, with `render` itself at 45ms. It used to ask seventeen of
 * them, which is how a page of sub-second tests came to spend three quarters
 * of its time naming buttons it was not looking for, and to blow its
 * five-second budget outright whenever the machine had a slow minute.
 *
 * So: ask the cloth about bets and ask the keys about keys. Scoped by class
 * for the same reason `said` is — the keys panel is a place on the felt, not a
 * landmark, and giving it a role to be found by would put a second one in
 * every screen reader's way for the sake of a test.
 */
const box = (cls: string) => {
  const found = document.querySelector<HTMLElement>(cls);
  if (found === null) {
    throw new Error(`no ${cls} on this felt`);
  }
  return within(found);
};

/** The keys under the cloth: the tray, the custom box and the three acts. */
const keys = () => box(".rl__controls");

/** Every bet on the cloth, as the keyboard reaches them. */
const bets = () => box(".rl__reach");

/**
 * One bet on the cloth, by the words it reads as.
 *
 * Scoping does not help here — the 157 are all in the one place — so this
 * reads the words itself rather than asking by role and naming the other 156
 * on the way past. Nothing is given up by that: these buttons carry no label
 * of their own, so their words *are* their accessible name, and the last test
 * in the file pins that by asking both ways and insisting on the same button.
 * The one-and-only-one check is the half of `getByRole` doing the real work.
 */
const bet = (reads: RegExp): HTMLButtonElement => {
  const found = [...document.querySelectorAll<HTMLButtonElement>(".rl__reach button")].filter(
    (one) => reads.test(one.textContent ?? ""),
  );
  if (found.length !== 1) {
    throw new Error(`${found.length} bets on the cloth read as ${reads}`);
  }
  return found[0];
};

describe("the roulette felt", () => {
  it("takes a chip when the window is open", () => {
    const { table, act } = stub();
    render(<Felt table={table} state={view()} seatId="s1" />);
    fireEvent.click(bet(/^17, pays 35 to 1/));
    expect(act).toHaveBeenCalledWith(expect.objectContaining({ type: "place", spotId: "straight:17" }));
    // A chip landing makes a sound, and the sound is the press being answered
    // before the table can answer it — so it goes with the chip, not the ack.
    expect(vi.mocked(play)).toHaveBeenCalledWith("bet");
  });

  it("takes nothing once the wheel is turning", () => {
    const { table, act } = stub();
    render(<Felt table={table} state={view({ phase: "spinning", pocket: 17 })} seatId="s1" />);
    fireEvent.click(bet(/^17, pays 35 to 1/));
    expect(act).not.toHaveBeenCalled();
  });

  it("takes nothing at last call, so a late chip is never a race", () => {
    const { table, act } = stub();
    render(<Felt table={table} state={view({ lastCall: true })} seatId="s1" />);
    fireEvent.click(bet(/^17, pays 35 to 1/));
    expect(act).not.toHaveBeenCalled();
  });

  it("keeps the result off the cloth until the ball is in", () => {
    /*
     * The view carries the pocket all through the spin, because the wheel
     * needs it to roll the ball to the right place. A felt that passed it
     * straight through would light the winning square seconds early.
     */
    const spinning = render(<Felt table={stub().table} state={view({ phase: "spinning", pocket: 17 })} seatId="s1" />);
    expect(spinning.container.querySelector(".rl__square--won")).toBeNull();
    cleanup();

    const settled = render(<Felt table={stub().table} state={view({ phase: "settled", pocket: 17 })} seatId="s1" />);
    expect(settled.container.querySelector(".rl__square--won")).toBeTruthy();
  });

  it("refuses a chip the bank could not pay out on, and says so", () => {
    /*
     * The refusal is the server's either way. What this is about is the
     * player: a press that does nothing at all and gives no reason is a
     * broken button, and that is exactly what an empty bank felt like — every
     * chip silently ignored, with the table looking perfectly normal.
     */
    const { table, act } = stub();
    render(<Felt table={table} state={view({ bank: 0 })} seatId="s1" />);
    fireEvent.click(bet(/^17, pays 35 to 1/));
    expect(act).not.toHaveBeenCalled();
    expect(said()).toMatch(/bank/i);
  });

  it("says the bank is empty before anybody presses anything", () => {
    // A table that cannot take a bet should say so while you are still
    // deciding, not once you have tried and been ignored.
    render(<Felt table={stub().table} state={view({ bank: 0 })} seatId="s1" />);
    expect(said()).toMatch(/nothing to play for yet/i);
  });

  it("tells a watcher the bank is empty too, since they never open Controls", () => {
    // A watcher's own next press is sitting down, and they should not do
    // that blind. said() only reaches a seated player, so this is the one
    // place left that can tell somebody who hasn't sat down yet.
    render(<Felt table={stub().table} state={view({ bank: 0, you: null })} seatId={null} />);
    expect(screen.getByRole("status").textContent).toMatch(/nothing to play for yet/i);
  });

  it("names the cap when the bank can cover something but not this", () => {
    // 3,500 covers exactly 100 straight up, so a 500 chip is too big for it
    // and the player is told the number rather than left guessing.
    const { table, act } = stub();
    render(<Felt table={table} state={view({ bank: 3_500 })} seatId="s1" />);
    fireEvent.click(keys().getByRole("radio", { name: "Bet with 500" }));
    fireEvent.click(bet(/^17, pays 35 to 1/));
    expect(act).not.toHaveBeenCalled();
    expect(said()).toContain("100");
  });

  it("takes the chip when the bank can cover it", () => {
    const { table, act } = stub();
    render(<Felt table={table} state={view({ bank: 3_500 })} seatId="s1" />);
    fireEvent.click(bet(/^17, pays 35 to 1/));
    expect(act).toHaveBeenCalled();
  });

  it("offers a watcher no controls at all", () => {
    render(<Felt table={stub().table} state={view({ you: null })} seatId={null} />);
    // The whole keys panel rather than one of its buttons: a watcher handed
    // the tray but not the acts is still being handed controls. Which is also
    // the cheap way to ask — an absence asked by role names all 157 bets on
    // the cloth on its way to finding nothing.
    expect(document.querySelector(".rl__controls")).toBeNull();
    expect(screen.getByText(/Take a seat to play/)).toBeTruthy();
  });

  it("says what the table is doing", () => {
    const open = render(<Felt table={stub().table} state={view()} seatId="s1" />);
    expect(open.container.textContent).toContain("Place your bets");
    cleanup();

    const last = render(<Felt table={stub().table} state={view({ lastCall: true })} seatId="s1" />);
    expect(last.container.textContent).toContain("Last call");
    cleanup();

    const turning = render(<Felt table={stub().table} state={view({ phase: "spinning", pocket: 3 })} seatId="s1" />);
    expect(turning.container.textContent).toContain("No more bets");
  });

  it("shows what each seat has down, and what the spin did to them", () => {
    const state = view({
      phase: "settled",
      pocket: 32,
      seats: [seat({ id: "s1", name: "Ada", staked: 200 }), seat({ id: "s2", name: "Bram", staked: 100 })],
      paid: [
        { seatId: "s1", name: "Ada", back: 400, staked: 200 },
        { seatId: "s2", name: "Bram", back: 0, staked: 100 },
      ],
    });
    render(<Felt table={stub().table} state={state} seatId="s1" />);
    expect(screen.getByText("+200")).toBeTruthy();
    expect(screen.getByText("-100")).toBeTruthy();
  });

  it("greys the tray down to what a play purse can afford", () => {
    const state = view({ forFun: true, you: seat({ id: "s1", name: "Ada", purse: 60 }) });
    render(<Felt table={stub().table} state={state} seatId="s1" />);
    expect((keys().getByRole("radio", { name: "Bet with 25" }) as HTMLButtonElement).disabled).toBe(false);
    expect((keys().getByRole("radio", { name: "Bet with 500" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("reads its buttons as sentences rather than as run-on words", () => {
    /*
     * Each of these is a word over a note, and two spans with nothing between
     * them give an accessible name like "Undo The last chip down" — which is
     * what a screen reader says out loud. Written once, so what it looks like
     * and what it reads as cannot drift. Poker's felt learned this as "Call80".
     */
    render(<Felt table={stub().table} state={view()} seatId="s1" />);
    expect(keys().getByRole("button", { name: "Put last round's chips down again" })).toBeTruthy();
    expect(keys().getByRole("button", { name: "Undo the last chip you put down" })).toBeTruthy();
    expect(
      keys().getByRole("button", { name: "Take back everything you have on the cloth" }),
    ).toBeTruthy();
  });

  it("will not offer to repeat a round that never happened", () => {
    render(<Felt table={stub().table} state={view()} seatId="s1" />);
    expect(
      (keys().getByRole("button", { name: /^Put last round/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    cleanup();

    render(<Felt table={stub().table} state={view({ canRepeat: true })} seatId="s1" />);
    expect(
      (keys().getByRole("button", { name: /^Put last round/ }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("shows who the wheel has been paying, and what they are up", () => {
    /*
     * The board beside the numbers. The numbers say what the wheel has been
     * doing; this says what that has been worth to the people at the table,
     * which is the half of the evening a strip of numbers cannot show.
     */
    render(
      <Felt
        table={stub().table}
        state={view({
          winners: [
            { spin: 4, pocket: 32, seatId: "s2", name: "Bram", up: 1750 },
            { spin: 5, pocket: 17, seatId: "s1", name: "Ada", up: 350 },
          ],
        })}
        seatId="s1"
      />,
    );
    const board = screen.getByLabelText("Recent winners, oldest first");
    expect(board.textContent).toContain("Bram");
    expect(board.textContent).toContain("+1,750");
    expect(board.textContent).toContain("Ada");
    expect(board.textContent).toContain("+350");
  });

  it("has no winners' board before anybody has won", () => {
    // An empty board is a heading over nothing. A table nobody has been paid
    // at yet says so by having no board rather than by having a blank one.
    render(<Felt table={stub().table} state={view()} seatId="s1" />);
    expect(screen.queryByLabelText("Recent winners, oldest first")).toBeNull();
  });

  it("has nothing to undo before anything is down", () => {
    render(<Felt table={stub().table} state={view()} seatId="s1" />);
    expect((keys().getByRole("button", { name: /^Undo the last chip/ }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();

    const down = view({ you: seat({ id: "s1", name: "Ada", staked: 150 }), placed: [{ seatId: "s1", spotId: RED, chips: 150 }] });
    render(<Felt table={stub().table} state={down} seatId="s1" />);
    expect((keys().getByRole("button", { name: /^Undo the last chip/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("reaches every bet by name, and keeps the keys somewhere small to ask", () => {
    /*
     * The pin for the paragraph above, in the one unit that does not vary with
     * how busy the machine is: how many buttons a question has to name. Last,
     * and the only wide ask left in the file, so that `bet` and `keys` can be
     * narrow everywhere else. If the acts ever move out of the keys, or the
     * reach list ever grows a label of its own, this fails and says why,
     * rather than every question above quietly going wide again.
     */
    render(<Felt table={stub().table} state={view()} seatId="s1" />);
    expect(document.querySelectorAll("button").length).toBeGreaterThan(150);
    expect(keys().getAllByRole("button").length).toBeLessThan(20);
    // Asked both ways, and it has to be the same button: which is what lets
    // every press above read the words instead of computing 157 names.
    expect(bets().getByRole("button", { name: "17, pays 35 to 1" })).toBe(bet(/^17, pays 35 to 1/));
  });
});
