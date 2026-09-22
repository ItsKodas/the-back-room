// @vitest-environment jsdom
import type { SeatView, TableView } from "@backroom/game-poker";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Felt } from "./Felt.js";
import { seat, stub, view } from "./fixtures.js";

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
