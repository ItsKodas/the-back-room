// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Rules } from "./Rules.js";

describe("the rules card", () => {
  it("says the three moves", () => {
    render(<Rules standing={null} />);
    expect(screen.getByText(/Raise/)).toBeInTheDocument();
    expect(screen.getByText(/Liar/)).toBeInTheDocument();
    expect(screen.getByText(/Exact/)).toBeInTheDocument();
  });

  it("says ones are wild", () => {
    render(<Rules standing={null} />);
    expect(screen.getByText(/wild/)).toBeInTheDocument();
  });

  it("lights the row that applies to a plain standing bid", () => {
    const { container } = render(<Rules standing={{ count: 4, face: 5 }} />);
    expect(container.querySelector(".ld__rule--on")?.textContent).toContain("plain face");
  });

  it("lights the other row when ones are standing", () => {
    const { container } = render(<Rules standing={{ count: 3, face: 1 }} />);
    expect(container.querySelector(".ld__rule--on")?.textContent).toContain("ones");
  });

  it("lights neither with nothing said", () => {
    const { container } = render(<Rules standing={null} />);
    expect(container.querySelector(".ld__rule--on")).toBe(null);
  });

  it("works out the actual figures for the bid on the table", () => {
    // Four sixes standing: two ones beats it outright, and since six is
    // already the top plain face, beating THAT two-ones bid back needs five
    // of a plain face — leastCount(2, {count: 2, face: 1}, 50) === 5, not the
    // nine you get by doubling four sixes' own count directly.
    render(<Rules standing={{ count: 4, face: 6 }} />);
    expect(screen.getByText(/two ones/)).toBeInTheDocument();
    expect(screen.getByText(/five/)).toBeInTheDocument();
  });
});
