// face/plugins/lunhui/lib/contracts/shared.mjs
/**
 * What the module contracts (`lib/contracts/<module>.mjs`) share beyond the core's rules: the
 * digest lookup `firstId`, the built example `exampleOf` - `NOT_EVALUABLE` naming the missing
 * sources, else `OK` with UNKNOWN headlines and one INSUFFICIENT claim, a format a role cannot copy
 * as a judgment - the headline rule `ownClaims`, by which each headline value other than UNKNOWN
 * stands on a claim of its own citing its kind of evidence, the market modules' derived view
 * `derivedRow` with its hint `DERIVED_HINT`, and the strategy modules' (leader, mode) views of a
 * quote and a pool row, `quoteRow` and `poolRow`.
 */
import { fail } from "../contract-core.mjs";

/** @typedef {import("../contract-core.mjs").ContextDigest} ContextDigest */
/** @typedef {import("../contract-core.mjs").DigestItem} DigestItem */

/**
 * The first id in the digest whose entry `test` accepts, or undefined.
 * @param {ContextDigest} digest
 * @param {(entry: DigestItem) => boolean} test
 * @returns {string | undefined}
 */
export function firstId(digest, test) {
  for (const [id, entry] of digest.items) if (test(entry)) return id;
  return undefined;
}

/**
 * A context's example, built from the digest's own ids, its envelope the digest's (with
 * `market_run` and `market_snapshot_id` when the module cites a market run): `NOT_EVALUABLE` with the missing sources,
 * `unknown` headlines and no claim when any source is missing; else `OK` with `unknown` headlines,
 * `extra` fields, and one INSUFFICIENT claim citing the first id `pickCited` accepts (else the
 * digest's first id).
 * @param {ContextDigest} digest
 * @param {Record<string, unknown>} unknown the module's headline fields, each UNKNOWN or empty
 * @param {(entry: DigestItem) => boolean} pickCited
 * @param {Record<string, unknown>} [extra] fields an OK example adds
 */
export function exampleOf(digest, unknown, pickCited, extra = {}) {
  const envelope = {
    module: digest.module, contract_version: digest.contract_version, hypotheses_version: digest.hypotheses_version,
    snapshot_id: digest.snapshot_id, run: digest.run, as_of: digest.as_of, session: digest.session,
    // A module citing a market run carries its two bound fields too.
    ...(Object.hasOwn(digest, "market_run") ? { market_run: digest.market_run, market_snapshot_id: digest.market_snapshot_id } : {}),
  };
  if (digest.missing.length > 0)
    return {
      ...envelope, status: "NOT_EVALUABLE", missing_sources: [...digest.missing], ...unknown,
      claims: [], limitations: [`缺少 ${digest.missing.join("、")} 证据，无法评估。`],
    };
  const cited = firstId(digest, pickCited) ?? firstId(digest, () => true);
  const claims = cited === undefined ? [] : [{
    id: "c1", basis: "INSUFFICIENT", evidence_ids: [cited],
    text: "示例：所引证据只示格式；按读数改写本声明的 basis 与文字，再填标题字段。",
  }];
  return { ...envelope, status: "OK", missing_sources: [], ...unknown, ...extra, claims, limitations: [] };
}

/**
 * Each headline field set to a value other than UNKNOWN stands on a claim of its own, not
 * INSUFFICIENT, citing an item its `test` accepts: a field with no such claim fails naming it; two
 * fields that only one claim can serve fail naming them both (a matching of fields to claims).
 * Every message is an "evidence reference" one, so the classifier files it as REFERENCE.
 * @param {any} parsed
 * @param {ContextDigest} context
 * @param {{ field: string, test: (entry: DigestItem) => boolean, needs: string }[]} demands
 */
export function ownClaims(parsed, context, demands) {
  const set = demands.filter(({ field }) => parsed[field] !== "UNKNOWN");
  const options = set.map(({ field, test, needs }) => {
    const claims = parsed.claims.flatMap((claim, index) =>
      claim.basis !== "INSUFFICIENT" && claim.evidence_ids.some((id) => {
        const entry = context.items.get(id);
        return entry !== undefined && test(entry);
      }) ? [index] : []);
    if (claims.length === 0)
      fail(`analysis.${field}: a value other than UNKNOWN needs a claim, not INSUFFICIENT, with an evidence reference to ${needs}.`);
    return claims;
  });
  /** @type {Map<number, number>} claim index → the demand it serves */
  const served = new Map();
  const assign = (demand, tried) => options[demand].some((claim) => {
    if (tried.has(claim)) return false;
    tried.add(claim);
    const holder = served.get(claim);
    if (holder !== undefined && !assign(holder, tried)) return false;
    served.set(claim, demand);
    return true;
  });
  for (let demand = 0; demand < set.length; demand += 1)
    if (!assign(demand, new Set()))
      fail(`analysis.${set[demand].field}: ${set.map(({ field }) => field).join(", ")} each need a claim of their own; one claim with an evidence reference to several stands for one of them.`);
}

/**
 * A derived item as a market module's context shows it: `{ id, measure, value, params?,
 * inputs_total }` - the count of its inputs, not their ids (a pool's measure cites every row), and
 * no `source`, `kind` or `scope`, which the derived section implies; the evidence file and the
 * digest keep every field, so validation reads them unchanged.
 * @param {Record<string, any>} item
 */
export function derivedRow({ id, measure, value, params, inputs }) {
  return {
    id, measure, value, ...(params === undefined ? {} : { params }),
    inputs_total: Array.isArray(inputs) ? inputs.length : 0,
  };
}

/** The hint naming what a derived row shows, for the contracts that use `derivedRow`. */
export const DERIVED_HINT =
  "派生量只列 id、measure、value、params 与输入条数 inputs_total，不列来源、种类、时效与输入编号；value 为 null 且 inputs_total 为 0 的派生量表示其输入未冻结（如家数计数被拒），只能作 INSUFFICIENT 声明的依据；时效为本运行交易日 CURRENT，除非其所在文件的交易日早于本运行（那时为 HISTORICAL），引用其编号即可。";

/**
 * The market counts as a market module's context shows them: the six counts and the session they
 * belong to; the buckets, the data hash and the stamps stay in the file (spec §17).
 * @param {Record<string, any>} item
 */
export function countsRow({ kind, qdate, advancers, decliners, unchanged, limitUp, limitDown, total }) {
  return { kind, qdate, advancers, decliners, unchanged, limitUp, limitDown, total };
}

/** The hint naming what the counts row shows, for the contracts that use `countsRow`. */
export const COUNTS_HINT =
  "家数计数行（kind 为 counts）只列 qdate 与六个计数：上涨 advancers、下跌 decliners、平盘 unchanged、涨停 limitUp、跌停 limitDown 与合计 total，取自东方财富的涨跌分布；为 null 的计数表示分布里没有该档；各档分布与数据哈希在证据文件里。没有这一行时家数计数未冻结，index 的三个计数派生量为 null。";

/** A quote without its validity block and provider: the file keeps them. */
export function quoteRow({ validity, provider, ...item }) {
  return item;
}

/** A pool row as a strategy module reads it: who, how high, when sealed, how often broken. */
export function poolRow(item) {
  const keep = ["pool", "code", "name", "pct", "boards", "firstSealAt", "lastSealAt", "breakCount", "yesterdayBoards", "yesterdaySealAt", "streak", "industry"];
  return Object.fromEntries(keep.filter((key) => item[key] !== undefined).map((key) => [key, item[key]]));
}
