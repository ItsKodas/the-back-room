// @vitest-environment jsdom
import { CODE_LENGTH } from "@backroom/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodeScreen, cleanCode } from "./CodeScreen.js";

afterEach(cleanup);

function Harness({ onEnter }: { onEnter?: () => void }) {
  const [code, setCode] = useState("");
  return <CodeScreen value={code} onChange={setCode} {...(onEnter ? { onEnter } : {})} />;
}

const field = () => screen.getByRole("textbox", { name: "Table code" }) as HTMLInputElement;
const cells = (container: HTMLElement) =>
  [...container.querySelectorAll(".lcd__cell")].map((cell) => cell.textContent);

describe("cleanCode", () => {
  it("uppercases, drops anything that is not a letter or digit, and stops at the code's length", () => {
    expect(cleanCode(" xk-q3 7zz")).toBe("XKQ37".slice(0, CODE_LENGTH));
  });
});

describe("CodeScreen", () => {
  it("is an ordinary named text field, so paste and screen readers just work", () => {
    render(<Harness />);
    expect(field().maxLength).toBe(CODE_LENGTH);
  });

  it("shows the example faint until it is typed over", () => {
    const { container } = render(<Harness />);
    expect(cells(container)).toEqual("XKQ37".split(""));
    expect(container.querySelectorAll(".lcd__cell--empty")).toHaveLength(CODE_LENGTH);
  });

  it("puts what was typed, cleaned, in the cells", () => {
    const { container } = render(<Harness />);
    fireEvent.change(field(), { target: { value: "ab1" } });
    expect(field().value).toBe("AB1");
    expect(cells(container).slice(0, 3)).toEqual(["A", "B", "1"]);
    expect(container.querySelectorAll(".lcd__cell--empty")).toHaveLength(CODE_LENGTH - 3);
    expect(container.querySelector(".lcd__cell--next")?.textContent).toBe("3");
  });

  it("hands Enter to the page", () => {
    const onEnter = vi.fn();
    render(<Harness onEnter={onEnter} />);
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onEnter).toHaveBeenCalledOnce();
  });
});
