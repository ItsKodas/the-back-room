// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Seg } from "./Seg.js";

afterEach(cleanup);

function Harness() {
  const [value, setValue] = useState("chips");
  return (
    <Seg
      label="Play for"
      value={value}
      onChange={setValue}
      options={[
        { value: "chips", text: "For chips" },
        { value: "fun", text: "For fun" },
      ]}
    />
  );
}

describe("Seg", () => {
  it("is one named group with exactly one answer pressed", () => {
    render(<Harness />);
    expect(screen.getByRole("group", { name: "Play for" })).toBeDefined();
    const pressed = screen.getAllByRole("button").filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed.map((b) => b.textContent)).toEqual(["For chips"]);
  });

  it("moves the press to the answer pressed", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "For fun" }));
    expect(screen.getByRole("button", { name: "For fun" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "For chips" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("hides the thumb from assistive tech, since the press already says it", () => {
    const { container } = render(<Harness />);
    expect(container.querySelector(".seg__thumb")?.getAttribute("aria-hidden")).toBe("true");
  });
});
