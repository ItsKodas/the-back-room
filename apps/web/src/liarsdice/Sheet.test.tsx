// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Sheet } from "./Sheet.js";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" aria-controls="test-sheet" onClick={() => setOpen(true)}>
        Open
      </button>
      {/* A fresh function every render, as a careless owner would pass. */}
      <Sheet id="test-sheet" label="How it pays" open={open} onClose={() => setOpen(false)} className="ld__sheet--felt">
        <p>Inside</p>
      </Sheet>
    </div>
  );
}

describe("a sheet at the table", () => {
  it("is not there while shut", () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is a dialog named for what it holds, and takes the focus", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const sheet = screen.getByRole("dialog", { name: "How it pays" });
    expect(sheet.textContent).toContain("Inside");
    expect(document.activeElement).toBe(sheet);
  });

  it("closes on Escape and hands the focus back to the key that opened it", () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open" });
    fireEvent.click(opener);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("closes from its scrim", () => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const scrim = container.querySelector(".ld__scrim");
    if (scrim !== null) {
      fireEvent.click(scrim);
    }
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
