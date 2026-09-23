// @vitest-environment jsdom
import type { SeatView, TableView } from "@backroom/game-two-up";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TableSocketHook } from "../table/useTableSocket.js";
import { Felt } from "./TwoUp.js";

afterEach(cleanup);

/**
 * The felt, given a table.
 *
 * Modelled on `Roulette.test.tsx`: `Felt` is exercised directly against a
 * stubbed `table`, the same seam that lets the wheel's own tests skip the
 * socket entirely. What is new here is the optimistic press and the camera —
 * neither exists on the wheel's felt, so neither has a precedent to copy.
 */

type Table = TableSocketHook<TableView>;

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
  school: "casino",
  phase: "betting",
  deadline: Date.now() + 20_000,
  lastCall: false,
  holding: false,
  spinnerId: "s1",
  faces: null,
  throws: [],
  called: null,
  decided: null,
  history: [],
  placed: [],
  centre: null,
  covers: [],
  uncovered: 0,
  paid: [],
  bank: 5_000_000,
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

/** A table stub with nothing wired up, for tests that only look at one seam. */
const stub = (over: Partial<Table> = {}): Table =>
  ({ act: vi.fn(), busy: false, error: null, ...over }) as unknown as Table;

describe("the two-up felt", () => {
  it("shows a stake on the felt the instant it is pressed, even on a slow connection", () => {
    /*
     * A deliberately slow reply: the ack fires five seconds from now, and the
     * assertion below runs before a single one of them has ticked. A felt that
     * only showed the chip once `act`'s callback ran would fail this exactly
     * the way it would fail somebody playing from another continent.
     */
    vi.useFakeTimers();
    const act = vi.fn((_action: Record<string, unknown>, done?: () => void) => {
      setTimeout(() => done?.(), 5_000);
    });
    const { container } = render(<Felt table={stub({ act })} state={view()} seatId="s1" />);
    fireEvent.click(screen.getByRole("button", { name: "Heads" }));
    expect(act).toHaveBeenCalledWith(expect.objectContaining({ type: "place", on: "heads" }));
    expect(container.querySelector(".tu__spot-mine")?.textContent).toBe("25");
    vi.useRealTimers();
  });

  it("gives up the optimistic chip when the table refuses it", () => {
    const act = vi.fn();
    const { container, rerender } = render(<Felt table={stub({ act })} state={view()} seatId="s1" />);
    fireEvent.click(screen.getByRole("button", { name: "Heads" }));
    expect(container.querySelector(".tu__spot-mine")?.textContent).toBe("25");

    rerender(
      <Felt
        table={stub({ act, error: "You do not have the chips for that." })}
        state={view()}
        seatId="s1"
      />,
    );
    expect(container.querySelector(".tu__spot-mine")).toBeNull();
  });

  it("gives up the optimistic chip when the table refuses it in the same words again", () => {
    const act = vi.fn();
    const no = "You do not have the chips for that.";
    const { container, rerender } = render(
      <Felt table={stub({ act, error: no, errorKey: 1 })} state={view()} seatId="s1" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Heads" }));
    expect(container.querySelector(".tu__spot-mine")?.textContent).toBe("25");

    rerender(<Felt table={stub({ act, error: no, errorKey: 2 })} state={view()} seatId="s1" />);
    expect(container.querySelector(".tu__spot-mine")).toBeNull();
  });

  it("keeps a coin's face unread while it is in the air", () => {
    render(
      <Felt
        table={stub()}
        state={view({ phase: "spinning", faces: ["head", "tail"] })}
        seatId="s1"
      />,
    );
    expect(screen.getAllByRole("img", { name: "A coin in the air." })).toHaveLength(2);
    expect(screen.queryByRole("img", { name: "Heads." })).toBeNull();
    expect(screen.queryByRole("img", { name: "Tails." })).toBeNull();
  });

  it("says why the ring is holding, and offers nothing that would take a chip", () => {
    const state = view({
      school: "school",
      phase: "centre",
      holding: true,
      spinnerId: "s1",
    });
    render(<Felt table={stub()} state={state} seatId="s1" />);
    expect(screen.getByText(/Waiting for another player/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Heads|Tails|5 odds|centre|cover/i })).toBeNull();
  });

  it("shows an odds throw on the board along with results", () => {
    render(<Felt table={stub()} state={view({ history: ["heads", "odds", "tails"] })} seatId="s1" />);
    const board = screen.getByLabelText("Recent throws, oldest first");
    expect(board.textContent).toContain("O");
    expect(board.textContent).toContain("H");
    expect(board.textContent).toContain("T");
  });

  it("drops the felt back while the coins are up, and returns it once they land", () => {
    const flying = render(
      <Felt
        table={stub()}
        state={view({ phase: "spinning", faces: ["head", "tail"] })}
        seatId="s1"
      />,
    );
    expect(flying.container.querySelector(".tu__felt--away")).toBeTruthy();
    cleanup();

    const landed = render(
      <Felt table={stub()} state={view({ phase: "reading", throws: ["heads"] })} seatId="s1" />,
    );
    expect(landed.container.querySelector(".tu__felt--away")).toBeNull();
  });

  it("swings the kip on the press, before the table has said anything", () => {
    vi.useFakeTimers();
    const act = vi.fn((_action: Record<string, unknown>, done?: () => void) => {
      setTimeout(() => done?.(), 5_000);
    });
    const { container } = render(
      <Felt table={stub({ act })} state={view({ phase: "kip", spinnerId: "s1" })} seatId="s1" />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Throw/i }));
    expect(container.querySelector(".tu__kip--swung")).toBeTruthy();
    expect(act).toHaveBeenCalledWith(expect.objectContaining({ type: "throw" }));
    vi.useRealTimers();
  });

  it("offers nobody else's kip", () => {
    render(<Felt table={stub()} state={view({ phase: "kip", spinnerId: "s2" })} seatId="s1" />);
    expect((screen.getByRole("button", { name: /Throw/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("the table saying no", () => {
  /*
   * The refusal is the server's either way. What these are about is the
   * player: the felt works out what would be refused and then greyed the side
   * out without a word, so a bank that could not cover a 500 chip looked
   * exactly like a broken table — every press ignored, everything else normal.
   * The wheel has said the number out loud since it was built; this felt did
   * not.
   */
  it("names the cap when the bank can cover something but not this", () => {
    const act = vi.fn();
    render(<Felt table={stub({ act })} state={view({ bank: 300 })} seatId="s1" />);
    fireEvent.click(screen.getByRole("radio", { name: "Bet with 500" }));
    fireEvent.click(screen.getByRole("button", { name: "Heads" }));
    expect(act).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("300");
  });

  it("leaves the side pressable so it can say why", () => {
    // A disabled control cannot explain itself. The side stays live while
    // betting is open and refuses in words; it is dark only when the window
    // itself is shut.
    render(<Felt table={stub()} state={view({ bank: 300 })} seatId="s1" />);
    expect((screen.getByRole("button", { name: "Heads" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("takes the chip when the bank can cover it", () => {
    const act = vi.fn();
    render(<Felt table={stub({ act })} state={view({ bank: 300 })} seatId="s1" />);
    fireEvent.click(screen.getByRole("button", { name: "Heads" }));
    expect(act).toHaveBeenCalledWith(expect.objectContaining({ type: "place", on: "heads" }));
  });

  it("forgets the refusal once a chip it can cover goes down", () => {
    const act = vi.fn();
    render(<Felt table={stub({ act })} state={view({ bank: 300 })} seatId="s1" />);
    fireEvent.click(screen.getByRole("radio", { name: "Bet with 500" }));
    fireEvent.click(screen.getByRole("button", { name: "Heads" }));
    expect(screen.getByRole("status").textContent).toContain("300");
    fireEvent.click(screen.getByRole("radio", { name: "Bet with 25" }));
    fireEvent.click(screen.getByRole("button", { name: "Heads" }));
    expect(screen.getByRole("status").textContent).not.toContain("300");
  });
});

describe("taking a chip back off a side", () => {
  const HOLD_MS = 450;

  /* A side with something on it: nothing comes off a side that is empty. */
  const withChipsDown = () => view({ placed: [{ seatId: "s1", on: "heads", chips: 100 }] });

  it("comes off when the side is held down", () => {
    /*
     * The rail has promised "press and hold" since this felt was built and
     * only right-click was ever wired, which on a phone meant the promise was
     * simply false — there is no right button on a thumb.
     */
    vi.useFakeTimers();
    const act = vi.fn();
    render(<Felt table={stub({ act })} state={withChipsDown()} seatId="s1" />);
    const heads = screen.getByRole("button", { name: /^Heads/ });
    fireEvent.pointerDown(heads, { button: 0 });
    vi.advanceTimersByTime(HOLD_MS);
    expect(act).toHaveBeenCalledWith(expect.objectContaining({ type: "take", on: "heads" }));
    vi.useRealTimers();
  });

  it("does not also put one down when the hold ends", () => {
    // The pointer that held the side sends a click on the way up, and a felt
    // that acted on it would take a chip off and put it straight back.
    vi.useFakeTimers();
    const act = vi.fn();
    render(<Felt table={stub({ act })} state={withChipsDown()} seatId="s1" />);
    const heads = screen.getByRole("button", { name: /^Heads/ });
    fireEvent.pointerDown(heads, { button: 0 });
    vi.advanceTimersByTime(HOLD_MS);
    fireEvent.pointerUp(heads);
    fireEvent.click(heads);
    expect(act).toHaveBeenCalledTimes(1);
    expect(act).not.toHaveBeenCalledWith(expect.objectContaining({ type: "place" }));
    vi.useRealTimers();
  });

  it("puts one down when the press was too short to be a hold", () => {
    vi.useFakeTimers();
    const act = vi.fn();
    render(<Felt table={stub({ act })} state={withChipsDown()} seatId="s1" />);
    const heads = screen.getByRole("button", { name: /^Heads/ });
    fireEvent.pointerDown(heads, { button: 0 });
    vi.advanceTimersByTime(HOLD_MS - 100);
    fireEvent.pointerUp(heads);
    fireEvent.click(heads);
    expect(act).toHaveBeenCalledTimes(1);
    expect(act).toHaveBeenCalledWith(expect.objectContaining({ type: "place", on: "heads" }));
    vi.useRealTimers();
  });

  it("lets go of the hold when the thumb slides off the side", () => {
    // Sliding off is how somebody gets out of a hold without lifting, the
    // same escape the board's drop key gives.
    vi.useFakeTimers();
    const act = vi.fn();
    render(<Felt table={stub({ act })} state={withChipsDown()} seatId="s1" />);
    const heads = screen.getByRole("button", { name: /^Heads/ });
    fireEvent.pointerDown(heads, { button: 0 });
    vi.advanceTimersByTime(HOLD_MS - 100);
    fireEvent.pointerLeave(heads);
    vi.advanceTimersByTime(HOLD_MS);
    expect(act).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("takes one chip off, not two, when a long press also opens the context menu", () => {
    /*
     * A long press on a touch screen raises `contextmenu` on its own, at
     * roughly the same moment the hold lands. Both routes take a chip back,
     * so without this the pile shrinks twice for one gesture.
     */
    vi.useFakeTimers();
    const act = vi.fn();
    render(<Felt table={stub({ act })} state={withChipsDown()} seatId="s1" />);
    const heads = screen.getByRole("button", { name: /^Heads/ });
    fireEvent.pointerDown(heads, { button: 0 });
    vi.advanceTimersByTime(HOLD_MS);
    fireEvent.contextMenu(heads);
    expect(act).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("still comes off on a right-click, which was the only way before", () => {
    const act = vi.fn();
    render(<Felt table={stub({ act })} state={withChipsDown()} seatId="s1" />);
    fireEvent.contextMenu(screen.getByRole("button", { name: /^Heads/ }));
    expect(act).toHaveBeenCalledWith(expect.objectContaining({ type: "take", on: "heads" }));
  });
});

describe("what you are betting with", () => {
  it("offers an amount of your own as well as the seven chips", () => {
    render(<Felt table={stub()} state={view()} seatId="s1" />);
    expect(screen.getByRole("button", { name: /amount of your own/i })).toBeTruthy();
  });

  it("keeps the box shut until it is asked for, so the rail stays short", () => {
    render(<Felt table={stub()} state={view()} seatId="s1" />);
    expect(screen.queryByRole("textbox", { name: /own/i })).toBeNull();
  });

  it("bets a figure nobody minted a chip for", () => {
    const act = vi.fn();
    render(<Felt table={stub({ act })} state={view()} seatId="s1" />);
    fireEvent.click(screen.getByRole("button", { name: /amount of your own/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /own/i }), { target: { value: "1375" } });
    fireEvent.click(screen.getByRole("button", { name: /^Hold it$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Heads" }));
    expect(act).toHaveBeenCalledWith({ type: "place", on: "heads", chips: 1_375 });
  });

  it("reads a figure written the way it is printed, commas and all", () => {
    const act = vi.fn();
    render(<Felt table={stub({ act })} state={view()} seatId="s1" />);
    fireEvent.click(screen.getByRole("button", { name: /amount of your own/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /own/i }), { target: { value: "1,375" } });
    fireEvent.click(screen.getByRole("button", { name: /^Hold it$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Heads" }));
    expect(act).toHaveBeenCalledWith({ type: "place", on: "heads", chips: 1_375 });
  });

  it("shuts the box on the hold, and shows the figure on the key instead", () => {
    /*
     * The key doubles as the readout, which is what lets the box collapse
     * the moment it has done its job — the rail goes back to its short shape
     * and the player can still see what they are betting with.
     */
    render(<Felt table={stub()} state={view()} seatId="s1" />);
    fireEvent.click(screen.getByRole("button", { name: /amount of your own/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /own/i }), { target: { value: "1375" } });
    fireEvent.click(screen.getByRole("button", { name: /^Hold it$/ }));
    expect(screen.queryByRole("textbox", { name: /own/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Betting with 1,375/i }).textContent).toContain(
      "1,375",
    );
  });

  it("refuses a figure under the smallest chip rather than sending it", () => {
    render(<Felt table={stub()} state={view()} seatId="s1" />);
    fireEvent.click(screen.getByRole("button", { name: /amount of your own/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /own/i }), { target: { value: "10" } });
    expect((screen.getByRole("button", { name: /^Hold it$/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("lets a chip go back to being the one held", () => {
    const act = vi.fn();
    render(<Felt table={stub({ act })} state={view()} seatId="s1" />);
    fireEvent.click(screen.getByRole("button", { name: /amount of your own/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /own/i }), { target: { value: "1375" } });
    fireEvent.click(screen.getByRole("button", { name: /^Hold it$/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Bet with 100" }));
    fireEvent.click(screen.getByRole("button", { name: "Heads" }));
    expect(act).toHaveBeenCalledWith({ type: "place", on: "heads", chips: 100 });
  });
});

describe("putting last round's chips down again", () => {
  it("is offered once there is a round behind you", () => {
    const act = vi.fn();
    render(<Felt table={stub({ act })} state={view({ canRepeat: true })} seatId="s1" />);
    fireEvent.click(screen.getByRole("button", { name: /last round's chips/i }));
    expect(act).toHaveBeenCalledWith({ type: "repeat" });
  });

  it("is dark when there is nothing to put back down", () => {
    render(<Felt table={stub()} state={view({ canRepeat: false })} seatId="s1" />);
    const again = screen.getByRole("button", { name: /last round's chips/i }) as HTMLButtonElement;
    expect(again.disabled).toBe(true);
  });

  it("is not offered in the ring, which has no last round to put down", () => {
    const state = view({ school: "school", phase: "centre", canRepeat: true });
    render(<Felt table={stub()} state={state} seatId="s1" />);
    expect(screen.queryByRole("button", { name: /last round's chips/i })).toBeNull();
  });
});

describe("what the felt says to somebody not looking at it", () => {
  it("names what is on a side, not just which side it is", () => {
    /*
     * An `aria-label` replaces everything inside the button it is on, so the
     * pile drawn in the corner of a side — and the figure beside it — reach
     * nobody listening to this page. The side has to say it itself.
     */
    const state = view({ placed: [{ seatId: "s1", on: "heads", chips: 1_375 }] });
    render(<Felt table={stub()} state={state} seatId="s1" />);
    expect(screen.getByRole("button", { name: "Heads, 1,375 down" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tails" })).toBeTruthy();
  });

  it("says a pile's figure once rather than twice", () => {
    /*
     * `ChipStack` draws the amount on the top chip and carries it again in
     * its own accessible name, which put the same number in the tree twice
     * next to the figure that was already there.
     */
    const state = view({ placed: [{ seatId: "s1", on: "heads", chips: 1_375 }] });
    const { container } = render(<Felt table={stub()} state={state} seatId="s1" />);
    const stacks = container.querySelectorAll(".tu__spot-stack .stack");
    expect(stacks).toHaveLength(1);
    expect(stacks[0]?.closest("[aria-hidden='true']")).not.toBeNull();
  });

  it("names how much of the centre is still open on the button that covers it", () => {
    const state = view({
      school: "school",
      phase: "covering",
      spinnerId: "s2",
      seats: [seat({ id: "s1", name: "Ada" }), seat({ id: "s2", name: "Bo" })],
      centre: { seatId: "s2", chips: 2_000 },
      covers: [],
      uncovered: 2_000,
    });
    render(<Felt table={stub()} state={state} seatId="s1" />);
    expect(screen.getByRole("button", { name: /Cover the centre, 2,000 left/ })).toBeTruthy();
  });
});

describe("the ring's felt", () => {
  const ring = (over = {}) =>
    view({
      school: "school",
      phase: "covering",
      spinnerId: "s2",
      seats: [seat({ id: "s1", name: "Ada" }), seat({ id: "s2", name: "Bo" })],
      centre: { seatId: "s2", chips: 2_000 },
      covers: [{ seatId: "s1", chips: 500 }],
      uncovered: 1_500,
      ...over,
    });

  it("draws the same two-and-one the casino felt draws", () => {
    // A table that changed shape between rulesets would make two games out
    // of one table.
    const { container } = render(<Felt table={stub()} state={ring()} seatId="s1" />);
    expect(container.querySelectorAll(".tu__spots--ring .tu__spot")).toHaveLength(3);
    expect(container.querySelector(".tu__spots--ring .tu__spot--wide")).toBeTruthy();
  });

  it("shows the ring its own cover and the spinner what has come in", () => {
    const mine = render(<Felt table={stub()} state={ring()} seatId="s1" />);
    expect(mine.getByText("Your cover")).toBeTruthy();
    cleanup();

    const theirs = render(<Felt table={stub()} state={ring()} seatId="s2" />);
    expect(theirs.getByText("Covered")).toBeTruthy();
  });

  it("puts the spinner's centre up on the press, before the table has spoken", () => {
    /*
     * A stake is the player's own number, so it goes up at once. The table
     * has not confirmed a centre yet — `centre` is still null — and the felt
     * shows what they staked rather than nothing.
     */
    vi.useFakeTimers();
    const act = vi.fn((_action: Record<string, unknown>, done?: () => void) => {
      setTimeout(() => done?.(), 5_000);
    });
    const state = ring({ phase: "centre", spinnerId: "s1", centre: null, covers: [], uncovered: 0 });
    const { container } = render(<Felt table={stub({ act })} state={state} seatId="s1" />);
    fireEvent.click(screen.getByRole("button", { name: "Set the centre" }));
    expect(act).toHaveBeenCalledWith(expect.objectContaining({ type: "centre" }));
    expect(container.querySelector(".tu__spot-mine")?.textContent).toBe("25");
    vi.useRealTimers();
  });

  it("offers the ring no undo, clear or same again", () => {
    // There is nothing to put back down in a ring, and a centre once set is
    // contested by the time anybody could take it back.
    render(<Felt table={stub()} state={ring()} seatId="s1" />);
    expect(screen.queryByRole("button", { name: /Undo the last chip/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Take back everything/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /last round's chips/i })).toBeNull();
  });

  it("still offers the ring an amount of its own to cover with", () => {
    render(<Felt table={stub()} state={ring()} seatId="s1" />);
    expect(screen.getByRole("button", { name: /amount of your own/i })).toBeTruthy();
  });
});
