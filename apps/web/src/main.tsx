import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.js";
import "@backroom/ui/tokens.css";
import "./global.css";
/*
 * Site-wide, not per page. It used to be imported by the game, which meant the
 * room and the profile rendered with no styles at all — the markup was there
 * and nothing could be seen.
 */
import "./game/game.css";
/*
 * Here for the same reason: taunts are the building's furniture rather than
 * any one game's, and every table can carry them.
 */
import "./taunt/taunt.css";
/*
 * Here for the same reason as the two above: a window turned away from one
 * game is turned away on every game's page, so its panel is the building's
 * furniture rather than any one game's.
 */
import "./net/net.css";
import "./tips/tips.css";
import "./leaderboard/leaderboard.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("index.html is missing #root");
}

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
