import { Sign } from "../game/Sign.js";
import { Deck } from "./Deck.js";
import { Fittings } from "./Fittings.js";
import { PokerMockup } from "./PokerMockup.js";
import { RouletteMockup } from "./RouletteMockup.js";
import { SlotMockup } from "./SlotMockup.js";
import { Swatches } from "./Swatches.js";
import { TextureTiles } from "./TextureTiles.js";
import { TypeSpecimen } from "./TypeSpecimen.js";
import "@backroom/game-slots/theme.css";
import "./gallery.css";

export function Gallery() {
  return (
    <main className="gallery">
      <h1 className="gallery__title">
        <Sign />
      </h1>
      <p className="gallery__deck">
        The building's design system, as running code — every colour, typeface and surface the room
        is built from. A game may repaint the materials it is played on; these are what it borrows
        and must not change: the sign, the controls, and the two colours that carry meaning rather
        than mood. Anything glowing is happening now. Anything gold is money.
      </p>
      <Swatches />
      <TypeSpecimen />
      <TextureTiles />
      <Fittings />
      <Deck />
      <SlotMockup />
      <PokerMockup />
      <RouletteMockup />
    </main>
  );
}
