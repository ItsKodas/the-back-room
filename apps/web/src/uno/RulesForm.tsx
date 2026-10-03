import type { RuleDef, Rules } from "@backroom/game-uno";
import { CATEGORIES, describe, officialRules, presetOf, PRESETS, RULES, sanitize } from "@backroom/game-uno";
import { useId } from "react";

/**
 * The host's rules for a new table: a game mode to start from, and every
 * toggle under it.
 *
 * Drawn from the game's own list, the way the tabletop drew its setup screen,
 * so a rule added to the game appears here without anybody touching this
 * file. Nothing here is the rule — the server checks every value against the
 * same list — so the controls are held inside what is legal as a courtesy.
 */
export function RulesForm({ rules, onChange }: { rules: Rules; onChange: (rules: Rules) => void }) {
  const preset = presetOf(rules);
  const set = (id: RuleDef["id"], value: boolean | number | string) =>
    onChange(sanitize({ ...rules, [id]: value }));

  return (
    <div className="uno-rules-form">
      <div className="lamps uno__pick" role="radiogroup" aria-label="Game mode">
        {PRESETS.map((one) => (
          <button
            key={one.id}
            type="button"
            role="radio"
            aria-checked={preset?.id === one.id}
            className="lamp lamp--word"
            title={one.blurb}
            onClick={() => onChange(one.rules())}
          >
            {one.name}
          </button>
        ))}
      </div>
      <p className="panel__note uno-rules-form__mode">
        {preset === null ? "House rules: your own mix of the toggles below." : preset.blurb}
      </p>
      <details className="uno-rules-form__all">
        <summary>Every rule</summary>
        {CATEGORIES.map((category) => (
          <fieldset key={category.id} className="uno-rules-form__group">
            <legend>{category.name}</legend>
            {RULES.filter((rule) => rule.category === category.id).map((rule) => (
              <RuleRow key={rule.id} rule={rule} rules={rules} onSet={set} />
            ))}
          </fieldset>
        ))}
      </details>
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
    <div className={`uno-rule${disabled ? " is-off" : ""}${changed ? " is-changed" : ""}`}>
      <div className="uno-rule__text">
        <label className="uno-rule__name" htmlFor={id}>
          {rule.name}
          {changed ? <span className="tag uno-rule__tag">changed</span> : null}
        </label>
        <p className="uno-rule__desc" id={`${id}-desc`}>
          {rule.desc}
        </p>
      </div>
      <div className="uno-rule__ctl">
        {rule.type === "bool" ? (
          <input
            id={id}
            type="checkbox"
            className="uno-switch"
            aria-describedby={`${id}-desc`}
            checked={value === true}
            disabled={disabled}
            onChange={(event) => onSet(rule.id, event.target.checked)}
          />
        ) : rule.type === "select" ? (
          <select
            id={id}
            className="uno-select"
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
            className="uno-number"
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

/**
 * The rules a table is playing, for anybody at it to read. Only what differs
 * from the box is worth a line each; the rest is "official".
 */
export function RulesSummary({ rules, ruleset }: { rules: Rules; ruleset: string }) {
  const official = officialRules();
  const changed = RULES.filter((rule) => rules[rule.id] !== official[rule.id]);
  return (
    <div className="uno-summary">
      <p className="uno-summary__lead">
        <strong>{ruleset}.</strong> Match the top card by colour, number or symbol, or play a Wild. Can't
        or won't? Draw one. Down to one card, call UNO before anybody catches you.
      </p>
      {changed.length === 0 ? (
        <p className="uno-summary__line">Every rule is as it comes in the box.</p>
      ) : (
        <dl className="uno-summary__list">
          {changed.map((rule) => (
            <div key={rule.id} className="uno-summary__row">
              <dt>{rule.name}</dt>
              <dd>
                <strong>{describe(rules, rule)}</strong> — {rule.desc}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <p className="uno-summary__line">
        Keys: <kbd>D</kbd> draw, <kbd>K</kbd> keep the drawn card, <kbd>U</kbd> call UNO.
      </p>
    </div>
  );
}
