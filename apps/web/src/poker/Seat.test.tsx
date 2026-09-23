// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Felt } from "./Felt.js";
import { account, seat, stub, view } from "./fixtures.js";

/** The one account every render below reads its balance from. */
const ACCOUNT = account();

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
        account={ACCOUNT}
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
        account={ACCOUNT}
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
      <Felt table={table} seatId="s3" state={view({ seats })} account={ACCOUNT} />,
    );

    const names = [...container.querySelectorAll(".pk__seat .pk__name")].map(
      (one) => one.textContent,
    );
    // Cass first, then the table carries on in its own order from there.
    expect(names).toEqual(["Cass", "Ada", "Bram"]);
    expect(container.querySelector(".pk__seat--you .pk__name")?.textContent).toBe("Cass");
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
        account={ACCOUNT}
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
        account={ACCOUNT}
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
        account={ACCOUNT}
      />,
    );
    expect(container.querySelectorAll(".turn-ring")).toHaveLength(0);
  });
});
