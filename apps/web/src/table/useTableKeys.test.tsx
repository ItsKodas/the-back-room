// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTableKeys } from "./useTableKeys.js";

afterEach(cleanup);

function Harness({ onR, disabled = false }: { onR: () => void; disabled?: boolean }) {
  const root = useRef<HTMLElement | null>(null);
  useTableKeys(root, { r: "R" });
  return (
    <section ref={root}>
      <button type="button" aria-keyshortcuts="R" disabled={disabled} onClick={onR}>
        Same again
      </button>
      <input aria-label="say" />
    </section>
  );
}

describe("useTableKeys", () => {
  it("presses the button that declares the shortcut", () => {
    const onR = vi.fn();
    render(<Harness onR={onR} />);
    fireEvent.keyDown(window, { key: "r" });
    expect(onR).toHaveBeenCalledTimes(1);
  });

  it("does nothing while typing", () => {
    const onR = vi.fn();
    render(<Harness onR={onR} />);
    fireEvent.keyDown(screen.getByLabelText("say"), { key: "r" });
    expect(onR).not.toHaveBeenCalled();
  });

  it("does nothing with a modifier held, or on a repeat", () => {
    const onR = vi.fn();
    render(<Harness onR={onR} />);
    fireEvent.keyDown(window, { key: "r", ctrlKey: true });
    fireEvent.keyDown(window, { key: "r", metaKey: true });
    fireEvent.keyDown(window, { key: "r", altKey: true });
    fireEvent.keyDown(window, { key: "r", repeat: true });
    expect(onR).not.toHaveBeenCalled();
  });

  it("does nothing for a button that could not be pressed", () => {
    const onR = vi.fn();
    render(<Harness onR={onR} disabled />);
    fireEvent.keyDown(window, { key: "r" });
    expect(onR).not.toHaveBeenCalled();
  });
});
