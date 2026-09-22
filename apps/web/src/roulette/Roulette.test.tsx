// @vitest-environment jsdom
import type { SeatView, TableView } from "@backroom/game-roulette";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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

beforeAll(() => {
  // Talk's log scrolls itself to the newest line, and jsdom lays nothing out,
  // so it has no such method to call.
  Element.prototype.scrollIntoView = vi.fn();
});

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
  eventSeq: 0,
  window: 30_000,
  canRepeat: false,
  ...over,
});

/**
 * The socket, as much of it as a felt touches.
 *
 * `chat` and `say` are real here rather than left off: talk is part of the
 * table's furniture now, and a felt that read them off nothing would throw
 * before it drew a square.
 */
const stub = (over: Partial<TableSocketHook<TableView>> = {}) => {
  const act = vi.fn();
  return {
    table: { act, busy: false, chat: [], say: vi.fn(), ...over } as unknown as TableSocketHook<TableView>,
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
const box = (cls: string, what: string) => {
  const found = document.querySelector<HTMLElement>(cls);
  if (found === null) {
    throw new Error(`this felt has no ${what}`);
  }
  return within(found);
};

/** The keys under the cloth: the tray, the custom box and the three acts. */
const keys = () => box(".rl__controls", "keys under it");

/** Every bet on the cloth, as the keyboard reaches them. */
const bets = () => box(".rl__reach", "reachable bets");

/** The column beside the cloth, where the talk and ? keys stand. */
const corner = () => box(".rl__corner", "corner beside the cloth");

/**
 * One bet on the cloth, by the words it reads as.
 *
 * Scoping does not help here — the 157 are all in the one place — so this
 * reads the words itself rather than asking by role and naming the other 156
 * on the way past. Nothing is given up by that: these buttons carry no label
 * of their own, so their words *are* their accessible name, and the last test
 * in the file pins exactly that, of one button, without naming the rest. The
 * one-and-only-one check is the half of `getByRole` doing the real work.
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

  it("says nothing about the pocket while the ball is still in the air (T4)", () => {
    /*
     * The medallion's caption is the easiest place in the building to give a
     * result away: it is a line of text under a wheel too small to read, and
     * the view has carried the pocket since the moment betting closed so the
     * wheel could roll the ball to it. What it says while the ball is
     * travelling is how much of the wheel your own chips are on — a fact about
     * your bets, which is a different fact from where the ball went.
     */
    const spinning = render(
      <Felt table={stub().table} state={view({ phase: "spinning", pocket: 17 })} seatId="s1" />,
    );
    const caption = spinning.container.querySelector(".rl__covered");
    expect(caption, "the medallion has no caption at all").not.toBeNull();
    expect(caption?.textContent).not.toContain("17");
    expect(spinning.container.querySelector(".rl__square--won")).toBeNull();
    cleanup();

    const settled = render(
      <Felt table={stub().table} state={view({ phase: "settled", pocket: 17 })} seatId="s1" />,
    );
    expect(settled.container.querySelector(".rl__covered")?.textContent).toBe("17");
  });

  it("gives the stage to the wheel while the ball rolls, and hands it back at settled", () => {
    /*
     * A phone has not the height for both a wheel and a cloth whose squares
     * you can hit. Which of them has the room is one attribute, read by the
     * stylesheet — back at "settled" rather than at the next window, because
     * settling is when the cloth is worth looking at.
     */
    const on = () => document.querySelector(".rl__in")?.getAttribute("data-on") ?? null;

    render(<Felt table={stub().table} state={view()} seatId="s1" />);
    expect(on()).toBe("cloth");
    cleanup();

    render(<Felt table={stub().table} state={view({ phase: "spinning", pocket: 17 })} seatId="s1" />);
    expect(on()).toBe("wheel");
    cleanup();

    render(<Felt table={stub().table} state={view({ phase: "settled", pocket: 17 })} seatId="s1" />);
    expect(on()).toBe("cloth");
  });

  it("works the acts from the keyboard by pressing the buttons themselves", () => {
    /*
     * Through the button rather than past it, so a key can never do what the
     * button would refuse: with nothing on the cloth there is nothing to undo,
     * and U is as dead as the control it presses.
     */
    const { table, act } = stub();
    const down = view({
      you: seat({ id: "s1", name: "Ada", staked: 150 }),
      placed: [{ seatId: "s1", spotId: RED, chips: 150 }],
    });
    render(<Felt table={table} state={down} seatId="s1" />);
    fireEvent.keyDown(window, { key: "c" });
    expect(act).toHaveBeenCalledWith({ type: "clear" });
    cleanup();

    const { table: empty, act: never } = stub();
    render(<Felt table={empty} state={view()} seatId="s1" />);
    fireEvent.keyDown(window, { key: "u" });
    expect(never).not.toHaveBeenCalled();
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
     * how busy the machine is: how many buttons a question has to name. Every
     * ask here is about one element or one small box, deliberately — a test
     * that guarded the file's speed by being slow itself would be a poor sort
     * of guard. If the acts ever move out of the keys, or a reach button ever
     * grows a label of its own, this fails and says why, rather than every
     * question above quietly going wide again.
     */
    render(<Felt table={stub().table} state={view()} seatId="s1" />);
    expect(document.querySelectorAll("button").length).toBeGreaterThan(150);
    expect(keys().getAllByRole("button").length).toBeLessThan(20);
    // The licence for `bet`: a reach button reads out as the words it holds,
    // so finding one by its words finds it by its name.
    expect(bet(/^17, pays 35 to 1/)).toHaveAccessibleName("17, pays 35 to 1");
    /*
     * And every one of them still arrives as a button. This list is the only
     * way to place a bet without a pointer — aiming at the point where four
     * squares meet is a pointer's talent, and this is what a keyboard has
     * instead — so an `aria-hidden` or a `role="presentation"` on any of them
     * takes the cloth away from anybody not using a mouse while breaking
     * nothing a gesture test would notice. Asked by role, once, on purpose:
     * `toHaveAccessibleName` above would name a hidden button quite happily.
     */
    const reachable = document.querySelectorAll(".rl__reach button").length;
    expect(reachable).toBeGreaterThan(150);
    expect(bets().getAllByRole("button")).toHaveLength(reachable);
  });
});

/*
 * What stands around the table rather than on it: talk, the log of what the
 * table has said, and the two boards. Every question here is asked inside the
 * corner or of one element by class, for the reason the paragraph above `box`
 * gives — a felt is 168 buttons, and an unscoped ask pays for all of them.
 */
describe("the table's furniture", () => {
  it("opens talk rather than pushing it onto the page (C1)", () => {
    const { container } = render(<Felt table={stub().table} state={view()} seatId="s1" />);
    // Nothing inline: the only way to talk is to open it.
    expect(container.querySelector(".chat")).toBeNull();
    expect(corner().getByRole("button", { name: "Table talk" })).toBeTruthy();
  });

  it("counts what somebody else said while talk was shut (C2)", () => {
    /*
     * Said while you were looking at the cloth, which is how talk arrives at a
     * table: the socket hands the felt a longer log, and the key carries what
     * you have not read. Two lines land and one of them is yours, so the key
     * says one — your own line is not news to you.
     */
    const state = view();
    const { rerender } = render(<Felt table={stub().table} state={state} seatId="s1" />);
    const chat = [
      { seatId: "s2", name: "Bram", text: "evening", at: 1 },
      { seatId: "s1", name: "Ada", text: "hello", at: 2 },
    ];
    rerender(<Felt table={stub({ chat }).table} state={state} seatId="s1" />);
    expect(corner().getByRole("button", { name: "Table talk, 1 unread" })).toBeTruthy();
  });

  it("keeps the pocket board on the felt rather than folding it into the log (A3)", () => {
    /*
     * Roulette's numbers are the table's own record and the one thing players
     * at a wheel actually read. The log is for the table's sentences; the
     * board stays where it can be glanced at without opening anything.
     */
    const { container } = render(
      <Felt table={stub().table} state={view({ history: [17, 0, 32] })} seatId="s1" />,
    );
    const board = container.querySelector(".rl__in > .rl__history");
    expect(board).not.toBeNull();
    expect(board?.closest(".talk")).toBeNull();
  });

  it("keeps what the table has said, rather than one line that flashes", () => {
    const { table } = stub();
    const { rerender } = render(
      <Felt table={table} state={view({ lastEvent: "Bram sat down.", eventSeq: 1 })} seatId="s1" />,
    );
    rerender(
      <Felt table={table} state={view({ lastEvent: "17. Bram is up 350.", eventSeq: 2 })} seatId="s1" />,
    );

    fireEvent.click(corner().getByRole("button", { name: /^Table talk/ }));
    fireEvent.click(box(".talk", "talk sheet").getByRole("button", { name: "Activity" }));
    const log = document.querySelector(".activity")?.textContent ?? "";
    expect(log).toContain("Bram sat down.");
    expect(log).toContain("17. Bram is up 350.");
  });

  it("never stands talk and what it pays on the same rectangle at once", () => {
    render(<Felt table={stub().table} state={view()} seatId="s1" />);
    fireEvent.click(corner().getByRole("button", { name: "What it pays" }));
    expect(document.querySelector(".rl__pays")).not.toBeNull();

    fireEvent.click(corner().getByRole("button", { name: /^Table talk/ }));
    expect(document.querySelector(".rl__pays")).toBeNull();
    expect(document.querySelector(".talk")).not.toBeNull();

    fireEvent.click(corner().getByRole("button", { name: "What it pays" }));
    expect(document.querySelector(".talk")).toBeNull();
    expect(document.querySelector(".rl__pays")).not.toBeNull();
  });

  it("shuts what it pays the way talk shuts — Escape, the scrim, and focus home (R19)", () => {
    /*
     * Two panels on one rectangle that dismiss differently is a defect, and
     * the keyboard half of it is the worse half: a sheet that goes without
     * handing focus back leaves the tab order standing on nothing.
     */
    render(<Felt table={stub().table} state={view()} seatId="s1" />);
    const key = corner().getByRole("button", { name: "What it pays" });

    fireEvent.click(key);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.querySelector(".rl__pays")).toBeNull();
    expect(document.activeElement).toBe(key);

    fireEvent.click(key);
    const scrim = document.querySelector(".rl__pays-scrim");
    expect(scrim, "what it pays has no scrim to tap off").not.toBeNull();
    fireEvent.click(scrim as Element);
    expect(document.querySelector(".rl__pays")).toBeNull();
    // Both ways out, not just the one: a sheet tapped away has to hand the
    // keyboard back where Escape hands it back.
    expect(document.activeElement).toBe(key);
  });
});
