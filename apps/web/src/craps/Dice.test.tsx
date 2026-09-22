// @vitest-environment jsdom
import type { Roll } from "@backroom/game-craps";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Dice } from "./Dice.js";

describe("the dice on screen", () => {
  it("says nothing about the result while they are in the air", () => {
    render(<Dice dice={[3, 5] as Roll} thrown ms={2_400} />);
    expect(screen.getByRole("status")).toHaveTextContent(/rolling/i);
    expect(screen.queryByText("8")).toBeNull();
  });

  it("reads the total out once they have stopped", () => {
    render(<Dice dice={[3, 5] as Roll} thrown={false} ms={2_400} />);
    expect(screen.getByRole("status")).toHaveTextContent("8");
  });

  it("shows nothing at all before anything has been thrown", () => {
    render(<Dice dice={null} thrown={false} ms={2_400} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
