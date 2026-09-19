// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Controls } from "./Controls.js";

function controls(overrides: Partial<Parameters<typeof Controls>[0]> = {}) {
  const props: Parameters<typeof Controls>[0] = {
    risk: "medium",
    onRisk: vi.fn(),
    stake: 50,
    onStake: vi.fn(),
    limit: 1_000,
    why: null,
    canDrop: true,
    onDrop: vi.fn(),
    ...overrides,
  };
  render(<Controls {...props} />);
  return props;
}

describe("the controls", () => {
  it("drops on the one lit key, which says the stake", () => {
    const props = controls();
    fireEvent.click(screen.getByRole("button", { name: /drop · 50/i }));
    expect(props.onDrop).toHaveBeenCalledTimes(1);
  });

  it("will not drop when it cannot", () => {
    controls({ canDrop: false });
    expect(screen.getByRole("button", { name: /drop/i })).toHaveProperty("disabled", true);
  });

  it("doubles within what the bank and balance allow", () => {
    const props = controls({ stake: 400, limit: 600 });
    fireEvent.click(screen.getByRole("button", { name: "Double the stake" }));
    expect(props.onStake).toHaveBeenCalledWith(600);
  });

  it("says why a stake cannot go higher", () => {
    controls({ why: "The bank covers 290 a ball on high." });
    expect(screen.getByRole("status").textContent).toBe("The bank covers 290 a ball on high.");
  });

  it("changes risk", () => {
    const props = controls();
    fireEvent.click(screen.getByRole("button", { name: "High" }));
    expect(props.onRisk).toHaveBeenCalledWith("high");
  });
});
