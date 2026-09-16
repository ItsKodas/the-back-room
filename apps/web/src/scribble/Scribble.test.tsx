// @vitest-environment jsdom
import type { TableView } from "@backroom/game-scribble";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TableSocketHook } from "../table/useTableSocket.js";
import { Felt } from "./Scribble.js";
import { seat, viewOf } from "./testView.js";

type Table = TableSocketHook<TableView>;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({
        createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }),
        putImageData: () => {},
      }) as unknown as CanvasRenderingContext2D,
  );
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const stub = (over: Partial<Table> = {}): Table =>
  ({
    act: vi.fn(),
    say: vi.fn(),
    chat: [],
    error: null,
    onRelay: () => () => {},
    // useInk subscribes to this unconditionally; without it every render of
    // Felt throws before a single assertion runs.
    onError: () => () => {},
    ...over,
  }) as unknown as Table;

describe("the scribble felt", () => {
  it("gives a guesser the guess box and no drawing tools", () => {
    render(<Felt table={stub()} state={viewOf()} seatId="s1" />);
    expect(screen.getByPlaceholderText("Type your guess")).toBeInTheDocument();
    expect(screen.queryByRole("toolbar", { name: "Drawing tools" })).toBeNull();
  });

  it("gives the drawer the tools, and no box to give the word away in", () => {
    const state = viewOf({ you: seat("s0", { drawing: true }), word: "lighthouse", mask: null });
    render(<Felt table={stub()} state={state} seatId="s0" />);
    expect(screen.getByRole("toolbar", { name: "Drawing tools" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("asks for teams between games at a teams table", () => {
    const seats = [seat("s0"), seat("s1"), seat("s2"), seat("s3")];
    const state = viewOf({
      phase: "waiting",
      mode: "teams",
      seats,
      turn: null,
      mask: null,
      teams: [
        { index: 0, name: "Blue", score: 0, members: [] },
        { index: 1, name: "Orange", score: 0, members: [] },
      ],
    });
    render(<Felt table={stub()} state={state} seatId="s1" />);
    expect(screen.getByRole("radiogroup", { name: "Your team" })).toBeInTheDocument();
  });

  it("puts the word pick over the napkin while picking", () => {
    const state = viewOf({ phase: "picking", mask: null, you: seat("s0", { drawing: true }), choices: ["a cat", "a dog", "a hat"] });
    render(<Felt table={stub()} state={state} seatId="s0" />);
    expect(screen.getByRole("dialog", { name: "Pick a word" })).toBeInTheDocument();
  });
});
