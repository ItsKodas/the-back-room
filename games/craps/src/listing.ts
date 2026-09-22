import type { GameListing } from "@backroom/core";

/** How Craps lists itself in the room. */
export const CRAPS: GameListing = {
  id: "craps",
  name: "Craps",
  blurb: "Two dice, a point to make, and a rail of people shouting.",
  shape: "table",
  /*
   * One seat, for the reason the wheel and the machine are allowed one: this
   * table pays from a bank that players alone fill, so a win still comes from
   * real people — everybody who has played here before you. What it may not do
   * is seat a bot at a table playing for chips, which the adapter refuses.
   */
  minSeats: 1,
  maxSeats: 8,
  mark: { text: "CRAPS", accentAt: 0 },
  /*
   * The same values theme.css sets, repeated because the link cards are drawn
   * on the server where there is no stylesheet to read. They have to agree.
   */
  theme: { wall: "#1a1610", felt: "#33280f", accent: "#c08a1e", accentHi: "#ffd166" },
  open: true,
};
