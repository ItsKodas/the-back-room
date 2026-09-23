// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Cloth } from "./Cloth.js";

const base = {
  placed: [],
  mine: "s1",
  point: null,
  offByBank: [] as string[],
  odds: false,
  landedOn: null,
};

describe("the cloth", () => {
  it("offers every bet as something you can actually press", () => {
    render(<Cloth {...base} onPlace={() => {}} />);
    // A box is a button. Roulette needs a hit-test because a chip can sit on
    // a line between squares; craps has no split bets, so this is a control.
    expect(screen.getByRole("button", { name: /pass line/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hard 8/i })).toBeInTheDocument();
  });

  it("places on the box that was pressed", () => {
    const onPlace = vi.fn();
    render(<Cloth {...base} onPlace={onPlace} />);
    fireEvent.click(screen.getByRole("button", { name: /field/i }));
    expect(onPlace).toHaveBeenCalledWith("field");
  });

  it("takes chips back on a right-click, which is also a long press", () => {
    const onTake = vi.fn();
    render(
      <Cloth
        {...base}
        placed={[{ seatId: "s1", spotId: "field", chips: 30, off: false }]}
        onPlace={() => {}}
        onTake={onTake}
      />,
    );
    fireEvent.contextMenu(screen.getByRole("button", { name: /field/i }));
    expect(onTake).toHaveBeenCalledWith("field");
  });

  it("presses nothing at all while the dice are out", () => {
    const onPlace = vi.fn();
    render(<Cloth {...base} disabled onPlace={onPlace} />);
    const field = screen.getByRole("button", { name: /field/i });
    expect(field).toBeDisabled();
    fireEvent.click(field);
    expect(onPlace).not.toHaveBeenCalled();
  });

  it("puts a travelled come bet in its number's box, apart from the place bet", () => {
    render(
      <Cloth
        {...base}
        placed={[
          { seatId: "s1", spotId: "place:6", chips: 30, off: false },
          { seatId: "s1", spotId: "come:6", chips: 60, off: false },
        ]}
        onPlace={() => {}}
      />,
    );
    const six = screen.getByRole("button", { name: /place 6/i });
    // Two stacks, in two slots, inside one box.
    expect(six.querySelectorAll("[data-slot]")).toHaveLength(2);
    expect(six.querySelector("[data-slot='come']")).not.toBeNull();
  });

  it("draws a stake in chips this table actually has", () => {
    /*
     * `ChipStack` counts in the building's betting plates by default, and none
     * of them divide craps' tray — its own doc comment says a game whose
     * numbers do not has to hand it its own ladder. Left to the default, a
     * hundred and fifty on the field drew as a hundred and a fifty: two chips,
     * neither of them anything on this table's tray, for a stake pushed out
     * with one press of one plate.
     */
    render(
      <Cloth
        {...base}
        placed={[{ seatId: "s1", spotId: "field", chips: 150, off: false }]}
        onPlace={() => {}}
      />,
    );
    const field = screen.getByRole("button", { name: /field/i });
    expect(field.querySelectorAll(".stack__chip")).toHaveLength(1);
  });

  it("says which bets the bank could not carry, rather than only dimming them", () => {
    // A colour that merely changes is one somebody has to already know the
    // meaning of. An OFF lozenge arrives and says the word.
    render(
      <Cloth
        {...base}
        placed={[{ seatId: "s1", spotId: "place:6", chips: 30, off: true }]}
        offByBank={["place:6"]}
        onPlace={() => {}}
      />,
    );
    expect(screen.getByText(/off/i)).toBeInTheDocument();
  });

  it("marks the point, because everything on the cloth hangs off it", () => {
    render(<Cloth {...base} point={6} onPlace={() => {}} />);
    expect(screen.getByRole("button", { name: /place 6/i })).toHaveAttribute("data-point", "true");
  });

  it("lights nothing until the dice have stopped", () => {
    /*
     * The felt is handed the dice during the throw so they can settle onto the
     * real faces. Lighting the winning boxes from them would be the answer,
     * several seconds early — so the light comes from landedOn, which is null
     * until the dice are at rest, and from nothing else.
     */
    const { rerender } = render(<Cloth {...base} onPlace={() => {}} />);
    expect(screen.getByRole("button", { name: /place 6/i })).not.toHaveAttribute("data-lit");
    rerender(<Cloth {...base} landedOn={["place:6"]} onPlace={() => {}} />);
    expect(screen.getByRole("button", { name: /place 6/i })).toHaveAttribute("data-lit", "true");
  });

  it("outlines only what can take odds when odds are being laid", () => {
    render(
      <Cloth
        {...base}
        point={6}
        odds
        placed={[{ seatId: "s1", spotId: "pass", chips: 30, off: false }]}
        onPlace={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /pass line/i })).toHaveAttribute("data-odds", "true");
    expect(screen.getByRole("button", { name: /field/i })).not.toHaveAttribute("data-odds", "true");
  });
});
