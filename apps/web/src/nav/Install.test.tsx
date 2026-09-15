// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The browser's install prompt is held for the whole page, not by one bar, so
 * every test loads the module fresh — otherwise a prompt offered in one test
 * would still be waiting in the next.
 */
let Install: typeof import("./Install.js").Install;
let isIos: typeof import("./useInstall.js").isIos;

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

const button = () => screen.queryByRole("button", { name: "Install The Back Room" });
const hint = () => screen.queryByRole("dialog", { name: "How to install The Back Room" });

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

beforeEach(async () => {
  vi.resetModules();
  ({ Install } = await import("./Install.js"));
  ({ isIos } = await import("./useInstall.js"));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "matchMedia");
});

describe("the install button", () => {
  it("is an icon, named for a screen reader rather than spelled out on the bar", () => {
    render(<Install />);
    const found = button();

    expect(found).not.toBeNull();
    expect(found?.querySelector("svg")).not.toBeNull();
    expect(found?.textContent).toBe("");
  });

  it("is on the bar in an ordinary browser tab, before the browser has offered anything", () => {
    // Waiting for the browser's own event hid it on every browser that never
    // sends one, which is most of them — the button has to be findable anyway.
    render(<Install />);
    expect(button()).not.toBeNull();
  });

  it("explains the browser's own route when there is no prompt to hand over", () => {
    render(<Install />);
    fireEvent.click(button() as HTMLElement);

    expect(hint()?.textContent).toContain("Install app");
  });

  it("hides only inside the installed app itself", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: true }),
    });
    render(<Install />);
    offerFromBrowser();

    expect(button()).toBeNull();
  });
});

describe("on a browser that can install", () => {
  it("hands the press to the browser's own prompt, and opens no hint", async () => {
    render(<Install />);
    const { event, prompt } = offerFromBrowser();

    // Held back, so the browser's mini-infobar does not appear on its own.
    expect(event.defaultPrevented).toBe(true);
    fireEvent.click(button() as HTMLElement);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(hint()).toBeNull();

    // The prompt is spent, but this is still a browser tab, so the button stays.
    await act(async () => {});
    expect(button()).not.toBeNull();
  });

  it("keeps a prompt the browser offered before the bar was drawn", () => {
    /*
     * The browser sends its one prompt when it decides the page is installable,
     * which can be before any bar has mounted to catch it. Missed, the press
     * falls back to telling somebody to find a menu item.
     */
    const { prompt } = offerFromBrowser();
    render(<Install />);

    fireEvent.click(button() as HTMLElement);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(hint()).toBeNull();
  });

  it("keeps the prompt when the bar is drawn again on another page", () => {
    /*
     * Every page draws its own bar, so walking from the front door to a table
     * throws the old one away. The browser does not send its prompt twice, so a
     * prompt that lived in the bar was gone the first time anybody changed page.
     */
    const first = render(<Install />);
    const { prompt } = offerFromBrowser();
    first.unmount();

    render(<Install />);
    fireEvent.click(button() as HTMLElement);
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("stops offering a spent prompt, on this bar or the next one", async () => {
    // A prompt answers once. Pressed again, it has to explain rather than
    // call a prompt the browser will refuse.
    const { prompt } = offerFromBrowser();
    const first = render(<Install />);
    fireEvent.click(button() as HTMLElement);
    await act(async () => {});
    first.unmount();

    render(<Install />);
    fireEvent.click(button() as HTMLElement);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(hint()).not.toBeNull();
  });

  it("stays after installing, because this tab is still not the app", () => {
    render(<Install />);
    offerFromBrowser();
    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });

    expect(button()).not.toBeNull();
  });
});

describe("on an iPhone", () => {
  beforeEach(() => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(IPHONE);
  });

  it("explains how on a press, because iOS has no prompt to give", () => {
    render(<Install />);
    expect(hint()).toBeNull();

    fireEvent.click(button() as HTMLElement);
    expect(hint()?.textContent).toContain("Add to Home Screen");
  });

  it("closes the hint on Got it and keeps the button, now and next visit", () => {
    const { unmount } = render(<Install />);
    fireEvent.click(button() as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));

    expect(hint()).toBeNull();
    expect(button()).not.toBeNull();

    unmount();
    render(<Install />);
    expect(button()).not.toBeNull();
  });
});

describe("Chrome on an iPhone", () => {
  const CHROME_IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1";

  beforeEach(() => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(CHROME_IPHONE);
  });

  it("points at Chrome's own Share button, which is up in the address bar rather than Safari's toolbar", () => {
    /*
     * Every browser on an iPhone is Safari underneath, so Chrome there has no
     * prompt to give either — but its Share sits somewhere else, and telling
     * somebody to look along the bottom sends them looking for a button that
     * is not there.
     */
    render(<Install />);
    fireEvent.click(button() as HTMLElement);

    expect(hint()?.textContent).toContain("address bar");
    expect(hint()?.textContent).toContain("Add to Home Screen");
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
