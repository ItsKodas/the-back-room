// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Only `play`/`unlock` are stubbed — the hook reaches for the rest of the
 * sound module (getVolume, isMuted...) and would break without them. What
 * these tests check is only whether a press on a given element asks the
 * building's one sound module to play the tap.
 */
const played = vi.hoisted(() => ({ calls: [] as string[], preloads: 0 }));
vi.mock("./audio.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./audio.js")>();
  return {
    ...actual,
    play: (cue: string) => {
      played.calls.push(cue);
    },
    unlock: () => {},
    preload: async () => {
      played.preloads += 1;
    },
  };
});

import { useButtonSound } from "./useButtonSound.js";

function Harness() {
  useButtonSound();
  return (
    <div>
      <button type="button">a real button</button>
      <a className="slab" href="#slab">
        a slab-link
      </a>
      <a className="key" href="#key">
        a key-link
      </a>
      <a className="quiet" href="#quiet">
        a quiet-link
      </a>
      <a className="plain" href="#plain">
        a plain link
      </a>
    </div>
  );
}

afterEach(() => {
  played.calls = [];
  played.preloads = 0;
});

describe("the building's sounds, fetched on arrival", () => {
  it("asks for them as soon as any page mounts, not when a game does", () => {
    /*
     * RED before the fix: only the games preloaded, so a player who landed on
     * the room and picked a game pressed before the manifest had been asked
     * for, and the door opened in silence. unlock() does fetch it, but only
     * from that same press — too late for the sound that press wants.
     */
    render(<Harness />);
    expect(played.preloads).toBe(1);
  });
});

describe("the building-wide press click", () => {
  it("sounds on a link-slab", () => {
    // RED before the fix: a.slab is not in PRESSABLE, so this press is silent.
    const { getByText } = render(<Harness />);
    fireEvent.pointerDown(getByText("a slab-link"));
    expect(played.calls).toEqual(["tap"]);
  });

  it("sounds on a link-key", () => {
    const { getByText } = render(<Harness />);
    fireEvent.pointerDown(getByText("a key-link"));
    expect(played.calls).toEqual(["tap"]);
  });

  it("sounds on a link-quiet", () => {
    const { getByText } = render(<Harness />);
    fireEvent.pointerDown(getByText("a quiet-link"));
    expect(played.calls).toEqual(["tap"]);
  });

  it("still sounds on a real button", () => {
    const { getByText } = render(<Harness />);
    fireEvent.pointerDown(getByText("a real button"));
    expect(played.calls).toEqual(["tap"]);
  });

  it("stays silent on a link that wears none of the fitting classes", () => {
    const { getByText } = render(<Harness />);
    fireEvent.pointerDown(getByText("a plain link"));
    expect(played.calls).toEqual([]);
  });
});
