/**
 * The window that came second.
 *
 * A state the page is in rather than a complaint that fades, so it is a panel
 * and not the four-second error toast — and it stands *in place of* the
 * playing area rather than over it. A refused window with a lever still drawn
 * behind the message is a window with something on it that looks pressable and
 * is not.
 */
export function Taken({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <section className="taken" role="status" aria-live="polite">
      <p className="taken__what">{message}</p>
      <p className="taken__how">Close it and try again.</p>
      <button type="button" className="slab" onClick={onRetry}>
        Try again
      </button>
    </section>
  );
}
