// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { card, hand, seat, settledHand, splitTurn, view, yourTurn } from "./fixtures.js";
import { Dealer, Seats } from "./Seats.js";

describe("the seats", () => {
  it("put your seat first, marked as yours, and everybody else after it", () => {
    const { container } = render(<Seats state={yourTurn()} seatId="b" stake={0} arriving={false} />);
    const plates = screen.getAllByRole("article");
    expect(plates.map((plate) => plate.getAttribute("aria-label"))).toEqual(["Bo (you)", "Ada"]);
    expect(plates[0]?.classList.contains("bj__seat--mine")).toBe(true);
    expect(container.querySelector(".bj__others")?.textContent).toContain("Ada");
  });

  it("light the seat whose turn it is", () => {
    render(<Seats state={yourTurn()} seatId="b" stake={0} arriving={false} />);
    expect(screen.getByRole("article", { name: "Ada" }).classList.contains("bj__seat--turn")).toBe(true);
    expect(screen.getByRole("article", { name: "Bo (you)" }).classList.contains("bj__seat--turn")).toBe(false);
  });

  it("dim a seat waiting for the next hand or gone, and say which, rather than hide it", () => {
    const base = yourTurn();
    const state = {
      ...base,
      seats: [...base.seats, seat("c", "Cy", { waiting: true }), seat("d", "Dee", { connected: false, bet: 100 })],
    };
    render(<Seats state={state} seatId="a" stake={0} arriving={false} />);
    const cy = screen.getByRole("article", { name: "Cy" });
    const dee = screen.getByRole("article", { name: "Dee" });
    expect(cy.classList.contains("bj__seat--out")).toBe(true);
    expect(cy.textContent).toContain("Next hand");
    expect(dee.classList.contains("bj__seat--out")).toBe(true);
    expect(dee.textContent).toContain("Dropped");
  });

  it("show your stake from the press, before the table has agreed to it", () => {
    render(<Seats state={view()} seatId="a" stake={500} arriving={false} />);
    const mine = screen.getByRole("article", { name: "Ada (you)" });
    expect(mine.querySelector(".bj__bet")?.textContent).toBe("500");
    expect(mine.querySelector(".bj__pile")).not.toBeNull();
  });

  it("put a card on its way face down on your hand while a hit is in the air", () => {
    render(<Seats state={yourTurn()} seatId="a" stake={0} arriving />);
    const mine = screen.getByRole("article", { name: "Ada (you)" });
    expect(mine.querySelectorAll(".card")).toHaveLength(3);
    expect(mine.querySelector(".card--down")).not.toBeNull();
  });

  it("grow a box per hand on your split seat, lighting the one being played", () => {
    const { container } = render(<Seats state={splitTurn()} seatId="a" stake={0} arriving={false} />);
    const mine = screen.getByRole("article", { name: "Ada (you)" });
    expect(mine.classList.contains("bj__seat--split")).toBe(true);
    const boxes = [...container.querySelectorAll(".bj__box")];
    expect(boxes.map((box) => box.className)).toEqual(["bj__box bj__box--wait", "bj__box bj__box--live"]);
    expect(boxes.map((box) => box.querySelector(".bj__box-top b")?.textContent)).toEqual(["500", "500"]);
    expect(boxes[0]?.textContent).toContain("Stood");
  });

  it("show somebody else's split as two small hands on their plate", () => {
    const state = yourTurn();
    const bo = seat("b", "Bo", {
      bet: 1_000,
      hands: [
        hand({ bet: 500, cards: [card("A"), card("9")], total: 20, fromSplit: true, done: true }),
        hand({ bet: 500, cards: [card("A", "hearts"), card("6")], total: 17, fromSplit: true }),
      ],
    });
    const { container } = render(
      <Seats state={{ ...state, seats: [state.seats[0] ?? seat("a", "Ada"), bo] }} seatId="a" stake={0} arriving={false} />,
    );
    expect(container.querySelectorAll(".bj__seat--other .bj__mini")).toHaveLength(2);
    expect(container.querySelector(".bj__seat--other.bj__seat--split")).toBeNull();
  });

  it("say a split seat's own state — waiting or gone — the same as anybody else's", () => {
    const state = yourTurn();
    const bo = seat("b", "Bo", {
      waiting: true,
      bet: 1_000,
      hands: [
        hand({ bet: 500, cards: [card("A"), card("9")], total: 20, fromSplit: true, done: true }),
        hand({ bet: 500, cards: [card("A", "hearts"), card("6")], total: 17, fromSplit: true }),
      ],
    });
    render(
      <Seats state={{ ...state, seats: [state.seats[0] ?? seat("a", "Ada"), bo] }} seatId="a" stake={0} arriving={false} />,
    );
    const boArticle = screen.getByRole("article", { name: "Bo" });
    expect(boArticle.classList.contains("bj__seat--out")).toBe(true);
    expect(boArticle.textContent).toContain("Next hand");
  });

  it("say a payout in gold and glow the seat it went to", () => {
    render(<Seats state={settledHand()} seatId="a" stake={0} arriving={false} />);
    const mine = screen.getByRole("article", { name: "Ada (you)" });
    expect(mine.classList.contains("bj__seat--paid")).toBe(true);
    const paid = [...mine.querySelectorAll(".bj__tag")].find((tag) => tag.textContent === "Paid 750");
    expect(paid?.classList.contains("tag--chips")).toBe(true);
    const bust = screen.getByRole("article", { name: "Bo" }).querySelector(".bj__tag");
    expect(bust?.classList.contains("bj__tag--bad")).toBe(true);
  });
});

describe("the dealer", () => {
  it("keeps room for two cards before the deal, and says who is watching", () => {
    const { container } = render(<Dealer dealer={{ cards: [], total: 0, hidden: false }} watching={2} />);
    expect(container.querySelectorAll(".bj__slot")).toHaveLength(2);
    expect(container.textContent).toContain("2 watching");
  });

  it("shows the up card and a card face down until the dealer plays", () => {
    render(<Dealer dealer={{ cards: [card("10")], total: 10, hidden: true }} watching={0} />);
    expect(screen.getByRole("img", { name: "10 of spades" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "face down" })).toBeTruthy();
  });
});
