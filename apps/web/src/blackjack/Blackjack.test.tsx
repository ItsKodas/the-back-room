// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { opensForFun } from "../table/TableSetup.js";

/*
 * What a table opens as.
 *
 * The bug this pins was invisible: the panel defaulted to play money for
 * everybody, because it decided at mount and the account had not come back
 * yet. A profile that has not arrived is indistinguishable from a guest, and
 * the host only found out when the table they had opened would not take a
 * chip.
 */
describe("what a new table plays for", () => {
  it("opens for chips once the account is known", () => {
    expect(opensForFun(null, false)).toBe(false);
  });

  it("opens for play money for somebody with no account", () => {
    expect(opensForFun(null, true)).toBe(true);
  });

  it("follows the account until the host picks, rather than freezing at mount", () => {
    // The whole bug in one line: guest is true while the profile is on its
    // way and false once it lands, and the default has to move with it.
    expect(opensForFun(null, true)).toBe(true);
    expect(opensForFun(null, false)).toBe(false);
  });

  it("keeps what the host picked, whatever the account says", () => {
    // Including a signed-in host deliberately opening a for-fun table, which
    // is the case a default that merely watched the account would undo.
    expect(opensForFun(true, false)).toBe(true);
    expect(opensForFun(false, false)).toBe(false);
    expect(opensForFun(true, true)).toBe(true);
  });
});
