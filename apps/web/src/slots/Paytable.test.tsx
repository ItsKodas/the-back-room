// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BONUS_AWARDS, JACKPOT_SHARE, LINE_COUNT, PAYS } from "@backroom/game-slots";
import { exact } from "../game/money.js";
import { Paytable } from "./Paytable.js";

/*
 * jsdom has the element but not the modal half of it, so opening is stood in
 * for by the attribute the real method sets.
 */
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

const base = { open: true, onClose: () => {}, stake: 0, lineCount: LINE_COUNT, jackpot: 0 };

function cell(container: HTMLElement, face: string, length: number) {
  return container.querySelector(`[data-face-row="${face}"] [data-run="${length}"]`);
}

describe("the paytable", () => {
  it("opens when asked and not before", () => {
    const shut = render(<Paytable {...base} open={false} />);
    expect(shut.container.querySelector("dialog")?.hasAttribute("open")).toBe(false);
    shut.unmount();

    const { container } = render(<Paytable {...base} />);
    expect(container.querySelector("dialog")?.hasAttribute("open")).toBe(true);
  });

  it("reads every multiplier off the machine's own table", () => {
    const { container } = render(<Paytable {...base} />);
    for (const [face, runs] of Object.entries(PAYS)) {
      for (const length of [3, 4, 5] as const) {
        const multiplier = runs[length];
        if (multiplier === null) {
          continue;
        }
        expect(cell(container, face, length)?.textContent).toContain(`×${exact(multiplier)}`);
      }
    }
  });

  it("lists the faces best first", () => {
    const { container } = render(<Paytable {...base} />);
    const order = [...container.querySelectorAll("[data-face-row]")].map((row) =>
      row.getAttribute("data-face-row"),
    );
    expect(order[0]).toBe("seven");
    expect(order.at(-1)).toBe("tumbler");
  });

  it("says nothing in chips until there is a bet to work them out from", () => {
    const { container } = render(<Paytable {...base} stake={0} />);
    expect(container.querySelector("[data-chips]")).toBeNull();
  });

  it("works out what each run pays at the bet on the machine", () => {
    // A line bet of 25: three dice is twelve of them.
    const { container } = render(<Paytable {...base} stake={25} />);
    const dice = PAYS.dice[3] as number;
    expect(cell(container, "dice", 3)?.querySelector("[data-chips]")?.textContent).toBe(
      exact(dice * 25),
    );
  });

  it("puts the jackpot where five sevens would be, at what the bank would pay", () => {
    const { container } = render(<Paytable {...base} jackpot={4_000} />);
    const five = cell(container, "seven", 5);
    expect(five?.textContent).toContain("Jackpot");
    expect(five?.textContent).toContain(exact(4_000));
    expect(container.textContent).toContain(`${Math.round(JACKPOT_SHARE * 100)}% of the bank`);
  });

  it("gives the bonus in free spins for every count the machine knows", () => {
    const { container } = render(<Paytable {...base} />);
    for (const [count, spins] of Object.entries(BONUS_AWARDS)) {
      const row = container.querySelector(`[data-scatter="${count}"]`);
      expect(row?.textContent).toContain(`${spins} free spins`);
    }
  });

  it("draws all nine lines and dims the ones that were not bought", () => {
    const { container } = render(<Paytable {...base} lineCount={3} />);
    const lines = [...container.querySelectorAll("[data-payline]")];
    expect(lines).toHaveLength(LINE_COUNT);
    const bought = lines.filter((line) => line.getAttribute("data-bought") === "true");
    expect(bought.map((line) => line.getAttribute("data-payline"))).toEqual(["1", "2", "3"]);
  });

  it("says a run counts from the first reel", () => {
    const { container } = render(<Paytable {...base} />);
    expect(container.textContent).toMatch(/left to right, starting on the first reel/i);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    const { container } = render(<Paytable {...base} onClose={onClose} />);
    fireEvent.keyDown(container.querySelector("dialog") as HTMLDialogElement, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
