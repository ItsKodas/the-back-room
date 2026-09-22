// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Controls, opening } from "./Controls.js";
import { seat, view } from "./fixtures.js";

const props = (over: Record<string, unknown> = {}) => ({
  state: view([seat(), seat({ id: "s1", name: "Bram" })], { total: 10, toAct: "s0" }),
  seatId: "s0",
  busy: false,
  ready: false,
  onBid: vi.fn(),
  onCall: vi.fn(),
  onReady: vi.fn(),
  taunt: <button type="button">Taunt</button>,
  help: <button type="button">?</button>,
  ...over,
});

describe("the opening default", () => {
  it("is what the table is expected to hold, not what you hold", () => {
    // Ten dice, wilds counted: a third of them.
    expect(opening(10)).toEqual({ count: 3, face: 2 });
    expect(opening(2)).toEqual({ count: 1, face: 2 });
  });
});

describe("building a bid", () => {
  it("arrives on the lowest legal raise", () => {
    render(
      <Controls
        {...props({
          state: view([seat(), seat({ id: "s1" })], { total: 10, toAct: "s0", bid: { count: 4, face: 3 } }),
        })}
      />,
    );
    expect(screen.getByRole("button", { name: /Bid four fours/ })).toBeInTheDocument();
  });

  it("arrives on the neutral opening when nothing has been said", () => {
    render(<Controls {...props()} />);
    expect(screen.getByRole("button", { name: /Bid three twos/ })).toBeInTheDocument();
  });

  it("steps the count up and down, never below what is legal", () => {
    render(
      <Controls
        {...props({
          state: view([seat(), seat({ id: "s1" })], { total: 10, toAct: "s0", bid: { count: 4, face: 6 } }),
        })}
      />,
    );
    // Four sixes standing: two ones is the floor at ones, and the preset.
    expect(screen.getByRole("button", { name: /Bid two ones/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "One fewer" }));
    expect(screen.getByRole("button", { name: /Bid two ones/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "One more" }));
    expect(screen.getByRole("button", { name: /Bid three ones/ })).toBeInTheDocument();
  });

  it("never steps past the dice on the table", () => {
    render(
      <Controls {...props({ state: view([seat(), seat({ id: "s1" })], { total: 3, toAct: "s0" }) })} />,
    );
    for (let press = 0; press < 6; press += 1) {
      fireEvent.click(screen.getByRole("button", { name: "One more" }));
    }
    expect(screen.getByRole("button", { name: /Bid three twos/ })).toBeInTheDocument();
  });

  it("dims a face no legal bid can reach", () => {
    // Three ones standing with six dice: a plain face needs seven, so all five
    // of them are out of reach and only ones is left.
    render(
      <Controls
        {...props({
          state: view([seat(), seat({ id: "s1" })], { total: 6, toAct: "s0", bid: { count: 3, face: 1 } }),
        })}
      />,
    );
    expect(screen.getByRole("radio", { name: "Sixes" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Ones" })).not.toBeDisabled();
  });

  it("lifts the count when a face is chosen that needs more", () => {
    render(
      <Controls
        {...props({
          state: view([seat(), seat({ id: "s1" })], { total: 10, toAct: "s0", bid: { count: 4, face: 6 } }),
        })}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Twos" }));
    expect(screen.getByRole("button", { name: /Bid five twos/ })).toBeInTheDocument();
  });

  it("sends the bid it shows", () => {
    const bound = props();
    render(<Controls {...bound} />);
    fireEvent.click(screen.getByRole("button", { name: /Bid three twos/ }));
    expect(bound.onBid).toHaveBeenCalledWith({ count: 3, face: 2 });
  });
});

describe("calling", () => {
  it("offers nothing to call before anything has been said", () => {
    render(<Controls {...props()} />);
    expect(screen.getByRole("button", { name: /Liar/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Exact/ })).toBeDisabled();
  });

  it("offers both once there is a bid", () => {
    const bound = props({
      state: view([seat(), seat({ id: "s1" })], { total: 10, toAct: "s0", bid: { count: 3, face: 5 }, bidder: "s1" }),
    });
    render(<Controls {...bound} />);
    fireEvent.click(screen.getByRole("button", { name: /Liar/ }));
    expect(bound.onCall).toHaveBeenCalledWith("liar");
    fireEvent.click(screen.getByRole("button", { name: /Exact/ }));
    expect(bound.onCall).toHaveBeenCalledWith("exact");
  });
});

describe("whose turn it is not", () => {
  it("lights nothing, says who it is waiting on, and offers a taunt", () => {
    render(
      <Controls
        {...props({ state: view([seat(), seat({ id: "s1", name: "Bram" })], { total: 10, toAct: "s1" }) })}
      />,
    );
    expect(screen.getByText(/Bram/)).toBeInTheDocument();
    expect(document.querySelectorAll(".slab")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Taunt" })).toBeInTheDocument();
  });
});

describe("between games", () => {
  it("offers the ready slab", () => {
    const bound = props({ state: view([seat()], { phase: "waiting", toAct: null }) });
    render(<Controls {...bound} />);
    fireEvent.click(screen.getByRole("button", { name: /I'm in/ }));
    expect(bound.onReady).toHaveBeenCalledWith(true);
  });

  it("says it is waiting for players below two", () => {
    render(
      <Controls
        {...props({ state: view([seat()], { phase: "waiting", toAct: null, waitingFor: "players" }) })}
      />,
    );
    expect(screen.getByText(/second player/)).toBeInTheDocument();
  });
});

describe("the press going down", () => {
  it("holds the main action busy rather than disabling it", () => {
    render(<Controls {...props({ busy: true })} />);
    const slab = screen.getByRole("button", { name: /Bid three twos/ });
    expect(slab).toHaveClass("is-busy");
    expect(slab).not.toBeDisabled();
  });
});

describe("the keys it declares", () => {
  it("names Space, L and E on the buttons they press", () => {
    render(
      <Controls
        {...props({
          state: view([seat(), seat({ id: "s1" })], {
            total: 10,
            toAct: "s0",
            bid: { count: 3, face: 5 },
            bidder: "s1",
          }),
        })}
      />,
    );
    expect(screen.getByRole("button", { name: /Bid/ })).toHaveAttribute("aria-keyshortcuts", "Space");
    expect(screen.getByRole("button", { name: /Liar/ })).toHaveAttribute("aria-keyshortcuts", "L");
    expect(screen.getByRole("button", { name: /Exact/ })).toHaveAttribute("aria-keyshortcuts", "E");
  });
});
