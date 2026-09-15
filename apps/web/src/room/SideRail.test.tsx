// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { play } from "../game/audio.js";
import { SideRail } from "./SideRail.js";

vi.mock("../game/audio.js", async (original) => ({
  ...(await original<typeof import("../game/audio.js")>()),
  play: vi.fn(),
  unlock: vi.fn(),
}));

afterEach(() => vi.mocked(play).mockClear());

function show() {
  return render(
    <SideRail side="right" label="Who's ahead" icon={null}>
      <p>inside</p>
    </SideRail>,
  );
}

describe("a rail that is a drawer on a phone", () => {
  it("opens from its tab and says so", () => {
    const { container } = show();
    const tab = screen.getByRole("button", { name: "Who's ahead" });
    expect(tab.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".rail")?.hasAttribute("data-open")).toBe(false);

    fireEvent.click(tab);

    expect(tab.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(".rail")?.hasAttribute("data-open")).toBe(true);
    expect(vi.mocked(play).mock.calls).toEqual([["open"]]);
  });

  it("puts focus inside when it opens and back on the tab when it shuts", () => {
    show();
    const tab = screen.getByRole("button", { name: "Who's ahead" });
    fireEvent.click(tab);
    const shut = screen.getByRole("button", { name: "Close who's ahead" });
    expect(document.activeElement).toBe(shut);

    fireEvent.click(shut);
    expect(document.activeElement).toBe(tab);
    expect(tab.getAttribute("aria-expanded")).toBe("false");
  });

  it("shuts on Escape and on a tap outside it", () => {
    const { container } = show();
    const tab = screen.getByRole("button", { name: "Who's ahead" });

    fireEvent.click(tab);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(tab.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(tab);
    fireEvent.click(container.querySelector(".rail__scrim") as Element);
    expect(tab.getAttribute("aria-expanded")).toBe("false");
  });
});
