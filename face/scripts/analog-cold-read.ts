/** Times a cold read of companies' whole daily histories through the market, the measurement the analog universe
 * is sized by. Reads each ticker named on the command line (with none, the current `UNIVERSE`) through a fresh bars
 * keep over the market at `FACE_MARKET_URL` (default http://127.0.0.1:4821), four at a time, and writes nothing:
 *
 *     cd face && FACE_MARKET_URL=http://127.0.0.1:4821 npx tsx scripts/analog-cold-read.ts [TICKER …]
 *
 * One line per ticker in the order given: `<symbol> <bars> bars from <firstBar> · <source> · <seconds>s`, where the
 * seconds are those elapsed since the start when the last request for that ticker was answered, or
 * `<symbol> refused: <the market's words>`; then `read <n> of <m> in <seconds>s, four at a time`; then
 * `within 300s: the first <k> of the list`, the longest prefix whose tickers were all read by 300 s (a refused ticker
 * does not end the prefix). A market that is warm from an earlier run answers faster: the figure is a cold one only
 * on the first run after the market starts.
 * @module
 */
import { createBarsKeep, marketAsk } from "../plugins/analog/lib/bars.mjs";
import { UNIVERSE } from "../plugins/analog/lib/universe.mjs";

/** The cold-scan budget the list is cut to. */
const BUDGET_S = 300;

const symbols = process.argv.length > 2 ? process.argv.slice(2) : [...UNIVERSE];
const ask = marketAsk(process.env.FACE_MARKET_URL ?? "http://127.0.0.1:4821");
const began = Date.now();
const seconds = (at: number): number => (at - began) / 1000;
/** When the last request for each symbol was answered. */
const answered = new Map<string, number>();

const keep = createBarsKeep({
  ask: async (query) => {
    const answer = await ask(query);
    answered.set(query.symbol, Date.now());
    return answer;
  },
});
const { read, refused, timedOut } = await keep.histories(symbols);
const total = seconds(Date.now());

let within = 0;
let prefixOpen = true;
for (const symbol of symbols) {
  const history = read.get(symbol);
  const done = seconds(answered.get(symbol) ?? Date.now());
  if (history !== undefined) {
    console.log(`${symbol} ${history.bars.length} bars from ${history.firstBar} · ${history.source} · ${done.toFixed(1)}s`);
    if (done > BUDGET_S) prefixOpen = false;
  } else if (refused.has(symbol)) {
    console.log(`${symbol} refused: ${refused.get(symbol)}`);
  } else {
    console.log(`${symbol} not read${timedOut.includes(symbol) ? ": past the deadline" : ""}`);
    prefixOpen = false;
  }
  if (prefixOpen) within++;
}
console.log(`read ${read.size} of ${symbols.length} in ${total.toFixed(1)}s, four at a time`);
console.log(`within ${BUDGET_S}s: the first ${within} of the list`);
