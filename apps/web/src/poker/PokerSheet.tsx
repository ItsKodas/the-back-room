import { POKER } from "@backroom/game-poker";
import type { BotSkill } from "@backroom/shared";
import { Seg } from "../fittings/Seg.js";
import { Sheet } from "../table/Sheet.js";

export const POKER_SHEET_ID = "pk-table";

export interface PokerSheetProps {
  open: boolean;
  onClose: () => void;
  code: string;
  listed: boolean;
  forFun: boolean;
  /** How many are sitting at the table now. */
  seated: number;
  onListed: (listed: boolean) => void;
  onBot: (skill: BotSkill) => void;
}

const SKILLS: ReadonlyArray<{ skill: BotSkill; text: string }> = [
  { skill: "easy", text: "Easy" },
  { skill: "normal", text: "Normal" },
  { skill: "hard", text: "Hard" },
];

/**
 * The shape of the evening, which is the host's to set: who can find the
 * table and who else sits down. Behind a key, because none of it is anything
 * to do with the hand in front of you.
 *
 * No "time to bet" field the way blackjack's table sheet has one — a poker
 * turn runs on its own clock fixed when the table opened, not a dial the
 * host turns mid-evening.
 */
export function PokerSheet({
  open,
  onClose,
  code,
  listed,
  forFun,
  seated,
  onListed,
  onBot,
}: PokerSheetProps) {
  return (
    <Sheet
      id={POKER_SHEET_ID}
      label="Table"
      heading={`Table ${code}`}
      open={open}
      onClose={onClose}
      className="sheet--page"
    >
      <div className="pk__field">
        <p className="label">Seats</p>
        {/*
         * Not "of the maximum the host chose" — a poker table's view carries
         * no such field, and a number this sheet cannot get right is worse
         * than none (never invent a fact). The building's own ceiling for
         * the game is the one true thing to measure against, and it is the
         * same ten the felt already holds bots to.
         */}
        <p className="pk__seats-count">
          {seated} of {POKER.maxSeats} seated
        </p>
      </div>
      <div className="pk__field">
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
      {forFun && seated < POKER.maxSeats ? (
        <div className="pk__field">
          <p className="label">Add a player</p>
          <div className="pk__sheet-bots">
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
