// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Install } from "./Install.js";
import { isIos } from "./useInstall.js";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

function offerFromBrowser() {
  const prompt = vi.fn(async () => {});
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt,
    userChoice: Promise.resolve({ outcome: "accepted" as const }),
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return { event, prompt };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "matchMedia");
});

describe("on a browser that can install", () => {
  it("offers nothing until the browser says it can", () => {
    render(<Install />);
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });

  it("offers Install once it can, and hands the press to the browser's own prompt", async () => {
    render(<Install />);
    const { event, prompt } = offerFromBrowser();

    // Held back, so the browser's mini-infobar does not appear on its own.
    expect(event.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    expect(prompt).toHaveBeenCalledTimes(1);

    // A prompt can be used once; after the choice the button has nothing to do.
    await act(async () => {});
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });

  it("goes away once the app is installed", () => {
    render(<Install />);
    offerFromBrowser();
    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });

  it("offers nothing inside the installed app itself", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: true }),
    });
    render(<Install />);
    offerFromBrowser();
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });
});

describe("on an iPhone", () => {
  beforeEach(() => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(IPHONE);
  });

  it("explains how on a press, because iOS has no prompt to give", () => {
    render(<Install />);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    const hint = screen.getByRole("dialog", { name: "Install The Back Room" });
    expect(hint.textContent).toContain("Add to Home Screen");
  });

  it("stays dismissed once somebody has said they have got it", () => {
    const { unmount } = render(<Install />);
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();

    unmount();
    render(<Install />);
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });
});

describe("telling an iPhone or iPad apart", () => {
  it("knows an iPhone", () => {
    expect(isIos(IPHONE, 5)).toBe(true);
  });

  it("knows an iPad that is pretending to be a Mac", () => {
    expect(isIos(IPAD_AS_MAC, 5)).toBe(true);
  });

  it("does not mistake an actual Mac for one", () => {
    expect(isIos(IPAD_AS_MAC, 0)).toBe(false);
  });
});
