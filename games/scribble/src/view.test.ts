import { describe, expect, it } from "vitest";
import { tableFor } from "./fixtures.js";

describe("what each seat sees", () => {
  it("shows the three choices to the drawers only", () => {
    const { table } = tableFor({ mode: "teams", teams: 2 }, 4);
    table.deal();
    expect(table.view("s0").choices).toEqual(["lighthouse", "accordion", "sandcastle"]);
    expect(table.view("s2").choices).toEqual(["lighthouse", "accordion", "sandcastle"]);
    expect(table.view("s1").choices).toBeNull();
    expect(table.view(null).choices).toBeNull();
  });

  it("gives drawers the word and guessers only blanks", () => {
    const { table } = tableFor({ hints: "none" });
    table.deal();
    table.pick("s0", 0);
    expect(table.view("s0").word).toBe("lighthouse");
    expect(table.view("s0").mask).toBeNull();
    expect(table.view("s1").word).toBeNull();
    expect(table.view("s1").mask).toEqual(Array.from({ length: 10 }, () => null));
    expect(table.view(null).word).toBeNull();
  });

  it("gives the word to somebody the moment they have guessed it", () => {
    const { table } = tableFor({}, 4);
    table.deal();
    table.pick("s0", 0);
    table.say("s1", "lighthouse");
    expect(table.view("s1").word).toBe("lighthouse");
    expect(table.view("s2").word).toBeNull();
  });

  it("marks who is drawing and who has guessed", () => {
    const { table } = tableFor({}, 4);
    table.deal();
    table.pick("s0", 0);
    table.say("s1", "lighthouse");
    const seats = table.view("s2").seats;
    expect(seats.find((seat) => seat.id === "s0")).toMatchObject({ drawing: true, guessed: false });
    expect(seats.find((seat) => seat.id === "s1")).toMatchObject({ drawing: false, guessed: true });
  });

  it("carries the whole picture, so a reconnect draws it from the view", () => {
    const { table } = tableFor();
    table.deal();
    table.pick("s0", 0);
    table.stroke("s0", { id: "k1", seq: 0, ink: "red", size: 0, pts: [1, 2, 3, 4] });
    expect(table.view("s2").ink).toEqual([{ kind: "stroke", id: "k1", by: "s0", ink: "red", size: 0, pts: [1, 2, 3, 4] }]);
  });

  it("shows the reveal to everybody once the turn ends", () => {
    const { table } = tableFor();
    table.deal();
    table.pick("s0", 0);
    table.deadline = table.now();
    table.advanceDrawing();
    expect(table.view("s1").reveal?.word).toBe("lighthouse");
    expect(table.view(null).reveal?.word).toBe("lighthouse");
  });

  it("names the teams and lists their members", () => {
    const { table } = tableFor({ mode: "teams", teams: 2 }, 4);
    table.deal();
    expect(table.view("s0").teams).toEqual([
      { index: 0, name: "Blue", score: 0, members: ["s0", "s2"] },
      { index: 1, name: "Orange", score: 0, members: ["s1", "s3"] },
    ]);
  });

  it("says whose view it is, and the server's time so the client can correct its clock", () => {
    const { table, clock } = tableFor();
    const view = table.view("s1");
    expect(view.you?.id).toBe("s1");
    expect(view.now).toBe(clock.now());
    expect(table.view(null).you).toBeNull();
  });
});
