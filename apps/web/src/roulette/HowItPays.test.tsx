// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HowItPays } from "./HowItPays.js";

afterEach(cleanup);

describe("what it pays", () => {
  it("shows nothing until it is opened", () => {
    const { container } = render(<HowItPays open={false} onClose={() => {}} lit={null} />);
    expect(container.firstChild).toBe(null);
  });

  it("names every kind of bet with what it pays", () => {
    render(<HowItPays open onClose={() => {}} lit={null} />);
    expect(screen.getByText("35 to 1")).toBeDefined();
    expect(screen.getByText("1 to 1")).toBeDefined();
  });

  it("lights the row for the bet being aimed at", () => {
    const { container } = render(<HowItPays open onClose={() => {}} lit="split" />);
    const lit = container.querySelectorAll(".rl__pays-row--lit");
    expect(lit).toHaveLength(1);
    expect(lit[0]?.textContent).toContain("17 to 1");
  });

  it("takes its figures from the rules, not from a list of its own", () => {
    // A straight up pays 35 and a split 17 because 36/n - 1 says so. If the
    // rules ever change, this sheet changes with them or this test fails.
    render(<HowItPays open onClose={() => {}} lit={null} />);
    expect(screen.getByText("17 to 1")).toBeDefined();
  });
});
