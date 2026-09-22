// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Controls, readChip } from "./Controls.js";

afterEach(cleanup);

const base = {
  reach: { most: 10_000, purse: 50_000, bank: 2_000_000 },
  refused: null,
  open: true,
  betting: true,
  down: 0,
  canRepeat: true,
  busy: false,
  onRepeat: () => {},
  onUndo: () => {},
  onClear: () => {},
};

function Harness(over: Partial<Parameters<typeof Controls>[0]> = {}) {
  const [chip, setChip] = useState(100);
  return <Controls {...base} chip={chip} onChip={setChip} {...over} />;
}

/** The one line under the keys — `.rl__said`, not a second `role="status"`. */
function said(): string | null {
  return document.querySelector(".rl__said")?.textContent ?? null;
}

describe("readChip", () => {
  it("takes a figure with commas and rejects everything else", () => {
    expect(readChip("1,250")).toBe(1250);
    expect(readChip("")).toBe(null);
    expect(readChip("abc")).toBe(null);
  });
});

describe("the chip keys", () => {
  it("is one named group with exactly one chip held", () => {
    render(<Harness />);
    const held = screen
      .getAllByRole("radio")
      .filter((b) => b.getAttribute("aria-checked") === "true");
    expect(held).toHaveLength(1);
  });

  it("moves the hold to the chip pressed", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: "Bet with 500" }));
    expect(screen.getByRole("radio", { name: "Bet with 500" }).getAttribute("aria-checked")).toBe("true");
  });

  it("darkens a chip the purse cannot cover, but never the one held", () => {
    render(<Harness reach={{ most: 10_000, purse: 300, bank: 2_000_000 }} />);
    expect(screen.getByRole("radio", { name: "Bet with 5,000" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Bet with 100" })).not.toBeDisabled();
  });

  it("never darkens the chip held, even when the purse can no longer cover it", () => {
    // A chip picked at 500, with a purse that has since fallen under it: the
    // exemption is pointless to test with a chip the purse could afford on
    // its own, which is what the assertion above never actually held.
    render(<Harness chip={500} reach={{ most: 10_000, purse: 300, bank: 2_000_000 }} />);
    expect(screen.getByRole("radio", { name: "Bet with 500" })).not.toBeDisabled();
    expect(screen.getByRole("radio", { name: "Bet with 1,000" })).toBeDisabled();
  });
});

describe("the custom bet", () => {
  it("does not bet on a keystroke — typing 1000 goes through 1 and 10", () => {
    const onChip = vi.fn();
    render(<Harness onChip={onChip} />);
    fireEvent.change(screen.getByLabelText("Custom chip"), { target: { value: "1000" } });
    expect(onChip).not.toHaveBeenCalled();
  });

  it("puts the typed figure on when it is committed", () => {
    render(<Harness />);
    const box = screen.getByLabelText("Custom chip");
    fireEvent.change(box, { target: { value: "1250" } });
    fireEvent.click(screen.getByRole("button", { name: "Bet it" }));
    expect(screen.getByRole("button", { name: "Held" })).toBeDefined();
  });

  it("commits on Enter too", () => {
    render(<Harness />);
    const box = screen.getByLabelText("Custom chip");
    fireEvent.change(box, { target: { value: "1250" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Held" })).toBeDefined();
  });

  it("will not commit a figure under the smallest chip", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Custom chip"), { target: { value: "10" } });
    expect(screen.getByRole("button", { name: "Bet it" })).toBeDisabled();
    expect(said()).toContain("start at 25");
  });

  it("formats on blur", () => {
    render(<Harness />);
    const box = screen.getByLabelText("Custom chip") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "1250" } });
    fireEvent.blur(box);
    expect(box.value).toBe("1,250");
  });

  it("releases a held custom figure the cap has moved under, and says why", () => {
    // Mirrors Slots' BetKeys, which resets and explains an uncoverable held
    // stake rather than leaving it lit over a lever that will not move.
    // 1,250 rather than a minted denomination — a figure already on the tray
    // would never register as "held" by the custom box in the first place.
    const { rerender } = render(<Harness reach={{ most: 10_000, purse: 50_000, bank: 2_000_000 }} />);
    const box = screen.getByLabelText("Custom chip");
    fireEvent.change(box, { target: { value: "1250" } });
    fireEvent.click(screen.getByRole("button", { name: "Bet it" }));
    expect(screen.getByRole("button", { name: "Held" })).toBeDefined();

    // The bank shrinks under the held figure without a press of the player's.
    rerender(<Harness reach={{ most: 1_000, purse: 50_000, bank: 2_000_000 }} />);

    expect(screen.queryByRole("button", { name: "Held" })).toBeNull();
    expect(screen.getByRole("button", { name: "Bet it" })).toBeDefined();
    expect(said()).toMatch(/released/i);
    expect(said()).toContain("1,250");
  });

  /*
   * The release is one more message on the one line, so it takes its turn in
   * the same order as the rest. It used to be rendered instead of that line
   * rather than inside it, which put it above every rule said() documents as
   * winning — and an empty bank losing to anything is the regression this
   * table has already had once.
   */
  const releaseHeld = (rerender: (ui: ReactElement) => void) => {
    fireEvent.change(screen.getByLabelText("Custom chip"), { target: { value: "1250" } });
    fireEvent.click(screen.getByRole("button", { name: "Bet it" }));
    rerender(<Harness reach={{ most: 1_000, purse: 50_000, bank: 2_000_000 }} />);
    expect(said()).toMatch(/released/i);
  };

  it("lets an empty bank outrank the release, because it is the reason for it", () => {
    const { rerender } = render(<Harness />);
    fireEvent.change(screen.getByLabelText("Custom chip"), { target: { value: "1250" } });
    fireEvent.click(screen.getByRole("button", { name: "Bet it" }));

    // The bank empties under the held figure. That lets it go *and* is the
    // whole reason it went, so the line owes the player the reason.
    rerender(<Harness reach={{ most: 0, purse: 50_000, bank: 0 }} />);
    expect(said()).toMatch(/bank is empty/i);
  });

  it("lets a fresh refusal outrank the release, so a dead press still says why", () => {
    const { rerender } = render(<Harness />);
    releaseHeld(rerender);

    // Now a chip the felt refuses before it sends it. With the release sitting
    // over the line the press says nothing new, which is the broken button the
    // refusal exists to prevent.
    rerender(
      <Harness
        reach={{ most: 1_000, purse: 50_000, bank: 2_000_000 }}
        refused="The bank covers 400 on that at the moment."
      />,
    );
    expect(said()).toContain("400");
  });

  it("does not leave the release up through the spin, or bring it back after", () => {
    const { rerender } = render(<Harness />);
    releaseHeld(rerender);

    // No more bets: nothing here is actionable, and a line that stays up
    // through a spin reads as a complaint about the spin.
    rerender(<Harness reach={{ most: 1_000, purse: 50_000, bank: 2_000_000 }} betting={false} />);
    expect(said()).toBe("");

    // And the window reopening is a new window. The release was about the old
    // one, and a player who has moved on is not told about it again.
    rerender(<Harness reach={{ most: 1_000, purse: 50_000, bank: 2_000_000 }} />);
    expect(said()).toBe("");
  });
});

describe("the three acts", () => {
  it("are three keys of equal weight, and none of them is a slab", () => {
    const { container } = render(<Harness />);
    expect(container.querySelector(".slab")).toBe(null);
    for (const name of ["Put last round's chips down again", "Undo the last chip you put down", "Take back everything you have on the cloth"]) {
      expect(screen.getByRole("button", { name }).classList.contains("key")).toBe(true);
    }
  });

  it("offers nothing to undo or clear with an empty cloth", () => {
    render(<Harness down={0} />);
    expect(screen.getByRole("button", { name: "Undo the last chip you put down" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Take back everything you have on the cloth" })).toBeDisabled();
  });

  it("declares its shortcuts on the buttons themselves", () => {
    render(<Harness down={500} />);
    expect(screen.getByRole("button", { name: "Put last round's chips down again" }).getAttribute("aria-keyshortcuts")).toBe("R");
    expect(screen.getByRole("button", { name: "Undo the last chip you put down" }).getAttribute("aria-keyshortcuts")).toBe("U");
    expect(screen.getByRole("button", { name: "Take back everything you have on the cloth" }).getAttribute("aria-keyshortcuts")).toBe("C");
  });
});
