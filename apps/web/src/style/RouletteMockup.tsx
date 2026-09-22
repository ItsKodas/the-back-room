import type { Win } from "@backroom/game-roulette";
import { CHIPS, SPIN_MS, WHEEL, colourOf } from "@backroom/game-roulette";
import { useEffect, useRef, useState } from "react";
import { Chip } from "../chips/Chip.js";
import { Seg } from "../fittings/Seg.js";
import { Cloth } from "../roulette/Cloth.js";
import { Wheel } from "../roulette/Wheel.js";
import { Winners } from "../roulette/Winners.js";
import "@backroom/game-roulette/theme.css";
// The table's own stylesheet, which the real felt shares: see roulette.css.
import "../roulette/roulette.css";

/**
 * A roulette table, before there is one.
 *
 * Not a drawing of the felt — the felt, with nothing behind it. The wheel and
 * the cloth here are the same components the real table uses, so what this
 * answers is the half the engine cannot: whether a cloth of thirty-seven
 * numbers and six outside boxes is readable at all, whether aiming at a corner
 * with a thumb actually works, and what the thing looks like at 375px.
 *
 * Chips placed here are placed nowhere. There is no bank, no seat and no
 * money; the only thing being tested is the surface.
 */

const HISTORY = [17, 0, 32, 5, 21, 34, 2, 26, 14];

/*
 * A board of winners, fixed.
 *
 * Nothing here settles anything — chips placed on this cloth are placed
 * nowhere — so these are furniture rather than results. Which is all the
 * mockup needs them to be: what it is being asked is whether a row of names
 * and figures beside a row of numbers is readable at 375px, and a name long
 * enough to be a problem is a better test of that than a real one would be.
 */
const WINNERS: Win[] = [
  { spin: 7, pocket: 21, seatId: "them", name: "Marguerite", up: 1750 },
  { spin: 8, pocket: 34, seatId: "you", name: "You", up: 300 },
  { spin: 9, pocket: 26, seatId: "them", name: "Sal", up: 8600 },
  { spin: 10, pocket: 14, seatId: "you", name: "You", up: 3500 },
];

/*
 * The real table's own figure, not a shortened one.
 *
 * The mockup exists to answer whether this feels right, and the length of the
 * spin is most of that feeling — showing it at half speed would be testing
 * something nobody will ever play.
 */
const MOCK_SPIN_MS = SPIN_MS;

export function RouletteMockup() {
  const [history, setHistory] = useState<number[]>(HISTORY);
  const [spinning, setSpinning] = useState(false);
  const [pocket, setPocket] = useState<number | null>(14);
  const [placed, setPlaced] = useState<{ seatId: string; spotId: string; chips: number }[]>([
    { seatId: "you", spotId: "straight:17", chips: 100 },
    { seatId: "you", spotId: "corner:1-2-4-5", chips: 250 },
    { seatId: "them", spotId: "even:1-3-5-7-9-12-14-16-18-19-21-23-25-27-30-32-34-36", chips: 500 },
    { seatId: "them", spotId: "split:20-23", chips: 50 },
    { seatId: "you", spotId: "dozen:13-14-15-16-17-18-19-20-21-22-23-24", chips: 100 },
  ]);
  const [chip, setChip] = useState<number>(100);
  /*
   * Cloth has taken its own `portrait` prop all along, and reads `undefined`
   * as "work it out from my own width" — that is how the real felt gets a
   * phone right without ever passing the prop at all. `Seg` only carries
   * `string | boolean`, so `undefined` needs a string of its own to sit
   * beside "laid out" and "on its side"; "auto" is that string, and it is the
   * default so the gallery shows a real phone's behaviour unless a size is
   * forced.
   */
  const [orientation, setOrientation] = useState<"auto" | "laid" | "side">("auto");
  const portrait = orientation === "auto" ? undefined : orientation === "side";

  /*
   * A spin, for the mockup only. The real table is told where the ball went by
   * the server the moment betting closes; this picks its own so the animation
   * can be watched without one.
   */
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
    }
  }, []);

  const spin = () => {
    if (spinning) {
      return;
    }
    const landed = WHEEL[Math.floor(Math.random() * WHEEL.length)] as number;
    setPocket(landed);
    setSpinning(true);
    timer.current = window.setTimeout(() => {
      setSpinning(false);
      setHistory((was) => [...was, landed].slice(-12));
    }, MOCK_SPIN_MS);
  };

  return (
    <section className="gallery__section rl" data-game="roulette">
      <h2 className="gallery__heading">Roulette</h2>
      <p className="gallery__note">
        The wheel is drawn from the rim order the rules use, so the picture and the decision are one
        list. The cloth takes a chip wherever you aim it — on a number, on the line between two, or
        on the point where four meet — and names the bet before it costs anything. Right-click, or
        press and hold, to take one back off. On a narrow
        screen the cloth turns on its side, so its squares stay big enough to hit.
      </p>

      <div className="rl__boards">
        <div className="rl__history">
          {history.map((n, at) => (
            <span
              key={`${n}-${at}`}
              className={`rl__past rl__past--${colourOf(n) ?? "zero"}${
                at === history.length - 1 ? " rl__past--latest" : ""
              }`}
            >
              {n}
            </span>
          ))}
        </div>
        <Winners winners={WINNERS} />
      </div>

      <Seg
        label="Cloth"
        value={orientation}
        onChange={setOrientation}
        options={[
          { value: "auto", text: "Auto" },
          { value: "laid", text: "Laid out" },
          { value: "side", text: "On its side" },
        ]}
      />

      <div className="rl__table">
        <div className="rl__wheel-holds">
          <Wheel
            pocket={pocket}
            spinning={spinning}
            spinMs={MOCK_SPIN_MS}
            covered={new Set([17, 1, 2, 4, 5])}
          />
        </div>
        <Cloth
          placed={placed}
          mine="you"
          landed={spinning ? null : pocket}
          disabled={spinning}
          portrait={portrait}
          onPlace={(spotId: string) =>
            setPlaced((was) => {
              const already = was.find((one) => one.seatId === "you" && one.spotId === spotId);
              return already === undefined
                ? [...was, { seatId: "you", spotId, chips: chip }]
                : was.map((one) =>
                    one === already ? { ...one, chips: one.chips + chip } : one,
                  );
            })
          }
          onTake={(spotId: string) =>
            setPlaced((was) =>
              was.flatMap((one) => {
                if (one.seatId !== "you" || one.spotId !== spotId) {
                  return [one];
                }
                const left = one.chips - Math.min(one.chips, chip);
                return left === 0 ? [] : [{ ...one, chips: left }];
              }),
            )
          }
        />
      </div>

      <div className="rl__tray">
        {CHIPS.map((value) => (
          <button
            key={value}
            type="button"
            className={`rl__chip${chip === value ? " rl__chip--picked" : ""}`}
            aria-label={`Bet with ${value.toLocaleString("en-US")} chips`}
            aria-pressed={chip === value}
            onClick={() => setChip(value)}
          >
            <Chip amount={value} size={38} />
          </button>
        ))}
        <button type="button" className="rl__chip" onClick={() => setPlaced([])}>
          <span style={{ fontSize: 12, lineHeight: 1.6, padding: "0 8px" }}>Clear</span>
        </button>
        <button type="button" className="rl__spin" onClick={spin} disabled={spinning}>
          {spinning ? "No more bets" : "Spin"}
        </button>
      </div>
    </section>
  );
}
