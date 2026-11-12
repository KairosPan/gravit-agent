// face/client/js/host/event-window.js — the market page at an event (spec 2026-11-12 §4.3): the dated read of its daily bars
// from the US stocks line (the market's venue cboe), the window the view measured — 30 sessions before the bar whose New York
// day is `at` through 60 after, or the bars there are — and the marks on it: the case's day 0, then every other case or anchor
// of the same symbol in the view whose day 0 is a bar of the window. A US stock's daily bar starts at its New York session
// open, so its New York day is its date. Pure: no store, no fetch.

const DAY = 86_400_000;
export const BEFORE = 30, AFTER = 60;
/** The range a stock's page at an event opens on (Around the event), beside the Account's: never read, only drawn pressed. */
export const EVENT_RANGE = 'event';
const str = v => (typeof v === 'string' ? v : null);
const list = v => (Array.isArray(v) ? v : []);

const NY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
/** A moment's day in New York, `YYYY-MM-DD`. */
export const nyDay = ms => NY.format(new Date(ms));

/** The dated ask for an event's window: from 60 days before `at` (more than 30 sessions) to the lesser of now and 100 days
 *  after it (more than 60 sessions), at most 200 bars. */
export function windowAsk(at, now) {
  const day = Date.parse(`${at}T00:00:00Z`);
  return { since: day - 60 * DAY, before: Math.min(now, day + 100 * DAY), limit: 200 };
}

/** The market proxy's read of a stock's daily bars for that ask, on the US stocks line whatever line the page follows. */
export function windowPath(symbol, ask) {
  return `/data/market/candles?venue=cboe&symbol=${encodeURIComponent(symbol)}&interval=1d&since=${ask.since}&before=${ask.before}&limit=${ask.limit}`;
}

/** The bars of the event's window — 30 before through 60 after the bar whose New York day is `at`, fewer where the bars end
 *  sooner — and day 0's index in them; null when no bar is that day. */
export function eventWindowOf(bars, at) {
  const kept = list(bars).filter(b => Number.isFinite(b?.t));
  const i = kept.findIndex(b => nyDay(b.t) === at);
  if (i < 0) return null;
  const start = Math.max(0, i - BEFORE);
  return { bars: kept.slice(start, i + AFTER + 1), day0: i - start };
}

/** The marks on a window: the case's day 0 (unlabelled when the view or the case is not there), then each other case or anchor
 *  of its symbol whose day 0 is a bar of the window, with its label and group (an anchor has none). */
export function marksOf(view, caseId, window) {
  if (!window) return [];
  const anchors = list(view?.query?.anchors).map(a => ({ ...a, symbol: str(view?.query?.symbol), group: null }));
  const all = [...anchors, ...list(view?.cases)];
  const own = all.find(c => str(c?.id) !== null && c.id === caseId);
  const mark = (c, index, kind) => ({ index, label: str(c?.label) ?? '', group: str(c?.group), kind });
  const marks = [mark(own, window.day0, 'day0')];
  const symbol = str(own?.symbol);
  if (symbol === null) return marks;
  const days = list(window.bars).map(b => nyDay(b.t));
  for (const c of all) {
    if (c === own || str(c?.symbol) !== symbol || str(c?.day0) === null) continue;
    const index = days.indexOf(c.day0);
    if (index >= 0) marks.push(mark(c, index, 'other'));
  }
  return marks;
}
