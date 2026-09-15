// @vitest-environment jsdom
import type { TauntPlay } from "@backroom/shared";
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TAUNT_MS, TauntStage } from "./TauntStage.js";

/**
 * One taunt at a time, in the order they were thrown.
 *
 * The queueing is the part worth testing because it fails quietly: two people
 * mocking the same seat in the same second is ordinary, and the bug — the
 * second cutting the first short, or never appearing at all — looks like a
 * dropped message rather than a rendering fault.
 */

const played = vi.hoisted(() => vi.fn());
vi.mock("../game/audio.js", () => ({ playEmoteSound: played }));

function taunt(over: Partial<TauntPlay> & { id: string }): TauntPlay {
  return {
    emoteId: "e1",
    name: "Smug",
    image: "/api/emotes/e1/image",
    sound: null,
    fromSeatId: "a",
    fromName: "Ada",
    atSeatId: "b",
    atName: "Bo",
    chips: 250,
    revenge: false,
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  played.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the taunt stage", () => {
  it("shows nothing when nothing has been thrown", () => {
    const { container } = render(<TauntStage landed={[]} />);
    expect(container.querySelector(".taunt-stage")).toBeNull();
  });

  it("shows who threw what at whom", () => {
    const { container } = render(<TauntStage landed={[taunt({ id: "t1" })]} />);

    const stage = container.querySelector(".taunt-stage");
    expect(stage?.textContent).toContain("Ada");
    expect(stage?.textContent).toContain("Bo");
    expect(stage?.textContent).toContain("250");
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/api/emotes/e1/image");
  });

  it("clears itself once its moment is up", () => {
    const { container } = render(<TauntStage landed={[taunt({ id: "t1" })]} />);
    expect(container.querySelector(".taunt-stage")).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(TAUNT_MS + 10);
    });

    expect(container.querySelector(".taunt-stage")).toBeNull();
  });

  /* Two at once would be two animations fighting over one screen. */
  it("plays a second one only after the first has had its moment", () => {
    const { container, rerender } = render(
      <TauntStage landed={[taunt({ id: "t1", fromName: "Ada" })]} />,
    );
    rerender(
      <TauntStage
        landed={[taunt({ id: "t1", fromName: "Ada" }), taunt({ id: "t2", fromName: "Cass" })]}
      />,
    );

    // Still the first, even though the second has arrived.
    expect(container.querySelector(".taunt-stage")?.textContent).toContain("Ada");

    act(() => {
      vi.advanceTimersByTime(TAUNT_MS + 10);
    });

    expect(container.querySelector(".taunt-stage")?.textContent).toContain("Cass");
  });

  /*
   * The one that would fail silently: a taunt that arrived while another was
   * animating must be picked up rather than skipped past.
   */
  it("loses nothing that landed mid-animation", () => {
    const { container, rerender } = render(<TauntStage landed={[taunt({ id: "t1" })]} />);
    act(() => {
      vi.advanceTimersByTime(TAUNT_MS / 2);
    });
    rerender(
      <TauntStage
        landed={[taunt({ id: "t1" }), taunt({ id: "t2", fromName: "Cass", chips: 700 })]}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(TAUNT_MS);
    });

    expect(container.querySelector(".taunt-stage")?.textContent).toContain("700");
  });

  it("plays the sound when the emote has one", () => {
    render(<TauntStage landed={[taunt({ id: "t1", sound: "/api/emotes/e1/sound" })]} />);

    expect(played).toHaveBeenCalledWith("/api/emotes/e1/sound");
  });

  /* A sound is optional, and silence is not a failure. */
  it("says nothing for an emote with no sound", () => {
    render(<TauntStage landed={[taunt({ id: "t1", sound: null })]} />);

    expect(played).not.toHaveBeenCalled();
  });

  it("reads a revenge throw the other way round, and marks it", () => {
    const { container } = render(
      <TauntStage
        landed={[
          taunt({
            id: "t1",
            revenge: true,
            fromSeatId: "b",
            fromName: "Bo",
            atSeatId: "a",
            atName: "Ada",
          }),
        ]}
      />,
    );

    const stage = container.querySelector(".taunt-stage");
    expect(stage?.className).toContain("taunt-stage--revenge");
    // Bo was mocked, then won, and takes the chips off Ada who threw it.
    expect(stage?.textContent).toContain("Bo");
    expect(stage?.textContent).toContain("won");
  });

  /* Something that appears, makes a noise and leaves is exactly what a screen
     reader is otherwise never told about. */
  it("announces itself to somebody not looking at it", () => {
    const { container } = render(<TauntStage landed={[taunt({ id: "t1" })]} />);

    const stage = container.querySelector(".taunt-stage");
    expect(stage?.getAttribute("role")).toBe("status");
    expect(stage?.getAttribute("aria-live")).toBe("polite");
  });

  it("hides the picture of an emote that has since been deleted, and keeps the line", () => {
    const { container } = render(<TauntStage landed={[taunt({ id: "t1" })]} />);
    const art = container.querySelector(".taunt-stage__art") as HTMLImageElement;
    fireEvent.error(art);
    expect(art.hidden).toBe(true);
    expect(container.querySelector(".taunt-stage")?.textContent).toContain("Ada");
  });
});
