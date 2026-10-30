// One-shot live check of the Lunhui boards stand-in against the real iFinD QuantAPI:
// `fetchWencaiUniverse` for the latest session, then `deriveStandInBoards`; prints counts and the
// top five boards. One 问财 call (and a token exchange when none is cached). Never prints the token.
//
//   cd face && set -a && . ../.env.ifind && set +a && node scripts/lunhui-standin-check.mjs
//
// Exit 0 on success, 1 on a refusal (its code and message, which carry no token), 2 on no token.
import { sessionOf } from "../plugins/lunhui/lib/freeze-tool.mjs";
import { fetchWencaiUniverse, hasWencaiCredentials } from "../plugins/lunhui/lib/wencai.mjs";
import { deriveStandInBoards } from "../plugins/lunhui/lib/wencai-boards.mjs";

if (!hasWencaiCredentials(process.env)) {
  console.error("no IFIND_REFRESH_TOKEN or IFIND_ACCESS_TOKEN in the environment");
  process.exit(2);
}
const session = sessionOf(new Date());
try {
  const universe = await fetchWencaiUniverse({ session, env: process.env });
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
  console.error(`refused: ${error?.code ?? "ERROR"} ${error?.message ?? error}`);
  process.exit(1);
}
