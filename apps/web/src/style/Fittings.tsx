import { useState } from "react";
import { CodeScreen } from "../fittings/CodeScreen.js";
import { Seg } from "../fittings/Seg.js";
import "@backroom/game-blackjack/theme.css";
import "@backroom/game-greed/theme.css";
import "@backroom/game-roulette/theme.css";

const ROOMS = [
  { value: "", text: "Building" },
  { value: "blackjack", text: "Blackjack" },
  { value: "greed", text: "Greed" },
  { value: "roulette", text: "Roulette" },
  { value: "slots", text: "Slots" },
] as const;

type Room = (typeof ROOMS)[number]["value"];

/**
 * Every fitting, on one board, in whichever room you pick.
 *
 * Painted by putting data-game on this section rather than the document, the
 * way a front-page tile is, so the rest of the gallery keeps its own light.
 * This is the reference the table pass builds from.
 */
export function Fittings() {
  const [room, setRoom] = useState<Room>("blackjack");
  const [plays, setPlays] = useState<"chips" | "fun">("chips");
  const [seats, setSeats] = useState(6);
  const [variant, setVariant] = useState("Farkle");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const press = () => {
    setBusy(true);
    window.setTimeout(() => setBusy(false), 1600);
  };

  return (
    <section className="gallery__section fittings" aria-labelledby="fittings-title" {...(room === "" ? {} : { "data-game": room })}>
      <h2 className="gallery__heading" id="fittings-title">
        Fittings
      </h2>
      <Seg label="Room" options={ROOMS} value={room} onChange={setRoom} />

      <div className="fittings__grid">
        <div className="housing">
          <div className="housing__head">
            <code className="label">.slab</code>
          </div>
          <div className="housing__body">
            <button type="button" className={`slab${busy ? " is-busy" : ""}`} disabled={busy} onClick={press}>
              Open a table
            </button>
            <button type="button" className="slab" disabled>
              Take a seat
            </button>
          </div>
        </div>

        <div className="housing">
          <div className="housing__head">
            <code className="label">.key</code>
          </div>
          <div className="housing__body">
            <button type="button" className="key">
              Just watch
            </button>
            <button type="button" className="key key--small">
              Sit
            </button>
            <code className="label">.quiet</code>
            <button type="button" className="quiet">
              Cancel
            </button>
          </div>
        </div>

        <div className="housing">
          <div className="housing__head">
            <code className="label">.seg</code>
          </div>
          <div className="housing__body">
            <Seg
              label="Plays for"
              options={[
                { value: "chips", text: "For chips" },
                { value: "fun", text: "For fun" },
              ]}
              value={plays}
              onChange={setPlays}
            />
            <code className="label">.lamps</code>
            <div className="lamps" role="radiogroup" aria-label="Seats">
              {[2, 4, 6, 8, 10].map((n) => (
                <button key={n} type="button" role="radio" className="lamp" aria-checked={n === seats} onClick={() => setSeats(n)}>
                  {n}
                </button>
              ))}
            </div>
            <code className="label">.sort</code>
            <div className="sorts">
              <button type="button" className="sort" aria-pressed="true">
                chips
              </button>
              <button type="button" className="sort" aria-pressed="false">
                net
              </button>
            </div>
          </div>
        </div>

        <div className="housing">
          <div className="housing__head">
            <code className="label">.plates</code>
          </div>
          <div className="housing__body">
            <div className="plates" role="radiogroup" aria-label="Variant">
              {["Farkle", "Greed"].map((name) => (
                <button key={name} type="button" role="radio" className="plate" aria-checked={name === variant} onClick={() => setVariant(name)}>
                  <span className="plate__name">{name}</span>
                  <span className="plate__note">{name === "Greed" ? "$ G R E E D faces. First to 5,000." : "Ordinary pips. First to 10,000."}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="housing">
          <div className="housing__head">
            <code className="label">.input</code>
          </div>
          <div className="housing__body">
            <label className="entry">
              <span className="label">Your name</span>
              <input className="input" placeholder="Ada" />
            </label>
            <code className="label">.lcd</code>
            <CodeScreen value={code} onChange={setCode} />
          </div>
        </div>

        <div className="housing">
          <div className="housing__head">
            <code className="label">.housing</code>
            <span className="tag tag--live">Live</span>
          </div>
          <div className="housing__body">
            <div className="well">
              <code className="label">.well</code>
            </div>
            <code className="label">.readout</code>
            <div className="readout">
              <span className="label">Blackjack bank</span>
              <span className="readout__figure readout__figure--chips">1,204,880</span>
            </div>
          </div>
          <div className="housing__foot">
            <button type="button" className="quiet">
              Keep it open
            </button>
            <button type="button" className="slab slab--small">
              Close it
            </button>
          </div>
        </div>

        <div className="housing">
          <div className="housing__head">
            <code className="label">.rows</code>
          </div>
          <div className="housing__body">
            <ul className="rows">
              <li className="row">
                <span className="row__code">XKQ37</span>
                <span className="row__who">
                  <span className="row__name">An example table</span>
                  <span className="row__meta">
                    <span className="tag tag--live">in play</span> 4/6
                  </span>
                </span>
                <button type="button" className="key key--small">
                  Sit
                </button>
              </li>
            </ul>
            <code className="label">.tag</code>
            <span className="tag tag--chips">For chips</span>
            <code className="label">.notice</code>
            <p className="notice notice--bad">Not enough chips.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
