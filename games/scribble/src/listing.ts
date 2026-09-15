import type { GameListing } from "@backroom/core";

/** How Scribble lists itself in the room. */
export const SCRIBBLE: GameListing = {
  id: "scribble",
  name: "Scribble",
  blurb: "One of you draws it. Everybody else races to name it.",
  shape: "party",
  /*
   * Three at the least, because two is a game of charades with an audience of
   * nobody: the whole of it is the race between the guessers. Teams need more
   * than this, and that rule lives on the table — a listing cannot know which
   * mode a host is about to pick.
   */
  minSeats: 3,
  maxSeats: 10,
  /*
   * Played for nothing, and that is not a limitation to be lifted later. A
   * drawing game cannot be refereed: two friends on a call can say the word
   * out loud, so chips on it would pay whoever colludes best.
   */
  open: false,
  mark: { text: "SCRIBBLE", accentAt: 0 },
  // The same values theme.css sets. They have to agree; a test holds them to it.
  theme: { wall: "#131218", felt: "#f2efe9", accent: "#e2409c", accentHi: "#ff9ad3" },
};
