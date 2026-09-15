// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MIN_STAKE, STAKE_DIVISOR, type Face } from "@backroom/game-slots";
import type { SpinNews } from "@backroom/shared";
import { exact } from "../game/money.js";
import { REEL_STAGGER_MS } from "./Reel.js";
import {
  AFTER_A_WIN_MS,
  DEFAULT_LINES,
  LINE_CHOICES,
  autoBeatMs,
  BETWEEN_SPINS_MS,
  bonusRun,
  celebrationMs,
  Controls,
  covers,
  HOLD_MS,
  keptAcrossSwitch,
  readBet,
  HOLD_STEP_MS,
  HOLD_TOP_MS,
  holdsFor,
  teaseMs,
  Marquee,
  PaylineOverlay,
  roomShow,
  SpinFeed,
  winningCells,
  winningSpins,
} from "./Slots.js";

describe("a win", () => {
  it("lights every line that paid", () => {
    const { container } = render(
      <PaylineOverlay
        lines={[
          { line: 0, face: "tumbler", length: 3, pay: 400 },
          { line: 3, face: "diamond", length: 5, pay: 8750 },
        ]}
      />,
    );
    expect(container.querySelectorAll(".payline")).toHaveLength(2);
    expect(container.querySelector('[data-line="3"]')).not.toBeNull();
  });

  it("draws a line only as far as the run actually reached", () => {
    /*
     * A line drawn the whole width for a run of three is the machine claiming
     * a win the player cannot see on the glass. Three points, not five.
     */
    const { container } = render(
      <PaylineOverlay lines={[{ line: 0, face: "tumbler", length: 3, pay: 400 }]} />,
    );
    const drawn = container.querySelector(".payline");
    expect(drawn?.getAttribute("data-length")).toBe("3");
    expect(drawn?.getAttribute("points")?.trim().split(/\s+/)).toHaveLength(3);
  });

  it("draws each line through the middle of the cells it passes", () => {
    // The middle line runs straight across the centre row of a 500x300 box.
    const { container } = render(
      <PaylineOverlay lines={[{ line: 0, face: "tumbler", length: 5, pay: 400 }]} />,
    );
    expect(container.querySelector(".payline")?.getAttribute("points")).toBe(
      "50,150 150,150 250,150 350,150 450,150",
    );
  });

  it("follows a diagonal rather than flattening it", () => {
    // Line 3 is the V: top, middle, bottom, middle, top.
    const { container } = render(
      <PaylineOverlay lines={[{ line: 3, face: "diamond", length: 5, pay: 8750 }]} />,
    );
    expect(container.querySelector(".payline")?.getAttribute("points")).toBe(
      "50,50 150,150 250,250 350,150 450,50",
    );
  });

  it("stretches over the glass rather than keeping its own shape", () => {
    // The reels fill the box; an overlay that preserved its aspect ratio would
    // sit a line down the middle of nothing.
    const { container } = render(
      <PaylineOverlay lines={[{ line: 0, face: "tumbler", length: 3, pay: 400 }]} />,
    );
    expect(container.querySelector("svg")?.getAttribute("preserveAspectRatio")).toBe("none");
  });

  it("shows nothing at all when nothing paid", () => {
    const { container } = render(<PaylineOverlay lines={[]} />);
    expect(container.querySelectorAll(".payline")).toHaveLength(0);
  });
});

/**
 * How long the machine takes to say what it already knows.
 *
 * The server sends the whole grid at once, so none of this guesses at
 * anything — it only decides which reels are worth drawing out. Getting it
 * wrong is not a wrong answer, it is a machine that shrugs through a line of
 * sevens or makes a meal of three chips.
 */
describe("holding a reel back", () => {
  const g = (...columns: Face[][]) => columns;
  const t: Face = "tumbler";
  const c: Face = "cigar";
  const s7: Face = "seven";
  const d: Face = "diamond";

  it("does not hold anything on an ordinary spin", () => {
    // Alternating reels drawn from two faces that never meet, so no payline
    // can start a run at all. Writing this by eye is how the first version of
    // this test ended up with three bells down the peak line.
    const grid = g([t, t, t], [c, c, c], [t, t, t], [c, c, c], [t, t, t]);
    expect(holdsFor(grid)).toEqual([0, 0, 0, 0, 0]);
  });

  it("does not make a meal of three small ones", () => {
    // Three chips pays, but it is not a moment, and treating it as one makes
    // every spin feel the same.
    const grid = g([t, t, t], [t, t, t], [t, t, t], [c, c, c], [c, c, c]);
    expect(holdsFor(grid)).toEqual([0, 0, 0, 0, 0]);
  });

  it("holds the fourth reel when three sevens are already up", () => {
    const grid = g([s7, s7, s7], [s7, s7, s7], [s7, s7, s7], [c, c, c], [c, c, c]);
    expect(holdsFor(grid)).toEqual([0, 0, 0, HOLD_MS + HOLD_TOP_MS, 0]);
  });

  it("holds the last reel too once four are up", () => {
    const grid = g([s7, s7, s7], [s7, s7, s7], [s7, s7, s7], [s7, s7, s7], [c, c, c]);
    expect(holdsFor(grid)).toEqual([
      0,
      0,
      0,
      HOLD_MS + HOLD_TOP_MS,
      HOLD_MS + HOLD_STEP_MS + HOLD_TOP_MS,
    ]);
  });

  it("holds for four of anything, however cheap", () => {
    // Four across is one reel from a five of anything, which is worth the wait
    // whatever the face turns out to be.
    const grid = g([t, t, t], [t, t, t], [t, t, t], [t, t, t], [c, c, c]);
    expect(holdsFor(grid)).toEqual([0, 0, 0, HOLD_MS, HOLD_MS + HOLD_STEP_MS]);
  });

  it("draws out the whole way on a five of a kind", () => {
    const grid = g([s7, s7, s7], [s7, s7, s7], [s7, s7, s7], [s7, s7, s7], [s7, s7, s7]);
    expect(holdsFor(grid)).toEqual([
      0,
      0,
      0,
      HOLD_MS + HOLD_TOP_MS,
      HOLD_MS + HOLD_STEP_MS + HOLD_TOP_MS,
    ]);
  });

  it("holds for bells as well as sevens", () => {
    const grid = g([d, d, d], [d, d, d], [d, d, d], [c, c, c], [c, c, c]);
    expect(holdsFor(grid)).toEqual([0, 0, 0, HOLD_MS, 0]);
  });

  /*
   * The tease has to get worse rather than merely continue. Two reels held for
   * the same length is a machine that has slowed down; each taking longer than
   * the last is a machine drawing it out.
   */
  it("takes longer over each held reel than the one before it", () => {
    const grid = g([t, t, t], [t, t, t], [t, t, t], [t, t, t], [c, c, c]);
    const holds = holdsFor(grid);
    expect(holds[4]).toBeGreaterThan(holds[3] as number);
  });

  /* One reel from the jackpot is the longest wait the machine ever asks for. */
  it("draws out a live run of sevens longer than the same run of anything else", () => {
    const sevens = holdsFor(g([s7, s7, s7], [s7, s7, s7], [s7, s7, s7], [t, t, t], [c, c, c]));
    const bells = holdsFor(g([d, d, d], [d, d, d], [d, d, d], [t, t, t], [c, c, c]));
    expect(sevens[3]).toBeGreaterThan(bells[3] as number);
  });

  it("makes the biggest moment the longest one", () => {
    const jackpot = holdsFor(g([s7, s7, s7], [s7, s7, s7], [s7, s7, s7], [s7, s7, s7], [c, c, c]));
    const ordinary = holdsFor(g([d, d, d], [d, d, d], [d, d, d], [c, c, c], [c, c, c]));
    expect(Math.max(...jackpot)).toBeGreaterThan(Math.max(...ordinary));
  });

  it("never holds a reel the answer no longer rides on", () => {
    // A run that died on reel two: nothing after it is worth waiting for.
    const grid = g([s7, s7, s7], [s7, s7, s7], [c, c, c], [s7, s7, s7], [s7, s7, s7]);
    expect(holdsFor(grid)).toEqual([0, 0, 0, 0, 0]);
  });
});

/**
 * The screen across the top of the machine.
 *
 * One panel doing two jobs: what there is to play for, and what the last pull
 * came to. It is the only place on the cabinet a message can go without
 * pushing the reels down the page every time somebody wins.
 */
describe("the machine's screen", () => {
  const tumblerLine = (line: number) => ({ line, face: "tumbler" as const, length: 3, pay: 1000 });

  it("shows what there is to play for when nothing has happened", () => {
    const { container } = render(
      <Marquee
        bank={8_000_000}
        jackpot={3_200_000}
        forFun={false}
        said={null}
        problem={null}
        lines={[]}
        wasJackpot={false}
        showing={false}
        awarded={0}
        freeLeft={0}
      />,
    );
    expect(container.querySelector(".screen__label")?.textContent).toBe("Jackpot");
    // The figure rolls, so the readable value is the one held for a screen
    // reader rather than the ten digits sitting on each column's strip.
    expect(container.querySelector(".roll__said")?.textContent).toBe("3,200,000");
  });

  it("shows the outcome once the reels have finished", () => {
    const { container } = render(
      <Marquee
        bank={8_000_000}
        jackpot={3_200_000}
        forFun={false}
        said="6,000"
        problem={null}
        lines={[tumblerLine(0), tumblerLine(1)]}
        wasJackpot={false}
        showing
      />,
    );
    expect(container.querySelector(".screen__label")?.textContent).toBe("Paid");
    expect(container.querySelector(".roll__said")?.textContent).toBe("6,000");
  });

  it("keeps the jackpot up until the reels have actually stopped", () => {
    // The answer is in long before the reels finish saying it; putting the
    // outcome up early would give away what the last reel is still hiding.
    const { container } = render(
      <Marquee
        bank={8_000_000}
        jackpot={3_200_000}
        forFun={false}
        said="6,000"
        problem={null}
        lines={[tumblerLine(0)]}
        wasJackpot={false}
        showing={false}
        awarded={0}
        freeLeft={0}
      />,
    );
    expect(container.querySelector(".screen__label")?.textContent).toBe("Jackpot");
  });

  it("groups identical wins rather than listing every line", () => {
    /*
     * Three chips across can light six paylines at once, and six rows saying
     * the same thing filled the belly of the machine and said nothing the
     * first row had not. The glass already shows which lines lit.
     */
    const { container } = render(
      <Marquee
        bank={8_000_000}
        jackpot={3_200_000}
        forFun={false}
        said="6,000"
        problem={null}
        lines={[0, 1, 2, 3, 4, 5].map(tumblerLine)}
        wasJackpot={false}
        showing
      />,
    );
    const rows = [...container.querySelectorAll(".won__row")];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain("3 × tumbler");
    expect(rows[0]?.textContent).toContain("on 6 lines");
    // And the total across all six, not one of them.
    expect(rows[0]?.textContent).toContain("6,000");
  });

  it("keeps different wins apart", () => {
    const { container } = render(
      <Marquee
        bank={8_000_000}
        jackpot={3_200_000}
        forFun={false}
        said="9,000"
        problem={null}
        lines={[tumblerLine(0), { line: 1, face: "diamond", length: 5, pay: 8000 }]}
        wasJackpot={false}
        showing
      />,
    );
    expect(container.querySelectorAll(".won__row")).toHaveLength(2);
    // Biggest first: the thing worth looking at is at the top.
    expect(container.querySelectorAll(".won__row")[0]?.textContent).toContain("5 × diamond");
  });

  it("says the jackpot in its own words", () => {
    const { container } = render(
      <Marquee
        bank={8_000_000}
        jackpot={3_200_000}
        forFun={false}
        said="3,200,000"
        problem={null}
        lines={[]}
        wasJackpot
        showing
      />,
    );
    expect(container.querySelector(".screen__label")?.textContent).toBe("Jackpot");
    expect(container.querySelector(".won__row--jackpot")?.textContent).toContain("Five sevens");
    expect(container.querySelector(".screen--jackpot")).not.toBeNull();
  });

  it("puts a refusal on the screen rather than swallowing it", () => {
    const { container } = render(
      <Marquee
        bank={0}
        jackpot={0}
        forFun={false}
        said={null}
        problem="The bank is empty."
        lines={[]}
        wasJackpot={false}
        showing={false}
        awarded={0}
        freeLeft={0}
      />,
    );
    expect(container.querySelector(".screen__note--said")?.textContent).toBe("The bank is empty.");
  });
});

/*
 * Which faces move when a line pays.
 *
 * The overlay says where the win was; the faces say what it was. Getting this
 * wrong is quiet — the machine still pays correctly and still draws the line,
 * and all that happens is that the wrong glass rattles.
 */
describe("the faces that won", () => {
  const line = (index: number, length: number) => ({
    line: index,
    face: "tumbler" as const,
    length,
    pay: 100,
  });

  it("marks nothing at all when nothing paid", () => {
    expect(winningCells([])).toEqual([
      [false, false, false],
      [false, false, false],
      [false, false, false],
      [false, false, false],
      [false, false, false],
    ]);
  });

  it("marks the middle row across every reel for a five along the middle", () => {
    // PAYLINES[0] is the middle row, which is why it is the line to test with.
    const cells = winningCells([line(0, 5)]);
    for (const reel of cells) {
      expect(reel).toEqual([false, true, false]);
    }
  });

  it("stops where the run stopped, because the next face is what ended it", () => {
    const cells = winningCells([line(0, 3)]);
    expect(cells.slice(0, 3)).toEqual([
      [false, true, false],
      [false, true, false],
      [false, true, false],
    ]);
    expect(cells.slice(3)).toEqual([
      [false, false, false],
      [false, false, false],
    ]);
  });

  it("marks a cell once however many lines cross it", () => {
    // The middle of the grid sits on several paylines at once, and a cell is
    // either winning or not — there is no marking it twice.
    const cells = winningCells([line(0, 5), line(1, 5), line(2, 5)]);
    expect(cells[2]?.filter((on) => on)).toHaveLength(3);
  });

  it("ignores a line number the machine has not got", () => {
    // It comes off the wire. A face nobody can draw is a blank cell; a row
    // index off the end of the list would be a crash on the winning spin.
    expect(() => winningCells([line(99, 5)])).not.toThrow();
    expect(winningCells([line(99, 5)])[0]).toEqual([false, false, false]);
  });
});

/*
 * The bonus, on the screen.
 *
 * A spin can win a run of free spins and pay nothing at all — which is one of
 * the better things that happens at this machine, and exactly the case a
 * screen that only ever asks "did a line pay?" shows as an ordinary loss.
 */
describe("the machine's screen on a bonus", () => {
  const screen = (props: Partial<Parameters<typeof Marquee>[0]>) =>
    render(
      <Marquee
        bank={8_000_000}
        jackpot={3_200_000}
        forFun={false}
        said={null}
        problem={null}
        lines={[]}
        wasJackpot={false}
        showing={true}
        awarded={0}
        freeLeft={0}
        {...props}
      />,
    );

  it("says what the bonus won even though no line paid", () => {
    const { container } = screen({ awarded: 8 });
    expect(container.querySelector(".screen__label")?.textContent).toBe("Bonus");
    expect(container.querySelector(".roll__said")?.textContent).toBe("8");
    expect(container.querySelector(".screen__note")?.textContent).toContain("free spins");
  });

  it("puts the bonus ahead of the lines when a spin did both", () => {
    const { container } = screen({
      awarded: 12,
      said: "6,000",
      lines: [{ line: 0, face: "tumbler" as const, length: 3, pay: 6000 }],
    });
    // The run of spins is the bigger news, so it takes the figure.
    expect(container.querySelector(".screen__label")?.textContent).toBe("Bonus");
    expect(container.querySelector(".roll__said")?.textContent).toBe("12");
    // And the money is still said, rather than being lost behind it.
    expect(container.querySelector(".screen__note")?.textContent).toContain("6,000");
  });

  it("says nothing about a bonus until the reels have stopped", () => {
    // Same rule as every other outcome: the screen must not give away what the
    // last reel is still hiding.
    const { container } = screen({ awarded: 8, showing: false });
    expect(container.querySelector(".screen__label")?.textContent).not.toBe("Bonus");
  });

  it("counts down what is left once the news is over", () => {
    const { container } = screen({ awarded: 0, freeLeft: 7 });
    expect(container.querySelector(".screen__label")?.textContent).toBe("Free spins left");
    expect(container.querySelector(".roll__said")?.textContent).toBe("7");
  });

  it("goes back to the jackpot when nothing is owed", () => {
    const { container } = screen({ awarded: 0, freeLeft: 0 });
    expect(container.querySelector(".screen__label")?.textContent).toBe("Jackpot");
  });
});

describe("how long the machine holds the lever down", () => {
  it("gives a spin that only won free spins its moment", () => {
    /*
     * The lever comes straight back when nothing happened. Winning eight free
     * spins and no chips is not nothing, and treating "paid zero" as "nothing
     * happened" would snatch the best news on this machine off the screen
     * before it could be read.
     */
    expect(celebrationMs(0, false, 0, 8)).toBeGreaterThan(0);
    expect(celebrationMs(0, false, 0, 0)).toBe(0);
  });

  it("still holds longest for a jackpot", () => {
    expect(celebrationMs(1000, true, 1, 8)).toBeGreaterThan(celebrationMs(0, false, 0, 8));
  });
});

/*
 * The rising notes, and where they go back to nought.
 *
 * Each bonus landing sounds a note above the last, which is a sentence about
 * one spin: "that is the second one on the glass, and a third would pay". Left
 * to carry across spins it stops being that sentence — the first bonus of the
 * evening is the only one that ever sounds its own note, every spin after it
 * starts wherever the last one stopped, and once five have landed the pitch is
 * pinned at the top for the rest of the session.
 */
describe("the run of bonuses in a spin", () => {
  it("starts at the bottom", () => {
    expect(bonusRun().landed()).toBe(0);
  });

  it("climbs one step per bonus", () => {
    const run = bonusRun();
    expect([run.landed(), run.landed(), run.landed()]).toEqual([0, 1, 2]);
  });

  it("goes back to the bottom for the next spin", () => {
    const run = bonusRun();
    run.landed();
    run.landed();
    run.reset();
    expect(run.landed()).toBe(0);
  });

  it("starts every spin the same way, however many the last one had", () => {
    // The whole point. Five spins, each with a couple of bonuses on it, and
    // every one of them opens on the same note.
    const run = bonusRun();
    for (let spin = 0; spin < 5; spin += 1) {
      run.reset();
      expect(run.landed()).toBe(0);
      expect(run.landed()).toBe(1);
    }
  });

  it("resets a spin that had none at all", () => {
    // A spin with no bonuses never calls landed(), so nothing would clear it
    // if the reset were hung off the landing rather than off the pull.
    const run = bonusRun();
    run.landed();
    run.reset();
    run.reset();
    expect(run.landed()).toBe(0);
  });

  it("does not climb on a free spin, which cannot win more of them", () => {
    // A third bonus on a free spin pays nothing, so a run that climbs towards
    // it is the machine promising something it will not do.
    const run = bonusRun();
    run.reset(true);
    expect([run.landed(), run.landed(), run.landed()]).toEqual([0, 0, 0]);
  });

  it("climbs again on the paid spin after a free one", () => {
    const run = bonusRun();
    run.reset(true);
    run.landed();
    run.reset();
    expect([run.landed(), run.landed()]).toEqual([0, 1]);
  });
});

/*
 * The spin button during a run of free spins.
 *
 * The screen at the top of the cabinet carries the count as well, but a player
 * mid-run is looking at the thing they are about to hit — and the question
 * they are asking of it is whether this press costs anything.
 */
const controls = (props: Partial<Parameters<typeof Controls>[0]>) =>
  render(
    <Controls
      stake={100}
      onStake={() => {}}
      highStakes={false}
      onHighStakes={() => {}}
      released={null}
      busy={false}
      balance={50_000}
      cap={5000}
      forFun={true}
      lineCount={9}
      onLines={() => {}}
      onPull={() => {}}
      canPull={true}
      auto={false}
      onAuto={() => {}}
      freeLeft={0}
      {...props}
    />,
  );

describe("the bet keys", () => {
  const row = (container: HTMLElement) =>
    within(within(container).getByRole("radiogroup", { name: "Bet a line" }));
  const said = (container: HTMLElement) => container.querySelector(".bet__said")?.textContent ?? "";

  it("offers the standard keys", () => {
    const { container } = controls({});
    expect(row(container).getAllByRole("radio").map((key) => key.textContent)).toEqual([
      "10",
      "50",
      "100",
      "250",
      "500",
      "1,000",
    ]);
  });

  it("offers the high stakes keys once the switch is on", () => {
    const { container } = controls({ highStakes: true });
    expect(row(container).getAllByRole("radio").map((key) => key.textContent)).toEqual([
      "1,000",
      "2,500",
      "5,000",
      "10,000",
    ]);
  });

  it("asks for the other row when the switch is flipped", () => {
    const onHighStakes = vi.fn();
    const { container } = controls({ onHighStakes });
    const flip = within(container).getByRole("switch", { name: "High stakes" });
    expect(flip.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(flip);
    expect(onHighStakes).toHaveBeenCalledWith(true);
  });

  it("sets the bet to the key pressed rather than adding to it", () => {
    const onStake = vi.fn();
    const { container } = controls({ stake: 100, onStake });
    fireEvent.click(row(container).getByRole("radio", { name: "250" }));
    expect(onStake).toHaveBeenCalledWith(250);
  });

  it("holds in the key that is the bet and no other", () => {
    const { container } = controls({ stake: 250 });
    const held = row(container)
      .getAllByRole("radio")
      .filter((key) => key.getAttribute("aria-checked") === "true")
      .map((key) => key.textContent);
    expect(held).toEqual(["250"]);
  });

  it("turns off a key the balance cannot cover across the lines", () => {
    const { container } = controls({ stake: 0, balance: 2000, lineCount: 3, cap: 100_000 });
    expect((row(container).getByRole("radio", { name: "1,000" }) as HTMLButtonElement).disabled).toBe(true);
    expect((row(container).getByRole("radio", { name: "500" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("turns off a key the bank cannot cover, whatever the balance", () => {
    const { container } = controls({ stake: 0, balance: 1_000_000, lineCount: 3, cap: 2000 });
    expect((row(container).getByRole("radio", { name: "1,000" }) as HTMLButtonElement).disabled).toBe(true);
    expect((row(container).getByRole("radio", { name: "500" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("says why a key is off without anybody having to hover it", () => {
    const { container } = controls({ stake: 0, balance: 2000, lineCount: 3, cap: 100_000 });
    expect(said(container)).toContain("1,000 and up");
  });

  it("keeps the held key lit mid-spin, while its stake is out of the balance", () => {
    /*
     * The stake leaves the shown balance on the press, so a thousand held on a
     * balance of a thousand reads as uncovered for the whole spin. The key it
     * is riding on must not go dark under the reels.
     */
    const { container } = controls({ stake: 1000, busy: true, balance: 0, lineCount: 1, cap: 100_000 });
    const key = row(container).getByRole("radio", { name: "1,000" }) as HTMLButtonElement;
    expect(key.disabled).toBe(false);
    expect(key.getAttribute("aria-checked")).toBe("true");
  });

  it("does not change the bet while the reels are turning", () => {
    const onStake = vi.fn();
    const { container } = controls({ stake: 100, busy: true, onStake });
    fireEvent.click(row(container).getByRole("radio", { name: "250" }));
    expect(onStake).not.toHaveBeenCalled();
  });

  it("says why a bet it could no longer cover was let go", () => {
    const { container } = controls({
      stake: 0,
      released: { bet: 1000, why: "cover" },
      balance: 2000,
      lineCount: 3,
      cap: 100_000,
    });
    expect(said(container)).toContain("1,000");
    expect(said(container)).toContain("released");
  });

  it("says the switch let a bet go", () => {
    const { container } = controls({
      stake: 0,
      highStakes: true,
      released: { bet: 250, why: "switch" },
    });
    expect(said(container)).toContain("250");
    expect(said(container)).toContain("high stakes");
  });

  it("asks for a bet when nothing is held", () => {
    const { container } = controls({ stake: 0, cap: 100_000 });
    expect(said(container)).toContain("Choose a key");
  });
});

describe("betting a figure of your own", () => {
  const box = (container: HTMLElement) =>
    within(container).getByRole("textbox", { name: "Custom bet a line" });
  const said = (container: HTMLElement) => container.querySelector(".bet__said")?.textContent ?? "";

  it("bets what was typed", () => {
    const onStake = vi.fn();
    const { container } = controls({ stake: 0, onStake });
    fireEvent.change(box(container), { target: { value: "37" } });
    fireEvent.click(within(container).getByRole("button", { name: "Bet it" }));
    expect(onStake).toHaveBeenCalledWith(37);
  });

  it("bets on Enter as well", () => {
    const onStake = vi.fn();
    const { container } = controls({ stake: 0, onStake });
    fireEvent.change(box(container), { target: { value: "37" } });
    fireEvent.keyDown(box(container), { key: "Enter" });
    expect(onStake).toHaveBeenCalledWith(37);
  });

  it("goes as low as a single chip", () => {
    const onStake = vi.fn();
    const { container } = controls({ stake: 0, onStake, lineCount: 9 });
    fireEvent.change(box(container), { target: { value: "1" } });
    fireEvent.click(within(container).getByRole("button", { name: "Bet it" }));
    expect(onStake).toHaveBeenCalledWith(1);
  });

  it("will not bet nothing", () => {
    const onStake = vi.fn();
    const { container } = controls({ stake: 0, onStake });
    fireEvent.change(box(container), { target: { value: "0" } });
    const bet = within(container).getByRole("button", { name: "Bet it" }) as HTMLButtonElement;
    expect(bet.disabled).toBe(true);
    fireEvent.keyDown(box(container), { key: "Enter" });
    expect(onStake).not.toHaveBeenCalled();
    expect(said(container)).toContain("Bets start at 1 a line.");
  });

  it("will not bet more than can be covered, and says what can", () => {
    const onStake = vi.fn();
    const { container } = controls({ stake: 0, onStake, balance: 100, lineCount: 3, cap: 100_000 });
    fireEvent.change(box(container), { target: { value: "50" } });
    const bet = within(container).getByRole("button", { name: "Bet it" }) as HTMLButtonElement;
    expect(bet.disabled).toBe(true);
    expect(said(container)).toContain("The most you can bet on 3 lines is 33 a line.");
  });

  it("holds the box in for a figure that is not a key", () => {
    const { container } = controls({ stake: 37, cap: 100_000 });
    const held = within(container).getByRole("button", { name: "Held" });
    expect(held.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector(".own")?.hasAttribute("data-held")).toBe(true);
  });

  it("leaves the box dark when the bet is a key", () => {
    const { container } = controls({ stake: 250, cap: 100_000 });
    expect(within(container).queryByRole("button", { name: "Held" })).toBeNull();
    expect(container.querySelector(".own")?.hasAttribute("data-held")).toBe(false);
  });
});

describe("what a bet has to be", () => {
  it("takes a single chip a line", () => {
    expect(MIN_STAKE).toBe(1);
  });

  it("is covered only when both the balance and the bank can take it across the lines", () => {
    expect(covers(100, { lines: 3, cap: 1000, balance: 1000 })).toBe(true);
    expect(covers(400, { lines: 3, cap: 1000, balance: 5000 })).toBe(false);
    expect(covers(400, { lines: 3, cap: 5000, balance: 1000 })).toBe(false);
    expect(covers(0, { lines: 3, cap: 5000, balance: 5000 })).toBe(false);
    expect(covers(10, { lines: 3, cap: 5000, balance: null })).toBe(false);
  });

  it("keeps 1,000 held across the switch, since both rows have it", () => {
    expect(keptAcrossSwitch(1000, true)).toBe(true);
    expect(keptAcrossSwitch(1000, false)).toBe(true);
  });

  it("keeps a figure of your own across the switch, since neither row has it", () => {
    expect(keptAcrossSwitch(37, true)).toBe(true);
    expect(keptAcrossSwitch(37, false)).toBe(true);
  });

  it("lets go of a key the other row does not have", () => {
    expect(keptAcrossSwitch(250, true)).toBe(false);
    expect(keptAcrossSwitch(5000, false)).toBe(false);
  });

  it("reads a typed figure with or without its commas", () => {
    expect(readBet("1,250")).toBe(1250);
    expect(readBet("37")).toBe(37);
    expect(readBet("")).toBeNull();
    expect(readBet("abc")).toBeNull();
  });
});

describe("the spin button", () => {
  const press = controls;

  it("says Spin when the next one costs something", () => {
    const { container } = press({});
    expect(container.querySelector(".spin__face")?.textContent).toBe("Spin");
    expect(container.querySelector(".spin__left")).toBeNull();
  });

  it("says what it is and how many are left during a run", () => {
    const { container } = press({ freeLeft: 7 });
    expect(container.querySelector(".spin__face")?.textContent).toBe("Free spin");
    expect(container.querySelector(".spin__left")?.textContent).toContain("7");
  });

  it("counts a run down to its last one", () => {
    const { container } = press({ freeLeft: 1 });
    expect(container.querySelector(".spin__left")?.textContent).toContain("1");
    expect(container.querySelector(".spin__face")?.textContent).toBe("Free spin");
  });

  it("drops the badge the moment the run is over", () => {
    // Zero is not a count to show. A badge reading nought is a machine that
    // still looks like it owes something.
    const { container } = press({ freeLeft: 0 });
    expect(container.querySelector(".spin__left")).toBeNull();
  });

  it("says the count in full for anybody not looking at it", () => {
    const { container } = press({ freeLeft: 7 });
    expect(container.querySelector(".spin__left")?.textContent).toContain("free spins left");
  });

  it("still says Spinning while the reels are up", () => {
    // Whatever it cost, what it is doing now is the more useful thing to say.
    const { container } = press({ freeLeft: 7, busy: true });
    expect(container.querySelector(".spin__face")?.textContent).toBe("Spinning");
    // The count stays put, so it does not flicker away for every spin.
    expect(container.querySelector(".spin__left")?.textContent).toContain("7");
  });

  it("works out what a shut machine needs from the paytable, not a number", () => {
    /*
     * This read 1296 until the paytable was retuned for the bonus, at which
     * point it quietly understated what the bank needs by about a tenth — a
     * figure a player would act on, and one nothing else would have caught.
     */
    const { container } = press({ cap: 0 });
    const said = container.querySelector(".slots__shut")?.textContent ?? "";
    expect(said).toContain(exact(MIN_STAKE * STAKE_DIVISOR));
  });
});

/*
 * What auto-spin does when a spin pays.
 *
 * It used to switch itself off, which enforced the right thing — a win the
 * player did not see happen is a win that did not happen to them — by making
 * them rearm the machine every time it did something good. Waiting says the
 * same thing without the punishment.
 */
describe("the beat between spins the machine pulls itself", () => {
  it("goes straight on after a spin that paid nothing", () => {
    expect(autoBeatMs({ won: 0, awarded: 0 })).toBe(BETWEEN_SPINS_MS);
  });

  it("waits after a win, long enough to read it and stop", () => {
    expect(autoBeatMs({ won: 4000, awarded: 0 })).toBe(AFTER_A_WIN_MS);
    expect(AFTER_A_WIN_MS).toBeGreaterThanOrEqual(6000);
  });

  it("waits after free spins even though no chips came out", () => {
    // The case reading `won` alone walks straight past, and it is one of the
    // better things that happens on this machine.
    expect(autoBeatMs({ won: 0, awarded: 8 })).toBe(AFTER_A_WIN_MS);
  });

  it("goes straight on when there is nothing to have missed", () => {
    // No answer yet, or the first spin of a run.
    expect(autoBeatMs(null)).toBe(BETWEEN_SPINS_MS);
  });

  it("always waits longer after something happened than after nothing", () => {
    expect(autoBeatMs({ won: 1, awarded: 0 })).toBeGreaterThan(autoBeatMs({ won: 0, awarded: 0 }));
  });
});

describe("the lines a machine opens with", () => {
  it("has some bought, so the lever works the moment you walk up", () => {
    // It used to open on none, which meant working out what a payline was
    // before the machine would do anything at all.
    expect(DEFAULT_LINES).toBeGreaterThan(0);
  });

  it("is one of the counts the picker offers", () => {
    // Otherwise the machine opens on a number the player cannot get back to
    // once they have touched the picker.
    expect(LINE_CHOICES).toContain(DEFAULT_LINES);
  });

  it("is not the dearest, because that is a decision about somebody's money", () => {
    // Nine trebles what a spin costs against three. A machine that arrives
    // with the most expensive option bought has chosen for the player.
    expect(DEFAULT_LINES).toBeLessThan(Math.max(...LINE_CHOICES));
  });
});

/**
 * How long the rising note has left to climb.
 *
 * This was the half of the tease that was quietly broken: the note was handed
 * the next reel's hold, which is a total measured from the start of the spin
 * rather than a gap between two landings. So it finished its sweep early and
 * sat at the top droning through the very moment it existed to build up to.
 */
const FOUR_SEVENS: Face[][] = [
  ["seven", "seven", "seven"],
  ["seven", "seven", "seven"],
  ["seven", "seven", "seven"],
  ["seven", "seven", "seven"],
  ["cigar", "cigar", "cigar"],
];
const FOUR_CHEAP: Face[][] = [
  ["tumbler", "tumbler", "tumbler"],
  ["tumbler", "tumbler", "tumbler"],
  ["tumbler", "tumbler", "tumbler"],
  ["tumbler", "tumbler", "tumbler"],
  ["cigar", "cigar", "cigar"],
];

describe("how long there is left to tease", () => {
  it("is nothing when no reel after this one is being held", () => {
    expect(teaseMs([0, 0, 0, 0, 0], 2)).toBe(0);
    expect(teaseMs([0, 0, 0, HOLD_MS, 0], 3)).toBe(0);
  });

  it("reaches to the last held reel, not merely the next one", () => {
    const holds = [0, 0, 0, HOLD_MS, HOLD_MS + HOLD_STEP_MS];
    /*
     * Reel two lands with no hold; reel four lands two staggers later plus its
     * own hold. Anything shorter leaves the note flat while the reel that
     * decides it is still turning.
     */
    expect(teaseMs(holds, 2)).toBe(2 * REEL_STAGGER_MS + HOLD_MS + HOLD_STEP_MS);
  });

  it("counts only what is left, from a reel that was itself held", () => {
    const holds = [0, 0, 0, HOLD_MS, HOLD_MS + HOLD_STEP_MS];
    // The wait already served does not get played twice.
    expect(teaseMs(holds, 3)).toBe(REEL_STAGGER_MS + HOLD_STEP_MS);
  });

  /* The bug, stated as an assertion: it must not stop at the next reel. */
  it("is longer with two reels held than with one", () => {
    const one = teaseMs([0, 0, 0, HOLD_MS, 0], 2);
    const two = teaseMs([0, 0, 0, HOLD_MS, HOLD_MS + HOLD_STEP_MS], 2);
    expect(two).toBeGreaterThan(one);
  });

  it("lasts longer for the jackpot run than for an ordinary one", () => {
    const ordinary = teaseMs(holdsFor(FOUR_CHEAP), 2);
    const jackpot = teaseMs(holdsFor(FOUR_SEVENS), 2);
    expect(jackpot).toBeGreaterThan(ordinary);
  });
});

describe("how much of the room a win lights up", () => {
  /* Nine lines at twenty a line: an ordinary spin off the tray. */
  const BET = 180;
  const line = (won: number) => roomShow({ won, bet: BET, jackpot: false });

  it("leaves the page dark for an ordinary line", () => {
    // Most paying lines come to less than the spin cost. The glass says so on
    // its own; the room has no business joining in for that.
    expect(line(BET / 2)).toBe(0);
  });

  it("leaves the page dark a chip under the bar", () => {
    expect(line(BET * 10 - 1)).toBe(0);
  });

  it("throws its first shells at ten times the stake", () => {
    expect(line(BET * 10)).toBeGreaterThan(0);
  });

  it("grows with the win", () => {
    expect(line(BET * 40)).toBeGreaterThan(line(BET * 12));
    expect(line(BET * 90)).toBeGreaterThan(line(BET * 40));
  });

  it("stops growing at the top of what the paytable can pay", () => {
    // A hundred times the stake is about a five-of-a-kind diamond, which is
    // the biggest a line gets. Anything past it is the same barrage, so a
    // stake nobody expected cannot ask the page for a thousand shells.
    expect(line(BET * 5000)).toBe(line(BET * 100));
  });

  it("gives the jackpot more than any line can", () => {
    expect(roomShow({ won: BET, bet: BET, jackpot: true })).toBeGreaterThan(line(BET * 5000));
  });

  it("asks nothing of a spin with no bet behind it", () => {
    // A free spin's *stake* is zero — nothing left the account. Sized off that
    // rather than off the bet it replays, every free spin would divide by
    // nothing. The caller passes the bet; this is the guard for when it does
    // not.
    expect(roomShow({ won: 9000, bet: 0, jackpot: false })).toBe(0);
  });
});

describe("the wall either side", () => {
  const spun = (over: Partial<SpinNews>): SpinNews => ({
    id: "one",
    name: "Ada",
    avatar: null,
    stake: 2500,
    won: 0,
    jackpot: false,
    at: 0,
    ...over,
  });

  const wall = (news: SpinNews[]) =>
    render(<SpinFeed title="At the machine" empty="Nobody has pulled it yet." news={news} side="left" />)
      .container;

  it("writes a spin that paid less than it took as the loss it was", () => {
    /*
     * Two thousand back on a stake of two and a half is a player five hundred
     * down, however much the machine handed over on the way. A row that reads
     * "+-500" is the wall unable to decide, and neither half of it is true.
     */
    const sum = wall([spun({ stake: 2500, won: 2000 })]).querySelector(".feed__sum");
    expect(sum?.textContent).toBe("-500");
    expect(sum?.querySelector(".feed__won")).toBeNull();
  });

  it("still writes a spin that cleared its stake in the black", () => {
    const sum = wall([spun({ stake: 2500, won: 13000 })]).querySelector(".feed__sum");
    expect(sum?.textContent).toBe("+10,500");
    expect(sum?.querySelector(".feed__won")).not.toBeNull();
  });

  it("writes a spin that paid nothing as the whole stake gone", () => {
    const sum = wall([spun({ stake: 2500, won: 0 })]).querySelector(".feed__sum");
    expect(sum?.textContent).toBe("-2,500");
  });

  it("keeps a spin that did not clear its stake off the paying-out column", () => {
    // The column says "Paying out" and its empty line says "No wins yet". A
    // spin that left the player down is neither, whatever the reels did.
    const short = spun({ id: "short", stake: 2500, won: 2000 });
    const push = spun({ id: "push", stake: 2500, won: 2500 });
    const ahead = spun({ id: "ahead", stake: 2500, won: 2501 });
    expect(winningSpins([short, push, ahead]).map((one) => one.id)).toEqual(["ahead"]);
  });
});
