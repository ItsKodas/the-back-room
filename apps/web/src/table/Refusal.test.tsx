// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { play } from "../game/audio.js";
import { Refusal } from "./Refusal.js";

vi.mock("../game/audio.js", () => ({ play: vi.fn() }));

const NO = "You need 500 in one turn to get on the board.";

beforeEach(() => {
  vi.mocked(play).mockClear();
});

describe("a refusal at the table", () => {
  it("is not there while nothing has been refused", () => {
    render(<Refusal message={null} id={0} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(play).not.toHaveBeenCalled();
  });

  it("shows in the middle of the board and sounds when the table says no", () => {
    const { rerender } = render(<Refusal message={null} id={0} />);
    rerender(<Refusal message={NO} id={1} />);
    expect(screen.getByRole("alert").textContent).toContain(NO);
    expect(vi.mocked(play).mock.calls).toEqual([["refused"]]);
  });

  it("goes at a tap", () => {
    const { rerender } = render(<Refusal message={null} id={0} />);
    rerender(<Refusal message={NO} id={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("comes back, and sounds again, for the same words refused a second time", () => {
    const { rerender } = render(<Refusal message={null} id={0} />);
    rerender(<Refusal message={NO} id={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    rerender(<Refusal message={NO} id={2} />);
    expect(screen.getByRole("alert").textContent).toContain(NO);
    expect(vi.mocked(play).mock.calls).toEqual([["refused"], ["refused"]]);
  });

  it("does not sound for a refusal that was already standing when the table appeared", () => {
    render(<Refusal message={NO} id={3} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(play).not.toHaveBeenCalled();
  });
});
