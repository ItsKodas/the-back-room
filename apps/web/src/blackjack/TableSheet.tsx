import { WINDOWS } from "@backroom/game-blackjack";
import type { BotSkill } from "@backroom/shared";
import { Seg } from "../fittings/Seg.js";
import { Sheet } from "../table/Sheet.js";

export const TABLE_SHEET_ID = "bj-table";

export interface TableSheetProps {
  open: boolean;
  onClose: () => void;
  code: string;
  bettingMs: number;
  listed: boolean;
  forFun: boolean;
  /** How many are sitting at the table now. */
  seated: number;
  maxSeats: number;
  onWindow: (ms: number) => void;
  onListed: (listed: boolean) => void;
  onBot: (skill: BotSkill) => void;
}

const SKILLS: ReadonlyArray<{ skill: BotSkill; text: string }> = [
  { skill: "easy", text: "Easy" },
  { skill: "normal", text: "Normal" },
  { skill: "hard", text: "Hard" },
];

/**
 * The shape of the evening, which is the host's to set: how long everybody gets
 * to bet, who can find the table, and who else sits down. Behind a key, because
 * none of it is anything to do with the hand in front of you.
 */
export function TableSheet({
  open,
  onClose,
  code,
  bettingMs,
  listed,
  forFun,
  seated,
  maxSeats,
  onWindow,
  onListed,
  onBot,
}: TableSheetProps) {
  return (
    <Sheet
      id={TABLE_SHEET_ID}
      label="Table"
      heading={`Table ${code}`}
      open={open}
      onClose={onClose}
      className="sheet--page"
    >
      <div className="bj__field">
        <p className="label">Time to bet</p>
        <Seg
          label="Time to bet"
          options={WINDOWS.map((ms) => ({ value: String(ms), text: `${ms / 1000}s` }))}
          value={String(bettingMs)}
          onChange={(value) => onWindow(Number(value))}
        />
        {/* Not this hand: the deal is already scheduled against the clock that is running. */}
        <p className="hint">Takes effect on the next hand.</p>
      </div>
      <div className="bj__field">
        <p className="label">Who can find it</p>
        <Seg
          label="Who can find it"
          options={[
            { value: true, text: "Public" },
            { value: false, text: "Private" },
          ]}
          value={listed}
          onChange={onListed}
        />
      </div>
      {/* Bots only ever sit at a table playing for nothing, because chips are
          only won from real people. The server refuses either way; this just
          stops offering something that would be turned down. */}
      {forFun && seated < maxSeats ? (
        <div className="bj__field">
          <p className="label">Add a player</p>
          <div className="bj__bots">
            {SKILLS.map(({ skill, text }) => (
              <button key={skill} type="button" className="key key--small" onClick={() => onBot(skill)}>
                {text}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}
