/* LIVE POSITIONS: what the owner (or the desk) bought, watched as it moves — the one card both the Portfolio ("Open positions · live")
   and the desk's open leads are drawn with, and the poll that keeps it moving.
   A card is one thing held with a known cost: the market it is priced at (venue|symbol), the entry, the size, the plan where there is one
   (a take-profit and a stop, the desk's). The poll asks the account for fresh prices every few seconds (GET /api/account/quotes, twelve
   markets a read, only while a card is on the page and the page is in view), and writes every card in one frame: the price, the
   unrealised result and its percent (tinted up or down for a moment, shell.css .tick-up · .tick-down), the marker on the ladder (a
   transform: nothing is laid out again), and a sparkline of the prices this page has seen. Under reduced motion nothing moves but the
   figures. Nothing here is estimated: a card without a fresh price keeps the last figure the account gave and says when it is from.

   lvCard(p)          the card's HTML; p = { key, symbol, name, venue, venueName, kind, side, qty, entry, mark, costUsd, unrealizedUsd,
                      roiPct, paper, leverage, tpPct, slPct, since, lead, fmt ("usd" | "c" for an event contract's cents), unit,
                      close ({ kind: "close", position } · { kind: "sell", venue, symbol, qty }) }
   lvWatch(el)        the cards in `el` are watched: the poll starts (or goes on) for them; lvRelease(el) when they go
   lvFresh(venue, symbol) the last fresh quote this page saw for a market */

const LV = { quotes: new Map(), history: new Map(), timer: 0, inFlight: false, roots: new Set(), listeners: new Set() };
/** told after every write of the cards: what sums them (the desk's equity) sums the fresh figures. The card's result is on it as a number
 * (lvResult) */
const lvOnWrite = (fn) => void LV.listeners.add(fn);
/** one card's unrealised result from the last fresh price, or null before one came */
function lvResult(card) {
  const q = LV.quotes.get(card.dataset.lvQ);
  return q ? lvPnl(card.dataset, q.price) : null;
}
const LV_EVERY_MS = 5_000;
const LV_HISTORY = 90;

/* a price as the card shows it: dollars, or an event contract's cents */
const lvPx = (n, fmt) => (fmt === "c" ? cents(n) : usd(n));
/* a signed result: +$1.20 · -$0.40 */
const lvSigned = (n) => `${num(n) >= 0 ? "+" : "-"}${money(Math.abs(num(n))).replace(/^-/, "")}`;
const lvPct = (n) => `${num(n) >= 0 ? "+" : ""}${num(n).toFixed(2)}%`;
/* the unrealised result of one card from its own figures: side × (mark − entry) × qty × contract, less the fees paid */
function lvPnl(d, mark) {
  const dir = d.side === "short" ? -1 : 1;
  const entry = Number(d.entry);
  const qty = Number(d.qty);
  const cs = Number(d.cs || 1);
  if (!Number.isFinite(entry) || !Number.isFinite(qty) || !Number.isFinite(mark)) return null;
  const pnl = dir * (mark - entry) * qty * cs - Number(d.fee || 0);
  const size = Number(d.size);
  return { pnl, pct: size > 0 ? (pnl / size) * 100 : 0 };
}
/* where the marker stands on the ladder: entry, mark, the stop and the take-profit laid on one line, a tenth of room either side */
function lvLadder(d, mark) {
  const entry = Number(d.entry);
  const pts = [entry, mark, d.tp ? Number(d.tp) : NaN, d.sl ? Number(d.sl) : NaN].filter((x) => Number.isFinite(x));
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const span = hi - lo || Math.abs(entry) * 0.02 || 1;
  const at = (x) => ((x - (lo - span * 0.1)) / (span * 1.2)) * 100;
  return { at, lo, hi };
}

/** one card. The figures the poll writes carry data attributes with the card's own numbers, so a fresh price alone is enough to redraw it */
function lvCard(p) {
  const fmt = p.fmt || (p.kind === "event" ? "c" : "usd");
  const side = p.side === "short" ? "short" : "long";
  const pair = `${p.venue}|${p.symbol}`;
  const mark = Number.isFinite(Number(p.mark)) ? Number(p.mark) : undefined;
  const r = mark !== undefined ? lvPnl({ side, entry: p.entry, qty: p.qty, cs: p.cs, fee: p.fee, size: p.costUsd }, mark) : null;
  const pnl = r ? r.pnl : num(p.unrealizedUsd);
  const pct = r ? r.pct : num(p.roiPct);
  const tp = p.tpPct !== undefined && p.tpPct !== null ? Number(p.entry) * (1 + (side === "long" ? 1 : -1) * (Number(p.tpPct) / 100)) : undefined;
  const sl = p.slPct !== undefined && p.slPct !== null ? Number(p.entry) * (1 - (side === "long" ? 1 : -1) * (Number(p.slPct) / 100)) : undefined;
  const lad = lvLadder({ entry: p.entry, tp, sl }, mark !== undefined ? mark : Number(p.entry));
  const x = (v) => Math.max(0, Math.min(100, lad.at(v))).toFixed(1);
  const cls = pnl > 0 ? "up" : pnl < 0 ? "down" : "flat";
  const chips = [p.paper ? '<span class="tag paper">Paper</span>' : "", `<span class="tag ${side === "long" ? "up" : "warn"}">${side === "long" ? "Long" : "Short"}${p.leverage && Number(p.leverage) > 1 ? ` ${esc(String(p.leverage))}x` : ""}</span>`, p.lead ? `<span class="tag mono">${esc(p.lead)}</span>` : ""].filter(Boolean).join("");
  const close = p.close ? `<button type="button" class="btn btn-sm" data-lv-close="${esc(JSON.stringify(p.close))}">${p.close.kind === "sell" ? "Sell" : "Close"}</button>` : "";
  const data = `data-lv-q="${esc(pair)}" data-fmt="${fmt}" data-side="${side}" data-entry="${esc(String(p.entry))}" data-qty="${esc(String(p.qty))}" data-cs="${esc(String(p.cs || 1))}" data-fee="${esc(String(p.fee || 0))}" data-size="${esc(String(p.costUsd || 0))}"${tp !== undefined ? ` data-tp="${esc(String(tp))}"` : ""}${sl !== undefined ? ` data-sl="${esc(String(sl))}"` : ""}`;
  return `<article class="lv-card" data-k="${esc(p.key)}" ${data}>
    <header class="lv-head"><div class="who">${avatar(p.symbol.split(/[/:@-]/)[0] || p.symbol, "sm")}<div><b>${esc(p.name || p.symbol)}</b><span class="dim">${esc(p.symbol)} · ${esc(p.venueName || nameOf(p.venue))}</span></div></div><div class="lv-chips">${chips}</div></header>
    <div class="lv-ladder" aria-hidden="true">
      <div class="lv-track"></div>
      ${sl !== undefined ? `<div class="lv-mark lv-sl" style="left:${x(sl)}%"><span>SL ${lvPx(sl, fmt)}</span></div>` : ""}
      <div class="lv-mark lv-entry" style="left:${x(Number(p.entry))}%"><span>Entry ${lvPx(p.entry, fmt)}</span></div>
      ${tp !== undefined ? `<div class="lv-mark lv-tp" style="left:${x(tp)}%"><span>TP ${lvPx(tp, fmt)}</span></div>` : ""}
      <div class="lv-now" style="--x:${mark !== undefined ? x(mark) : x(Number(p.entry))}"><span class="lv-dot"></span><span class="lv-now-t" data-lv-price>${mark !== undefined ? lvPx(mark, fmt) : "—"}</span></div>
    </div>
    <div class="lv-body">
      <div><div class="label">Unrealised</div><div class="num-m lv-pnl ${cls}" data-lv-pnl>${lvSigned(pnl)}</div><div class="lv-pct ${cls}" data-lv-pct><span class="sr">${pnl >= 0 ? "up" : "down"} </span>${lvPct(pct)}</div></div>
      <svg class="lv-spark" viewBox="0 0 100 30" preserveAspectRatio="none" data-lv-spark aria-hidden="true"><path class="lv-line" d=""></path></svg>
    </div>
    <footer class="lv-foot"><span class="dim small">${esc(money(p.costUsd || 0))} in · ${esc(qtyOf(p.qty))} ${esc(p.unit || p.symbol.split(/[/:@-]/)[0] || "")}${p.since ? ` · since ${esc(nyDay(p.since))} ${esc(nyTime(p.since))}` : ""}<span class="lv-asof" data-lv-asof></span></span>${close}</footer>
  </article>`;
}

/** the last fresh quote this page saw for a market */
function lvFresh(venue, symbol) {
  return LV.quotes.get(`${venue}|${symbol}`) || null;
}

/* the cards in an element are watched: a root is remembered until it is released; the poll runs while any root holds a card */
function lvWatch(el) {
  if (!el) return;
  LV.roots.add(el);
  lvArm();
  // a first price for what has none yet comes at once, not after the first interval
  if (!LV.inFlight) void lvPoll();
}
function lvRelease(el) {
  LV.roots.delete(el);
  if (!lvCards().length) lvStop();
}
const lvCards = () => [...LV.roots].filter((r) => r.isConnected).flatMap((r) => [...r.querySelectorAll(".lv-card[data-lv-q]")]);
function lvArm() {
  if (LV.timer) return;
  LV.timer = setInterval(() => void lvPoll(), LV_EVERY_MS);
}
function lvStop() {
  if (LV.timer) clearInterval(LV.timer);
  LV.timer = 0;
}
/** fresh prices for every card on the page: twelve markets a read, the rest on the next; written in one frame */
async function lvPoll() {
  if (LV.inFlight || document.hidden || !A) return;
  const cards = lvCards();
  if (!cards.length) return void lvStop();
  const pairs = [...new Set(cards.map((c) => c.dataset.lvQ))];
  LV.inFlight = true;
  try {
    for (let i = 0; i < pairs.length; i += 12) {
      const chunk = pairs.slice(i, i + 12);
      const body = await api(`/api/account/quotes?pairs=${encodeURIComponent(chunk.join(","))}`);
      if (!body || body.ok === false || !Array.isArray(body.quotes)) continue;
      const now = Date.now();
      for (const q of body.quotes) {
        if (!q.market) continue;
        const key = `${q.venue}|${q.symbol}`;
        const price = Number.isFinite(Number(q.market.price)) ? Number(q.market.price) : Number.isFinite(Number(q.market.bid)) && Number.isFinite(Number(q.market.ask)) ? (Number(q.market.bid) + Number(q.market.ask)) / 2 : undefined;
        if (price === undefined) continue;
        // the price's own moment where its market says it (a paper account's: when its source's venue answered), never the moment this
        // page read it: a kept listing is not passed off as now
        const own = Date.parse(String(q.market.quoteAt || ""));
        const at = Number.isFinite(own) ? own : now;
        LV.quotes.set(key, { at, price, bid: q.market.bid, ask: q.market.ask, market: q.market });
        const h = LV.history.get(key) || [];
        if (!h.length || h[h.length - 1][1] !== price) h.push([at, price]);
        if (h.length > LV_HISTORY) h.splice(0, h.length - LV_HISTORY);
        LV.history.set(key, h);
      }
    }
  } finally {
    LV.inFlight = false;
  }
  nextFrame(lvWrite);
}
/* every card written from the fresh prices: only what changed, the figure tinted when it moved */
function lvWrite() {
  for (const card of lvCards()) {
    const q = LV.quotes.get(card.dataset.lvQ);
    if (!q) continue;
    const d = card.dataset;
    const fmt = d.fmt || "usd";
    const priceEl = card.querySelector("[data-lv-price]");
    const t = lvPx(q.price, fmt);
    const moved = priceEl && priceEl.textContent !== t;
    if (priceEl && moved) {
      const was = Number(String(priceEl.textContent).replace(/[^0-9.-]/g, ""));
      setText(priceEl, t);
      if (Number.isFinite(was) && was !== q.price) lvFlash(priceEl, q.price > was);
    }
    const r = lvPnl(d, q.price);
    if (r) {
      const pnlEl = card.querySelector("[data-lv-pnl]");
      const pctEl = card.querySelector("[data-lv-pct]");
      const cls = r.pnl > 0 ? "up" : r.pnl < 0 ? "down" : "flat";
      const s = lvSigned(r.pnl);
      if (pnlEl && pnlEl.textContent !== s) {
        const wasN = Number(String(pnlEl.textContent).replace(/[^0-9.-]/g, "")) * (String(pnlEl.textContent).startsWith("-") ? -1 : 1);
        setText(pnlEl, s);
        pnlEl.className = `num-m lv-pnl ${cls}`;
        if (Number.isFinite(wasN)) lvFlash(pnlEl, r.pnl > wasN);
      }
      if (pctEl) {
        const pt = lvPct(r.pct);
        if (pctEl.textContent.replace(/^(up|down) /, "") !== pt) pctEl.innerHTML = `<span class="sr">${r.pnl >= 0 ? "up" : "down"} </span>${esc(pt)}`;
        pctEl.className = `lv-pct ${cls}`;
      }
      // the marker slides to the price: a transform of the track-wide element, so nothing is laid out again
      const now = card.querySelector(".lv-now");
      if (now) {
        const lad = lvLadder(d, q.price);
        const x = Math.max(0, Math.min(100, lad.at(q.price))).toFixed(1);
        if (now.style.getPropertyValue("--x") !== x) now.style.setProperty("--x", x);
      }
    }
    // when the price is from, and how old it is once it is not the last few seconds' (core ageWords)
    const asof = card.querySelector("[data-lv-asof]");
    const age = ageWords(q.at);
    if (asof) setText(asof, ` · ${nyTime(q.at)}${age ? ` (${age})` : ""}`);
    lvSpark(card, LV.history.get(card.dataset.lvQ) || []);
  }
  for (const fn of LV.listeners) {
    try {
      fn();
    } catch (err) {
      console.error(err);
    }
  }
}
/* the tint (shell.css .tick-up · .tick-down): on for 160 ms, then off */
function lvFlash(el, up) {
  if (still() || !el.classList) return;
  el.classList.remove("tick-up", "tick-down");
  el.classList.add(up ? "tick-up" : "tick-down");
  clearTimeout(el.lvFlashing);
  el.lvFlashing = setTimeout(() => el.classList.remove("tick-up", "tick-down"), 160);
}
/* the sparkline of the prices this page has seen for the card's market: the path alone is rewritten */
function lvSpark(card, h) {
  const path = card.querySelector("[data-lv-spark] path");
  if (!path) return;
  if (h.length < 2) return void (path.getAttribute("d") !== "" && path.setAttribute("d", ""));
  const lo = Math.min(...h.map((p) => p[1]));
  const hi = Math.max(...h.map((p) => p[1]));
  const span = hi - lo || 1;
  const d = h.map((p, i) => `${i ? "L" : "M"}${((i / (h.length - 1)) * 100).toFixed(2)},${(28 - ((p[1] - lo) / span) * 26 + 1).toFixed(2)}`).join(" ");
  if (path.getAttribute("d") !== d) path.setAttribute("d", d);
  const entry = Number(card.dataset.entry);
  const up = h[h.length - 1][1] >= entry;
  path.classList.toggle("lv-up", up);
  path.classList.toggle("lv-down", !up);
}
/* Sell or Close from a card: the owner's own ticket, filled in */
document.addEventListener("click", (e) => {
  const b = e.target && e.target.closest && e.target.closest("[data-lv-close]");
  if (!b) return;
  let c = null;
  try {
    c = JSON.parse(b.dataset.lvClose);
  } catch {
    return;
  }
  if (!c) return;
  if (c.kind === "close" && typeof openClose === "function") return void openClose(c.position);
  if (typeof openTicket === "function") openTicket({ venue: c.venue, symbol: c.symbol, side: "sell", amount: String(c.qty), unit: "qty" });
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && LV.timer) void lvPoll();
});
