import type { GameListing } from "@backroom/core";

/** How Two-up lists itself in the room. */
export const TWO_UP: GameListing = {
  id: "two-up",
  name: "Two-up",
  blurb: "Two coins in the air. Heads or tails, and nothing in between.",
  shape: "table",
  /*
   * One seat, because the casino school pays from a bank that players alone
   * fill — the exception CLAUDE.md names, and the same argument the wheel and
   * the machine already make.
   *
   * The traditional school needs two, and that rule lives on the table rather
   * than here. A listing says what a *game* allows, and the room cannot know
   * which ruleset a host is about to pick.
   */
  minSeats: 1,
  maxSeats: 8,
  mark: { text: "TWO-UP", accentAt: 0 },
  /*
   * The same values theme.css sets, repeated because the link cards are drawn
   * on the server where there is no stylesheet to read. They have to agree.
   */
  theme: { wall: "#141618", felt: "#232a2e", accent: "#8a9299", accentHi: "#dfe6ea" },
  open: true,
};
