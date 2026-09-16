import type { HintLevel, PackId, TableView } from "@backroom/game-scribble";
import {
  DEFAULT_PACKS,
  DRAW_SECONDS,
  MIN_CUSTOM_ALONE,
  minimumPlayers,
  PACK_IDS,
  PACKS,
  parseCustomWords,
  ROUNDS,
  TEAM_COUNTS,
} from "@backroom/game-scribble";
import { CODE_ALPHABET, CODE_LENGTH } from "@backroom/shared";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Seg } from "../fittings/Seg.js";
import type { Account } from "../game/useAccount.js";
import { useAccount } from "../game/useAccount.js";
import { useNav } from "../nav/NavContext.js";
import { Taken } from "../net/Taken.js";
import { TableSetup } from "../table/TableSetup.js";
import type { TableSocketHook } from "../table/useTableSocket.js";
import { useTableSocket } from "../table/useTableSocket.js";
import { GuessLog } from "./GuessLog.js";
import { Napkin } from "./Napkin.js";
import { Reveal } from "./Reveal.js";
import { Strip } from "./Strip.js";
import { TeamPick } from "./TeamPick.js";
import { Teams } from "./Teams.js";
import { Tray } from "./Tray.js";
import type { InkHandle, Tool } from "./useInk.js";
import { useInk } from "./useInk.js";
import { useScribbleSound } from "./useScribbleSound.js";
import { WordPick } from "./WordPick.js";
import "@backroom/game-scribble/theme.css";
import "./scribble.css";

type Table = TableSocketHook<TableView>;

/*
 * How much of the viewport `--sc-napkin-w` and `.sc-napkin`'s own max-height
 * (scribble.css) have to leave to everything else in the column, measured
 * off the real DOM rather than guessed: navbar + page padding + the strip
 * (single line) comes to ~232px; the drawer's own tray, shown below the
 * strip only while they're actually drawing, adds ~112px of its own height
 * plus the row-gap above it (12px) for ~356px. Tool, Size, Undo and Clear
 * share one flex-wrap row (`.sc-tray__row`) rather than Size standing apart
 * below it — sharing costs nothing at a desk width, where they all still
 * fit on one line, and only wraps (to Tool+Undo+Clear, then Size) on a
 * phone, where the tray's total height barely moves either way; keeping
 * them apart would cost the desktop napkin real width for no layout
 * necessity. A guesser mid-turn — and every other phase the napkin is
 * visible in, picking and reveal — never gets a tray (see `ink.drawing`
 * below), so charging them for one is dead space this pays back.
 *
 * Exported so `scribble.css.test.ts` can assert the CSS fallback
 * (`var(--sc-chrome, …)`, read where this same comment is mirrored) matches
 * this number exactly rather than merely matching *a* number — a test that
 * only checks the shape and not the value is what let the fallback go stale
 * and wrong-signed the last time this constant changed.
 */
export const NAPKIN_CHROME_WITH_TRAY = 356;
const NAPKIN_CHROME_NO_TRAY = 232;

export function Felt({ table, state, seatId }: { table: Table; state: TableView; seatId: string | null }) {
  const base = useInk(table, state, seatId);
  const sound = useScribbleSound({ state, seatId, log: table.chat, onRelay: table.onRelay });
  const [tool, setTool] = useState<Tool>({ ink: "black", size: 1, mode: "pen" });
  // Counts clears, so the wipe runs once for each rather than only the first.
  const [wipes, setWipes] = useState(0);
  const ink = useMemo<InkHandle>(
    () => ({
      ...base,
      begin: (chosen, x, y) => {
        sound.scratch();
        base.begin(chosen, x, y);
      },
      clear: () => {
        sound.swipe();
        setWipes((n) => n + 1);
        base.clear();
      },
    }),
    [base, sound],
  );
  const short = Math.max(0, state.minimum - state.seats.length);
  const chrome = ink.drawing ? NAPKIN_CHROME_WITH_TRAY : NAPKIN_CHROME_NO_TRAY;

  return (
    <div className={`sc${ink.drawing ? " sc--drawing" : ""}`} style={{ "--sc-chrome": `${chrome}px` } as CSSProperties}>
      <Teams state={state} seatId={seatId} />
      <div className="sc__middle">
        <Strip state={state} />
        {state.phase === "waiting" && state.mode === "teams" ? (
          <TeamPick state={state} seatId={seatId} act={table.act} error={table.error} />
        ) : null}
        {state.phase === "waiting" && state.mode === "solo" ? (
          <p className="notice">
            {short > 0 ? `Waiting for ${short} more to sit down.` : "Dealing as soon as the clock runs out."}
          </p>
        ) : null}
        {/*
         * No turn exists in "waiting" — the napkin is definitionally blank,
         * so mounting it is only dead space under the team-pick screen or a
         * solo table's own notice. `useInk` lives in `Felt`, not here, so
         * unmounting this stage never touches the `InkBook`; when it remounts
         * for "picking" the raster starts fresh from that same book, which
         * has nothing in it to have lost.
         */}
        {state.phase === "waiting" ? null : (
          <div className="sc__stage">
            <Napkin ink={ink} tool={tool} wipe={wipes} />
            {state.phase === "picking" ? (
              <WordPick state={state} seatId={seatId} act={table.act} error={table.error} />
            ) : null}
            {state.phase === "reveal" || state.phase === "over" ? <Reveal state={state} seatId={seatId} /> : null}
          </div>
        )}
        {ink.drawing ? <Tray tool={tool} onTool={setTool} onUndo={ink.undo} onClear={ink.clear} /> : null}
      </div>
      <GuessLog log={table.chat} seatId={seatId} state={state} error={table.error} onSay={table.say} />
    </div>
  );
}

export function Sit({ table, invited, account }: { table: Table; invited: string; account: Account }) {
  const [mode, setMode] = useState<"solo" | "teams">("solo");
  const [teams, setTeams] = useState<number>(2);
  const [rounds, setRounds] = useState<number>(3);
  const [drawSeconds, setDrawSeconds] = useState<number>(80);
  const [hints, setHints] = useState<HintLevel>("few");
  const [packs, setPacks] = useState<PackId[]>(["everyday", "animals", "food"]);
  const [custom, setCustom] = useState("");
  const [onlyCustom, setOnlyCustom] = useState(false);
  const parsed = parseCustomWords(custom);
  const needed = minimumPlayers({ mode, teams });
  /*
   * Whether "only my words" is more than a press: the server never honours it
   * below the minimum (options.ts), so a host who toggled it on and then
   * thinned the textarea back out is not actually getting it, whatever the
   * button still says.
   */
  const onlyCustomValid = onlyCustom && parsed.words.length >= MIN_CUSTOM_ALONE;

  /*
   * The last pack was let out only because "only my words" was standing in for
   * it. If that stops being true — the words were thinned back below the
   * minimum — a table with no packs and no valid custom list has nothing to
   * draw, and options.ts would silently hand it the defaults regardless: the
   * host would press Create believing one thing and get another. Restoring a
   * pack here keeps what's on screen the same as what the server would do.
   */
  useEffect(() => {
    if (packs.length === 0 && !onlyCustomValid) {
      setPacks([...DEFAULT_PACKS]);
    }
  }, [packs.length, onlyCustomValid]);

  const lamps = (label: string, choices: readonly number[], value: number, set: (n: number) => void, suffix = "") => (
    <div className="entry">
      <span className="label">{label}</span>
      <div className="lamps" role="radiogroup" aria-label={label}>
        {choices.map((choice) => (
          <button key={choice} type="button" role="radio" aria-checked={value === choice} className="lamp" onClick={() => set(choice)}>
            {choice}
            {suffix}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <TableSetup
      game="scribble"
      pitch="One of you draws it. Everybody else races to name it — or two of a team draw it together."
      invited={invited}
      account={account}
      busy={table.busy}
      connected={table.connected}
      onJoin={table.join}
      onWatch={table.watch}
      seats={{ initial: 8, ceiling: 10 }}
      options={
        <>
          <div className="plates" role="radiogroup" aria-label="Mode">
            {(["solo", "teams"] as const).map((option) => (
              <button key={option} type="button" role="radio" aria-checked={mode === option} className="plate" onClick={() => setMode(option)}>
                <span className="plate__name">{option === "solo" ? "Everyone for themselves" : "Teams"}</span>
                <span className="plate__note">
                  {option === "solo"
                    ? "One person draws, the rest guess. Highest score wins. Needs 3."
                    : "Two of a team draw together, everyone else guesses. Each team needs 2."}
                </span>
              </button>
            ))}
          </div>
          {mode === "teams" ? lamps("Teams", TEAM_COUNTS, teams, setTeams) : null}
          {lamps("Rounds", ROUNDS, rounds, setRounds)}
          {lamps("Draw time", DRAW_SECONDS, drawSeconds, setDrawSeconds, "s")}
          <div className="entry">
            <span className="label">Hints</span>
            <Seg<HintLevel>
              label="Hints"
              options={[
                { value: "none", text: "None" },
                { value: "few", text: "A few letters" },
                { value: "generous", text: "Generous" },
              ]}
              value={hints}
              onChange={setHints}
            />
          </div>
          <div className="entry">
            <span className="label">Word packs</span>
            <div className="lamps" role="group" aria-label="Word packs">
              {PACK_IDS.map((id) => {
                const on = packs.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={on}
                    // The last pack cannot go out unless custom words are genuinely
                    // standing in for it — a table with no words has nothing to draw.
                    disabled={on && packs.length === 1 && !onlyCustomValid}
                    className="lamp lamp--word lamp--fit"
                    onClick={() => setPacks((was) => (on ? was.filter((one) => one !== id) : PACK_IDS.filter((one) => one === id || was.includes(one))))}
                  >
                    {PACKS[id].name}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="entry">
            <label className="label" htmlFor="scribble-custom">
              Your own words
            </label>
            <textarea
              className="input"
              id="scribble-custom"
              rows={3}
              maxLength={6000}
              value={custom}
              placeholder="Kev's van, the jukebox, pint of mild"
              onChange={(event) => setCustom(event.target.value)}
            />
            <p className="hint">
              Separate with commas. {parsed.words.length} added
              {parsed.skipped > 0 ? `, ${parsed.skipped} skipped` : ""}.
              {parsed.words.length < MIN_CUSTOM_ALONE ? ` ${MIN_CUSTOM_ALONE} or more can replace the packs.` : ""}
            </p>
            <div className="lamps">
              <button
                type="button"
                aria-pressed={onlyCustomValid}
                disabled={parsed.words.length < MIN_CUSTOM_ALONE}
                className="lamp lamp--word lamp--fit"
                onClick={() => setOnlyCustom((was) => !was)}
              >
                Only my words
              </button>
            </div>
          </div>
        </>
      }
      note={({ maxSeats }) =>
        maxSeats < needed
          ? `${mode === "teams" ? `${teams} teams need` : "Scribble needs"} at least ${needed} seats.`
          : "Played for fun — nothing here is ever chips. You get a five-character code to share."
      }
      onCreate={(name, { maxSeats }) =>
        table.create(name, {
          game: "scribble",
          forFun: true,
          maxSeats,
          scribble: { mode, teams, rounds, drawSeconds, hints, packs, custom, onlyCustom: onlyCustomValid },
        })
      }
    />
  );
}

export function Scribble() {
  const navigate = useNavigate();
  const params = useParams();
  const account = useAccount();
  const raw = (params["code"] ?? "").toUpperCase();
  const looksLikeCode = raw.length === CODE_LENGTH && [...raw].every((letter) => CODE_ALPHABET.includes(letter));
  const urlCode = looksLikeCode ? raw : "";

  const back = useCallback(() => navigate("/scribble"), [navigate]);
  const table = useTableSocket<TableView>("scribble", back, account.setChips);
  const { state, seatId } = table;

  /*
   * The bar belongs to the building's shell, so this page only says what
   * should be on it rather than drawing one of its own. `room` is part of
   * that: the shell puts it on the document, where the haze and the
   * background outside this page can see it — a room that painted only its
   * own subtree would be a pink rectangle sitting in the building's blue.
   */
  useNav({
    room: "scribble",
    game: "Scribble",
    ...(state !== null ? { table: { code: state.code, onLeave: table.leave, confirm: false } } : {}),
    connected: table.connected,
  });

  useEffect(() => {
    if (state !== null && state.code !== urlCode) {
      navigate(`/scribble/${state.code}`, { replace: true });
    }
  }, [state, urlCode, navigate]);

  if (raw.length > 0 && !looksLikeCode) {
    return <p className="not-found">No table with that code.</p>;
  }

  /*
   * The widening is the napkin's, not the page's: only a table in progress
   * asks for more than `--page-width`. Setting up one is a form like every
   * other game's, and a form stretched across a desk is harder to read, not
   * easier.
   */
  return (
    <main className={`play${state !== null ? " play--scribble" : ""}`}>
      {table.error !== null ? <p className="play__error">{table.error}</p> : null}
      {table.taken !== null ? (
        <Taken message={table.taken} onRetry={table.retry} />
      ) : state === null ? (
        <Sit table={table} invited={urlCode} account={account} />
      ) : (
        <Felt table={table} state={state} seatId={seatId} />
      )}
    </main>
  );
}

export default Scribble;
