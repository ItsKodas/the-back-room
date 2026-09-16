// @vitest-environment jsdom
import type { TableView } from "@backroom/game-scribble";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Reveal } from "./Reveal.js";
import { Strip } from "./Strip.js";
import { TeamPick } from "./TeamPick.js";
import { Teams } from "./Teams.js";
import { seat, viewOf } from "./testView.js";
import { Tray, TRAY_INKS } from "./Tray.js";
import { WordPick } from "./WordPick.js";

afterEach(cleanup);

describe("the strip", () => {
  it("shows a guesser blanks, with any hint letters, and never the word", () => {
    const { container } = render(<Strip state={viewOf({ mask: [null, "i", null, null] })} />);
    expect(container.querySelectorAll(".sc-word i")).toHaveLength(4);
    expect(container.querySelector(".sc-word i.is-open")?.textContent).toBe("I");
  });

  it("shows the drawers the word itself", () => {
    render(<Strip state={viewOf({ word: "lighthouse", mask: null, you: seat("s0", { drawing: true }) })} />);
    expect(screen.getByText("LIGHTHOUSE")).toBeInTheDocument();
  });

  it("speaks the actual hint letters to a screen reader, not just a count", () => {
    // role="img" replaces the DOM content in the accessibility tree, so the
    // count alone would hide every revealed letter from a blind player.
    const { container } = render(<Strip state={viewOf({ mask: [null, "i", " ", "g"] })} />);
    expect(container.querySelector(".sc-word")?.getAttribute("aria-label")).toBe("3 letters: blank, I, space, G");
  });

  it("gives the clock a stable name whether or not there's a count to show yet", () => {
    const { container: withDeadline } = render(<Strip state={viewOf()} />);
    expect(withDeadline.querySelector(".sc-clock")?.getAttribute("aria-label")).toBe("Time left");
    cleanup();
    const { container: noDeadline } = render(<Strip state={viewOf({ deadline: null })} />);
    expect(noDeadline.querySelector(".sc-clock")?.getAttribute("aria-label")).toBe("Time left");
  });

  it("names the round, and gets who's drawing right for one, two, or a team", () => {
    const { container: alone } = render(
      <Strip
        state={viewOf({
          round: 2,
          rounds: 5,
          seats: [seat("s0", { drawing: true }), seat("s1")],
          you: seat("s1"),
          turn: { drawers: ["s0"], picker: "s0", team: null, startedAt: 1 },
        })}
      />,
    );
    expect(screen.getByText("Round 2 of 5")).toBeInTheDocument();
    expect(alone.querySelector(".sc-strip__turn b")?.textContent).toBe("S0 draws");
    cleanup();

    const you = seat("s0", { drawing: true });
    const { container: solo } = render(
      <Strip
        state={viewOf({
          seats: [you, seat("s1")],
          you,
          turn: { drawers: ["s0"], picker: "s0", team: null, startedAt: 1 },
        })}
      />,
    );
    expect(solo.querySelector(".sc-strip__turn b")?.textContent).toBe("You draw");
    cleanup();

    // The bug this guards: pluralising on whether the *first-listed* drawer
    // is "You", rather than on how many drawers there are, said "S1 & You draws".
    const partner = seat("s0", { drawing: true });
    const { container: pair } = render(
      <Strip
        state={viewOf({
          seats: [seat("s1", { drawing: true }), partner],
          you: partner,
          turn: { drawers: ["s1", "s0"], picker: "s1", team: null, startedAt: 1 },
        })}
      />,
    );
    expect(pair.querySelector(".sc-strip__turn b")?.textContent).toBe("S1 & You draw");
  });

  it("carries the fuse's starting fraction and remaining time as custom properties, off the injected clock", () => {
    // 40s of an 80s turn remain: half the bar, forty thousand milliseconds —
    // both read from `now`/`deadline` on the view, never `Date.now()`, so
    // this is exactly as true on a fake clock as on a real one.
    const { container } = render(
      <Strip state={viewOf({ phase: "drawing", drawMs: 80_000, deadline: 2_000_060_000, now: 2_000_020_000 })} />,
    );
    const strip = container.querySelector(".sc-strip") as HTMLElement;
    expect(strip.style.getPropertyValue("--fuse-from")).toBe("50%");
    expect(strip.style.getPropertyValue("--fuse-ms")).toBe("40000ms");
  });

  it("replays the burn for a new turn rather than continuing the last one's position", () => {
    // A CSS animation only restarts if the element carrying it is a fresh
    // DOM node — hence the key change on a new deadline. Same node, same
    // animation: it would keep burning from wherever it left off.
    const first = viewOf({ phase: "drawing", drawMs: 80_000, deadline: 2_000_060_000, now: 2_000_000_000 });
    const { container, rerender } = render(<Strip state={first} />);
    const before = container.querySelector(".sc-strip");
    const second = viewOf({ phase: "drawing", drawMs: 80_000, deadline: 2_000_140_000, now: 2_000_060_000 });
    rerender(<Strip state={second} />);
    const after = container.querySelector(".sc-strip");
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
  });

  it("does not replay the burn for an unrelated re-render within the same turn", () => {
    // A hint landing, a guess coming in — anything that re-renders the strip
    // without a new deadline must leave the running animation alone.
    const state = viewOf({ phase: "drawing", drawMs: 80_000, deadline: 2_000_060_000, now: 2_000_000_000, mask: [null, null] });
    const { container, rerender } = render(<Strip state={state} />);
    const before = container.querySelector(".sc-strip");
    rerender(<Strip state={{ ...state, mask: ["l", null] }} />);
    const after = container.querySelector(".sc-strip");
    expect(after).toBe(before);
  });

  it("keeps --left stepping once a second, the reduced-motion floor", () => {
    // The keyframe is the enhancement; this per-second step is what still
    // says how much time is left with motion switched off, so it must keep
    // doing exactly what it did before the burn was added.
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000_000);
    const { container } = render(
      <Strip state={viewOf({ phase: "drawing", drawMs: 80_000, deadline: 2_000_010_000, now: 2_000_000_000 })} />,
    );
    const strip = () => container.querySelector(".sc-strip") as HTMLElement;
    expect(strip().style.getPropertyValue("--left")).toBe("12.5%");
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(strip().style.getPropertyValue("--left")).toBe("11.25%");
    vi.useRealTimers();
  });
});

describe("picking the word", () => {
  const picking = (you: string) =>
    viewOf({
      phase: "picking",
      choices: you === "s0" ? ["lighthouse", "accordion", "sandcastle"] : null,
      mask: null,
      you: seat(you, { drawing: you === "s0" }),
    });

  it("marks the pick screen a true modal and focuses the first word for the picker", () => {
    render(<WordPick state={picking("s0")} seatId="s0" act={() => {}} error={null} />);
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("radio", { name: /lighthouse/i })).toHaveFocus();
  });

  it("shows its own countdown in minutes and seconds, the same way the strip does", () => {
    // The fixture's deadline is a full minute out — "0:60" (the old hardcoded
    // format) is not a time anybody reads; "1:00" is.
    render(<WordPick state={picking("s0")} seatId="s0" act={() => {}} error={null} />);
    expect(screen.getByText("1:00")).toBeInTheDocument();
  });

  it("lights the word on the press, before the table has answered", () => {
    const act = vi.fn();
    render(<WordPick state={picking("s0")} seatId="s0" act={act} error={null} />);
    const plate = screen.getByRole("radio", { name: /accordion/i });
    fireEvent.click(plate);
    expect(plate).toHaveAttribute("aria-checked", "true");
    expect(act).toHaveBeenCalledWith({ type: "pick", index: 1 });
  });

  it("puts the light out if the table refuses", () => {
    const { rerender } = render(<WordPick state={picking("s0")} seatId="s0" act={() => {}} error={null} />);
    fireEvent.click(screen.getByRole("radio", { name: /accordion/i }));
    rerender(<WordPick state={picking("s0")} seatId="s0" act={() => {}} error="It's not your pick." />);
    expect(screen.getByRole("radio", { name: /accordion/i })).toHaveAttribute("aria-checked", "false");
  });

  it("tells everybody else who is choosing, and shows them no words", () => {
    render(<WordPick state={picking("s1")} seatId="s1" act={() => {}} error={null} />);
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByText(/S0 is choosing/)).toBeInTheDocument();
  });

  it("gives up a lit plate refused twice with the same message", () => {
    // A repeat refusal carries the same string, so an effect keyed on
    // `error`'s identity never re-fires the second time — only a timer armed
    // independently on the press catches it.
    vi.useFakeTimers();
    const state = picking("s0");
    const { rerender } = render(<WordPick state={state} seatId="s0" act={() => {}} error={null} />);
    fireEvent.click(screen.getByRole("radio", { name: /accordion/i }));
    rerender(<WordPick state={state} seatId="s0" act={() => {}} error="It's not your pick." />);
    expect(screen.getByRole("radio", { name: /accordion/i })).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("radio", { name: /accordion/i }));
    rerender(<WordPick state={state} seatId="s0" act={() => {}} error="It's not your pick." />);
    expect(screen.getByRole("radio", { name: /accordion/i })).toHaveAttribute("aria-checked", "true");
    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    expect(screen.getByRole("radio", { name: /accordion/i })).toHaveAttribute("aria-checked", "false");
    vi.useRealTimers();
  });

  it("gives up a lit plate the table never answers at all", () => {
    vi.useFakeTimers();
    render(<WordPick state={picking("s0")} seatId="s0" act={() => {}} error={null} />);
    fireEvent.click(screen.getByRole("radio", { name: /accordion/i }));
    expect(screen.getByRole("radio", { name: /accordion/i })).toHaveAttribute("aria-checked", "true");
    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    expect(screen.getByRole("radio", { name: /accordion/i })).toHaveAttribute("aria-checked", "false");
    vi.useRealTimers();
  });

  it("clears its give-up timer if the picker leaves before the table answers", () => {
    // Counted as a delta, not an absolute: jsdom's own focus() dispatch leaves
    // a native timer of its own that neither React nor this component owns,
    // so this checks only the two timers this component is responsible for —
    // its countdown interval and the give-up timeout armed on press.
    vi.useFakeTimers();
    const { unmount } = render(<WordPick state={picking("s0")} seatId="s0" act={() => {}} error={null} />);
    const idle = vi.getTimerCount();
    fireEvent.click(screen.getByRole("radio", { name: /accordion/i }));
    expect(vi.getTimerCount()).toBe(idle + 1);
    unmount();
    expect(vi.getTimerCount()).toBe(idle - 1);
    vi.useRealTimers();
  });
});

describe("picking a team", () => {
  const waiting = (over: Partial<TableView> = {}) => {
    const seats = [seat("s0", { team: 0 }), seat("s1", { team: 0 }), seat("s2", { team: 1 }), seat("s3", { team: null })];
    return viewOf({
      phase: "waiting",
      mode: "teams",
      seats,
      you: seats[3] ?? null,
      turn: null,
      mask: null,
      teams: [
        { index: 0, name: "Blue", score: 0, members: ["s0", "s1"] },
        { index: 1, name: "Orange", score: 0, members: ["s2"] },
      ],
      ...over,
    });
  };

  it("shows its own countdown in minutes and seconds, the same way the strip does", () => {
    render(<TeamPick state={waiting()} seatId="s3" act={() => {}} error={null} />);
    expect(screen.getByText("Starts in 1:00")).toBeInTheDocument();
  });

  it("moves you on the press", () => {
    const act = vi.fn();
    render(<TeamPick state={waiting()} seatId="s3" act={act} error={null} />);
    const orange = screen.getByRole("radio", { name: /orange/i });
    fireEvent.click(orange);
    expect(orange).toHaveAttribute("aria-checked", "true");
    expect(act).toHaveBeenCalledWith({ type: "pickTeam", team: 1 });
  });

  it("closes a team that is already one bigger", () => {
    render(<TeamPick state={waiting()} seatId="s3" act={() => {}} error={null} />);
    expect(screen.getByRole("radio", { name: /blue/i })).toBeDisabled();
  });

  it("moves you back if the table refuses", () => {
    const { rerender } = render(<TeamPick state={waiting()} seatId="s3" act={() => {}} error={null} />);
    fireEvent.click(screen.getByRole("radio", { name: /orange/i }));
    rerender(<TeamPick state={waiting()} seatId="s3" act={() => {}} error="Orange is full for now." />);
    expect(screen.getByRole("radio", { name: /orange/i })).toHaveAttribute("aria-checked", "false");
  });

  it("moves you back if refused twice with the same message", () => {
    vi.useFakeTimers();
    const { rerender } = render(<TeamPick state={waiting()} seatId="s3" act={() => {}} error={null} />);
    fireEvent.click(screen.getByRole("radio", { name: /orange/i }));
    rerender(<TeamPick state={waiting()} seatId="s3" act={() => {}} error="Orange is full for now." />);
    expect(screen.getByRole("radio", { name: /orange/i })).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("radio", { name: /orange/i }));
    rerender(<TeamPick state={waiting()} seatId="s3" act={() => {}} error="Orange is full for now." />);
    expect(screen.getByRole("radio", { name: /orange/i })).toHaveAttribute("aria-checked", "true");
    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    expect(screen.getByRole("radio", { name: /orange/i })).toHaveAttribute("aria-checked", "false");
    vi.useRealTimers();
  });

  it("moves you back if the table never answers at all", () => {
    vi.useFakeTimers();
    render(<TeamPick state={waiting()} seatId="s3" act={() => {}} error={null} />);
    fireEvent.click(screen.getByRole("radio", { name: /orange/i }));
    expect(screen.getByRole("radio", { name: /orange/i })).toHaveAttribute("aria-checked", "true");
    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    expect(screen.getByRole("radio", { name: /orange/i })).toHaveAttribute("aria-checked", "false");
    vi.useRealTimers();
  });

  it("gives up even with no deadline at all to fall back on", () => {
    // "waiting" has no countdown while the table is short of players — the
    // give-up timer is the only thing that ever un-sticks a lost move here.
    vi.useFakeTimers();
    render(<TeamPick state={waiting({ deadline: null })} seatId="s3" act={() => {}} error={null} />);
    fireEvent.click(screen.getByRole("radio", { name: /orange/i }));
    expect(screen.getByRole("radio", { name: /orange/i })).toHaveAttribute("aria-checked", "true");
    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    expect(screen.getByRole("radio", { name: /orange/i })).toHaveAttribute("aria-checked", "false");
    vi.useRealTimers();
  });

  it("clears the timer it replaces, rather than being clobbered by an earlier press's expiry", () => {
    // Both teams have to stay open across the switch, or the second press
    // would be blocked by something other than the bug this test targets.
    vi.useFakeTimers();
    const seats = [seat("s0", { team: 0 }), seat("s1", { team: 1 }), seat("s2", { team: null }), seat("s3", { team: null })];
    const state = viewOf({
      phase: "waiting",
      mode: "teams",
      seats,
      you: seats[3] ?? null,
      turn: null,
      mask: null,
      teams: [
        { index: 0, name: "Blue", score: 0, members: ["s0"] },
        { index: 1, name: "Orange", score: 0, members: ["s1"] },
      ],
    });
    render(<TeamPick state={state} seatId="s3" act={() => {}} error={null} />);
    fireEvent.click(screen.getByRole("radio", { name: /blue/i }));
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    fireEvent.click(screen.getByRole("radio", { name: /orange/i }));
    expect(screen.getByRole("radio", { name: /orange/i })).toHaveAttribute("aria-checked", "true");
    // Blue's own give-up window (6s from its press) elapses now. It must not
    // revert a second press that is still outstanding and unanswered.
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.getByRole("radio", { name: /orange/i })).toHaveAttribute("aria-checked", "true");
    // Orange's own window (6s from *its* press) elapses with nothing coming
    // back — the fix has to still give up eventually, not just disable it.
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.getByRole("radio", { name: /orange/i })).toHaveAttribute("aria-checked", "false");
    vi.useRealTimers();
  });
});

describe("the team scores", () => {
  it("ranks a solo leaderboard by score, highest first", () => {
    const seats = [seat("s0", { score: 10 }), seat("s1", { score: 30 }), seat("s2", { score: 20 })];
    const { container } = render(<Teams state={viewOf({ mode: "solo", seats, you: seats[0] ?? null })} seatId="s0" />);
    const names = [...container.querySelectorAll(".sc-roster__name")].map((one) => one.textContent);
    expect(names).toEqual(["S1", "S2", "You"]);
  });

  it("opens only the pill you tap, not every team at once", () => {
    const seats = [seat("s0", { team: 0 }), seat("s1", { team: 1 })];
    const teams = [
      { index: 0, name: "Blue", score: 10, members: ["s0"] },
      { index: 1, name: "Orange", score: 5, members: ["s1"] },
    ];
    render(<Teams state={viewOf({ mode: "teams", seats, teams, you: seats[0] ?? null })} seatId="s0" />);
    const [blue, orange] = screen.getAllByRole("button");
    fireEvent.click(blue as HTMLElement);
    expect(blue).toHaveAttribute("aria-expanded", "true");
    expect(orange).toHaveAttribute("aria-expanded", "false");
  });

  it("marks the tapped well itself, so a phone's stylesheet has a class it can actually reach", () => {
    // scribble.css binds `.sc-teams__wells .well.sc-team.is-open` — a
    // compound selector on one element. A well opened any other way (the
    // brief had `.sc-teams.is-open .sc-teams__wells`, is-open on the row
    // around the wells instead) would leave that selector matching nothing,
    // and every well would stay hidden on a phone forever.
    const seats = [seat("s0", { team: 0 }), seat("s1", { team: 1 })];
    const teams = [
      { index: 0, name: "Blue", score: 10, members: ["s0"] },
      { index: 1, name: "Orange", score: 5, members: ["s1"] },
    ];
    const { container } = render(<Teams state={viewOf({ mode: "teams", seats, teams, you: seats[0] ?? null })} seatId="s0" />);
    fireEvent.click(screen.getAllByRole("button")[0] as HTMLElement);
    const opened = container.querySelector(".is-open");
    expect(opened).not.toBeNull();
    expect(opened).toHaveClass("well", "sc-team", "is-open");
  });
});

describe("the tray", () => {
  it("offers pencil, eraser and fill as one tool choice", () => {
    render(<Tray tool={{ ink: "black", size: 1, mode: "pen" }} onTool={() => {}} onUndo={() => {}} onClear={() => {}} />);
    const tools = screen.getByRole("radiogroup", { name: "Tool" });
    expect(within(tools).getAllByRole("radio")).toHaveLength(3);
    expect(within(tools).getByRole("radio", { name: "Pencil" })).toHaveAttribute("aria-checked", "true");
    expect(within(tools).getByRole("radio", { name: "Eraser" })).toHaveAttribute("aria-checked", "false");
    expect(within(tools).getByRole("radio", { name: "Fill" })).toHaveAttribute("aria-checked", "false");
  });

  it("switches to fill on a press, and pencil switches back to draw", () => {
    const onTool = vi.fn();
    const { rerender } = render(<Tray tool={{ ink: "black", size: 1, mode: "pen" }} onTool={onTool} onUndo={() => {}} onClear={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: "Fill" }));
    expect(onTool).toHaveBeenCalledWith({ ink: "black", size: 1, mode: "fill" });

    rerender(<Tray tool={{ ink: "black", size: 1, mode: "fill" }} onTool={onTool} onUndo={() => {}} onClear={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: "Pencil" }));
    expect(onTool).toHaveBeenLastCalledWith({ ink: "black", size: 1, mode: "pen" });
  });

  it("picks an ink and puts the pen back in your hand, but leaves fill's colour alone while filling", () => {
    const onTool = vi.fn();
    const { rerender } = render(<Tray tool={{ ink: "black", size: 1, mode: "eraser" }} onTool={onTool} onUndo={() => {}} onClear={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: "Blue" }));
    expect(onTool).toHaveBeenLastCalledWith({ ink: "blue", size: 1, mode: "pen" });

    rerender(<Tray tool={{ ink: "blue", size: 1, mode: "fill" }} onTool={onTool} onUndo={() => {}} onClear={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: "Red" }));
    expect(onTool).toHaveBeenLastCalledWith({ ink: "red", size: 1, mode: "fill" });
  });

  it("reads the chosen ink as checked even while erasing, so the pen you get back is never a surprise", () => {
    // Regression: the ink radios used to read `tool.mode !== "eraser" &&
    // tool.ink === ink`, so every ink went dark the moment you erased and
    // there was no way to see which one pressing Pencil would hand back.
    render(<Tray tool={{ ink: "blue", size: 1, mode: "eraser" }} onTool={() => {}} onUndo={() => {}} onClear={() => {}} />);
    expect(screen.getByRole("radio", { name: "Blue" })).toHaveAttribute("aria-checked", "true");
  });

  it("names its icon keys, including the one that wipes both drawers' work", () => {
    render(<Tray tool={{ ink: "black", size: 1, mode: "pen" }} onTool={() => {}} onUndo={() => {}} onClear={() => {}} />);
    for (const name of ["Undo", "Clear the napkin"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    for (const name of ["Pencil", "Eraser", "Fill"]) {
      expect(screen.getByRole("radio", { name })).toBeInTheDocument();
    }
  });

  it("keys pencil, eraser and fill to the building's own [aria-checked] lit style, not a locally scoped aria-pressed one", () => {
    render(<Tray tool={{ ink: "black", size: 1, mode: "pen" }} onTool={() => {}} onUndo={() => {}} onClear={() => {}} />);
    for (const name of ["Pencil", "Eraser", "Fill"]) {
      const control = screen.getByRole("radio", { name });
      expect(control).not.toHaveAttribute("aria-pressed");
      expect(control).toHaveClass("lamp");
    }
  });

  it("offers exactly five sizes, ordered smallest to largest, for pencil and for eraser alike", () => {
    const onTool = vi.fn();
    const { rerender } = render(<Tray tool={{ ink: "black", size: 0, mode: "pen" }} onTool={onTool} onUndo={() => {}} onClear={() => {}} />);
    const sizes = screen.getByRole("radiogroup", { name: "Size" });
    expect(within(sizes).getAllByRole("radio").map((radio) => radio.getAttribute("aria-label"))).toEqual([
      "Hairline",
      "Fine",
      "Medium",
      "Thick",
      "Bold",
    ]);
    expect(within(sizes).getByRole("radio", { name: "Fine" })).toHaveAttribute("aria-checked", "true");
    // The size a press sends is the array index, not its position on screen
    // — Bold is appended at index 4, not sorted in among the original three.
    fireEvent.click(within(sizes).getByRole("radio", { name: "Bold" }));
    expect(onTool).toHaveBeenCalledWith({ ink: "black", size: 4, mode: "pen" });

    rerender(<Tray tool={{ ink: "black", size: 0, mode: "eraser" }} onTool={onTool} onUndo={() => {}} onClear={() => {}} />);
    expect(screen.getByRole("radiogroup", { name: "Size" })).toBeInTheDocument();
  });

  it("hides the size row for fill — a flood has no size to offer", () => {
    render(<Tray tool={{ ink: "black", size: 0, mode: "fill" }} onTool={() => {}} onUndo={() => {}} onClear={() => {}} />);
    expect(screen.queryByRole("radiogroup", { name: "Size" })).toBeNull();
  });

  it("moves the roving tab stop through the sizes with the arrow keys, and picks the one it lands on", () => {
    const onTool = vi.fn();
    render(<Tray tool={{ ink: "black", size: 0, mode: "pen" }} onTool={onTool} onUndo={() => {}} onClear={() => {}} />);
    const group = screen.getByRole("radiogroup", { name: "Size" });
    const fine = screen.getByRole("radio", { name: "Fine" });
    const hairline = screen.getByRole("radio", { name: "Hairline" });
    // Fine (size 0) is checked, so it is the group's one tab stop.
    expect(fine).toHaveAttribute("tabindex", "0");
    expect(hairline).toHaveAttribute("tabindex", "-1");
    fine.focus();
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(onTool).toHaveBeenCalledWith({ ink: "black", size: 1, mode: "pen" });
    expect(screen.getByRole("radio", { name: "Medium" })).toHaveFocus();
  });

  it("never lists paper among the inks you can choose — it's the eraser, not a colour", () => {
    expect(TRAY_INKS).not.toContain("paper");
    render(<Tray tool={{ ink: "black", size: 1, mode: "pen" }} onTool={() => {}} onUndo={() => {}} onClear={() => {}} />);
    expect(screen.queryByRole("radio", { name: "Paper" })).toBeNull();
  });
});

describe("the reveal", () => {
  it("shows the word and what everybody scored", () => {
    const state = viewOf({
      phase: "reveal",
      mask: null,
      reveal: {
        word: "lighthouse",
        drawers: ["s0"],
        abandoned: false,
        scored: [
          { seatId: "s1", points: 240, drew: false },
          { seatId: "s0", points: 125, drew: true },
        ],
      },
    });
    const { container } = render(<Reveal state={state} seatId="s1" />);
    expect([...container.querySelectorAll(".lcd__cell")].map((cell) => cell.textContent).join("")).toBe("LIGHTHOUSE");
    expect(screen.getByText("+240")).toBeInTheDocument();
    expect(screen.getByText("+125")).toBeInTheDocument();
  });

  it("says plainly when a turn scored nothing because nobody was left drawing", () => {
    const state = viewOf({ phase: "reveal", mask: null, reveal: { word: "lighthouse", drawers: ["s0"], abandoned: true, scored: [] } });
    render(<Reveal state={state} seatId="s1" />);
    expect(screen.getByText(/nobody left drawing/i)).toBeInTheDocument();
  });

  it("declares a lone solo winner", () => {
    const state = viewOf({
      phase: "over",
      mode: "solo",
      mask: null,
      winners: ["s1"],
      reveal: { word: "lighthouse", drawers: ["s0"], abandoned: false, scored: [] },
    });
    render(<Reveal state={state} seatId="s1" />);
    expect(screen.getByText("You win")).toBeInTheDocument();
  });

  it("declares a solo tie by every name in it", () => {
    const state = viewOf({
      phase: "over",
      mode: "solo",
      mask: null,
      winners: ["s0", "s2"],
      reveal: { word: "lighthouse", drawers: ["s0"], abandoned: false, scored: [] },
    });
    render(<Reveal state={state} seatId="s1" />);
    expect(screen.getByText("S0 & S2 tie")).toBeInTheDocument();
  });

  it("declares a lone team winner", () => {
    const state = viewOf({
      phase: "over",
      mode: "teams",
      mask: null,
      teams: [
        { index: 0, name: "Blue", score: 400, members: ["s0"] },
        { index: 1, name: "Orange", score: 900, members: ["s1"] },
      ],
      reveal: { word: "lighthouse", drawers: ["s0"], abandoned: false, scored: [] },
    });
    render(<Reveal state={state} seatId="s1" />);
    expect(screen.getByText("Orange win")).toBeInTheDocument();
  });

  it("declares a team tie", () => {
    const state = viewOf({
      phase: "over",
      mode: "teams",
      mask: null,
      teams: [
        { index: 0, name: "Blue", score: 500, members: ["s0"] },
        { index: 1, name: "Orange", score: 500, members: ["s1"] },
      ],
      reveal: { word: "lighthouse", drawers: ["s0"], abandoned: false, scored: [] },
    });
    render(<Reveal state={state} seatId="s1" />);
    expect(screen.getByText("Blue & Orange tie")).toBeInTheDocument();
  });

  it("shows no result line rather than a bare 'tie' when a teams table ends with no teams", () => {
    const state = viewOf({
      phase: "over",
      mode: "teams",
      mask: null,
      teams: [],
      reveal: { word: "lighthouse", drawers: ["s0"], abandoned: false, scored: [] },
    });
    const { container } = render(<Reveal state={state} seatId="s1" />);
    expect(container.querySelector(".sc-reveal__result")).toBeNull();
  });

  it("labels each team's score delta by the view's own team name, not table position", () => {
    const seats = [seat("s0", { team: 0 }), seat("s1", { team: 1 })];
    const state = viewOf({
      phase: "reveal",
      mode: "teams",
      mask: null,
      seats,
      you: seats[1] ?? null,
      teams: [
        { index: 0, name: "Zesty", score: 400, members: ["s0"] },
        { index: 1, name: "Orange", score: 900, members: ["s1"] },
      ],
      reveal: { word: "lighthouse", drawers: ["s0"], abandoned: false, scored: [{ seatId: "s0", points: 50, drew: true }] },
    });
    const { container } = render(<Reveal state={state} seatId="s1" />);
    const notes = [...container.querySelectorAll(".readout__note")].map((one) => one.textContent);
    expect(notes).toEqual(["Zesty · +50", "Orange · +0"]);
  });
});
