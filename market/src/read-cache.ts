/** THE MARKET'S READ CACHE: every keyless public source as the market reads it, each answer kept a while and shared while it is on its way,
 * a source that cannot be asked just now held back, and how each one answered remembered as its health. A port of the read cache of
 * account/src/portfolio/service.ts at cb4930c4 (account split, plan A1): `ReadCache` is that file's class with the helpers it uses, and
 * `keptSource` is its `keptPublic` with `historyRead` — the same keys, keep times and part names (`public:<id>`, `#search`, `#history`,
 * `#line`). In memory only: nothing here is written anywhere. */
import { isRefusal, type Refusal } from "./core/errors.ts";
import { no } from "./refuse.ts";
import { keepMsOf, windowKey, type HistoryKeep } from "./live/history.ts";
import { holdBackMs, type PublicSource } from "./live/public-markets.ts";
import type { Candle, CandleInterval, CandlePage, CandleWindow } from "./live/trade.ts";

/** how a source has answered the market's reads lately */
export interface VenueHealth {
  /** when it last answered (a refusal about the request itself is an answer) */
  lastOkAt?: string | undefined;
  /** when it last failed — it did not answer, it is rate-limiting this machine, it does not serve this location — the code of that failure
   * and the source's words for it */
  lastFailAt?: string | undefined;
  code?: string | undefined;
  message?: string | undefined;
  /** how long its last read took, in milliseconds */
  ms?: number | undefined;
}

/** the bounded memory of price histories (keptSource's history reads): answers, and bars in all */
export const HISTORY_KEPT = 64;
export const HISTORY_KEPT_BARS = 250_000;

/** how long a venue that cannot be asked just now is not asked again: it did not answer, it is rate-limiting this machine, or it does not
 * serve this location — and ten minutes when it does not serve this location, a rule that does not change by the minute */
const FAIL_KEEP_MS = 20_000;
/** how long a public source's listings, tickers and events are kept here (its own keeping of the bodies it downloads sits under it) */
export const PUBLIC_KEEP_MS = 20_000;
/** how long one public market's line asked alone (PublicSource.line) is kept here: a paper account's quote of a share it knows stands on it,
 * its prices the background reader's while that is live */
export const LINE_KEEP_MS = 3_000;
/* the one rule for how long a refusal holds a venue back lives with the public sources (live/public-markets.ts holdBackMs) */
const holdsBack = (r: Refusal): boolean => holdBackMs(r) > 0;
/** a read that failed because of the venue or the key, not because of what was asked */
const venueFailed = (r: Refusal): boolean => holdsBack(r) || r.code === "E_VENUE_PERMISSION";
/** the venue's ban of this machine's address (its 418, or "banned until"): it covers every request from here */
export const isBan = (r: Refusal): boolean => {
  const n = r.native as { ban?: unknown; status?: unknown } | undefined;
  return n?.ban === true || n?.status === 418;
};
/** a hold on the venue's own time — a ban, or a wait it named (`native.until`) that has not run out: no re-check from here lifts it */
const ownTime = (r: Refusal, now: number): boolean => {
  const until = (r.native as { until?: unknown } | undefined)?.until;
  return isBan(r) || (typeof until === "number" && until > now);
};
/** the party that gave a refusal, when it is not the venue itself: its hold is its own (`native.party`) */
const partyOf = (r: Refusal): string | undefined => {
  const p = (r.native as { party?: unknown } | undefined)?.party;
  return typeof p === "string" && p ? p : undefined;
};
/** the venue a read cache name stands for: `public:okx` is OKX's keyless source */
const bareVenue = (venue: string): string => venue.replace(/^public:/, "");
/** a read cache name that is the venue's, one of its parties' (`venue|party`) or one of its parts' (`venue#part`) */
const ofVenue = (name: string, venue: string): boolean => name === venue || name.startsWith(`${venue}|`) || name.startsWith(`${venue}#`);
/** the source a read cache name is part of: `public:polymarket#history` is part of `public:polymarket`, whose own hold holds it too */
const baseVenue = (venue: string): string => venue.replace(/#.*$/, "");
/** mm itself cannot be asked (not installed, the node it needs, signed out): kept from the account's cache, where every read of the mm
 * connection waits it out; no keyless source answers these */
const MM_WIDE: ReadonlySet<string> = new Set(["ENOENT", "UNSUPPORTED_NODE", "MISSING_AUTH_TOKEN", "AUTH_REQUIRED", "AUTH_FAILED", "AUTH_ERROR", "TOKEN_INVALID", "TOKEN_REFRESH_FAILED", "NOT_INITIALIZED"]);
const connectionWide = (r: Refusal): boolean => r.code === "E_ACCOUNT_CREDENTIAL" || MM_WIDE.has(String((r.native as { code?: unknown } | undefined)?.code));
/** how many of one source's reads are on their way at once: the rest wait their turn */
const PER_VENUE = 2;
/** the longest anything is kept */
const KEEP_MAX_MS = 300_000;

/** a source that threw has answered in a way the market cannot read: the source's refusal for it, with no word of the exception on the
 * wire (the exception is written to the server's log, once per throw; a thrower is held back like a source that did not answer) */
export function thrownBy(venue: string, name: string, err: unknown): Refusal {
  if (isRefusal(err)) return err;
  console.error(`${venue}: a read threw: ${String((err as Error)?.message ?? err).slice(0, 300)}`);
  return no("E_VENUE_UNREACHABLE", { venue, message: `${name} answered in a way the market could not read` });
}

/** a hold that is the venue's own line for the whole of the network the market runs on — its place rule, or the server in front of it
 * refusing the network — rather than a rule for one product (`detail.scope`), or a close-only answer: its words, or nothing */
export function notServedBy(r: Refusal | undefined): string | undefined {
  if (!r || r.code !== "E_VENUE_GEOBLOCKED") return undefined;
  if ((r.detail as { scope?: unknown } | undefined)?.scope !== undefined) return undefined;
  if ((r.native as { closeOnly?: unknown } | undefined)?.closeOnly === true) return undefined;
  return r.message;
}

/** Answers kept for a short while, and one request in flight per key: an answer still on its way is waited for whatever its age, so a venue
 * that takes ten seconds to say no is asked once, not once per poll. A refusal is not kept — the next ask asks the venue again — except one
 * that says the venue cannot be asked just now, which is kept twenty seconds (ten minutes for a geoblock) and holds back EVERY read of that
 * venue for as long, so a page polling every few seconds does not hammer a venue that is down, rate-limiting or refusing this location.
 * With a venue named: at most two of its reads on their way at once, and how each one went is its health.
 *
 * A hold ends when the LATER of the venue's refusals says (a timeout after a ban does not shorten the ban), a read that waited its turn is
 * not sent into a hold set while it waited, and a ban of this machine's address holds the venue's keyless source and its keyed connection
 * alike. A refusal from another party than the venue (`native.party`: LI.FI pricing a wallet's swaps) holds that party's reads only, and
 * one from a part of a connection (`mm#swaps`, one of the venues mm reaches; `public:polymarket#history`, a source's other host) holds that
 * part only — while the connection's own hold holds every part of it */
export class ReadCache {
  /** `onRule`: a venue's own rule for the whole network, met by one of its reads and held here (the service remembers it for the keyless gate) */
  constructor(private readonly onRule?: (venue: string, r: Refusal) => void) {}
  private readonly kept = new Map<string, { at: number; value: Promise<unknown>; failed: boolean; settled: boolean }>();
  private readonly slots = new Map<string, { busy: number; waiting: Array<() => void> }>();
  private readonly health = new Map<string, VenueHealth>();
  /** a venue that said it cannot be asked just now: until when, and the refusal that stands for every read of it meanwhile. A party's own
   * hold is kept under `venue|party` */
  private readonly down = new Map<string, { until: number; refusal: Refusal }>();
  /** a ban of this machine's address, by the venue it is of (`binance` for the keyed connection and the keyless source both), and when it
   * was answered */
  private readonly bans = new Map<string, { until: number; refusal: Refusal; at: number }>();

  /** `parties`: the read is one of the venue's trader's (its markets, prices, history), which another party may answer for */
  get<T>(key: string, ttlMs: number, load: () => Promise<T>, venue?: string, parties = false): Promise<T> {
    const now = Date.now();
    const hit = this.kept.get(key);
    if (hit && (!hit.settled || now - hit.at < (hit.failed ? FAIL_KEEP_MS : ttlMs))) return hit.value as Promise<T>;
    const held = venue === undefined ? undefined : this.holding(venue, parties);
    if (held) return Promise.resolve(held.refusal as unknown as T);
    const entry: { at: number; value: Promise<unknown>; failed: boolean; settled: boolean } = { at: now, value: Promise.resolve(), failed: false, settled: false };
    // a read that waited its turn asks again whether the venue is held: it may have answered a ban, its place rule or an edge page to the
    // reads ahead of it. One turned away is not sent, and changes nothing of the venue's health
    const run =
      venue === undefined
        ? load
        : () =>
            this.slot(venue, () => {
              const since = this.holding(venue, parties);
              return since ? Promise.resolve(since.refusal as unknown as T) : this.timed(venue, load);
            });
    const value = run().then(
      (v) => {
        entry.settled = true;
        if (isRefusal(v) && this.kept.get(key) === entry) {
          if (holdsBack(v)) Object.assign(entry, { at: Date.now(), failed: true });
          else this.kept.delete(key);
        }
        return v;
      },
      (err: unknown) => {
        entry.settled = true;
        if (this.kept.get(key) === entry) this.kept.delete(key);
        throw err;
      },
    );
    entry.value = value;
    this.kept.set(key, entry);
    if (this.kept.size > 500) for (const [k, v] of this.kept) if (v.settled && now - v.at >= KEEP_MAX_MS) this.kept.delete(k);
    return value;
  }

  /** a venue disconnected, or connected afresh: what was kept of its answers, its hold-backs and its health go with it (a venue connected
   * again under the same id starts afresh). A ban of this machine's address stays — disconnecting does not lift it — unless the venue
   * `answered` just now (a connection it took) */
  forget(venue: string, answered = false): void {
    const ban = this.bans.get(bareVenue(venue));
    this.drop(venue, true);
    if (ban && !answered) this.bans.set(bareVenue(venue), ban);
    for (const k of [...this.health.keys()]) if (ofVenue(k, venue)) this.health.delete(k);
  }

  /** a write at a venue: what was kept of its reads goes, so the next read sees what the write changed. When the venue `answered` the
   * write it is not held back either; when nothing says it was reached (a card rejected, a move still waiting for the wallet), a hold it
   * set — a ban, its place rule — stands. Its health stays */
  drop(venue: string, answered = true): void {
    for (const k of [...this.kept.keys()]) if (ofVenue(k.split("|")[1] ?? "", venue)) this.kept.delete(k);
    if (!answered) return;
    for (const k of [...this.down.keys()]) if (ofVenue(k, venue)) this.down.delete(k);
    for (const k of [...this.bans.keys()]) if (ofVenue(k, bareVenue(venue))) this.bans.delete(k);
  }

  /** a re-check the user (or the half-hourly watch) asked for found the venue answering the network the user is on now: a hold learned on
   * the network before — its place rule, an edge page, no answer — and the refusals kept with it go. A hold on the venue's own time (a
   * ban, a wait it named) stands until then. Its health stays */
  release(venue: string): void {
    const now = Date.now();
    for (const [k, d] of [...this.down]) if ((k === venue || k.startsWith(`${venue}#`)) && !ownTime(d.refusal, now)) this.down.delete(k);
    if (this.holding(venue, false)) return;
    for (const [k, v] of this.kept) if (v.failed && v.settled && ofVenue(k.split("|")[1] ?? "", venue)) this.kept.delete(k);
  }

  /** every answer kept under these first segments (`explore`, `compare`): what a venue connected or disconnected changes */
  forgetAll(prefixes: readonly string[]): void {
    for (const k of [...this.kept.keys()]) if (prefixes.some((p) => k.startsWith(`${p}|`))) this.kept.delete(k);
  }

  /** the venue's health, as its reads through here went */
  healthOf(venue: string): VenueHealth | undefined {
    const h = this.health.get(venue);
    return h ? { ...h } : undefined;
  }

  /** the refusal that holds the venue back now, if one does: its own hold, or a ban of this machine's address learned by its keyless
   * source or its connection. What the venue's balance reads (adapters/live.ts) and its market reads follow alike */
  heldOf(venue: string): Refusal | undefined {
    return this.holding(venue, false)?.refusal;
  }

  /** a running ban of this machine's address by the venue, and when it was answered */
  banOf(venue: string): { refusal: Refusal; at: number } | undefined {
    const b = this.bans.get(bareVenue(venue));
    return b && Date.now() < b.until ? b : undefined;
  }

  /** a refusal the venue gave elsewhere on the account (its balance read, an order or earn door, the keyless probe's ban): held as one of
   * these, by the same rule — it lengthens a hold, never cuts one */
  hold(venue: string, r: Refusal): boolean {
    if (!holdsBack(r)) return false;
    this.holdBack(venue, r);
    // a party's refusal (LI.FI for a wallet's swaps) holds that party, not the venue: the venue's reads go on as before
    return !partyOf(r);
  }

  private holding(venue: string, parties: boolean): { until: number; refusal: Refusal } | undefined {
    const now = Date.now();
    const base = baseVenue(venue);
    for (const at of base === venue ? [venue] : [venue, base]) {
      const own = this.down.get(at);
      if (own && now < own.until) return own;
      const ban = this.bans.get(bareVenue(at));
      if (ban && now < ban.until) return ban;
    }
    if (parties) for (const [k, d] of this.down) if (k.startsWith(`${venue}|`) && now < d.until) return d;
    return undefined;
  }

  /** held back until the later of what is held and what this refusal says: a 429 or a timeout that lands after a ban does not shorten
   * it, nor does a 20-second "no answer" shorten a ten-minute place rule. Reads meanwhile answer in the words of the longer hold */
  private holdBack(venue: string, r: Refusal): void {
    if (!partyOf(r)) this.onRule?.(venue, r);
    const now = Date.now();
    const until = now + holdBackMs(r, now);
    const at = partyOf(r) ? `${venue}|${partyOf(r)}` : connectionWide(r) ? baseVenue(venue) : venue;
    const was = this.down.get(at);
    if (!was || was.until <= now || was.until < until) this.down.set(at, { until, refusal: r });
    if (isBan(r) && !partyOf(r)) {
      const b = this.bans.get(bareVenue(at));
      if (!b || b.until <= now || b.until < until) this.bans.set(bareVenue(at), { until, refusal: r, at: now });
    }
  }

  /** one of the venue's two places in line (one line for a whole connection, its parts included), handed straight to the next read
   * waiting when it is done */
  private async slot<T>(venue: string, run: () => Promise<T>): Promise<T> {
    let s = this.slots.get(baseVenue(venue));
    if (!s) this.slots.set(baseVenue(venue), (s = { busy: 0, waiting: [] }));
    const line = s;
    if (line.busy < PER_VENUE) line.busy++;
    else await new Promise<void>((go) => line.waiting.push(go));
    try {
      return await run();
    } finally {
      const next = line.waiting.shift();
      if (next) next();
      else line.busy--;
    }
  }

  /** one read, timed for the venue's health; a venue that said it cannot be asked just now is held back for the keep, whenever it said so.
   * Another party's refusal is that party's health and hold, not the venue's */
  private async timed<T>(venue: string, load: () => Promise<T>): Promise<T> {
    const start = Date.now();
    const note = (h: VenueHealth, at = venue) => this.health.set(at, { ...this.health.get(at), ...h, ms: Date.now() - start });
    try {
      const v = await load();
      if (isRefusal(v) && venueFailed(v)) {
        note({ lastFailAt: new Date().toISOString(), code: v.code, message: v.message }, partyOf(v) ? `${venue}|${partyOf(v)}` : connectionWide(v) ? baseVenue(venue) : venue);
        if (holdsBack(v)) this.holdBack(venue, v);
      } else {
        note({ lastOkAt: new Date().toISOString() });
        // a part that answered: the connection answered
        if (baseVenue(venue) !== venue) note({ lastOkAt: new Date().toISOString() }, baseVenue(venue));
      }
      return v;
    } catch (err) {
      // the readers above turn a throw into a refusal before it gets here; one that still throws is held back the same way, and the
      // exception's words stay in the server's log
      const r = thrownBy(venue, venue, err);
      note({ lastFailAt: new Date().toISOString(), code: r.code, message: r.message });
      this.holdBack(venue, r);
      throw err;
    }
  }
}

/** ONE PRICE HISTORY READ (service.ts historyRead): not asked while its source is held back (its place rule, a ban, a wait it asked for —
 * the read cache's holds, which a refusal here sets as any read's does), shared while on its way, kept by its window; a throw is a refusal */
function historyRead(c: ReadCache, histories: HistoryKeep<Candle[] | CandlePage>, key: string, at: string, ttlMs: number, load: () => Promise<Candle[] | CandlePage | Refusal>, id: string, name: string): Promise<Candle[] | CandlePage | Refusal> {
  const held = c.heldOf(at);
  if (held) return Promise.resolve(held);
  return histories.get(key, ttlMs, async () => {
    const r = await load().catch((err: unknown) => thrownBy(id, name, err));
    if (isRefusal(r)) c.hold(at, r);
    return r;
  });
}

/** A KEYLESS PUBLIC SOURCE AS THE MARKET READS IT (service.ts keptPublic): through the read cache under the source's id — so an answer on
 * its way is shared, a source that refuses this location (451), rate-limits this machine (429) or does not answer is not asked again for
 * the keep (a geoblock holds it back ten minutes), and a throw is a refusal. The source's own keeping of the bodies it downloads
 * (live/public-markets.ts) sits under this. Its holds, kept answers and health are under a name of its own (`public:okx`).
 *
 * A source whose price history comes from another host than its listings (Polymarket's CLOB, beside Gamma): a refusal of the history holds
 * back the history alone. A SOURCE THAT ANSWERS ONE MARKET'S LINE ALONE (the US stocks line) keeps each of its reads apart — its searches
 * (listings, stats, events) under `#search`, its history under `#history`, its line under `#line` — so a search's 429 or a chart's timeout
 * holds back neither the line nor each other. A refusal of this network (a 451, a ban of this machine's address) is the source's (widen),
 * and holds all three. Its book, trades, settlement and funding are the source's own, passed as they are */
export function keptSource(c: ReadCache, s: PublicSource, histories: HistoryKeep<Candle[] | CandlePage>): PublicSource {
  const id = s.id;
  const ns = `public:${id}`;
  const parted = !!s.line;
  /** a refusal of this network by a parted source's part: the source's whole, every part of it held with it */
  const widen = <T>(v: T | Refusal): T | Refusal => {
    if (parted && isRefusal(v) && (v.code === "E_VENUE_GEOBLOCKED" || isBan(v))) c.hold(ns, v);
    return v;
  };
  const read = <T>(key: string, ttlMs: number, load: () => Promise<T | Refusal>, venue = ns): Promise<T | Refusal> => c.get(key, ttlMs, () => load().catch((err: unknown) => thrownBy(id, s.name, err)).then((v) => (venue === ns ? v : widen(v))), venue);
  const history = s.historyApart || parted ? `${ns}#history` : ns;
  const search = parted ? `${ns}#search` : ns;
  return {
    ...s,
    listings: (o) => read(`public-listings|${ns}|${(o.q ?? "").trim().toUpperCase()}|${o.limit}`, PUBLIC_KEEP_MS, () => s.listings(o), search),
    ...(s.stats ? { stats: (symbols?: string[]) => read(`public-stats|${ns}|${symbols ? [...symbols].sort().join(",") : ""}`, PUBLIC_KEEP_MS, () => s.stats!(symbols), search) } : {}),
    ...(s.events ? { events: (o: { category?: string | undefined; closingWithinMs?: number | undefined; limit: number }) => read(`public-events|${ns}|${o.category ?? ""}|${o.closingWithinMs ?? ""}|${o.limit}`, PUBLIC_KEEP_MS, () => s.events!(o), search) } : {}),
    ...(s.line ? { line: (sym: string) => read(`public-line|${ns}|${sym.trim().toUpperCase()}`, LINE_KEEP_MS, () => s.line!(sym), `${ns}#line`) } : {}),
    // a history is kept by its window (live/history.ts windowKey): a source gives the bars of the window asked, so one asked from later
    // never stands in for the earlier bars it does not have
    // a forced re-check found the source answering this network (service.ts, its re-check): its holds here, its parts with it, and the
    // source's own keeping of a refusal from the network before, let go of
    reset: () => {
      c.release(ns);
      s.reset?.();
    },
    ...(s.candles ? { candles: (sym: string, interval: CandleInterval, w: CandleWindow) => historyRead(c, histories, `public-candles|${history}|${sym}|${windowKey(interval, w)}`, history, keepMsOf(interval, w), () => s.candles!(sym, interval, w).then((v) => (parted ? widen(v) : v)), id, s.name) } : {}),
  };
}
