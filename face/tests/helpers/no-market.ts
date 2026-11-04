/** Every test that boots a face imports this first: since plan A2 a boot composes the `mcp-market` row, which spawns
 * a real `market:mcp` child pointed at `FACE_MARKET_URL` (default 127.0.0.1:4821, the operator's live market), and
 * the boot's Lunhui freeze rows read the same variable. So no test face ever reaches a live market, this sets
 * `FACE_MARKET_URL` to a closed loopback port on import, whatever the shell had — as the face's own test faces set
 * `FACE_ACCOUNT_URL=http://127.0.0.1:9`. A smoke that needs answers points it at its stand-in's market
 * (`helpers/standin.ts` `Standin.marketUrl`) before its boot, and puts {@link DEAD_MARKET_URL} back after. */
export const DEAD_MARKET_URL = "http://127.0.0.1:9";
process.env.FACE_MARKET_URL = DEAD_MARKET_URL;
