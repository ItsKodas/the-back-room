import type { TableView } from "@backroom/game-two-up";
import { CHIPS, MIN_CHIP } from "@backroom/game-two-up";
import { useId, useState } from "react";
import { Chip } from "../chips/Chip.js";
import { exact } from "../game/money.js";
import type { TableSocketHook } from "../table/useTableSocket.js";

/**
 * The rail: what you are betting with, and the three ways a stake comes back
 * off the cloth.
 *
 * Sticky to the bottom of the viewport, which is what makes its height a real
 * design constraint rather than a detail — at 375px it was a quarter of the
 * screen before anything was drawn on the felt above it. So the seven chips
 * keep their row, the acts share one, and the box for a figure of your own is
 * not drawn until somebody asks for it. Nothing here is hidden behind hover:
 * the box is a press away, and the key that opens it says what is held.
 *
 * Every control is a courtesy. The server checks the amount against the purse
 * and the bank and refuses what fails; this only decides what to light.
 */

/** Read the way a figure is printed here: commas welcome and ignored. */
export function readAmount(typed: string): number | null {
  const digits = typed.replace(/[^\d]/g, "");
  return digits === "" ? null : Number(digits);
}

/** Whether this is one of the seven the room mints, or a figure of somebody's own. */
export function isChip(amount: number): boolean {
  return (CHIPS as readonly number[]).includes(amount);
}

export function Rail({
  table,
  state,
  chip,
  onChip,
}: {
  table: TableSocketHook<TableView>;
  state: TableView;
  chip: number;
  onChip: (value: number) => void;
}) {
  const purse = state.you?.purse ?? null;
  const down = state.you?.staked ?? 0;
  const open = state.school === "casino" && state.phase === "betting" && !state.lastCall;

  return (
    <div className="tu__rail">
      <Amounts chip={chip} onChip={onChip} purse={purse} />

      {state.school === "casino" ? (
        <div className="tu__acts">
          <button
            type="button"
            className="tu__act"
            /* Written out, not left to how the two spans happen to sit: a name
               and a note with nothing between them read as one run-on word. */
            aria-label="Put last round's chips down again"
            disabled={!open || !state.canRepeat || table.busy}
            onClick={() => table.act({ type: "repeat" })}
          >
            <span className="tu__act-name">Same again</span>
            <span className="tu__act-note">Last round's chips</span>
          </button>
          <button
            type="button"
            className="tu__act"
            aria-label="Undo the last chip you put down"
            disabled={!open || down === 0 || table.busy}
            onClick={() => table.act({ type: "undo" })}
          >
            <span className="tu__act-name">Undo</span>
            <span className="tu__act-note">The last chip down</span>
          </button>
          <button
            type="button"
            className="tu__act"
            aria-label="Take back everything you have on the cloth"
            disabled={!open || down === 0 || table.busy}
            onClick={() => table.act({ type: "clear" })}
          >
            <span className="tu__act-name">Clear</span>
            <span className="tu__act-note">Everything you have on</span>
          </button>
        </div>
      ) : null}

      {/*
        One line, and which line depends on whether there is anything to
        report. Two lines of figures plus the gesture was 43px of a sticky
        rail; somebody with nothing on the cloth has no figures worth the
        room, and somebody who has chips down has already found the gesture.
      */}
      <p className="tu__note">
        {down === 0 && purse === null ? (
          "Hold a side to take a chip back off."
        ) : (
          <>
            {down > 0 ? (
              <>
                <strong className="tu__note-figure">{exact(down)}</strong> on the cloth.{" "}
              </>
            ) : null}
            {purse === null ? null : (
              <>
                <strong className="tu__note-figure">{exact(purse)}</strong> in play money left.
              </>
            )}
          </>
        )}
      </p>
    </div>
  );
}

/**
 * The seven the room mints, and an eighth key for anything else.
 *
 * The chips stay because they are the room's own alphabet — `bank.ts` says so:
 * somebody who has learned that purple is five hundred should not have to
 * learn it again across the floor. What they cannot do is name 1,375, and the
 * table has always taken any whole number from twenty-five up.
 */
function Amounts({
  chip,
  onChip,
  purse,
}: {
  chip: number;
  onChip: (value: number) => void;
  purse: number | null;
}) {
  const id = useId();
  const ownHeld = !isChip(chip);
  /*
   * Whether the box is drawn at all. Its own state rather than derived from
   * `ownHeld`, because the two answer different questions — a held figure is
   * still held while the box is shut, which is the whole point of shutting it.
   */
  const [typing, setTyping] = useState(false);
  /* Half a number is no use to anybody outside this box, so it stays in here. */
  const [draft, setDraft] = useState(() => (ownHeld ? exact(chip) : ""));
  const typed = readAmount(draft);
  const affordable = typed !== null && typed >= MIN_CHIP && (purse === null || typed <= purse);

  const hold = () => {
    if (!affordable || typed === null) {
      return;
    }
    onChip(typed);
    setDraft(exact(typed));
    // Shut behind itself: the box has done its job, and a rail that stays
    // tall afterwards is a rail that costs a phone a row for nothing.
    setTyping(false);
  };

  return (
    <div className="tu__amounts">
      <div className="tu__tray-row">
        <div className="tu__tray" role="radiogroup" aria-label="What to bet with">
          {CHIPS.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={chip === value}
              aria-label={`Bet with ${exact(value)}`}
              className={`tu__chip${chip === value ? " tu__chip--picked" : ""}`}
              disabled={purse !== null && value > purse}
              onClick={() => onChip(value)}
            >
              <Chip amount={value} />
            </button>
          ))}
        </div>

        {/*
          The eighth key, which is also the readout. Shut, it carries whatever
          figure of their own the player is holding — so collapsing the box
          costs them sight of nothing.
        */}
        <button
          type="button"
          className={`tu__own-key${ownHeld ? " tu__own-key--held" : ""}`}
          aria-expanded={typing}
          aria-controls={`${id}-own`}
          aria-label={ownHeld ? `Betting with ${exact(chip)}. Change it.` : "Bet an amount of your own"}
          onClick={() => setTyping((was) => !was)}
        >
          <span className="tu__own-face">{ownHeld ? exact(chip) : "123"}</span>
        </button>
      </div>

      {typing ? (
        <div className="tu__own" id={`${id}-own`}>
          <span className="tu__field">
            <input
              type="text"
              inputMode="numeric"
              enterKeyHint="done"
              autoComplete="off"
              // Focused on arrival: the key was pressed to type in this box,
              // and a box you have to aim at twice is a box on a phone.
              // biome-ignore lint/a11y/noAutofocus: opened by a deliberate press, and the only thing in it
              autoFocus
              aria-label="An amount of your own"
              placeholder={`${exact(MIN_CHIP)} or more`}
              value={draft}
              onChange={(event) => setDraft(event.target.value.replace(/[^\d,]/g, ""))}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  hold();
                }
              }}
            />
          </span>
          {/*
            Nothing is held on a keystroke — typing a thousand goes through a
            one and a ten on the way, and each of those is a figure somebody
            could have bet by accident.
          */}
          <button type="button" className="tu__hold" disabled={!affordable} onClick={hold}>
            Hold it
          </button>
        </div>
      ) : null}
    </div>
  );
}
