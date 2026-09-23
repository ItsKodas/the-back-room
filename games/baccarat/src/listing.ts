import type { GameListing } from "@backroom/core";

/** How Baccarat lists itself in the room. */
export const BACCARAT: GameListing = {
  id: "baccarat",
  name: "Baccarat",
  blurb: "Player or banker. Bet on which side gets closer to nine.",
  shape: "table",
  /*
   * One seat is allowed for the same reason the wheel's and the machine's are:
   * this table pays from a bank that players alone fill, so a win still comes
   * from real people — everybody who has played here before you. What it is
   * not allowed to do is seat a bot at a table playing for chips, which the
   * table refuses.
   */
  minSeats: 1,
  maxSeats: 8,
  mark: { text: "BACCARAT", accentAt: 0 },
  /*
   * The same values theme.css sets, repeated because the link cards are drawn
   * on the server where there is no stylesheet to read. They have to agree.
   */
  theme: { wall: "#12161c", felt: "#1b2a3d", accent: "#3d7ab8", accentHi: "#86c2ff" },
  open: true,
};
