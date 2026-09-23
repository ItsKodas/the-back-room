import { card, felt, glass, plaster, vignette } from "@backroom/ui";
import type { CSSProperties } from "react";

interface Tile {
  id: string;
  name: string;
  note: string;
  background: string;
}

const tiles: Tile[] = [
  { id: "plaster", name: "plaster", note: "seed 1", background: plaster({ seed: 1 }) },
  { id: "plaster-alt", name: "plaster", note: "seed 2", background: plaster({ seed: 2 }) },
  { id: "felt", name: "felt", note: "seed 1", background: felt({ seed: 1 }) },
  { id: "glass", name: "glass", note: "lit", background: glass({ seed: 1 }) },
  { id: "card", name: "card", note: "seed 1", background: card({ seed: 1 }) },
  {
    id: "vignette",
    name: "vignette",
    note: "over plaster",
    background: `${vignette()}, ${plaster({ seed: 4 })}`,
  },
];

export function TextureTiles() {
  return (
    <section className="section" aria-label="Textures">
      <h2 className="section__title">Textures</h2>
      <div className="tiles">
        {tiles.map((tile) => (
          <div key={tile.id}>
            <div
              className="tile__surface"
              data-testid={`texture-${tile.id}`}
              /*
               * Handed to the stylesheet rather than written straight into
               * `background-image`, which is how every other computed value in
               * here reaches CSS. A custom property is stored as written; a
               * background-image is resolved and re-serialised on the way in,
               * and resolving a gradient costs enough — superlinear in the
               * length of the value, and each of these carries an encoded SVG —
               * that six of them were most of what rendering the gallery took.
               */
              style={{ "--tile-surface": tile.background } as CSSProperties}
            />
            <span className="tile__name">{tile.name}</span>
            <span className="tile__note">{tile.note}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
