import { useEffect, useRef, useState } from "react";
import { play } from "../game/audio.js";
import "./table.css";

/**
 * The table saying no, in the middle of the board.
 *
 * A strip above the felt was easy to miss mid-turn, and a refusal is the one
 * thing a player has to read before they press anything else: the board blurs
 * behind it so it is the only thing in focus, and it sounds so it lands even
 * with eyes on the dice. Tap anywhere and it goes; left alone it clears with
 * the error itself.
 *
 * Keyed on `id` rather than the words, because the same refusal twice is two
 * refusals — and one already standing when the table appears is old news, so it
 * shows but does not sound.
 */
export function Refusal({ message, id }: { message: string | null; id: number }) {
  const [dismissed, setDismissed] = useState(0);
  const firstId = useRef(id);

  useEffect(() => {
    if (id === 0 || id === firstId.current) {
      return;
    }
    play("refused");
  }, [id]);

  if (message === null || id === 0 || id === dismissed) {
    return null;
  }

  return (
    <div className="refusal" role="alert" key={id}>
      <button
        type="button"
        className="refusal__scrim"
        aria-label="Dismiss"
        onClick={() => setDismissed(id)}
      />
      <p className="refusal__card">{message}</p>
    </div>
  );
}
