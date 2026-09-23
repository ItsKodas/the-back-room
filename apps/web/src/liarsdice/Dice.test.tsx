// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Die, Hand } from "./Dice.js";

describe("a die", () => {
  it("shows its pips and says its face", () => {
    const { container } = render(<Die face={5} index={0} />);
    expect(container.querySelectorAll(".ld-die__pip")).toHaveLength(5);
    expect(screen.getByLabelText("Showing five")).toBeInTheDocument();
  });

  it("shows nothing at all for a face nobody has been told", () => {
    const { container } = render(<Die face={null} index={0} />);
    expect(container.querySelectorAll(".ld-die__pip")).toHaveLength(0);
    expect(container.querySelector(".ld-die--down")).not.toBe(null);
    expect(screen.getByLabelText("Face down")).toBeInTheDocument();
  });

  it("lights a die the count is about", () => {
    const { container } = render(<Die face={5} index={0} matched />);
    expect(container.querySelector(".ld-die--matched")).not.toBe(null);
  });

  it("staggers each die a beat after the one before", () => {
    const { container } = render(<Die face={3} index={2} />);
    expect(container.querySelector<HTMLElement>(".ld-die")?.style.animationDelay).toBe("80ms");
  });
});

describe("a hand", () => {
  it("draws one die per face and names itself", () => {
    const { container } = render(<Hand dice={[1, 5, null]} label="Your dice" />);
    expect(container.querySelectorAll(".ld-die")).toHaveLength(3);
    expect(screen.getByLabelText("Your dice")).toBeInTheDocument();
  });

  it("lights only the dice the bid is about, ones included", () => {
    const { container } = render(<Hand dice={[1, 5, 3]} matched={5} label="Your dice" />);
    expect(container.querySelectorAll(".ld-die--matched")).toHaveLength(2);
  });

  it("lights only real ones when ones are what was bid", () => {
    const { container } = render(<Hand dice={[1, 5, 3]} matched={1} label="Your dice" />);
    expect(container.querySelectorAll(".ld-die--matched")).toHaveLength(1);
  });
});
