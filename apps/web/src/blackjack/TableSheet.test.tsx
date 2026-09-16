// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TableSheetProps } from "./TableSheet.js";
import { TableSheet } from "./TableSheet.js";

function sheet(over: Partial<TableSheetProps> = {}) {
  const props: TableSheetProps = {
    open: true,
    onClose: vi.fn(),
    code: "HG4ME",
    bettingMs: 30_000,
    listed: true,
    forFun: true,
    seated: 2,
    maxSeats: 6,
    onWindow: vi.fn(),
    onListed: vi.fn(),
    onBot: vi.fn(),
    ...over,
  };
  render(<TableSheet {...props} />);
  return props;
}

describe("the host's Table sheet", () => {
  it("is a dialog headed with the table's code", () => {
    sheet();
    const dialog = screen.getByRole("dialog", { name: "Table" });
    expect(within(dialog).getByRole("heading").textContent).toBe("Table HG4ME");
  });

  it("sets how long everybody gets to bet, from the next hand", () => {
    const props = sheet();
    const windows = within(screen.getByRole("group", { name: "Time to bet" }));
    expect(windows.getByRole("button", { name: "30s" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(windows.getByRole("button", { name: "60s" }));
    expect(props.onWindow).toHaveBeenCalledWith(60_000);
    expect(screen.getByText("Takes effect on the next hand.")).toBeTruthy();
  });

  it("sets who can find the table", () => {
    const props = sheet();
    fireEvent.click(within(screen.getByRole("group", { name: "Who can find it" })).getByRole("button", { name: "Private" }));
    expect(props.onListed).toHaveBeenCalledWith(false);
  });

  it("adds a bot at a for-fun table with a seat free", () => {
    const props = sheet();
    fireEvent.click(screen.getByRole("button", { name: "Hard" }));
    expect(props.onBot).toHaveBeenCalledWith("hard");
  });

  it("offers no bot at a table for chips", () => {
    sheet({ forFun: false });
    expect(screen.queryByRole("button", { name: "Easy" })).toBeNull();
  });

  it("offers no bot at a full table", () => {
    sheet({ seated: 6 });
    expect(screen.queryByRole("button", { name: "Easy" })).toBeNull();
  });
});
