import { snapOptions } from "./options.js";
import { ScribbleTable } from "./table.js";

/*
 * Ten words the host typed, used alone, with a random source that always takes
 * the first — so a test knows the three choices and which word gets drawn.
 */
export const WORDS =
  "lighthouse, accordion, sandcastle, telescope, pineapple, snowflake, waterfall, butterfly, chocolate, dinosaur";

/** A table on a clock the test holds, with `seated` guests sat down as s0, s1, … */
export function tableFor(raw: Record<string, unknown> = {}, seated = 3) {
  let time = 1_000_000;
  const clock = {
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
  };
  const table = new ScribbleTable("ABCDE", 10, snapOptions({ custom: WORDS, onlyCustom: true, ...raw }), {
    now: clock.now,
    random: () => 0,
  });
  for (let at = 0; at < seated; at += 1) {
    table.join(`s${at}`, `P${at}`, null);
  }
  return { table, clock };
}
