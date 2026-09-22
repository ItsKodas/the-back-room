// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { useLiarsKeys } from "./useLiarsKeys.js";

function Harness({
  onBid,
  onLiar,
  busy = false,
  disabled = false,
}: {
  onBid: () => void;
  onLiar: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  const root = useRef<HTMLElement | null>(null);
  useLiarsKeys(root);
  return (
    <section ref={root}>
      <div className="ld__builder">
        <button type="button" className="ld__face-lamp" onClick={onBid}>
          5
        </button>
      </div>
      <button
        type="button"
        aria-keyshortcuts="Space"
        className={busy ? "slab is-busy" : "slab"}
        disabled={disabled}
        onClick={onBid}
      >
        Bid
      </button>
      <button type="button" aria-keyshortcuts="L" onClick={onLiar}>
        Liar
      </button>
      <input aria-label="Say something" />
      <div role="dialog">
        <button type="button">In a sheet</button>
      </div>
    </section>
  );
}

const press = (key: string, over: Partial<KeyboardEventInit> = {}, target?: Element) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...over });
  (target ?? document.body).dispatchEvent(event);
  return event;
};

describe("the keys", () => {
  it("presses the button Space stands for", () => {
    const onBid = vi.fn();
    render(<Harness onBid={onBid} onLiar={vi.fn()} />);
    press(" ");
    expect(onBid).toHaveBeenCalledTimes(1);
  });

  it("presses the button L stands for, whatever the case", () => {
    const onLiar = vi.fn();
    render(<Harness onBid={vi.fn()} onLiar={onLiar} />);
    press("L");
    press("l");
    expect(onLiar).toHaveBeenCalledTimes(2);
  });

  it("stops the page scrolling on Space", () => {
    render(<Harness onBid={vi.fn()} onLiar={vi.fn()} />);
    expect(press(" ").defaultPrevented).toBe(true);
  });

  it("does nothing while typing", () => {
    const onBid = vi.fn();
    const { container } = render(<Harness onBid={onBid} onLiar={vi.fn()} />);
    press(" ", {}, container.querySelector("input") as Element);
    expect(onBid).not.toHaveBeenCalled();
  });

  it("does nothing inside a sheet", () => {
    const onBid = vi.fn();
    const { container } = render(<Harness onBid={onBid} onLiar={vi.fn()} />);
    press(" ", {}, container.querySelector("[role='dialog'] button") as Element);
    expect(onBid).not.toHaveBeenCalled();
  });

  it("leaves a modifier to the browser", () => {
    const onBid = vi.fn();
    render(<Harness onBid={onBid} onLiar={vi.fn()} />);
    press(" ", { ctrlKey: true });
    press(" ", { metaKey: true });
    press(" ", { altKey: true });
    expect(onBid).not.toHaveBeenCalled();
  });

  it("counts a held key once", () => {
    const onBid = vi.fn();
    render(<Harness onBid={onBid} onLiar={vi.fn()} />);
    press(" ", { repeat: true });
    expect(onBid).not.toHaveBeenCalled();
  });

  it("does nothing for a button that could not be pressed", () => {
    const onBid = vi.fn();
    const { unmount } = render(<Harness onBid={onBid} onLiar={vi.fn()} disabled />);
    press(" ");
    expect(onBid).not.toHaveBeenCalled();
    unmount();
    render(<Harness onBid={onBid} onLiar={vi.fn()} busy />);
    press(" ");
    expect(onBid).not.toHaveBeenCalled();
  });

  it("hands Space to the table from a lamp that was clicked", () => {
    const onBid = vi.fn();
    const { container } = render(<Harness onBid={onBid} onLiar={vi.fn()} />);
    const lamp = container.querySelector(".ld__face-lamp") as HTMLElement;
    lamp.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    press(" ", {}, lamp);
    // One call, and it came from the slab rather than the lamp.
    expect(onBid).toHaveBeenCalledTimes(1);
  });

  it("leaves Space with a lamp reached by keyboard", () => {
    const onBid = vi.fn();
    const { container } = render(<Harness onBid={onBid} onLiar={vi.fn()} />);
    const lamp = container.querySelector(".ld__face-lamp") as HTMLElement;
    // Focus arriving anywhere other than the last clicked piece forgets it,
    // which is how a tabbed-to lamp keeps its own Space.
    lamp.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    const event = press(" ", {}, lamp);
    expect(event.defaultPrevented).toBe(false);
    expect(onBid).not.toHaveBeenCalled();
  });

  it("is not what :focus-visible says", () => {
    // Chrome reports a clicked button as keyboard-focused the moment a key goes
    // down on it, which is exactly when this has to know the difference. Proven
    // by making the browser lie and showing the answer does not change.
    const onBid = vi.fn();
    const { container } = render(<Harness onBid={onBid} onLiar={vi.fn()} />);
    const lamp = container.querySelector(".ld__face-lamp") as HTMLElement;
    const matches = vi.spyOn(lamp, "matches").mockReturnValue(true);
    lamp.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    press(" ", {}, lamp);
    expect(onBid).toHaveBeenCalledTimes(1);
    matches.mockRestore();
  });
});
