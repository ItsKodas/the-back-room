import { describe, expect, it } from "vitest";
import { Books } from "./books.js";

describe("the balance while balls are in the air", () => {
  it("has nothing to say when nothing is happening", () => {
    expect(new Books().shown()).toBeNull();
  });

  it("takes the stake on the press", () => {
    const books = new Books();
    books.press("a", 50, 1_000);
    expect(books.shown()).toBe(950);
  });

  it("holds a win back until the ball lands", () => {
    const books = new Books();
    books.press("a", 50, 1_000);
    books.answer("a", 1_450, 500); // the server has already paid
    expect(books.shown()).toBe(950);
    books.land("a");
    expect(books.shown()).toBe(1_450);
  });

  it("keeps several balls straight, whichever lands first", () => {
    const books = new Books();
    books.press("a", 10, 1_000);
    books.press("b", 10, 990);
    books.answer("a", 1_020, 30);
    expect(books.shown()).toBe(980); // b still out, a's 30 not landed
    books.answer("b", 1_025, 15);
    books.land("b");
    expect(books.shown()).toBe(995);
    books.land("a");
    expect(books.shown()).toBe(1_025);
  });

  it("gives a refused stake straight back", () => {
    const books = new Books();
    books.press("a", 50, 1_000);
    books.refuse("a");
    expect(books.shown()).toBe(1_000);
  });

  it("forgets its figures once everything has landed and been shown", () => {
    const books = new Books();
    books.press("a", 50, 1_000);
    books.answer("a", 950, 0);
    books.land("a");
    books.settle();
    expect(books.idle()).toBe(true);
    expect(books.shown()).toBeNull();
  });

  it("believes a late answer to a ball it had given up on", () => {
    // The server may have paid a ball whose answer arrived after we stopped
    // waiting. Its balance is a fact, so it wins.
    const books = new Books();
    books.press("a", 50, 1_000);
    books.giveUp("a");
    expect(books.shown()).toBe(1_000);
    books.answer("a", 1_450, 500);
    expect(books.shown()).toBe(1_450);
  });

  it("counts what is in the air", () => {
    const books = new Books();
    books.press("a", 10, 100);
    books.press("b", 10, 90);
    expect(books.inAir()).toBe(2);
    books.answer("a", 90, 0);
    expect(books.inAir()).toBe(1);
  });
});
