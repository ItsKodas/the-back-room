import type { GameListing } from "@backroom/core";

/** How Plinko lists itself in the room. */
export const PLINKO: GameListing = {
  id: "plinko",
  name: "Plinko",
  blurb: "Twelve rows of pegs, one board, everybody's balls.",
  shape: "machine",
  /*
   * One seat, which every table in the building would refuse. What allows it
   * is the bank: it holds only what players staked, so a win still comes from
   * real people — everybody who dropped a ball before you.
   */
  minSeats: 1,
  maxSeats: 1,
  mark: { text: "PLINKO", accentAt: 5 },
  theme: { wall: "#0c1519", felt: "#12262d", accent: "#22b8c8", accentHi: "#7cecf5" },
  open: true,
};
