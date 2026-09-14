/**
 * A face, not a figure — what shows while the die is still in the air.
 *
 * No digit looks like it, so it can never be misread as the number it is
 * about to become even for a single frame, and it is drawn by the same big
 * lit font as the settled value, so the swap between them reads as one
 * object changing state rather than a spinner giving way to an answer.
 */
const TUMBLING_FACE = "⚄";

/**
 * The number, and the only motion a duel has to speak of.
 *
 * One element for both states, marked with `data-falling`, because a die
 * tumbling and a die settled are one physical object rather than two — an
 * identity that survives the change is what lets a single CSS motion run from
 * unresolved to resolved instead of one animation replacing another mid-air.
 *
 * The value itself is never shown while `rolling` is true, whatever it
 * happens to be — a caller might well be holding the very number this
 * settles on, so the guard belongs here rather than trusted to every caller:
 * a result is the table's to say, never a guess dressed up as one. But
 * showing nothing at all is a different bug: an animation with no glyph
 * inside it paints nothing, so a slow connection is a blank gap for the
 * whole round trip — indistinguishable from a broken button. `TUMBLING_FACE`
 * is what the tumble keyframes actually move.
 */
export function Falling({ value, rolling }: { value: number; rolling: boolean }) {
  const settledOnOne = !rolling && value === 1;
  return (
    <p
      data-falling
      // Says something true the moment it changes, for anyone who cannot see
      // it fall — the keyframes are decoration, and this is the fact
      // underneath. While tumbling that fact is only "still rolling", never
      // the face shown for the eye: a screen reader announcing a die face
      // would just be a differently-shaped guess.
      aria-live="polite"
      className={[
        "dr__number",
        rolling ? "dr__number--rolling" : "dr__number--settled",
        settledOnOne ? "dr__number--hit" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {rolling ? (
        <>
          <span className="dr__number-face" aria-hidden="true">
            {TUMBLING_FACE}
          </span>
          <span className="roll__said">Rolling…</span>
        </>
      ) : (
        value
      )}
    </p>
  );
}
