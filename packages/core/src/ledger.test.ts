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
