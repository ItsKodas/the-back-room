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
