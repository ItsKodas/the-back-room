import type { BotSpeed, RuleDef, Rules } from "@backroom/game-uno";
import { CATEGORIES, officialRules, presetOf, PRESETS, RULES, sanitize } from "@backroom/game-uno";
import { useId } from "react";

/**
 * The host's rules for a new table, laid out as the tabletop's setup screen
 * laid them out: the presets along the top, then every rule in its category
 * with its switch, its list or its number, and the ones changed from the box
 * marked as changed.
 *
 * Drawn from the game's own list, so a rule added to the game appears here
 * without anybody touching this file. Nothing here is the rule — the server
 * checks every value against the same list — so the controls are held inside
 * what is legal as a courtesy.
 */
export function RulesForm({ rules, onChange }: { rules: Rules; onChange: (rules: Rules) => void }) {
  const preset = presetOf(rules);
  const set = (id: RuleDef["id"], value: boolean | number | string) => onChange(sanitize({ ...rules, [id]: value }));

  return (
    <div className="uno-rules">
      <div className="uno-rules__head">
        <h3>Rules</h3>
        <div className="uno-presets" role="radiogroup" aria-label="Game mode">
          <span className="uno-muted">Presets</span>
          {PRESETS.map((one) => (
            <button
              key={one.id}
              type="button"
              role="radio"
              aria-checked={preset?.id === one.id}
              className="uno-preset"
              title={one.blurb}
              onClick={() => onChange(one.rules())}
            >
              {one.name}
            </button>
          ))}
        </div>
      </div>
      <p className="uno-rules__mode">{preset === null ? "House rules: your own mix of the rules below." : preset.blurb}</p>
      {CATEGORIES.map((category) => (
        <fieldset key={category.id} className="uno-rule-cat">
          <legend>{category.name}</legend>
          {RULES.filter((rule) => rule.category === category.id).map((rule) => (
            <RuleRow key={rule.id} rule={rule} rules={rules} onSet={set} />
          ))}
        </fieldset>
      ))}
    </div>
  );
}

function RuleRow({
  rule,
  rules,
  onSet,
}: {
  rule: RuleDef;
  rules: Rules;
  onSet: (id: RuleDef["id"], value: boolean | number | string) => void;
}) {
  const id = useId();
  const value = rules[rule.id];
  const disabled = rule.enabledIf !== undefined && !rule.enabledIf(rules);
  const changed = value !== officialRules()[rule.id];
  return (
    <div className={`uno-rule${disabled ? " is-off" : ""}${changed ? " is-custom" : ""}`}>
      <div>
        <label className="uno-rule__name" htmlFor={id}>
          {rule.name}
          {changed ? <span className="uno-tag">changed</span> : null}
        </label>
        <p className="uno-rule__desc" id={`${id}-desc`}>
          {rule.desc}
        </p>
      </div>
      <div className="uno-rule__ctl">
        {rule.type === "bool" ? (
          <span className="uno-switch">
            <input
              id={id}
              type="checkbox"
              aria-describedby={`${id}-desc`}
              checked={value === true}
              disabled={disabled}
              onChange={(event) => onSet(rule.id, event.target.checked)}
            />
            <span aria-hidden="true" />
          </span>
        ) : rule.type === "select" ? (
          <select
            id={id}
            aria-describedby={`${id}-desc`}
            value={String(value)}
            disabled={disabled}
            onChange={(event) => onSet(rule.id, event.target.value)}
          >
            {rule.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={id}
            type="number"
            inputMode="numeric"
            aria-describedby={`${id}-desc`}
            min={rule.min}
            max={rule.max}
            step={rule.step}
            value={Number(value)}
            disabled={disabled}
            onChange={(event) => onSet(rule.id, Number(event.target.value))}
          />
        )}
      </div>
    </div>
  );
}

const SPEED_NAMES: Record<BotSpeed, string> = { slow: "Relaxed", normal: "Normal", fast: "Fast", turbo: "Turbo" };

/** The tabletop's bot speed, beside the rules because it is the host's call too. */
export function BotSpeedField({ value, onChange }: { value: BotSpeed; onChange: (speed: BotSpeed) => void }) {
  const id = useId();
  return (
    <div className="uno-field">
      <label htmlFor={id}>Bot speed</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value as BotSpeed)}>
        {(Object.keys(SPEED_NAMES) as BotSpeed[]).map((speed) => (
          <option key={speed} value={speed}>
            {SPEED_NAMES[speed]}
          </option>
        ))}
      </select>
    </div>
  );
}
