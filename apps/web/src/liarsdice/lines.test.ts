import { describe, expect, it } from "vitest";
import { seat, view } from "./fixtures.js";
import { whoseTurn } from "./lines.js";

describe("what the table is waiting for", () => {
  it("says who took it, once the game is over", () => {
    const state = view([seat()], { phase: "over", winnerIds: ["s0"], toAct: null });
    expect(whoseTurn(state, "s0")).toBe("Ada took it.");
  });

  it("says it is waiting for a second player", () => {
    const state = view([seat()], { phase: "waiting", toAct: null, waitingFor: "players" });
    expect(whoseTurn(state, "s0")).toBe(
      "Waiting for a second player. Nothing is staked until the table deals.",
    );
  });

  it("counts who is in, between games with enough players", () => {
    const state = view([seat(), seat({ id: "s1", name: "Bram" })], {
      phase: "waiting",
      toAct: null,
      readyCount: 0,
    });
    expect(whoseTurn(state, "s0")).toBe("Say you are in and the table will deal.");
  });

  it("says cups up, once a round is resolved", () => {
    const state = view([seat(), seat({ id: "s1", name: "Bram" })], {
      bid: { count: 4, face: 5 },
      bidder: "s0",
      toAct: null,
      resolution: {
        call: "liar",
        caller: "s1",
        bid: { count: 4, face: 5 },
        bidder: "s0",
        count: 6,
        right: true,
        losers: ["s1"],
      },
    });
    expect(whoseTurn(state, "s0")).toBe("Cups up.");
  });

  it("says you open, when it is your turn and nothing has been bid", () => {
    const state = view([seat()], { toAct: "s0", bid: null });
    expect(whoseTurn(state, "s0")).toBe("You open.");
  });

  it("says whom it is waiting on, when it is not your turn", () => {
    const state = view([seat(), seat({ id: "s1", name: "Bram" })], { toAct: "s1" });
    expect(whoseTurn(state, "s0")).toBe("Waiting on Bram.");
  });
});
