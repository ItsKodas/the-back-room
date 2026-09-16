// @vitest-environment jsdom
import type { TableView } from "@backroom/game-scribble";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../game/useAccount.js";
import type { TableSocketHook } from "../table/useTableSocket.js";
import { INK_RGB } from "./raster.js";
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
    const { container } = render(<Felt table={stub()} state={state} seatId="s0" />);
    expect(screen.getByRole("dialog", { name: "Pick a word" })).toBeInTheDocument();
    // Picking overlays the napkin rather than replacing it — the overlay
    // covers it, so there is no dead space to reclaim by unmounting here.
    expect(container.querySelector(".sc-napkin")).not.toBeNull();
  });

  it("reserves the napkin only the chrome height the phase actually on screen needs", () => {
    // A guesser mid-turn never gets a Tray (only the drawer does — see the
    // next test), so their napkin should get the smaller, tray-less
    // reservation exactly like picking or reveal would; only the drawer's
    // own view, with the tray actually below the strip, pays the larger one.
    const guessing = viewOf();
    const { container: guesserView } = render(<Felt table={stub()} state={guessing} seatId="s1" />);
    const guesserSc = guesserView.querySelector(".sc") as HTMLElement;
    expect(guesserSc.style.getPropertyValue("--sc-chrome")).toBe("232px");

    const drawingState = viewOf({ you: seat("s0", { drawing: true }) });
    const { container: drawerView } = render(<Felt table={stub()} state={drawingState} seatId="s0" />);
    const drawerSc = drawerView.querySelector(".sc") as HTMLElement;
    expect(drawerSc.style.getPropertyValue("--sc-chrome")).toBe("408px");
  });

  it("hides the blank napkin for the whole waiting phase, in both modes", () => {
    // No turn exists in "waiting", so the napkin is definitionally blank —
    // dead space whether a team-pick screen or a solo table's own notice
    // is what's actually sitting above it.
    const teamsWaiting = viewOf({
      phase: "waiting",
      mode: "teams",
      turn: null,
      mask: null,
      seats: [seat("s0"), seat("s1"), seat("s2"), seat("s3")],
      teams: [
        { index: 0, name: "Blue", score: 0, members: [] },
        { index: 1, name: "Orange", score: 0, members: [] },
      ],
    });
    const teamsResult = render(<Felt table={stub()} state={teamsWaiting} seatId="s1" />);
    expect(teamsResult.container.querySelector(".sc-napkin")).toBeNull();
    teamsResult.unmount();

    const soloWaiting = viewOf({ phase: "waiting", mode: "solo", turn: null, mask: null, seats: [seat("s0")] });
    const soloResult = render(<Felt table={stub()} state={soloWaiting} seatId="s0" />);
    expect(soloResult.container.querySelector(".sc-napkin")).toBeNull();
    expect(soloResult.getByText(/more to sit down/)).toBeInTheDocument();
  });

  it("keeps the ink machinery in step across the transition out of waiting, so the turn's first stroke still lands", () => {
    const painted: Uint8ClampedArray[] = [];
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
    // Frames run at once, so the assertion below reads the picture straight after the stroke.
    vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
      run(0);
      return 1;
    });
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

    const waiting = viewOf({ phase: "waiting", mode: "solo", turn: null, mask: null, you: seat("s0"), seats: [seat("s0"), seat("s1")] });
    const { container, rerender } = render(<Felt table={stub()} state={waiting} seatId="s0" />);
    expect(container.querySelector(".sc-napkin")).toBeNull();

    const drawing = viewOf({ phase: "drawing", you: seat("s0", { drawing: true }) });
    rerender(<Felt table={stub()} state={drawing} seatId="s0" />);

    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    fireEvent.pointerDown(canvas, { clientX: 50, clientY: 50, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 100, clientY: 50, pointerId: 1 });

    const last = painted.at(-1) as Uint8ClampedArray;
    const at = (100 * 1000 + 150) * 4;
    expect([last[at], last[at + 1], last[at + 2]]).toEqual([...INK_RGB.black]);
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
