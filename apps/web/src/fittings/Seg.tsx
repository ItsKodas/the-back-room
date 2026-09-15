import { useLayoutEffect, useRef } from "react";

/**
 * One question, two or three answers, and a lit thumb that slides to the one
 * chosen.
 *
 * A component rather than a class because the thumb has to know where an
 * answer is, and only layout knows that. The thumb is one element that moves
 * rather than a highlight on each answer, so a change of answer is one motion
 * and not a light going out in one place and on in another.
 */
export function Seg<T extends string | boolean>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  options: ReadonlyArray<{ value: T; text: string }>;
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const group = useRef<HTMLDivElement | null>(null);
  const thumb = useRef<HTMLSpanElement | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refs are stable; we need value to trigger repositioning
  useLayoutEffect(() => {
    const place = () => {
      const on = group.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (on === null || on === undefined || thumb.current === null) {
        return;
      }
      thumb.current.style.width = `${on.offsetWidth}px`;
      thumb.current.style.transform = `translateX(${on.offsetLeft}px)`;
    };
    place();
    // A font arriving late or a phone turning sideways moves every answer.
    window.addEventListener("resize", place);
    void document.fonts?.ready.then(place);
    return () => window.removeEventListener("resize", place);
  }, [value]);

  return (
    <div className="seg" role="group" aria-label={label} ref={group}>
      <span className="seg__thumb" aria-hidden="true" ref={thumb} />
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          className="seg__answer"
          aria-pressed={option.value === value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.text}
        </button>
      ))}
    </div>
  );
}
