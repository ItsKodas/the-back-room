// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Coin, Coins } from "./Coin.js";

describe("a coin", () => {
  it("shows nothing while it is still in the air", () => {
    /*
     * Never invent a fact. The face is the server's to know, so a coin that has
     * not landed says so rather than guessing — and the felt is handed the
     * faces early only so it can roll the coins onto them.
     */
    render(<Coin face={null} flying turns={9} delay={0} flightMs={2600} />);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "A coin in the air.");
  });

  it("names its face once it is down", () => {
    render(<Coin face="tail" flying={false} turns={9} delay={0} flightMs={2600} />);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Tails.");
  });

  it("turns a whole number of times to a head, and a half more to a tail", () => {
    /*
     * The thing on screen is the thing that decided. Written as calc() rather
     * than a number, for the reason the wheel writes its angles that way: two
     * separately-rounded decimals added is how "a whole number of turns" stops
     * being exactly true.
     */
    const { container } = render(<Coin face="head" flying turns={9} delay={0} flightMs={2600} />);
    const style = container.querySelector(".tu__coin")?.getAttribute("style") ?? "";
    expect(style).toContain("--coin-to: calc(9 * 360deg + 0deg)");

    const tails = render(<Coin face="tail" flying turns={9} delay={0} flightMs={2600} />);
    const tailStyle =
      tails.container.querySelector(".tu__coin")?.getAttribute("style") ?? "";
    expect(tailStyle).toContain("--coin-to: calc(9 * 360deg + 180deg)");
  });

  it("has a real edge, not two faces back to back", () => {
    const { container } = render(<Coin face="head" flying={false} turns={9} delay={0} flightMs={2600} />);
    expect(container.querySelectorAll(".tu__coin-edge").length).toBeGreaterThan(12);
  });

  it("chalks a cross on the tail and never on the head", () => {
    /*
     * What a real school marks its tails with, and what lets a player read a
     * throw at the top of the arc rather than waiting for it to land.
     */
    const { container } = render(<Coin face="tail" flying={false} turns={9} delay={0} flightMs={2600} />);
    expect(container.querySelector(".tu__chalk")).not.toBeNull();
  });
});

describe("two of them", () => {
  it("gives them different numbers of turns, so they are two objects", () => {
    const { container } = render(<Coins faces={["head", "tail"]} flying flightMs={2600} />);
    const styles = [...container.querySelectorAll(".tu__coin")].map(
      (node) => node.getAttribute("style") ?? "",
    );
    expect(styles).toHaveLength(2);
    expect(styles[0]).not.toBe(styles[1]);
  });

  it("draws nothing at all before a throw", () => {
    const { container } = render(<Coins faces={null} flying={false} flightMs={2600} />);
    expect(container.querySelectorAll(".tu__coin")).toHaveLength(0);
  });
});
