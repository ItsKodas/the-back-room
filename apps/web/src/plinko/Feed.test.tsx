// @vitest-environment jsdom
import type { PlinkoDrop } from "@backroom/shared";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Feed } from "./Feed.js";

const drop = (id: string, mult: number, won: number): PlinkoDrop => ({
  id,
  by: { name: "Mia", colour: 3 },
  risk: "high",
  path: Array(12).fill(false),
  bucket: 0,
  mult,
  stake: 10,
  won,
  bank: 1_000,
  at: 0,
});

describe("the feed", () => {
  it("names who dropped, the stake, the multiplier and what it paid", () => {
    const { container } = render(<Feed drops={[drop("a", 1700, 1700)]} here={[]} />);
    expect(container.textContent).toContain("Mia");
    expect(container.querySelector(".pk-feed__stake")?.textContent).toBe("10");
    expect(container.textContent).toContain("170×");
    expect(container.textContent).toContain("+1,700");
  });

  it("edges each drop in its player's colour", () => {
    const { container } = render(<Feed drops={[drop("a", 5, 0)]} here={[]} />);
    const row = container.querySelector(".pk-feed__drop") as HTMLElement;
    expect(row.style.getPropertyValue("--pk-who")).toBe("var(--pk-c3)");
  });

  it("says how many are at the board", () => {
    const here = [
      { name: "Mia", colour: 3 },
      { name: "Ada", colour: 1 },
    ];
    const { container } = render(<Feed drops={[]} here={here} />);
    expect(container.textContent).toContain("2 at the board");
  });
});
