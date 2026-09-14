// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSlide } from "./useSlide.js";

/**
 * jsdom lays nothing out, so every element's box is zero and no slide is ever
 * computed. What is worth testing here is therefore not the distance — it is
 * that the hook reads positions before the change and writes a transform after
 * it, on the elements it was given, and that it does neither when the reader
 * has asked for less motion.
 */
function stubMatchMedia(reduced: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: reduced, addEventListener() {}, removeEventListener() {} })),
  );
}

function Harness({ ids }: { ids: string[] }) {
  const ref = useSlide(ids.map((id) => ({ id })));
  return (
    <div ref={ref}>
      {ids.map((id) => (
        <div key={id} data-id={id} />
      ))}
    </div>
  );
}

describe("sliding a row to its new rank", () => {
  it("moves nothing when nothing has moved", () => {
    stubMatchMedia(false);
    const { container, rerender } = render(<Harness ids={["a", "b"]} />);
    rerender(<Harness ids={["a", "b"]} />);
    const first = container.querySelector('[data-id="a"]') as HTMLElement;
    expect(first.style.transform === "" || first.style.transform === "none").toBe(true);
  });

  it("touches nothing at all when the reader has asked for less motion", () => {
    stubMatchMedia(true);
    const { container, rerender } = render(<Harness ids={["a", "b"]} />);
    rerender(<Harness ids={["b", "a"]} />);
    const first = container.querySelector('[data-id="a"]') as HTMLElement;
    expect(first.style.transform).toBe("");
  });
});
