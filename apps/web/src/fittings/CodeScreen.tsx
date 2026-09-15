import { CODE_LENGTH } from "@backroom/shared";

/** A code as the server writes one: capitals and digits, and no more of them than a code has. */
export function cleanCode(typed: string): string {
  return typed
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, CODE_LENGTH);
}

/**
 * A table code on a lit screen, one cell per character.
 *
 * The input is real and lies over the cells, transparent. Drawing the code in
 * spans and listening for keys would lose paste, autofill, the phone's own
 * keyboard and a screen reader in one go; the cells are only what it looks
 * like.
 */
export function CodeScreen({
  value,
  onChange,
  onEnter,
  label = "Table code",
  example = "XKQ37",
}: {
  value: string;
  onChange: (code: string) => void;
  onEnter?: () => void;
  label?: string;
  example?: string;
}) {
  const cells = Array.from({ length: CODE_LENGTH }, (_, i) => {
    const typed = value[i];
    const next = i === value.length;
    return (
      <span
        // biome-ignore lint/suspicious/noArrayIndexKey: a cell is its position; there is nothing else to key it by
        key={i}
        className={`lcd__cell${typed === undefined ? " lcd__cell--empty" : ""}${next ? " lcd__cell--next" : ""}`}
      >
        {typed ?? example[i] ?? ""}
      </span>
    );
  });

  return (
    <label className="lcd">
      <input
        className="lcd__input"
        value={value}
        // No maxLength here: a native one truncates the raw pasted text —
        // separators included — before cleanCode ever runs, which turned
        // "xk-q37" into "xk-q3" and then "XKQ3", a character short.
        // cleanCode caps the cleaned result on its own.
        aria-label={label}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        onChange={(event) => onChange(cleanCode(event.target.value))}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            onEnter?.();
          }
        }}
      />
      <span className="lcd__cells" aria-hidden="true">
        {cells}
      </span>
    </label>
  );
}
