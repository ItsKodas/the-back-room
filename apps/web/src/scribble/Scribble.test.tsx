// @vitest-environment jsdom
import type { TableView } from "@backroom/game-scribble";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../game/useAccount.js";
import type { TableSocketHook } from "../table/useTableSocket.js";
import { Felt, Sit } from "./Scribble.js";
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
    busy: false,
    connected: true,
    join: vi.fn(),
    watch: vi.fn(),
    create: vi.fn(),
    ...over,
  }) as unknown as Table;

const account: Account = {
  profile: {
    id: "1",
    name: "Ada",
    avatar: null,
    accentColor: null,
    chips: 0,
    stats: { rounds: 0, roundsWon: 0, chipsWon: 0, chipsStaked: 0 },
    byGame: {},
  },
  available: true,
  loading: false,
  admin: false,
  refresh: () => {},
  setChips: () => {},
  signOut: () => {},
};

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

  it("clips a clear's wipe to the napkin itself, not loose over the felt beside it", () => {
    // .sc-napkin is the thing that is already overflow: hidden and rounded; a
    // sibling of it at the stage level is neither, and — with no
    // animation-fill-mode — reverts to a stage-sized, opaque-in-the-middle box
    // that never unmounts, sitting over the Teams column for good.
    const state = viewOf({ you: seat("s0", { drawing: true }) });
    const { container } = render(<Felt table={stub()} state={state} seatId="s0" />);
    fireEvent.click(screen.getByRole("button", { name: "Clear the napkin" }));
    const wipe = container.querySelector(".sc-napkin__wipe");
    expect(wipe).not.toBeNull();
    expect(wipe?.parentElement).toHaveClass("sc-napkin");
  });
});

describe("the setup screen's word packs", () => {
  it("never leaves the host believing the table has no words when the server would quietly hand it the defaults anyway", () => {
    render(<Sit table={stub()} invited="" account={account} />);
    const textarea = screen.getByPlaceholderText("Kev's van, the jukebox, pint of mild");

    // Ten words, the minimum that lets custom words stand in for the packs.
    // Plain letters only: parseCustomWords' SHAPE rule drops anything with a
    // digit in it, which "word0".."word9" would have been.
    const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet"].join(", ");
    fireEvent.change(textarea, { target: { value: words } });
    fireEvent.click(screen.getByRole("button", { name: "Only my words" }));

    // Take every default pack out, now that the custom list is standing in for them.
    for (const name of ["Everyday", "Animals", "Food & drink"]) {
      fireEvent.click(screen.getByRole("button", { name }));
    }
    expect(screen.getByRole("button", { name: "Everyday" })).toHaveAttribute("aria-pressed", "false");

    // Thin the words back out: "only my words" can no longer stand in for the packs.
    fireEvent.change(textarea, { target: { value: "alpha" } });

    expect(screen.getByRole("button", { name: "Only my words" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Everyday" })).toHaveAttribute("aria-pressed", "true");
  });
});
