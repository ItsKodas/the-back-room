import type { HouseRules, RoomView } from "@backroom/shared";

interface EditorProps {
  room: RoomView;
  /** Guests see the same rules, but cannot move them. */
  editable: boolean;
  onChange: (changes: Partial<HouseRules>) => void;
}

const TARGETS = [2000, 5000, 10_000, 20_000];
const THRESHOLDS = [0, 350, 500, 1000];
const TIMERS: Array<number | null> = [30, 60, 120, null];

/** A rule the host can switch off, and what it is worth when on. */
const TOGGLES: Array<{ key: "straight" | "threePairs" | "twoTriplets" | "fourPlusPair"; label: string; when: number }> = [
  { key: "straight", label: "Straight", when: 1500 },
  { key: "threePairs", label: "Three pairs", when: 750 },
  { key: "twoTriplets", label: "Two triplets", when: 2500 },
  { key: "fourPlusPair", label: "Four and a pair", when: 1500 },
];

export function HouseRulesEditor({ room, editable, onChange }: EditorProps) {
  const rules = room.ruleset;

  return (
    <section className="housing" aria-label="House rules">
      <div className="housing__head">
        <h2 className="label">House rules</h2>
      </div>
      <div className="housing__body">
        <Choice
          label="First to"
          options={TARGETS.map((value) => ({ value, text: value.toLocaleString("en-US") }))}
          current={rules.targetScore}
          editable={editable}
          onPick={(value) => onChange({ targetScore: value })}
        />

        <Choice
          label="On the board at"
          options={THRESHOLDS.map((value) => ({
            value,
            text: value === 0 ? "any" : value.toLocaleString("en-US"),
          }))}
          current={rules.entryThreshold}
          editable={editable}
          onPick={(value) => onChange({ entryThreshold: value })}
        />

        <Choice
          label="Turn clock"
          options={TIMERS.map((value) => ({ value, text: value === null ? "off" : `${value}s` }))}
          current={rules.turnTimerSeconds}
          editable={editable}
          onPick={(value) => onChange({ turnTimerSeconds: value })}
        />

        <div className="rules__toggles">
          {TOGGLES.map((toggle) => {
            const on = rules[toggle.key] !== null && (rules[toggle.key] ?? 0) > 0;
            return (
              <button
                key={toggle.key}
                type="button"
                aria-pressed={on}
                disabled={!editable}
                className="lamp lamp--word rules__toggle"
                onClick={() => onChange({ [toggle.key]: on ? null : toggle.when })}
              >
                <span>{toggle.label}</span>
                <b>{on ? (rules[toggle.key] ?? 0).toLocaleString("en-US") : "off"}</b>
              </button>
            );
          })}
        </div>

        {!editable ? <p className="hint">Only the host can change these.</p> : null}
      </div>
    </section>
  );
}

function Choice<T extends number | null>({
  label,
  options,
  current,
  editable,
  onPick,
}: {
  label: string;
  options: Array<{ value: T; text: string }>;
  current: T;
  editable: boolean;
  onPick: (value: T) => void;
}) {
  return (
    <div className="rules__row">
      <span className="label">{label}</span>
      <div className="lamps" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={option.value === current}
            disabled={!editable}
            className="lamp"
            onClick={() => onPick(option.value)}
          >
            {option.text}
          </button>
        ))}
      </div>
    </div>
  );
}
