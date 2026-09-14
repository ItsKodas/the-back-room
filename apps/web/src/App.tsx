import { Route, Routes } from "react-router-dom";
import { Admin } from "./admin/Admin.js";
import { Haze } from "./atmosphere/Haze.js";
import { Blackjack } from "./blackjack/Blackjack.js";
import { DeathRoll } from "./deathroll/DeathRoll.js";
import { Leaderboard } from "./leaderboard/Leaderboard.js";
import { Poker } from "./poker/Poker.js";
import { Roulette } from "./roulette/Roulette.js";
import Slots from "./slots/Slots.js";
import { Play } from "./game/Play.js";
import { useButtonSound } from "./game/useButtonSound.js";
import { Profile } from "./profile/Profile.js";
import { Room } from "./room/Room.js";
import { TableLink } from "./room/TableLink.js";
import { Gallery } from "./style/Gallery.js";
import Tips from "./tips/Tips.js";

export default function App() {
  // Every press on the site, from one listener. Mounted here because it
  // belongs to the building rather than to any room in it.
  useButtonSound();

  return (
    <>
      {/* Behind every page, and mounted out here rather than in one: it is the
          air in the building, so it should not be rebuilt each time you walk
          between rooms. */}
      <Haze />
      <Routes>
      <Route path="/" element={<Room />} />
      {/*
        * Static segments are declared before the dynamic one. React-router
        * ranks a literal above a parameter anyway, but the order says the
        * intent out loud: /style is a page, not a five-letter table code.
        */}
      <Route path="/admin" element={<Admin />} />
      <Route path="/me" element={<Profile />} />
      <Route path="/style" element={<Gallery />} />
      <Route path="/leaderboard" element={<Leaderboard />} />
      <Route path="/greed" element={<Play />} />
      <Route path="/greed/:code" element={<Play />} />
      <Route path="/blackjack" element={<Blackjack />} />
      <Route path="/death-roll" element={<DeathRoll />} />
      <Route path="/death-roll/:code" element={<DeathRoll />} />
      <Route path="/poker" element={<Poker />} />
      <Route path="/poker/:code" element={<Poker />} />
      <Route path="/roulette" element={<Roulette />} />
      <Route path="/roulette/:code" element={<Roulette />} />
      <Route path="/slots" element={<Slots />} />
      <Route path="/tips" element={<Tips />} />
      <Route path="/blackjack/:code" element={<Blackjack />} />
      {/*
        * A bare code at the root, so a link that was shared before there were
        * several games still works and no share link ever has to name one.
        */}
      <Route path="/:code" element={<TableLink />} />
      <Route path="*" element={<p className="not-found">No such page.</p>} />
      </Routes>
    </>
  );
}
