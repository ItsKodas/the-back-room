import { ANIMALS } from "./animals.js";
import { EVERYDAY } from "./everyday.js";
import { FILMS } from "./films.js";
import { FOOD } from "./food.js";
import { HARD } from "./hard.js";
import { MUSIC } from "./music.js";
import { PLACES } from "./places.js";
import { SPORT } from "./sport.js";

export type PackId = "everyday" | "animals" | "food" | "films" | "places" | "sport" | "music" | "hard";

/** In the order the setup screen shows them. */
export const PACK_IDS: readonly PackId[] = ["everyday", "animals", "food", "films", "places", "sport", "music", "hard"];

export const PACKS: Record<PackId, { name: string; words: readonly string[] }> = {
  everyday: { name: "Everyday", words: EVERYDAY },
  animals: { name: "Animals", words: ANIMALS },
  food: { name: "Food & drink", words: FOOD },
  films: { name: "Films & TV", words: FILMS },
  places: { name: "Places", words: PLACES },
  sport: { name: "Sport", words: SPORT },
  music: { name: "Music", words: MUSIC },
  hard: { name: "Hard mode", words: HARD },
};
