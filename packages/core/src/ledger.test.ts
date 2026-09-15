import { describe, expect, it } from "vitest";
import { BankLedger } from "./ledger.js";

describe("a table that has closed", () => {
  it("stops holding the bank's chips however much its cloth still says it owes", () => {
    const ledger = new BankLedger();
    const closed = {};
    const live = {};
    ledger.owes(closed, () => 500);
    expect(ledger.owedElsewhere(live)).toBe(500);
    ledger.release(closed);
    expect(ledger.owedElsewhere(live)).toBe(0);
  });
});

describe("everything a bank has promised", () => {
  it("counts every table, and drops the ones that owe nothing", () => {
    const ledger = new BankLedger();
    let settled = 300;
    ledger.owes({}, () => 500);
    ledger.owes({}, () => settled);
    expect(ledger.owedTotal()).toBe(800);
    settled = 0;
    expect(ledger.owedTotal()).toBe(500);
    settled = 300;
    // Dropped on the way past, like `owedElsewhere`: the table puts itself back.
    expect(ledger.owedTotal()).toBe(500);
  });
});
