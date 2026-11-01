/**
 * The stand-in's boards, members and flow, derived from one all-market universe (A20: host code
 * derives, the model never does). Pure: rows in, the three lists out, in the keys Eastmoney's
 * `boardRow`, `memberRow` and `flowRow` carry, so `deriveBoards` and the theme context read them
 * unchanged. Stamps (provider, taxonomy, host) are the freeze row's.
 */
import { EXCLUDED_CONCEPTS, EXCLUDED_PATTERNS, exclusionReason } from "./wencai-excluded.mjs";

export { EXCLUDED_CONCEPTS, EXCLUDED_PATTERNS };

const finite = (v) => typeof v === "number" && Number.isFinite(v);
const numOrNull = (v) => (finite(v) ? v : null);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
/** Larger change first; a tie to the larger turnover; then code, for a stable order. */
const byChange = (a, b) =>
  (b.pct ?? -Infinity) - (a.pct ?? -Infinity) || (b.amount ?? 0) - (a.amount ?? 0) || a.code.localeCompare(b.code);

/**
 * @param {{ code: string, name: string|null, pct: number|null, amount: number|null, mainNet: number|null, concepts: string[] }[]} rows
 * @param {{ minMembers?: number, excluded?: ReadonlyMap<string,string>, top?: number, memberBoards?: number, maxMembers?: number }} [options]
 */
export function deriveStandInBoards(
  rows,
  { minMembers = 10, excluded = EXCLUDED_CONCEPTS, top = 30, memberBoards = 10, maxMembers = 100 } = {},
) {
  const skip = (name) => (excluded === EXCLUDED_CONCEPTS ? exclusionReason(name) !== undefined : excluded.has(name));

  /** @type {Map<string, typeof rows>} */
  const groups = new Map();
  for (const row of rows) {
    for (const concept of new Set(row.concepts ?? [])) {
      if (!concept || skip(concept)) continue;
      if (!groups.has(concept)) groups.set(concept, []);
      groups.get(concept).push(row);
    }
  }

  const boards = [];
  for (const [name, members] of groups) {
    if (members.length < minMembers) continue;
    const priced = members.filter((m) => finite(m.pct));
    const amount = sum(members.map((m) => (finite(m.amount) ? m.amount : 0)));
    const mainNet = sum(members.map((m) => (finite(m.mainNet) ? m.mainNet : 0)));
    const lead = [...priced].sort(byChange)[0];
    boards.push({
      board: {
        code: `THS:${name}`,
        name,
        pct: priced.length ? sum(priced.map((m) => m.pct)) / priced.length : null,
        amount,
        advancers: priced.filter((m) => m.pct > 0).length,
        decliners: priced.filter((m) => m.pct < 0).length,
        leader: lead ? (lead.name ?? lead.code) : null,
      },
      members,
      mainNet,
    });
  }

  const ranked = [...boards].sort(
    (a, b) => (b.board.pct ?? -Infinity) - (a.board.pct ?? -Infinity) || a.board.name.localeCompare(b.board.name),
  );

  const topBoards = ranked.slice(0, top);
  const members = topBoards.slice(0, memberBoards).map(({ board, members: ms }) => {
    const ordered = [...ms].sort(byChange);
    return {
      board: board.code,
      truncated: ordered.length > maxMembers,
      members: ordered.slice(0, maxMembers).map((m) => ({ code: m.code, name: m.name, pct: numOrNull(m.pct) })),
    };
  });

  const flow = [...boards]
    .sort((a, b) => b.mainNet - a.mainNet || a.board.name.localeCompare(b.board.name))
    .slice(0, top)
    .map(({ board, mainNet }) => ({
      code: board.code,
      name: board.name,
      pct: board.pct,
      mainNet,
      mainShare: finite(board.amount) && board.amount !== 0 ? (mainNet / board.amount) * 100 : null,
    }));

  return { boards: topBoards.map((b) => b.board), members, flow };
}
