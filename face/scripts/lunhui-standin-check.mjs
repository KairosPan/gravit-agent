// One-shot live check of the Lunhui boards stand-in against the real iFinD QuantAPI, through the
// market: `fetchWencaiUniverse` for the latest session over the market adapter (the market at
// FACE_MARKET_URL, default http://127.0.0.1:4821, holds the token and asks iFinD), then
// `deriveStandInBoards`; prints counts and the top five boards. One 问财 call. This script reads no
// IFIND_* variable and never sees a token.
//
//   cd face && node scripts/lunhui-standin-check.mjs        (the market running)
//
// Exit 0 on success, 1 on a refusal (its code and message, which carry no token), 2 when the
// market holds no iFinD token.
import { DEFAULT_MARKET_URL, marketFetch, marketOrigin } from "../plugins/lunhui/lib/market-fetch.mjs";
import { sessionOf } from "../plugins/lunhui/lib/freeze-tool.mjs";
import { WENCAI_NOT_CONFIGURED, fetchWencaiUniverse } from "../plugins/lunhui/lib/wencai.mjs";
import { deriveStandInBoards } from "../plugins/lunhui/lib/wencai-boards.mjs";

const fetchImpl = marketFetch(marketOrigin(process.env.FACE_MARKET_URL || DEFAULT_MARKET_URL));
const session = sessionOf(new Date());
try {
  const universe = await fetchWencaiUniverse({ session, fetchImpl });
  const derived = deriveStandInBoards(universe.rows);
  const eligible = deriveStandInBoards(universe.rows, { top: Infinity }).boards.length;
  const concepts = new Set(universe.rows.flatMap((row) => row.concepts));
  const fmt = (n) => (typeof n === "number" ? n.toFixed(2) : "n/a");
  console.log(`session ${session}`);
  console.log(`query ${universe.query}`);
  console.log(`rows ${universe.rows.length} (dataVol ${universe.dataVol})`);
  console.log(`concepts seen ${concepts.size}`);
  console.log(`eligible concepts ${eligible}`);
  console.log(`boards ${derived.boards.length}, member lists ${derived.members.length}, flow rows ${derived.flow.length}`);
  for (const board of derived.boards.slice(0, 5)) {
    console.log(`  ${board.code}  pct ${fmt(board.pct)}  up ${board.advancers} down ${board.decliners}  leader ${board.leader ?? "n/a"}`);
  }
} catch (error) {
  if (error?.code === WENCAI_NOT_CONFIGURED) {
    console.error("the market holds no iFinD token: start it with .env.ifind sourced");
    process.exit(2);
  }
  console.error(`refused: ${error?.code ?? "ERROR"} ${error?.message ?? error}`);
  process.exit(1);
}
