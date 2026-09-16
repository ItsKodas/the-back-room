// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Reveal } from "./Reveal.js";
import { Strip } from "./Strip.js";
import { TeamPick } from "./TeamPick.js";
import { Tray } from "./Tray.js";
import { seat, viewOf } from "./testView.js";
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
});

describe("picking the word", () => {
  const picking = (you: string) =>
    viewOf({
      phase: "picking",
      choices: you === "s0" ? ["lighthouse", "accordion", "sandcastle"] : null,
      mask: null,
      you: seat(you, { drawing: you === "s0" }),
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
});

describe("picking a team", () => {
  const waiting = () => {
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
    });
  };

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
});

describe("the tray", () => {
  it("picks an ink and puts the pen back in your hand", () => {
    const onTool = vi.fn();
    render(<Tray tool={{ ink: "black", size: 1, mode: "fill" }} onTool={onTool} onUndo={() => {}} onClear={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: "Blue" }));
    expect(onTool).toHaveBeenCalledWith({ ink: "blue", size: 1, mode: "fill" });
    fireEvent.click(screen.getByRole("button", { name: "Eraser" }));
    expect(onTool).toHaveBeenLastCalledWith({ ink: "black", size: 1, mode: "eraser" });
  });

  it("names its icon keys, including the one that wipes both drawers' work", () => {
    render(<Tray tool={{ ink: "black", size: 1, mode: "pen" }} onTool={() => {}} onUndo={() => {}} onClear={() => {}} />);
    for (const name of ["Fill", "Eraser", "Undo", "Clear the napkin"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
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
});
