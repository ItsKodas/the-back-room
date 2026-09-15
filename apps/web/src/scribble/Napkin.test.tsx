// @vitest-environment jsdom
import type { TableView } from "@backroom/game-scribble";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Napkin } from "./Napkin.js";
import { INK_RGB } from "./raster.js";
import { seat, viewOf } from "./testView.js";
import type { InkTable, Tool } from "./useInk.js";
import { FLUSH_MS, useInk } from "./useInk.js";

const painted: Uint8ClampedArray[] = [];

beforeEach(() => {
  painted.length = 0;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({
        createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }),
        putImageData: (image: { data: Uint8ClampedArray }) => painted.push(new Uint8ClampedArray(image.data)),
      }) as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 500,
    height: 375,
    right: 500,
    bottom: 375,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  // Frames run at once, so a test reads the picture straight after the event that drew it.
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
    run(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  // jsdom has no PointerEvent; testing-library builds events from whatever window names.
  if (!("PointerEvent" in window)) {
    class FakePointer extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    }
    vi.stubGlobal("PointerEvent", FakePointer);
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// Fakes only the flush loop's timers: the frame stub above has to keep
// running frames at once, and vi.useFakeTimers() with no `toFake` list would
// otherwise replace it with a fake requestAnimationFrame that never fires
// without an explicit advance — painting nothing before a test can look.
const fakeFlushTimers = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });

const pen: Tool = { ink: "red", size: 1, mode: "pen" };

function Harness({ table, state, seatId, tool = pen }: { table: InkTable; state: TableView; seatId: string; tool?: Tool }) {
  const ink = useInk(table, state, seatId);
  return <Napkin ink={ink} tool={tool} />;
}

const pixel = (x: number, y: number) => {
  const last = painted.at(-1) as Uint8ClampedArray;
  const at = (y * 1000 + x) * 4;
  return [last[at], last[at + 1], last[at + 2]];
};

const drawerView = () => viewOf({ you: seat("s0", { drawing: true }) });

describe("the napkin", () => {
  it("puts your line on it the moment you draw, long before the server could answer", () => {
    fakeFlushTimers();
    const act = vi.fn();
    const table: InkTable = { act, error: null, onRelay: () => () => {} };
    const { container } = render(<Harness table={table} state={drawerView()} seatId="s0" />);
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;

    fireEvent.pointerDown(canvas, { clientX: 50, clientY: 50, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 100, clientY: 50, pointerId: 1 });

    expect(act).not.toHaveBeenCalled();
    expect(pixel(150, 100)).toEqual([...INK_RGB.red]);

    vi.advanceTimersByTime(FLUSH_MS);
    expect(act).toHaveBeenCalledWith(
      expect.objectContaining({ type: "stroke", seq: 0, ink: "red", size: 1, pts: [100, 100, 200, 100] }),
    );
  });

  it("sends the last of a line as soon as the finger lifts", () => {
    fakeFlushTimers();
    const act = vi.fn();
    const { container } = render(<Harness table={{ act, error: null, onRelay: () => () => {} }} state={drawerView()} seatId="s0" />);
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
    expect(act).toHaveBeenCalledTimes(1);
  });

  it("does nothing under a guesser's finger", () => {
    const act = vi.fn();
    const { container } = render(<Harness table={{ act, error: null, onRelay: () => () => {} }} state={viewOf()} seatId="s1" />);
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    fireEvent.pointerDown(canvas, { clientX: 50, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 50, clientY: 50, pointerId: 1 });
    expect(act).not.toHaveBeenCalled();
    expect(pixel(100, 100)).toEqual([...INK_RGB.paper]);
  });

  it("draws a partner's line as it is relayed", () => {
    let hear: (relay: { seatId: string; payload: unknown }) => void = () => {};
    const table: InkTable = {
      act: vi.fn(),
      error: null,
      onRelay: (listener) => {
        hear = listener;
        return () => {};
      },
    };
    render(<Harness table={table} state={viewOf()} seatId="s1" />);
    hear({ seatId: "s0", payload: { kind: "stroke", id: "p1", by: "s0", ink: "blue", size: 1, seq: 0, pts: [300, 300, 400, 300] } });
    expect(pixel(350, 300)).toEqual([...INK_RGB.blue]);
  });

  it("gives your line up when the table refuses it", () => {
    const table: InkTable = { act: vi.fn(), error: null, onRelay: () => () => {} };
    const state = drawerView();
    const { container, rerender } = render(<Harness table={table} state={state} seatId="s0" />);
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    fireEvent.pointerDown(canvas, { clientX: 50, clientY: 50, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 100, clientY: 50, pointerId: 1 });
    expect(pixel(150, 100)).toEqual([...INK_RGB.red]);

    rerender(<Harness table={{ ...table, error: "The napkin's full." }} state={state} seatId="s0" />);
    expect(pixel(150, 100)).toEqual([...INK_RGB.paper]);
  });

  it("floods a fill at once", () => {
    const act = vi.fn();
    const { container } = render(
      <Harness table={{ act, error: null, onRelay: () => () => {} }} state={drawerView()} seatId="s0" tool={{ ink: "green", size: 1, mode: "fill" }} />,
    );
    fireEvent.pointerDown(container.querySelector("canvas") as HTMLCanvasElement, { clientX: 5, clientY: 5, pointerId: 1 });
    expect(pixel(900, 700)).toEqual([...INK_RGB.green]);
    expect(act).toHaveBeenCalledWith(expect.objectContaining({ type: "fill", ink: "green", x: 10, y: 10 }));
  });
});
