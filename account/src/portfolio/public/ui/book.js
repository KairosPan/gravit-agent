/* The ORDER BOOK and the LATEST TRADES: the Trade page's middle panel (ui/terminal.js mounts it beside the chart and the ticket). Two tabs:
   "Order book" — the ladder, the offers above and the bids below, the best of each nearest the middle, a spread row between them — and
   "Trades", the latest trades, newest first. What it shows is the market's own source, read by the account (GET /api/account/book and
   GET /api/account/trades; service.ts marketBook / marketTrades): a connected venue's own book, a paper account's market's public source, a
   venue not connected from its public data without a key. Nothing on it is made up: every row is a level the source sent, a grouped row is
   the sum of the real sizes inside it — and the group at the far end of a side the source may hold more of says "≥", only part of its range
   having been read — a bar behind a row is that row's own running total, and a source whose depth is not read (a US stock's public quote
   has none at all) is shown as exactly its best bid and best ask, with a quiet line saying which, and how old a quote is once it is more
   than a few seconds old. A price is printed to its tick, never to fewer decimals than it has. A read that fails shows the refusal's own
   words.

     bkMount(el, { venue, symbol, kind, quote, priceStep, base?, rows?, onPrice })
                   draws the panel into el for one market and keeps it fresh: the book read every two seconds while its tab shows, the
                   trades every four while theirs does, and neither while el is out of the document (it stops itself then), its pane is
                   put aside (shell.js `hidden`: it waits, and reads at once when the pane comes back) or the page is hidden. A read the
                   account refuses — or that never reaches it (a stopped service, a dropped connection) — is asked again later and later —
                   two seconds, then four, eight … at most a minute apart — until one is answered, so a venue that is not connected, or an
                   account that is down, is not asked every two seconds for ever; and the panel says so: the refusal's words, or "the
                   account is not answering", with how long it now waits between asks. While the account does not answer, the book and
                   the trades last read stay, dimmed, under a line that says since when they were not read (an old book is never taken
                   for a live one); a refusal, which is the account's or the venue's own word, takes them away. A source that publishes
                   no trades (the account answers so: `none`) is not asked for them again until the market or the tab changes. Mounting
                   el again with another market switches cleanly: every read is tagged with the market it was asked for,
                   and an answer for a market no longer showing is dropped. `priceStep` (the market's own tick) sets the prices' precision
                   and the grouping offered (1×, 10×, 100× the tick); `kind: "event"` shows prices in cents. Pressing a row of the ladder
                   calls onPrice(price), the price in the market's quote (an event contract's in dollars: 0.62), which the ticket takes as
                   its limit price. `rows`: how many rows a side the ladder draws; without it, as many whole rows as the panel's height
                   holds (worked out when it is mounted and when its size changes, never as data arrives), so no row is ever cut
     bkRelease(el) stops it: its timers, and any answer still on its way is dropped
   PUSHED. Where the account's stream carries the market (ui/stream.js: the market showing is followed, and its venue's own stream moves —
   live/stream-hub.ts), its book and its latest trades come pushed as book · trades events, a few times a second, and are drawn in the next
   frame (only while their tab shows; kept for it otherwise): the reads above then become a slow fallback — once every BK_SLOW_MS while what
   is pushed is fresh — and are back on their beat as soon as it is not (the stream down, the market no longer live there, nothing pushed for
   BK_PUSH_FRESH_MS). A pushed book that holds as many levels a side as the ladder draws (or every level the venue has) is drawn as it came;
   a stream that sends only its venue's nearest few (Hyperliquid's five, OKX's five, Kraken's ten) has those drawn live with the deeper levels
   of the last read beyond them (bkCompose) — only levels strictly further out than the stream's last, from a read no older than
   BK_STITCH_MS — and the quiet line says so, with when those were read; the reads keep their beat then, for the depth. The pushed trades and
   the trades read are one tape (bkMergeTrades): each trade once, newest first, each row keyed by the trade itself, so a new trade comes in at
   the top and the rows under it are the same rows moved down, never drawn again. Nothing pushed is ever taken for more than it is: an
   answer read before a newer push is not drawn over it, and a market the stream says is not live is read again at once
   As HL's does, a level whose size changed since the last read flashes once in its side's colour (bkFlashes; none under reduced motion) —
   softer, and a level at most once in BK_FLASH_MS, while the stream drives the book (bk-live: it moves several times a second) —
   and a pointer over a row shows a card beside the panel with what the rows from the best to it add up to (bkReach: the distance from the
   middle, the average price, the totals in the base and the quote — from the source's own levels; the keyboard's focus on a row shows it
   too, a finger never).
   The pure parts, for the tests and anything else that draws a book: bkGroup · bkLadder · bkSpread · bkSpreadParts · bkSpreadWords ·
   bkSpreadHtml · bkTopLine · bkPrice · bkSize · bkClock · bkGroups · bkFlashes · bkReach · bkReachLines · bkUnanswered (whether a read's body says the account did not answer
   it: the terminal's bar asks it too) · bkNoWords · bkOldWords · bkCompose · bkLiveLine · bkMergeTrades · bkTradeKey. */

/** each mounted panel's state, by its element: the market, the tab, the grouping, what the last reads said, the timers */
const BK = new WeakMap();
/** the elements whose listeners are on already (one set per element, reading BK for the market showing) */
const BK_WIRED = new WeakSet();
/** how often each is read while it shows, how many rows a side the ladder draws, how many trades are asked */
const BK_BOOK_MS = 2000;
const BK_TRADES_MS = 4000;
const BK_ROWS = 9;
const BK_TRADES = 30;
/** a row's pitch — HL's 23-pixel row and the 2 pixels between rows — and what the book's pane holds besides its two halves — the tabs (41),
 * the controls row (31: the grouping, the size's unit), the column heads (17), the spread row (23) and room for the quiet line (30) — as
 * book.css draws them: how many rows a side fit is worked out from these (bkFit reads the row's own height where the stylesheet set
 * another: --bk-row, 24 under a coarse pointer) */
const BK_ROW_PX = 25;
const BK_GAP_PX = 2;
const BK_CHROME_PX = 41 + 31 + 17 + 23 + 30;
/** a refused read is asked again after this long, doubled each time it is refused again, at most the second figure; an answer resets it */
const BK_BACKOFF_MS = 2000;
const BK_BACKOFF_MAX_MS = 60_000;
/** WHILE THE STREAM PUSHES THE MARKET: what was pushed is fresh for this long; meanwhile a read is asked only once in BK_SLOW_MS (the
 * fallback, and a check of what the stream says); the deeper levels a read gave are laid beyond a shallow stream's for this long at most;
 * and a level flashes at most once in BK_FLASH_MS (its own flash's length) */
const BK_PUSH_FRESH_MS = 5_000;
const BK_SLOW_MS = 15_000;
const BK_STITCH_MS = 10_000;
const BK_FLASH_MS = 800;
/** the panels mounted now, each its state (the pushed book and trades find theirs here; BK is keyed by element and cannot be walked) */
const BK_LIVE = new Set();

// ---- the pure parts --------------------------------------------------------------------------------------------------------------------

/** the decimal places a step is written in (0.01 → 2, 0.5 → 1, 10 → 0); none known → undefined */
function bkDecimals(step) {
  // to twelve figures first: 0.07 × 100 is 7.000000000000001 in binary, and has no fifteen decimals
  const s = Number(Number(step).toPrecision(12));
  if (!(s > 0) || !Number.isFinite(s)) return undefined;
  const [m, e] = s.toExponential().split("e");
  return Math.max(0, (m.split(".")[1] || "").length - Number(e));
}

/** the groupings a market's tick allows: 1×, 10× and 100× it — an event contract's only while a group stays under a dollar (10¢ at most for
 * a 1¢ tick: a 100¢ row would be the whole book). None without a tick */
function bkGroups(step, kind) {
  const s = Number(step);
  if (!(s > 0) || !Number.isFinite(s)) return [];
  return [1, 10, 100].filter((k) => k === 1 || kind !== "event" || k * s < 1 - 1e-12);
}

/** One side of a book grouped to `g` (a price: the tick times the grouping): each bid's price floored to the group and each ask's ceiled — so
 * a group's row never shows a better price than any level in it — and the sizes inside a group summed. The source's own levels, added up:
 * nothing made up. `g` not above 0: the levels as they are. Best first — the highest bid, the lowest ask — whatever order they came in.
 * `goesOn`: the side may hold levels past the worst one sent (OrderBook.more). Then the group holding that worst level is only PART of its
 * range — the levels further out in it were never read — unless that level sits on the group's far edge (a bid at the group's own floor, an
 * ask at its own ceiling), where nothing unread can fall inside: that row is marked as part (a third element, true), and its sum is what was
 * read of it, never the whole */
function bkGroup(levels, side, g, goesOn = false) {
  const rows = Array.isArray(levels) ? levels.filter((l) => Array.isArray(l) && Number(l[0]) > 0) : [];
  const best = (a, b) => (side === "bids" ? b[0] - a[0] : a[0] - b[0]);
  if (!(g > 0)) return rows.map((l) => [Number(l[0]), l[1] === null || l[1] === undefined ? null : Number(l[1])]).sort(best);
  const dec = bkDecimals(g) ?? 8;
  const out = [];
  const at = new Map();
  let worst;
  for (const [p, s] of rows) {
    const n = Number(p);
    if (worst === undefined || (side === "bids" ? n < worst : n > worst)) worst = n;
    const k = side === "bids" ? Math.floor(n / g + 1e-9) : Math.ceil(n / g - 1e-9);
    const price = Number((k * g).toFixed(dec));
    const size = s === null || s === undefined ? null : Number(s);
    if (!at.has(price)) {
      at.set(price, out.length);
      out.push([price, size]);
    } else {
      const row = out[at.get(price)];
      row[1] = row[1] === null || size === null ? (row[1] ?? size) : row[1] + size;
    }
  }
  out.sort(best);
  const last = out[out.length - 1];
  if (goesOn && last && Math.abs(last[0] - worst) > g * 1e-9) last.push(true);
  return out;
}

/** the spread between the best bid and the best ask as the source sent them (never between grouped rows): in the market's quote — to no
 * more decimals than the two prices have between them, so a difference of large numbers carries no binary tail (100000.0001 − 100000 is
 * 0.0001, not 0.0000999999974) — and in percent of their middle; nothing while either side is empty */
function bkSpread(book) {
  const bid = book && Array.isArray(book.bids) && book.bids[0] ? Number(book.bids[0][0]) : NaN;
  const ask = book && Array.isArray(book.asks) && book.asks[0] ? Number(book.asks[0][0]) : NaN;
  if (!(bid > 0) || !(ask > 0)) return null;
  const dec = Math.min(12, Math.max(bkDecimals(bid) ?? 12, bkDecimals(ask) ?? 12));
  const abs = Number((ask - bid).toFixed(dec));
  return { abs, pct: (abs / ((ask + bid) / 2)) * 100 };
}

/** a price as the market writes it: in cents for an event contract (62¢, 62.5¢ on a tenth-of-a-cent tick), else to the decimals of its tick
 * times the grouping — but never to fewer than the price itself needs: a level finer than the tick the market states (a 0.999 bid where a
 * paper account says 0.01, a Polymarket market on a 0.001 tick) is printed whole, never rounded to look like another price. Its own decimals
 * are counted with no binary tails, at most eight in dollars (six in cents). No tick known: an event contract's in whole cents unless the
 * price needs more, anything else as it came (core.js px) */
function bkPrice(p, o, g) {
  const n = Number(p);
  if (!Number.isFinite(n)) return "—";
  const step = Number(o && o.priceStep) > 0 ? Number(o.priceStep) * (g || 1) : undefined;
  const own = (x) => (x === 0 ? 0 : (bkDecimals(Math.abs(x)) ?? 0));
  if (o && o.kind === "event") {
    const c = n * 100;
    const dec = Math.min(6, Math.max(step !== undefined ? (bkDecimals(step * 100) ?? 0) : 0, own(c)));
    return `${c.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })}¢`;
  }
  if (step === undefined) return px(n);
  const dec = Math.min(8, Math.max(bkDecimals(step) ?? 0, own(n)));
  return n.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

/** a size in the units an order is sized in there, as the source gave it — to eight decimals, with no binary tails (a sum of sizes is held
 * to twelve figures) — never cut to fit; none given: a dash */
function bkSize(s) {
  if (s === null || s === undefined || s === "") return "—";
  const n = Number(s);
  if (!Number.isFinite(n)) return "—";
  return Number(n.toPrecision(12)).toLocaleString("en-US", { maximumFractionDigits: 8 });
}

/** a moment on the viewer's own clock, HH:MM:SS — the trading screen's one clock (core yourClock), as the chart and the tables say it */
function bkClock(iso) {
  const ms = typeof iso === "number" ? iso : Date.parse(String(iso || ""));
  if (!Number.isFinite(ms)) return "—";
  if (typeof yourClock === "function") return yourClock(ms, { date: false });
  const d = new Date(ms);
  const two = (x) => String(x).padStart(2, "0");
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

/** The ladder from one book: at most `rows` rows a side, grouped to `group` (a price; 0: not grouped) by bkGroup — a group at the far end of
 * a side that may go on marked `part` — each with its running total from the best outward and its bar's share — the running total over the largest running total drawn on either side, so the two sides compare. The offers
 * come in the order they are drawn (the worst at the top, the best ask last, nearest the middle); the bids best first. A book of depth "top"
 * is never grouped: its two prices are the source's best bid and ask, as they are */
function bkLadder(book, { rows = BK_ROWS, group = 0 } = {}) {
  const top = !!book && book.depth === "top";
  const g = top ? 0 : group;
  // a side may go on past what was sent unless the source said it sent everything (OrderBook.more); not said: taken as may go on
  const more = (side) => !(book && book.more && book.more[side] === false);
  const asks = bkGroup(book && book.asks, "asks", g, more("asks")).slice(0, rows);
  const bids = bkGroup(book && book.bids, "bids", g, more("bids")).slice(0, rows);
  // a row that is only part of its range (bkGroup) is the last of its side: its size, and the running total through it, are "at least"
  const run = (side) => {
    let t = 0;
    let known = true;
    return side.map(([p, s, part]) => {
      if (s === null || s === undefined) known = false;
      else t += s;
      return { p, s, t: known ? Number(t.toPrecision(12)) : null, ...(part ? { part: true } : {}) };
    });
  };
  const a = run(asks);
  const b = run(bids);
  const most = Math.max(0, ...[...a, ...b].map((r) => (r.t === null ? 0 : r.t)));
  const share = (r) => (r.t !== null && most > 0 ? r.t / most : 0);
  return { asks: a.map((r) => ({ ...r, w: share(r) })).reverse(), bids: b.map((r) => ({ ...r, w: share(r) })), spread: bkSpread(book), top };
}

/** the spread row's figures: the spread in the market's own figures (an event contract's in cents) and in percent of the middle — two
 * figures that count below one percent, never in exponent notation (a spread of a ten-millionth of a percent is "0.0000001%"); null while a
 * side is empty */
function bkSpreadParts(book, o) {
  const s = bkSpread(book);
  if (!s) return null;
  const pct = Math.abs(s.pct) >= 1 ? s.pct.toFixed(2) : s.pct.toLocaleString("en-US", { maximumSignificantDigits: 2, useGrouping: false });
  return { value: bkPrice(s.abs, o, 1), pct: `${pct}%` };
}
/** the spread row's words: "Spread 1.0 · 0.0012%"; a dash while a side is empty — what a screen reader hears of the row, whose three parts
 * stand apart on the screen (bkSpreadHtml) */
function bkSpreadWords(book, o) {
  const s = bkSpreadParts(book, o);
  if (!s) return book && ((book.bids || []).length || (book.asks || []).length) ? "Spread — · one side of the book is empty" : "Spread —";
  return `Spread ${s.value} · ${s.pct}`;
}
/** the spread row as HL draws it: "Spread", the value and the percent as three figures 32 pixels apart, read out as one sentence */
function bkSpreadHtml(book, o) {
  const s = bkSpreadParts(book, o);
  const words = bkSpreadWords(book, o);
  if (!s) return `<span class="bk-spread">${esc(words)}</span>`;
  return `<span class="bk-spread" role="text" aria-label="${esc(words)}"><span aria-hidden="true">Spread</span><span aria-hidden="true">${esc(s.value)}</span><span aria-hidden="true">${esc(s.pct)}</span></span>`;
}

/** a top-of-book quote older than this has its time said in the quiet line */
const BK_OLD_MS = 5000;
/** The quiet line under a book of its best bid and ask only: whose quote it is, in its own name, and why that is all — the source gives no
 * depth at all (OrderBook.topOnly "none": a US stock's public quote), or the account does not read the depth it has ("unread", or not said:
 * an exchange's pre-IPO contract, a venue connected whose book is not read) — and how old it is: the time it is from, once that is more
 * than a few seconds ago, or, for a quote with no time of its own taken from a list kept a while, how long that list is kept. An old
 * quote is never taken for a live book */
function bkTopLine(book, now = Date.now()) {
  if (!book || book.depth !== "top") return "";
  const from = book.from || "its source";
  const why = book.topOnly === "none" ? `${from} gives no depth` : `the account reads no depth from ${from}`;
  // a quote with no time of its own, from a list kept a while (OrderBook.upToMs): how old it may be; else its own time, once it is old
  const upTo = Number(book.upToMs);
  const at = Date.parse(String(book.at || ""));
  const old = upTo > BK_OLD_MS ? ` · from a list kept up to ${Math.round(upTo / 1000)} s` : Number.isFinite(at) && now - at > BK_OLD_MS ? ` · quoted at ${bkClock(at)}` : "";
  return `Best bid and ask only: ${why}${old}`;
}

/** THE BOOK TO DRAW from what the stream pushed (`push`: its levels a side, best first, and whether each side may go on past them — `more`)
 * and the last read (`read`, or null): a side the stream sends as deep as the ladder needs (`need` levels), or whole (`more` false), is the
 * stream's alone; a side it sends shallower has the stream's levels and, beyond them, the read's levels strictly further out than the
 * stream's last (a bid lower, an ask higher) — never one of the read's inside the stream's, which the stream now says otherwise — and goes
 * on as far as the read says. A read of a book's best bid and ask only (depth "top") adds nothing. `short`: a side was shallower than the
 * ladder needs; `stitched` says how many levels a side are the stream's where the read's lie beyond them, and when that read is from (its
 * own moment); neither: the stream's book alone, as deep as it is needed */
function bkCompose(push, read, need) {
  const lv = (x) => (Array.isArray(x) ? x.filter((l) => Array.isArray(l) && Number(l[0]) > 0) : []);
  const deep = read && read.depth !== "top" ? read : null;
  const out = { bids: [], asks: [], at: push.at, from: push.from, depth: "full", more: {} };
  let live = Infinity;
  for (const side of ["bids", "asks"]) {
    const mine = lv(push[side]);
    const goesOn = !(push.more && push.more[side] === false);
    if (!goesOn || mine.length >= need) {
      out[side] = mine;
      out.more[side] = goesOn;
      continue;
    }
    // shallower than the ladder needs: the reads keep their beat for the depth (book.js bkDue)
    out.short = true;
    if (!deep) {
      out[side] = mine;
      out.more[side] = goesOn;
      continue;
    }
    const last = mine.length ? Number(mine[mine.length - 1][0]) : side === "bids" ? Infinity : -Infinity;
    const beyond = lv(deep[side]).filter((l) => (side === "bids" ? Number(l[0]) < last : Number(l[0]) > last));
    out[side] = [...mine, ...beyond];
    out.more[side] = !(deep.more && deep.more[side] === false);
    if (beyond.length && mine.length) live = Math.min(live, mine.length);
  }
  if (live !== Infinity) out.stitched = { n: live, at: deep.at };
  return out;
}
/** the quiet line under a book drawn from the stream: how many levels a side are live, and when the deeper ones were read — short, to sit
 * on one line under the ladder (the stream's name is the bar's and the tape's) — "" for the stream's book alone */
function bkLiveLine(book) {
  if (!book || !book.stitched) return "";
  const at = Date.parse(String(book.stitched.at || ""));
  return `Nearest ${book.stitched.n} live · the rest as read${Number.isFinite(at) ? ` at ${bkClock(at)}` : ""}`;
}

/** a trade's own words, as one key: its moment (to the millisecond, however its source wrote it), its price, its size, its side */
function bkTradeKey(t) {
  const ms = Date.parse(String((t && t.at) || ""));
  return `${Number.isFinite(ms) ? ms : String((t && t.at) || "")}|${Number(t && t.price)}|${Number(t && t.size)}|${(t && t.side) || ""}`;
}
/** ONE TAPE from two lists of the same market's latest trades (the stream's and a read's, each newest first): every trade once — as many
 * of the same trade as the list that holds most of it says (two fills of one size in one moment are two trades) — newest first, the first
 * list's order kept among trades of one moment, `limit` at most. Nothing is made: every row is a trade one of them gave */
function bkMergeTrades(a, b, limit = BK_TRADES) {
  const out = [];
  const most = new Map();
  for (const list of [a, b]) {
    const here = new Map();
    for (const t of Array.isArray(list) ? list : []) {
      if (!t || !Number.isFinite(Number(t.price))) continue;
      const k = bkTradeKey(t);
      const n = (here.get(k) || 0) + 1;
      here.set(k, n);
      if (n <= (most.get(k) || 0)) continue;
      most.set(k, n);
      out.push(t);
    }
  }
  const ms = (t) => {
    const x = Date.parse(String(t.at || ""));
    return Number.isFinite(x) ? x : -Infinity;
  };
  return out
    .map((t, i) => [t, i])
    .sort((x, y) => ms(y[0]) - ms(x[0]) || x[1] - y[1])
    .slice(0, limit)
    .map(([t]) => t);
}

// ---- drawing ----------------------------------------------------------------------------------------------------------------------------

/** the panel's frame for one market: its head (the tabs, the grouping), the book's pane and the trades' pane — drawn once per market; the
 * parts inside are drawn as the reads come. Keyed by the market, so another market's frame replaces it whole */
function bkFrame(st) {
  const o = st.o;
  const groups = bkGroups(o.priceStep, o.kind);
  // what the prices and the sizes are counted in, said once, at the controls row's right (HL's "BTC") and to a screen reader with the
  // column heads, which stay one word each so none is ever cut
  const quote = o.kind === "event" ? "cents" : o.quote || "";
  const size = o.base || "";
  const select = groups.length > 1 ? `<label class="bk-gw"><span class="sr">Group prices by</span><select class="bk-group" data-bk-group>${groups.map((k) => `<option value="${k}"${k === st.group ? " selected" : ""}>${esc(bkPrice(k * Number(o.priceStep), o, k))}</option>`).join("")}</select></label>` : "";
  const unit = size ? `<span class="bk-unit" title="${esc(`Sizes and totals in ${size}`)}">${esc(size)}</span>` : "";
  const heads = (last) => `<div class="bk-cols"><span>Price<span class="sr">${quote ? ` in ${esc(quote)}` : ""}</span></span><span>Size<span class="sr">${size ? ` in ${esc(size)}` : ""}</span></span><span>${last}</span></div>`;
  return `<div class="bk" data-k="bk:${esc(st.key)}">
<div class="bk-head"><div class="bk-tabs" role="tablist" aria-label="Order book or trades"><button type="button" role="tab" class="bk-tab" data-bk-tab="book" aria-selected="true">Order book</button><button type="button" role="tab" class="bk-tab" data-bk-tab="trades" aria-selected="false">Trades</button></div></div>
<div class="bk-pane" data-bk-pane="book" role="tabpanel"><div class="bk-ctl">${select}${unit}</div>${heads("Total")}<div class="bk-ladder" tabindex="0" role="group" aria-label="Order book: the arrow keys move from level to level, Enter takes a level's price as the limit"><div class="bk-asks" data-bk-asks></div><div class="bk-mid" data-bk-mid><span class="bk-wait">Reading the book…</span></div><div class="bk-bids" data-bk-bids></div></div><p class="bk-note" data-bk-note></p></div>
<div class="bk-pane" data-bk-pane="trades" role="tabpanel" hidden>${heads("Time")}<div class="bk-tape" data-bk-tape><p class="bk-wait">Reading the trades…</p></div></div>
</div>`;
}

/** one row of the ladder: its bar (its running total's share), its price, its size, its running total; a button that hands its price on.
 * `flash`: "a" or "b" when the level's size changed since the book was last drawn (bkFlashes) — the row flashes once in its side's colour
 * (book.css, HL's 800 ms); two names, taken in turn, so a level that changes on two reads running flashes on both */
function bkRowHtml(r, side, o, g, flash = "") {
  const p = bkPrice(r.p, o, g);
  const w = Math.max(0, Math.min(1, r.w || 0));
  // a row that is only part of its range: its size and its running total are what was read of it, at least that much ("≥"), and it says so
  const least = r.part ? "≥\u2009" : "";
  const title = r.part ? `Use ${p} as the limit price · only part of this range was read: at least this much rests here` : `Use ${p} as the limit price`;
  return `<div class="bk-row bk-${side}${r.part ? " bk-part" : ""}${flash ? ` bk-f${flash}` : ""}" role="button" tabindex="-1" data-k="${side}:${esc(String(r.p))}${r.part ? ":part" : ""}" data-bk-px="${esc(String(r.p))}" title="${esc(title)}"><span class="bk-bar" style="transform:scaleX(${Number(w.toFixed(4))})"></span><span class="bk-p">${esc(p)}</span><span class="bk-s">${least}${esc(bkSize(r.s))}</span><span class="bk-t">${least}${esc(bkSize(r.t))}</span></div>`;
}

/** THE LEVELS THAT CHANGED since the book was last drawn at this grouping: a level at the same price on the same side whose size the
 * source now says is another — never a level that only came into the rows drawn (the ladder's far end moves as the book does) and never one
 * whose size is not known. Returns the set of `${side}:${price}` keys that changed, and keeps this draw's sizes for the next (st.sizes, by
 * the grouping they were drawn at: another grouping starts afresh, as does another market — a new state). The first draw flashes nothing */
function bkFlashes(st, lad, g) {
  const now = new Map();
  for (const r of lad.asks) if (r.s !== null && r.s !== undefined) now.set(`ask:${r.p}`, r.s);
  for (const r of lad.bids) if (r.s !== null && r.s !== undefined) now.set(`bid:${r.p}`, r.s);
  const was = st.sizes && st.sizesAt === g ? st.sizes : null;
  st.sizes = now;
  st.sizesAt = g;
  const changed = new Set();
  if (was) for (const [k, s] of now) if (was.has(k) && was.get(k) !== s) changed.add(k);
  return changed;
}

/** WHAT A ROW REACHES, for the card beside the book on hover (HL's): every level of the source from the best on the row's side to the row
 * itself — read from the source's own levels, never the grouped rows' prices (an ask's group holds the levels at or under its price, a bid's
 * those at or over it, so the levels counted are exactly those of the rows from the best to it) — and what they add up to: the row's
 * distance from the middle of the best bid and the best ask in percent, the average price of what rests there, and the sizes added up in
 * the base and in the quote (an event contract's in dollars). Null where a size in the reach is not known (a quote with no depth), or there is
 * no middle */
function bkReach(book, side, price) {
  const levels = book && Array.isArray(side === "ask" ? book.asks : book.bids) ? (side === "ask" ? book.asks : book.bids) : [];
  const P = Number(price);
  const s = bkSpread(book);
  if (!(P > 0) || !s) return null;
  const eps = Math.abs(P) * 1e-12;
  let base = 0;
  let quote = 0;
  for (const l of levels) {
    const p = Number(l && l[0]);
    if (!(p > 0) || (side === "ask" ? p > P + eps : p < P - eps)) continue;
    if (l[1] === null || l[1] === undefined || !Number.isFinite(Number(l[1]))) return null;
    base += Number(l[1]);
    quote += p * Number(l[1]);
  }
  if (!(base > 0)) return null;
  const bid = Number(book.bids[0][0]);
  const ask = Number(book.asks[0][0]);
  const mid = (bid + ask) / 2;
  return { dist: ((P - mid) / mid) * 100, avg: quote / base, base: Number(base.toPrecision(12)), quote: Number(quote.toPrecision(12)) };
}
/** the card's four lines, as words: [label, value] — the distance with its sign, two figures below one percent; the average to the market's
 * own step (it is an average: no tail no venue quotes; an event's in cents to a tenth); the totals as the ladder writes sizes, and in the
 * quote to the cent. `part`: the row is only part of its range — its totals at least ("≥") */
function bkReachLines(reach, o, part = false) {
  const ev = o && o.kind === "event";
  const a = Math.abs(reach.dist);
  const dist = `${reach.dist > 0 ? "+" : reach.dist < 0 ? "−" : ""}${a >= 1 ? a.toFixed(2) : a.toLocaleString("en-US", { maximumSignificantDigits: 2, useGrouping: false })}%`;
  const dec = Number(o && o.priceStep) > 0 ? (bkDecimals(Number(o.priceStep)) ?? 2) : 2;
  const avg = ev ? `${Number((reach.avg * 100).toFixed(1))}¢` : reach.avg.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const least = part ? "≥\u2009" : "";
  const quote = ev ? "USD" : (o && o.quote) || "";
  const base = (o && o.base) || "";
  return [
    ["Distance from mid", dist],
    ["Average price", avg],
    [`Total${base ? ` (${base})` : ""}`, `${least}${bkSize(reach.base)}`],
    [`Total${quote ? ` (${quote})` : ""}`, `${least}${reach.quote.toLocaleString("en-US", { maximumFractionDigits: 2 })}`],
  ];
}

/** the book's pane drawn from what the last read said: the ladder, the spread row, the quiet line — or the refusal's words in the middle */
function bkDrawBook(el, st) {
  const part = (sel) => el.querySelector(sel);
  const asks = part("[data-bk-asks]");
  const bids = part("[data-bk-bids]");
  const mid = part("[data-bk-mid]");
  const note = part("[data-bk-note]");
  if (st.bookNo) {
    paint(asks, "");
    paint(bids, "");
    paint(mid, `<span class="${st.bookNo.quiet ? "bk-wait" : "bk-no"}" role="status">${esc(bkNoWords(st.bookNo, st.wait.book))}</span>`);
    paint(note, "");
    bkTop(el, false);
    bkOld(el, false);
    return;
  }
  const book = st.book;
  if (!book) return;
  // grouped only above 1× the tick: at 1× every level shows at its own price, as the source sent it
  const g = book.depth === "top" ? 1 : st.group;
  const step = Number(st.o.priceStep);
  const lad = bkLadder(book, { rows: st.rows, group: g > 1 && step > 0 ? Number((g * step).toPrecision(12)) : 0 });
  const shown = g;
  // the levels whose size changed since the last draw flash once (bkFlashes); the two names are taken in turn, one per draw. While the
  // stream drives the book (st.live: several draws a second) a level flashes at most once in BK_FLASH_MS, and keeps its flash's name on
  // the draws within it, so its flash runs its whole length rather than being cut by the next draw
  let changed = bkFlashes(st, lad, g);
  const t = Date.now();
  const held = st.live ? st.flashAt || (st.flashAt = new Map()) : null;
  if (held) changed = new Set([...changed].filter((k) => !(held.has(k) && t - held.get(k).at < BK_FLASH_MS)));
  if (changed.size) st.flip = st.flip === "a" ? "b" : "a";
  if (held) {
    for (const k of changed) held.set(k, { at: t, name: st.flip });
    for (const [k, f] of held) if (t - f.at >= BK_FLASH_MS) held.delete(k);
  } else st.flashAt = null;
  const fl = (side, r) => {
    const k = `${side}:${r.p}`;
    if (changed.has(k)) return st.flip;
    return held && held.has(k) ? held.get(k).name : "";
  };
  paint(asks, lad.asks.map((r) => bkRowHtml(r, "ask", st.o, shown, fl("ask", r))).join(""));
  paint(bids, lad.bids.map((r) => bkRowHtml(r, "bid", st.o, shown, fl("bid", r))).join(""));
  st.lad = lad;
  bkCardAgain(el, st);
  paint(mid, !lad.asks.length && !lad.bids.length ? '<span class="bk-wait">No orders on the book just now</span>' : bkSpreadHtml(book, st.o));
  // a book kept while the account does not answer: said over its quiet line, in the warning colour, and the ladder dimmed (bkOld). A book
  // the stream pushes with the deeper levels of the last read beyond its own says which are live (bkLiveLine)
  const top = bkTopLine(book) || bkLiveLine(book);
  paint(note, st.bookOld ? `<span class="bk-oldline" role="status">${esc(bkOldWords(st.bookOld, st.wait.book))}</span>${top ? ` ${esc(top)}` : ""}` : esc(top));
  bkOld(el, !!st.bookOld);
  bkLiveMark(el, !!st.live);
  // a book of its best bid and ask only: the panel says so on its root (book.css centres the two rows and the line under them, rather
  // than leaving them adrift in a ladder's height)
  bkTop(el, book.depth === "top");
  bkGroupShown(el, st);
}
/* the root's mark for a book of its best bid and ask only (C7: bk-top), set and taken away as the reads say */
function bkTop(el, top) {
  const root = el.querySelector(".bk");
  if (root && root.classList && typeof root.classList.toggle === "function") root.classList.toggle("bk-top", !!top);
}
/* the root's mark for a book kept while the account does not answer (bk-old: book.css dims its ladder), set and taken away as the reads say */
function bkOld(el, old) {
  const root = el.querySelector(".bk");
  if (root && root.classList && typeof root.classList.toggle === "function") root.classList.toggle("bk-old", !!old);
}
/* the root's mark for a book the stream drives (bk-live: book.css flashes its changed levels softer) */
function bkLiveMark(el, live) {
  const root = el.querySelector(".bk");
  if (root && root.classList && typeof root.classList.toggle === "function") root.classList.toggle("bk-live", !!live);
}

/** the trades' pane: time, price (coloured by the side that took it, where the source says, with the side in words for a screen reader),
 * size — or the refusal's words */
function bkDrawTrades(el, st) {
  const tape = el.querySelector("[data-bk-tape]");
  if (st.tradesNo) return void paint(tape, `<p class="${st.tradesNo.quiet ? "bk-wait" : "bk-no"}" role="status">${esc(bkNoWords(st.tradesNo, st.wait.trades))}</p>`);
  if (!st.trades) return;
  // the trades kept while the account does not answer: the line over them says since when they were not read
  const old = st.tradesOld ? `<p class="bk-oldline" role="status" data-k="old">${esc(bkOldWords(st.tradesOld, st.wait.trades))}</p>` : "";
  if (!st.trades.length) return void paint(tape, `${old}<p class="bk-wait">No trades just now</p>`);
  // each row keyed by the trade itself (bkTradeKey, and how many of the same came before it): a trade that comes in is a row inserted at
  // the top, and the rows under it are the same elements moved down — never every row's words written again
  const seen = new Map();
  paint(
    tape,
    old +
    st.trades
      .map((t) => {
        const side = t.side === "buy" ? "buy" : t.side === "sell" ? "sell" : "";
        const k = bkTradeKey(t);
        const n = (seen.get(k) || 0) + 1;
        seen.set(k, n);
        return `<div class="bk-trow" data-k="${esc(`t:${k}#${n}`)}"><span class="bk-p${side ? ` bk-${side}` : ""}">${esc(bkPrice(t.price, st.o, 1))}${side ? `<span class="sr"> ${side === "buy" ? "bought" : "sold"}</span>` : ""}</span><span class="bk-s">${esc(bkSize(t.size))}</span><span class="bk-t">${esc(bkClock(t.at))}</span></div>`;
      })
      .join(""),
  );
}

/* ---- the card beside the book (HL's hover card) -------------------------------------------------------------------------------- */
/** The card for one row, beside the panel on its left (HL's place for it), centred on the row: what the row reaches (bkReach), drawn only
 * where a pointer hovers (a touch screen never keeps one stuck) or a row has the keyboard's focus, and only where every size it adds is known.
 * It is laid at a fixed place on the screen; the box it is fixed to is measured (a container on the way to the window holds fixed boxes too),
 * so it lands beside the row wherever the panel is mounted. Gone when the pointer or the focus leaves the rows, when the book is no longer
 * drawn, or when the row is not on it any more */
function bkCardShow(el, st, row) {
  const root = el.querySelector(".bk");
  if (!root || !row || typeof row.getBoundingClientRect !== "function" || !st.book || st.bookNo) return bkCardHide(el, st);
  const side = row.classList && row.classList.contains("bk-ask") ? "ask" : "bid";
  const price = Number(row.dataset.bkPx);
  const reach = bkReach(st.book, side, price);
  if (!reach) return bkCardHide(el, st);
  const part = !!(row.classList && row.classList.contains("bk-part"));
  let card = root.querySelector(".bk-card");
  if (!card) {
    root.insertAdjacentHTML("beforeend", '<div class="bk-card" aria-hidden="true"></div>');
    card = root.querySelector(".bk-card");
  }
  st.cardRow = `${side}:${price}`;
  paint(card, bkReachLines(reach, st.o, part).map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join(""));
  // where the card's fixed box starts on the screen (its own place at 0, 0), then the row and the panel: beside the panel, centred on the row
  card.style.left = "0px";
  card.style.top = "0px";
  card.hidden = false;
  const o = card.getBoundingClientRect();
  const r = row.getBoundingClientRect();
  const b = el.getBoundingClientRect();
  const left = b.left - o.width - 8 >= 0 ? b.left - o.width - 8 : b.right + 8;
  card.style.left = `${Math.round(left - o.left)}px`;
  card.style.top = `${Math.round(Math.max(4, r.top + r.height / 2 - o.height / 2) - o.top)}px`;
}
function bkCardHide(el, st) {
  st.cardRow = "";
  const card = el.querySelector(".bk .bk-card");
  if (card) card.hidden = true;
}
/* the book drawn again while the card shows: the card follows the row it was for (its figures from this read), or goes with it */
function bkCardAgain(el, st) {
  if (!st.cardRow) return;
  const [side, price] = st.cardRow.split(":");
  const row = typeof el.querySelector === "function" ? el.querySelector(`.bk-${side}[data-bk-px="${price}"]`) : null;
  if (row) bkCardShow(el, st, row);
  else bkCardHide(el, st);
}
/* a pointer that hovers (not a finger): the card is for it */
const bkHovers = () => typeof matchMedia === "function" && matchMedia("(hover: hover)").matches;

/** THE SLIDING UNDERLINE, as HL's tab bars draw it: one accent line under the bar that moves to the tab pressed (left and width over .3 s).
 * The bar's --tab-x and --tab-w are set from the pressed tab's own place and width, and its class slide-under draws the line as one ::after
 * the width of that tab and takes the pressed tab's own static line away (book.css for the book's tabs; terminal.css for the tables' and the
 * narrow terminal's, which call this too). Until it has run — a page that cannot measure, a bar with no box — the pressed tab keeps its own
 * static line, so a tab bar is never without one. Called whenever the tab pressed changes and whenever the bar's size changes. `pressed`:
 * how the bar marks the tab pressed, where it is not aria-selected alone (the order panel's Pro, a select: .tk-pro.on) */
function bkSlideUnder(bar, pressed = '[aria-selected="true"]') {
  if (!bar || typeof bar.querySelector !== "function" || !bar.style || typeof bar.style.setProperty !== "function") return;
  const on = bar.querySelector(pressed);
  if (!on || !(on.offsetWidth > 0)) return;
  bar.style.setProperty("--tab-x", `${on.offsetLeft}px`);
  bar.style.setProperty("--tab-w", `${on.offsetWidth}px`);
  if (bar.classList && typeof bar.classList.add === "function") bar.classList.add("slide-under");
}

/** the tab showing, on the tabs and the panes (set directly: the frame is not drawn again for it), its line slid under it */
function bkShowTab(el, st) {
  for (const b of el.querySelectorAll("[data-bk-tab]")) b.setAttribute("aria-selected", String(b.dataset.bkTab === st.tab));
  for (const p of el.querySelectorAll("[data-bk-pane]")) p.hidden = p.dataset.bkPane !== st.tab;
  bkSlideUnder(el.querySelector(".bk-tabs"));
  bkGroupShown(el, st);
}

/** the grouping is the book's: it stands aside while the trades show, and for a book of its best bid and ask only (nothing to group) */
function bkGroupShown(el, st) {
  const gw = el.querySelector(".bk-gw");
  if (gw) gw.hidden = st.tab !== "book" || !!(st.book && st.book.depth === "top");
}

/** the browser's own words for a request that never reached the account — a stopped service, a dropped connection ("Failed to fetch",
 * "Load failed", "NetworkError when attempting to fetch resource.") — or for an answer that was not the account's (a gateway's "502 Bad
 * Gateway"): core api gives either as { ok: false, error } with no refusal */
const BK_UNANSWERED = /^(Failed to fetch|Load failed|NetworkError\b|fetch failed|The network connection was lost|The Internet connection appears to be offline|The account did not answer\b|\d{3}\b)/i;
/** a read the account did not answer: no body at all, or core api's { ok: false, error } for a request that never reached it — or that it
 * let go unanswered after its timeout (`b` may be
 * that body, or the words a read already took from one). Never a refusal: that is the account's own sentence, and an error the account
 * wrote itself (its 500's "The account hit an error answering this") is its own words too */
function bkUnanswered(b) {
  if (b === undefined || b === null) return true;
  if (typeof b === "string") return BK_UNANSWERED.test(b.trim());
  if (b.ok !== false || b.refusal) return false;
  const e = String(b.error || "").trim();
  return !e || BK_UNANSWERED.test(e);
}
/** a refusal's words in the panel: a source that publishes no book or no trades (E_VENUE_RAIL_CLOSED) said quietly, as a fact of the
 * source; the account not answering at all in the page's own words (never the browser's error as it was thrown); any other refusal — a
 * place rule, a venue not connected — in its own words; all but the quiet ones in the warning colour */
function bkSaid(body, fallback) {
  if (bkUnanswered(body)) return { words: "The account is not answering", quiet: false, unanswered: true };
  const words = refusalOf(body) || fallback;
  const quiet = !!(body && body.refusal && body.refusal.code === "E_VENUE_RAIL_CLOSED");
  return { words, quiet };
}
/** what the panel says of a read that failed: its words (bkSaid) and — but for a source's quiet fact — how long it now waits between asks
 * (bkMissed: two seconds, doubling, at most a minute), so a panel that has gone still says it is still asking */
function bkNoWords(no, wait) {
  const words = String(no.words || "").replace(/[.\s]+$/, "");
  return no.quiet || !(wait > 0) ? words : `${words}. Asking again every ${Math.round(wait / 1000)} s.`;
}
/** the line over a book or trades kept while the account does not answer: since when they were not read (the viewer's clock, as the
 * book's own times are), why, and how long it now waits between asks */
function bkOldWords(since, wait) {
  return bkNoWords({ words: `Not read since ${bkClock(since)}: the account is not answering` }, wait);
}
/** a refused read of `what` ("book" or "trades") is asked again later each time: two seconds, then twice as long each refusal more, at
 * most a minute; an answer resets it, so the next read is on the tab's own beat again */
function bkMissed(st, what, refused) {
  if (!refused) {
    st.wait[what] = 0;
    st.next[what] = 0;
    return;
  }
  st.wait[what] = Math.min(BK_BACKOFF_MAX_MS, Math.max(BK_BACKOFF_MS, st.wait[what] * 2));
  st.next[what] = Date.now() + st.wait[what];
}

// ---- reading -----------------------------------------------------------------------------------------------------------------------------

/** How many rows a side fit the panel: the ladder's halves are drawn a whole number of rows high (book.css, --bk-n), the panel's own box
 * fills its place without its rows pushing it taller, so the count follows the place and never the data. Rows the caller gave stand. True
 * when the count changed */
function bkFit(el, st) {
  if (st.fixed) return false;
  // only in a column of a flexbox (the terminal's .tt-book), where the panel takes its place's height and adds none of its own: anywhere
  // else its height would be its rows', and fitting rows to it would only ever shrink them
  let host = null;
  try {
    host = typeof getComputedStyle === "function" ? getComputedStyle(el) : null;
  } catch {
    host = null;
  }
  if (!host || !String(host.display).includes("flex") || !String(host.flexDirection).startsWith("column")) return false;
  const root = el.querySelector(".bk");
  const h = root ? Number(root.clientHeight) : NaN;
  if (!(h > 0)) return false;
  // the row's pitch: its own height as the stylesheet sets it (--bk-row) and the gap under it, else HL's 23 and 2
  let row = NaN;
  try {
    row = parseFloat(getComputedStyle(root).getPropertyValue("--bk-row"));
  } catch {
    row = NaN;
  }
  const pitch = row > 0 ? row + BK_GAP_PX : BK_ROW_PX;
  const n = Math.max(3, Math.min(25, Math.floor((h - BK_CHROME_PX) / (2 * pitch))));
  if (root.style && typeof root.style.setProperty === "function") root.style.setProperty("--bk-n", String(n));
  if (n === st.rows) return false;
  st.rows = n;
  return true;
}

/** the panel is laid out: it has a box on the page. A pane the page has put aside (shell.js hides a pane with `hidden` when the owner moves
 * to another, and keeps it in the document) has none, and neither has anything inside it — as chart.js chLaidOut asks. An element that
 * cannot say is taken as laid out */
function bkLaidOut(el) {
  return typeof el.getClientRects !== "function" || el.getClientRects().length > 0;
}

/** the panel may read now: it is the one mounted for its market, in the document, laid out (its pane not put aside) and the page shows. A
 * panel found out of the document on one of its beats has been taken off the page: it stops itself (`letGo`; not while it is being
 * mounted, which may come before its element is placed). A panel in a pane put aside only waits: its beats go on, asking nothing, and it
 * reads again once its pane comes back */
function bkLive(el, st, letGo = true) {
  if (!st.alive || BK.get(el) !== st) return false;
  if (el.isConnected === false) {
    if (letGo) bkRelease(el);
    return false;
  }
  if (!bkLaidOut(el)) return false;
  return !(typeof document !== "undefined" && document.visibilityState === "hidden");
}

/** one read of the book for the market this state is for: an answer that comes back after the panel moved to another market (or was
 * released), or after a later read already drew, is dropped */
async function bkReadBook(el, st) {
  const ask = ++st.bookAsked;
  const depth = st.group > 1 ? 50 : 20;
  st.readAt.book = Date.now();
  const body = await api(`/api/account/book?${new URLSearchParams({ venue: st.o.venue, symbol: st.o.symbol, depth: String(depth) })}`);
  if (BK.get(el) !== st || !st.alive || ask < st.bookDrawn) return;
  st.bookDrawn = ask;
  const read = !!(body && body.ok && body.book);
  // what the stream pushes is fresh: the read is the depth beyond a shallow stream's levels (bkCompose), and a read that failed takes
  // nothing away from the book the stream keeps drawing
  if (bkPushed(st, "book")) {
    if (read) {
      st.rest = body.book;
      st.restAt = Date.now();
      st.book = bkCompose(st.pushBook, st.rest, bkNeed(st));
    }
    bkMissed(st, "book", !read);
    return void bkDrawBook(el, st);
  }
  st.live = false;
  if (read) {
    st.book = body.book;
    st.rest = body.book;
    st.restAt = Date.now();
    st.bookNo = null;
    st.bookAt = Date.now();
    st.bookOld = 0;
  } else if (st.book && bkUnanswered(body)) {
    // the account did not answer: the book last read stays, dimmed, said as not read since then — never passed off as live
    st.bookOld = st.bookAt || Date.now();
  } else {
    st.book = null;
    st.bookOld = 0;
    st.bookNo = bkSaid(body, "The book could not be read just now");
  }
  bkMissed(st, "book", !read);
  bkDrawBook(el, st);
}

/** one read of the latest trades, on the same terms. A source that publishes no trades the account can read is an answer, not a refusal
 * (C7: HTTP 200, `none` in its words; an older account refused it, E_VENUE_RAIL_CLOSED, and is heard the same way): its words, said
 * quietly, and no more asking until the market or the tab changes (st.tradesQuiet) */
async function bkReadTrades(el, st) {
  const ask = ++st.tradesAsked;
  st.readAt.trades = Date.now();
  const body = await api(`/api/account/trades?${new URLSearchParams({ venue: st.o.venue, symbol: st.o.symbol, limit: String(BK_TRADES) })}`);
  if (BK.get(el) !== st || !st.alive || ask < st.tradesDrawn) return;
  st.tradesDrawn = ask;
  const none = body && body.ok && typeof body.none === "string" && body.none.trim() ? body.none.trim() : "";
  // the stream pushes the market's trades: a read's are laid into the same tape (each trade once), and a read that failed takes nothing
  // away from it
  if (bkPushed(st, "trades")) {
    const read = !!(body && body.ok && Array.isArray(body.trades));
    if (read) st.trades = bkMergeTrades(st.trades, body.trades);
    bkMissed(st, "trades", !read);
    return void bkDrawTrades(el, st);
  }
  if (none) {
    st.trades = null;
    st.tradesNo = { words: none, quiet: true };
    st.tradesOld = 0;
  } else if (body && body.ok && Array.isArray(body.trades)) {
    st.trades = body.trades;
    st.tradesNo = null;
    st.tradesAt = Date.now();
    st.tradesOld = 0;
  } else if (st.trades && bkUnanswered(body)) {
    // the account did not answer: the trades last read stay, under a line that says since when
    st.tradesOld = st.tradesAt || Date.now();
  } else {
    st.trades = null;
    st.tradesOld = 0;
    st.tradesNo = bkSaid(body, "The trades could not be read just now");
  }
  st.tradesQuiet = !!(st.tradesNo && st.tradesNo.quiet);
  bkMissed(st, "trades", !!st.tradesOld || (!!st.tradesNo && !st.tradesQuiet));
  bkDrawTrades(el, st);
}
/* the read `what` may be asked on its beat now: its tab showing, not quiet (trades a source does not publish), not waiting out a refusal —
   and, while the stream pushes it whole (a book as deep as the ladder needs, the trades), only once in BK_SLOW_MS */
const bkDue = (st, what) => st.tab === what && !(what === "trades" && st.tradesQuiet) && Date.now() >= st.next[what] && !(bkPushed(st, what) && (what === "trades" || !(st.book && st.book.short)) && Date.now() - st.readAt[what] < BK_SLOW_MS);
/* what the stream pushes of the market (its book or its trades) is fresh: it came within BK_PUSH_FRESH_MS, live, and the stream is connected */
const bkPushed = (st, what) => st.heard[what] > 0 && Date.now() - st.heard[what] < BK_PUSH_FRESH_MS && (typeof stHealth !== "function" || stHealth() === "connected");
/* how many levels a side the ladder needs drawn from a pushed book alone: its rows at 1× the tick; grouped, the fifty a side a read asks */
const bkNeed = (st) => (st.group > 1 ? 50 : st.rows);

/** THE BOOK THE STREAM PUSHED for a panel's market (ui/stream.js book event): drawn in the next frame — its own levels, with the last read's
 * deeper ones beyond them where it sends fewer than the ladder needs (bkCompose) — and the reads slowed while it comes whole. One that says
 * its market is not live (the stream lost it) puts the reads back on their beat at once */
function bkPushedBook(st, d) {
  if (!d || d.live !== true || !Array.isArray(d.bids) || !Array.isArray(d.asks)) {
    st.heard.book = 0;
    st.pushBook = null;
    st.next.book = 0;
    return;
  }
  st.pushBook = d;
  st.heard.book = Date.now();
  st.live = true;
  st.book = bkCompose(d, st.rest && Date.now() - st.restAt <= BK_STITCH_MS ? st.rest : null, bkNeed(st));
  st.bookNo = null;
  st.bookOld = 0;
  st.bookAt = Date.now();
  bkSoon(st, "book");
}
/** THE TRADES THE STREAM PUSHED (the market's latest, newest first): laid into the tape — each once, newest first — and drawn in the next
 * frame. Trades that come with the word that the market is not live are still the venue's own (laid in), but the reads are on their beat
 * again at once */
function bkPushedTrades(st, d) {
  if (!d || !Array.isArray(d.trades)) return;
  if (d.live === true) st.heard.trades = Date.now();
  else {
    st.heard.trades = 0;
    st.next.trades = 0;
  }
  if (!d.trades.length) return;
  st.trades = bkMergeTrades(d.trades, st.trades);
  st.tradesNo = null;
  st.tradesOld = 0;
  st.tradesAt = Date.now();
  st.tradesQuiet = false;
  bkSoon(st, "trades");
}
/** what was pushed drawn once, in the next frame, however much came meanwhile — only the tab showing, and only while the panel is on the
 * page and laid out (otherwise it is kept, and drawn when its tab or its pane comes back) */
function bkSoon(st, what) {
  st.due[what] = true;
  if (st.queued) return;
  st.queued = true;
  nextFrame(() => {
    st.queued = false;
    if (!bkLive(st.el, st)) return;
    for (const w of ["book", "trades"]) {
      if (!st.due[w] || st.tab !== w) continue;
      st.due[w] = false;
      if (w === "book") bkDrawBook(st.el, st);
      else bkDrawTrades(st.el, st);
    }
  });
}
/* the pushed book and trades, each to the panels mounted on its market; the stream no longer connected: the reads are on their beat again */
if (typeof stOn === "function") {
  const each = (d, fn) => {
    if (!d || typeof d.venue !== "string") return;
    for (const st of [...BK_LIVE]) if (st.alive && st.o.venue === d.venue && st.o.symbol === d.symbol) fn(st, d);
  };
  stOn("book", (d) => each(d, bkPushedBook));
  stOn("trades", (d) => each(d, bkPushedTrades));
  stOn("health", (h) => {
    if (h === "connected") return;
    for (const st of BK_LIVE) {
      st.heard.book = 0;
      st.heard.trades = 0;
    }
  });
}

/** the next read of `what` in `ms`, while the panel lives; a read only while its tab shows and the page is visible */
function bkLoop(el, st, what, ms) {
  const tick = () => {
    if (!st.alive || BK.get(el) !== st) return;
    if (bkLive(el, st) && bkDue(st, what)) void (what === "book" ? bkReadBook(el, st) : bkReadTrades(el, st)).catch(() => undefined);
    if (st.alive) st.timers[what] = setTimeout(tick, ms);
  };
  st.timers[what] = setTimeout(tick, ms);
}

/** the panel's listeners, once per element: a tab pressed, the grouping changed, a row of the ladder pressed (or Enter / Space on it) */
function bkWire(el) {
  if (BK_WIRED.has(el) || typeof el.addEventListener !== "function") return;
  BK_WIRED.add(el);
  const press = (target) => {
    const st = BK.get(el);
    if (!st || !target || typeof target.closest !== "function") return false;
    const tab = target.closest("[data-bk-tab]");
    if (tab && el.contains(tab)) {
      const want = tab.dataset.bkTab === "trades" ? "trades" : "book";
      if (want !== st.tab) {
        st.tab = want;
        bkCardHide(el, st);
        bkShowTab(el, st);
        // the tab coming in is read at once, then on its own beat: pressing it asks again whatever the last read said (a source that
        // publishes no trades is asked once more, and is quiet again if it still does not)
        st.tradesQuiet = false;
        st.next[want] = 0;
        // what the stream pushed for it while it was not showing, drawn now rather than after the read
        if (st.due[want]) {
          st.due[want] = false;
          if (want === "book") bkDrawBook(el, st);
          else bkDrawTrades(el, st);
        }
        void (want === "book" ? bkReadBook(el, st) : bkReadTrades(el, st)).catch(() => undefined);
      }
      return true;
    }
    const row = target.closest("[data-bk-px]");
    if (row && el.contains(row)) {
      const p = Number(row.dataset.bkPx);
      if (p > 0 && typeof st.o.onPrice === "function") st.o.onPrice(p);
      return true;
    }
    return false;
  };
  el.addEventListener("click", (e) => void press(e.target));
  // the card beside the book: a row under a hovering pointer, or a row with the keyboard's focus
  const rowOf = (t) => (t && typeof t.closest === "function" ? t.closest("[data-bk-px]") : null);
  el.addEventListener("mouseover", (e) => {
    const st = BK.get(el);
    const row = rowOf(e.target);
    if (!st || !bkHovers()) return;
    // between two rows (the two pixels that part them) the card stays as it is; anywhere else off the rows it goes
    const inLadder = !!(e.target && typeof e.target.closest === "function" && e.target.closest(".bk-ladder"));
    if (!row || !el.contains(row)) return void (st.cardRow && !inLadder && bkCardHide(el, st));
    if (st.cardRow !== `${row.classList.contains("bk-ask") ? "ask" : "bid"}:${Number(row.dataset.bkPx)}`) bkCardShow(el, st, row);
  });
  el.addEventListener("mouseleave", () => {
    const st = BK.get(el);
    if (st) bkCardHide(el, st);
  });
  el.addEventListener("focusin", (e) => {
    const st = BK.get(el);
    const row = rowOf(e.target);
    if (st && row && el.contains(row)) bkCardShow(el, st, row);
  });
  el.addEventListener("focusout", () => {
    const st = BK.get(el);
    if (st) bkCardHide(el, st);
  });
  el.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target && e.target.dataset && e.target.dataset.bkPx !== undefined && press(e.target)) return void e.preventDefault();
    // THE BOOK IS ONE TAB STOP (its rows are not: tabbing through forty levels to reach the order panel is no way to trade): from the ladder,
    // ↑ goes to the best ask and ↓ to the best bid; on a level, ↑ and ↓ move to the next one up or down, Home and End to the ends
    const t = e.target;
    if (!t || !["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key) || typeof t.closest !== "function") return;
    const lad = t.closest(".bk-ladder");
    if (!lad || !el.contains(lad)) return;
    const rows = [...lad.querySelectorAll("[data-bk-px]")];
    if (!rows.length) return;
    const at = rows.indexOf(t);
    const asks = lad.querySelectorAll(".bk-asks [data-bk-px]").length;
    let to;
    if (e.key === "Home") to = rows[0];
    else if (e.key === "End") to = rows[rows.length - 1];
    else if (at < 0) to = e.key === "ArrowUp" ? rows[Math.max(0, asks - 1)] : rows[Math.min(rows.length - 1, asks)];
    else to = rows[Math.max(0, Math.min(rows.length - 1, at + (e.key === "ArrowUp" ? -1 : 1)))];
    if (!to) return;
    e.preventDefault();
    to.focus({ preventScroll: true });
  });
  el.addEventListener("change", (e) => {
    const st = BK.get(el);
    const sel = e.target;
    if (!st || !sel || !sel.matches || !sel.matches("[data-bk-group]")) return;
    const k = Number(sel.value);
    st.group = k >= 1 ? k : 1;
    // the stream's book laid over the last read again for the depth this grouping needs
    if (st.pushBook && bkPushed(st, "book")) st.book = bkCompose(st.pushBook, st.rest, bkNeed(st));
    bkDrawBook(el, st);
    void bkReadBook(el, st).catch(() => undefined);
  });
}

/** Draw the panel into `el` for one market and keep it fresh (see the top of this file). Mounting the same element again — another market,
 * the same one — starts afresh: what was on its way for the market before is dropped */
function bkMount(el, o) {
  if (!el || !o || !o.venue || !o.symbol) return;
  bkRelease(el);
  const fixed = Number.isInteger(o.rows) && o.rows > 0 && o.rows <= 50;
  // what the stream pushed (heard: when, by what; pushBook its last book), the last read's book (rest, restAt: what lies beyond a shallow
  // stream's levels), when each read was last asked, whether the book drawn is the stream's (live), the draws waiting for the next frame
  const st = { key: `${o.venue}|${o.symbol}`, el, o, rows: fixed ? o.rows : BK_ROWS, fixed, tab: "book", group: 1, book: null, bookNo: null, bookAt: 0, bookOld: 0, trades: null, tradesNo: null, tradesAt: 0, tradesOld: 0, tradesQuiet: false, bookAsked: 0, bookDrawn: 0, tradesAsked: 0, tradesDrawn: 0, wait: { book: 0, trades: 0 }, next: { book: 0, trades: 0 }, timers: {}, alive: true, watch: null, sizes: null, sizesAt: 0, flip: "", cardRow: "", lad: null, heard: { book: 0, trades: 0 }, pushBook: null, rest: null, restAt: 0, readAt: { book: 0, trades: 0 }, live: false, flashAt: null, due: { book: false, trades: false }, queued: false };
  BK.set(el, st);
  BK_LIVE.add(st);
  paint(el, bkFrame(st));
  bkShowTab(el, st);
  // the rows a side: the caller's, else as many as the panel holds — and again whenever its size changes, the book drawn again from what
  // was read (nothing is asked for it)
  const root = el.querySelector(".bk");
  if (fixed && root && root.style && typeof root.style.setProperty === "function") root.style.setProperty("--bk-n", String(st.rows));
  bkFit(el, st);
  // its size watched: the rows refitted, and — its pane coming back after being put aside (its box from none to some) — the tab showing
  // read at once, not on its next beat
  st.shown = bkLaidOut(el);
  if (typeof ResizeObserver === "function") {
    st.watch = new ResizeObserver(() => {
      if (BK.get(el) !== st) return;
      // the two tabs share the panel's width: the line under the one showing follows it
      bkSlideUnder(el.querySelector(".bk-tabs"));
      if (bkFit(el, st)) bkDrawBook(el, st);
      const was = st.shown;
      st.shown = bkLaidOut(el);
      if (st.shown && !was && bkLive(el, st) && bkDue(st, st.tab)) void (st.tab === "book" ? bkReadBook(el, st) : bkReadTrades(el, st)).catch(() => undefined);
    });
    st.watch.observe(el);
  }
  const sel = el.querySelector("[data-bk-group]");
  if (sel) sel.value = "1";
  bkWire(el);
  if (bkLive(el, st, false)) void bkReadBook(el, st).catch(() => undefined);
  bkLoop(el, st, "book", BK_BOOK_MS);
  bkLoop(el, st, "trades", BK_TRADES_MS);
}

/** Stop the panel in `el`: its timers, and whatever is on its way is dropped. What it drew stays until something else is drawn there */
function bkRelease(el) {
  const st = el ? BK.get(el) : undefined;
  if (!st) return;
  st.alive = false;
  for (const t of Object.values(st.timers)) clearTimeout(t);
  if (st.watch) st.watch.disconnect();
  BK.delete(el);
  BK_LIVE.delete(st);
}
