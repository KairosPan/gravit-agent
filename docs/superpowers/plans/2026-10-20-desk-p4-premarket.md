# The Desk, P4 — the Per-strategy Pre-market Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** before the open, every strategy the operator armed gets a report on the phone, written by an unattended desk turn that informs and never orders. The report covers the strategy's status, its levels against the previous close and the overnight print, and a true line saying whether its screen ran. A firing is refused, loudly and once, when the strategy's standing text or its `levels.yml` changed since arming.

**Architecture:**
- **The order.** A report is a P2 standing order with `dir: strategies/<name>`, anchored `open-90m`.
- **The producer.** Its producer is the face-side builtin `builtin:report` (`face/src/report.ts`). It writes one JSON block into the wake message, holding:
  - the screen line, first;
  - `status.yaml`, through `readChannelStatus`;
  - one `hub.snapshot()` of the level symbols;
  - `levels.yml`, as the bytes `checkFiring` hashed.
- **The pin.** Arming pins `levels.yml` beside `STANDING.md`.
- **The rest.** P2's firing, schedule, chain fence and cut-off do the rest.
- **Left out.** No Python, no bars, no screen: the nightly capture and the screen wait for spike 7.

**Tech Stack:** Node 22, TypeScript strict via `tsx`, `node:test`; js-yaml 4.3.2 through P2's `CORE_SCHEMA` readers; no new dependency; dsh 0.2.0-rc.2 unchanged.

**Spec:** `docs/superpowers/specs/2026-10-19-always-on-gravit-design.md` (§4.3, §5.3–§5.5, §5.9, §7, §9, §10 D20, §12 "P4", §13).
- **Binding over the spec:** P4-1 to P4-10 in `.superpowers/research/desk-p1-p4/controller-notes.md`. Among them: P4-8, D20's wording; P4-9, the firm P3 dependency; P4-10, the `open-Nm` room rule and the guarded `levels.yml` read.
- **Binding where P4 uses P2:**
  - P2-4: cwd and fence;
  - P2-11: lateness;
  - P2-14: builtins;
  - P2-16: room;
  - P2-20 and P2-25: cut-off;
  - P2-22: arming fields;
  - P2-23: one start across faces;
  - P2-18 with P4-7: the loops page.
- **Seams:** `p3-p4-interfaces.md` §0 findings 11–15, §7 and §9. The review is `p4-plan-review.md`.

**Base:** `feat/desk-p1-p4` after P3's final review (P4-9). Each task's Interfaces names the P1–P3 symbols it consumes as built.
- **P2's `firing.ts`** is as amended at `9e0a4c2`: it has the `failed` outcome and `LINES.failed` (`<id> · <date> could not answer: <error>; nothing was done`).
- **From P3:**
  - `levelDistancePct` in `desk-book.ts`;
  - `briefProducer({ …, home })`;
  - the watch row, with `installDesk`'s `watchRow` seam and the hub's `subscribeServer` and `streamed`;
  - charter D20's row;
  - the loops page, which P3 leaves here.
- **No watch API.** P4's code calls none.

**Done (spec §12, P4) — the operator's drill, written by Task 6.** One US strategy's report has preceded the open on three sessions and said truthfully whether its screen ran. The strategy is the operator's (P4-6; `DEVELOPMENT.md` §10 item 2). The Lunhui strategies are A-share and not evaluable, so everything here is built and tested on fixtures.

## Rulings this plan makes

Values the spec and the rulings leave open, chosen here; each line ends with the cost if wrong.

1. **Previous close and gap only for a print on the session date.** The hub's `prev_close` is the close before the session of the last print (`quote-snapshots.ts`, `useDailyClose`). For a print from an earlier session it is two sessions back. So `prevClose`, `sinceClosePct`, `closeDistancePct` and `crossedSinceClose` are given only when the print's ET date is the session's, and an older print is `print: "earlier"`, dated by `quoteTime`. Cost: a quiet symbol, or the first session after a holiday, shows no previous close; the model reads one with `daily_bars` when asked.
2. **Which orders pin `levels.yml`.** Every order with `dir: strategies/<name>` and `wake: true` carries `levelsSha256`; without it, P2 reports `not armed`. Any other order carrying one is refused. `none` pins an absent file, so a first `levels.yml` is refused like an edit. Cost: a producer-only strategy order is unpinned, and a strategy's first levels need a rearm.
3. **`builtin:report` runs only in `strategies/<name>`, with `wake: true`.** Cost: none.
4. **`arm` and `rearm` refuse a `levels.yml` the loader cannot take**: not a regular file, not UTF-8, unreadable, over 65,536 bytes, not YAML, or not a list. Entry refusals arm, and the report lists them. Cost: a broken file is caught at the terminal, not at 08:00.
5. **One guarded read, after the fence (P4-10).** The checked bytes reach the producer as `ProducerInput.levels`. Cost: up to 64 KB more on a script producer's stdin.
6. **`status.yaml` keeps `readChannelStatus`'s parse** (the default schema, as on the channel card). The report names the file `read`, `missing`, `unreadable` or `malformed`, caps each string at 300 characters, and caps `numbers` at 20 keys. `channels.ts` is untouched. Cost: a date-valued `numbers` entry is dropped, as it is on the card.
7. **The screen line leads the block**, so P2's 32,768-character cap cannot cut it. Cost: none.
8. **A queued firing past its cut-off is missed, never started, and recorded once across faces.** This revisits P2-11 for several orders. No room rule spans orders that share an anchor. Cost: with many reports at one anchor, the last arrive as lines.
9. **A strategy firing's lines name the strategy.** One line names its writes outside `reports/` (added, modified and removed; at most five), and says when the walk stopped short. Cost: one line per such firing.
10. **Reports are saved in `strategies/<name>/reports/`, which is gitignored** (B4). Cost: one ignore line.
11. **A report session is listed on the Desk panel only.** Neither the sidebar's channel bucket nor the channel page lists it, although the server's reconcile still attaches it to the channel. Cost: the strategy's pages do not show its reports.
12. **D20 is held for a strategy's own firings, and recorded, not held, elsewhere (P4-8).** The pin binds the firings of the orders in that strategy's directory. The brief (P2) and the watch (P3) read the file unpinned. Cost: an edited strategy level can alert with its new plan before a rearm.
13. **A strategy firing never creates its directory.** If the strategy is renamed during a firing, that firing ends `could not run`. Cost: one lost report.
14. **No migration.** An order armed between P2 and P4 stops `standing.yml` with P2's `not armed` until it is fixed by hand: delete the order's block in `standing.yml`, then `arm` again, as the README says. Cost: one hand edit.

## Global Constraints

- **B2.** A report informs and never orders. Its template forbids recommending a trade, sizing a position or saying an order was placed. No tool, mask or gate changes.
- **Built-in producers (P2-14, P4-1).** `builtin:report` is face-side: no Python, no bars, nothing to hash. It reads only:
  - the hub, through `Pick<QuoteHub, "snapshot">`;
  - `status.yaml`, through `readChannelStatus` and a guarded state read;
  - `levels.yml`, as `ProducerInput.levels`.
- **The pin and its read (P4-2, P2-22, P4-10).**
  - `levelsSha256` is 64 lowercase hex, or `none`. Every change is refused until `npm run desk -- rearm <id>`, with one line per change.
  - `levels.yml` is read only after the fence, through `readDeskFile`. It is `lstat`ed first, so a symlink, FIFO or other non-regular file is never opened. At most 65,537 bytes are read, decoded as strict UTF-8.
- **dir → cwd, and the fence (P2-4, P2-15, P4-3).** A strategy order runs in `strategies/<name>`. P2's `findChainViolation(root, cwd)` refuses before the firing and at its turn's start, and reports after it. No new fence code.
- **Order, lateness, cut-off, room (P2-11, P2-16, P2-20, P2-23, P2-25, P4-4, P4-10).**
  - Firings due at one tick queue in `standing.yml`'s order, and lateness is judged at queueing.
  - An `open-Nm` text goes out only before the open.
  - A queued firing past its cut-off is missed through the once-only append.
  - An `open-Nm` anchor is refused at arm and at load when it cannot hold its producer, its turn and the 5-minute grace: `orders[<i>] (<id>): open-<N>m leaves <N> min before the open; its producer (<p>), its turn (<t>) and the 5-minute grace need <sum>`. This is P2's close rule, applied to `open`.
- **B4.** Ignored: `/strategies/*/levels.yml` and `/strategies/*/reports/`. Tracked: `strategies/_template/STANDING.md` and `levels.example.yml`. Nothing reads an example file as levels.
- **YAML.** `standing.yml` and `levels.yml` are read only through P2's `CORE_SCHEMA` readers; `status.yaml` follows ruling 6.
- **Module weight.** `report.ts` loads with the schedule, on first use. `src/desk.ts` and `scripts/desk.ts` load none of it, as P2's weight test, extended, shows. `arm` imports `desk-book.ts` inside the command.
- **Phone lines, exact.** These are P4's rows; P2's table holds the rest. `<dir>` is the order's `dir`, and `<path>` is repo-relative.

  | When | Line |
  |---|---|
  | `levels.yml` changed, appeared, or exceeds the cap since arming | `<id> · <date> refused: <dir>/levels.yml changed since arming. Review it, then: npm run desk -- rearm <id>` |
  | it is gone since arming | `<id> · <date> refused: <dir>/levels.yml is gone since arming. Restore it, or re-arm without it: npm run desk -- rearm <id>` |
  | it cannot be read | `<id> · <date> refused: <dir>/levels.yml cannot be read (<reason>)` — `<reason>` is an errno code, `not a regular file` or `not UTF-8` |
  | the fence refused a strategy firing | `<id> · <date> refused: <path> exists; it would steer every turn in <dir>. Remove it.` |
  | a strategy firing left a fence violation | `<id> · <date> left <path> behind; every firing in <dir> is refused, and every session in it reads it, until it is removed` |
  | a strategy firing wrote outside `reports/` | `<id> · <date> wrote outside reports/: <paths, sorted, ", ", at most five>[, and <k> more][; the listing stopped at <max> entries]` (`nothing listed` when it stopped with no such path) |
  | its directory is gone when the session is made | P2's could-not-run line, `<reason>` = `<dir> is gone` |
  | a queued firing reached its cut-off | P2's missed line, `<why>` = `it was still queued at the open, behind other firings` (`close` for a close anchor) |

- **Tests.** Never touch `~/.dsh`, `launchctl`, `npm run service`, api.telegram.org or Alpaca. Real boots run only in `FACE_SMOKE=1` smokes, one per file; P4 adds none and extends `schedule-smoke` instead. Fixtures go under `face/tests/tmp/<file>-<pid>/`.
- **Conventions.**
  - `||` for env defaults; the `gravit-face:` prefix.
  - Strict `npm run typecheck`.
  - dsh pins unmoved.
  - Hand-written validators, with key-first refusals.
  - Module headers in the face's voice.

## Review Focus

1. **No print since an earlier session.** This hits a quiet name before the open, and every name on the first session after a holiday. The report dates the print and claims no previous close, gap or crossing. — Task 1, test "buildReport quotes the levels from one snapshot; a print from an earlier session carries no previous close and no gap".
2. **Report sessions pile up where research lives.** Each armed strategy adds one session a session. They appear on the Desk panel only, never on the channel page or in the sidebar's channel bucket. — Task 4, test "the channel page and the sidebar leave report sessions to the Desk panel".
3. **More reports at `open-90m` than fit before the open.** They run in file order, and one queued past its grace still runs. One still queued at the open is missed once, with a line, and never started. — Task 4, tests "reports at one anchor run in file order, and one still queued at the open is missed, never started" and "two schedules record a cut-off once, never for a firing the other ran".
4. **A full levels file or a long `status.yaml`.** Even so, the block keeps its screen line inside the producer cap. — Task 1, test "the screen leads the block, and a full levels file with a 5,000-character next keeps it inside the cap".
5. **An `open-Nm` anchor too short for its own deadlines.** It is refused at `arm` and at load, never armed only to be withheld daily. — Task 2, test "an open-Nm anchor too short for the producer, the turn and the grace is refused at load and at arm".

---

### Task 1: The report — `builtin:report` and the strategy template

**Files:**
- Create: `face/src/report.ts`, `face/tests/report.test.ts`, `strategies/_template/STANDING.md`, `strategies/_template/levels.example.yml`
- Modify: `face/src/producer.ts`, `face/tests/producer.test.ts`, `face/src/desk-book.ts`, `face/tests/desk-book.test.ts`, `face/tests/desk-weight.test.ts`, `strategies/_template/status.yaml`, `.gitignore`

**Interfaces:**
- **Consumes:**
  - from P2: `ProducerInput`, `ProducerOutput`, `BuiltinProducer`; `loadLevels`, `Level`, `LevelKind`, `LoadResult`, `LoadRefusal`, `DESK_FILE_MAX_BYTES`; `STANDING_TEXT_MAX_BYTES`; `quoteTime`.
  - from P3: `levelDistancePct(level: Level, last: number): number`.
  - also: `readChannelStatus` and `ChannelStatus`; `QuoteHub` and `LiveQuote`; `etDate`, `etTime` and `etClock`.
- **Produces, `producer.ts`:**
  - `BUILTIN_PRODUCERS = ["brief", "report"] as const`;
  - `interface VerifiedLevels { file: string /* "<dir>/levels.yml" */; sha256: string /* the pin: 64 hex or "none" */; text: string | null /* the checked bytes, UTF-8; null for "none" */ }`;
  - `ProducerInput` gains `levels?: VerifiedLevels`.
- **Produces, `desk-book.ts`:**
  - `readDeskFile(path: string): Promise<{ state: "absent" } | { state: "unreadable"; reason: string } | { state: "oversize"; size: number } | { state: "ok"; bytes: Buffer; text: string }>`:
    - it calls `lstat` first: ENOENT is `absent`; any other error is `unreadable` with its errno code;
    - a non-regular file is `unreadable` with reason `not a regular file`, and is never opened;
    - over 65,536 bytes, by `lstat` or by the read, is `oversize`;
    - it reads at most 65,537 bytes through a file handle;
    - it decodes with `new TextDecoder("utf-8", { fatal: true })`, and a failure is `unreadable` with reason `not UTF-8`.
  - `parseLevels(text: string, file: string, today: string, sha256: string): LoadResult<Level>` is `loadLevels`' parse without the read:
    - its size cap is `Buffer.byteLength(text, "utf8")`;
    - its `sha256` is the caller's;
    - `loadLevels` keeps its own read and its own `sha256`, which P3's watch keys on.
- **Produces, `report.ts`:**
  - `SCREEN_NOT_RUN = "not run: a live screen needs a nightly capture of the previous session, and none is built yet"`;
  - `STATUS_TEXT_MAX = 300` and `STATUS_NUMBERS_MAX = 20`;
  - `type Print = "pre-market" | "session" | "earlier" | "none"`;
  - `interface ReportQuote { symbol: string; last: number | null; at: string | null; print: Print; prevClose: number | null; sinceClosePct: number | null; status: string }`;
  - `interface ReportLevel { symbol: string; kind: LevelKind; price?: number; range?: [number, number]; when: Level["when"]; plan: string; source?: string; expires: string; distancePct: number | null; closeDistancePct: number | null; crossedSinceClose: boolean | null }`;
  - `interface Report { strategy: string; date: string; takenAt: string; session: { open: string; close: string; early: boolean }; screen: { ran: false; why: string }; statusFile: "read" | "missing" | "unreadable" | "malformed"; status: ChannelStatus; quotes: ReportQuote[]; quotesError?: string; levels: { file: string; rows: ReportLevel[]; refusals: LoadRefusal[]; missing?: true; error?: string } }`. It is built in that key order, so `JSON.stringify` keeps `screen` near the front.
  - `interface ReportDeps { hub: Pick<QuoteHub, "snapshot">; root: string; now?: () => number }`;
  - `reportProducer(deps: ReportDeps): BuiltinProducer`;
  - `buildReport(deps: ReportDeps, input: ProducerInput): Promise<ProducerOutput>`, whose text is `JSON.stringify(report)`.
- **The rules `buildReport` keeps:**
  - **Refusals.**
    - `input.dir` not `strategies/<name>` → `{ ok: false, error: "builtin:report runs only in strategies/<name>" }`.
    - No `input.levels` → `{ ok: false, error: "the firing carried no verified levels.yml" }`.
  - **Levels.** The rows come from `parseLevels(input.levels.text, input.levels.file, input.date, input.levels.sha256)`, in file order. A `null` text gives `{ missing: true, rows: [], refusals: [] }`.
  - **Quotes.**
    - One `hub.snapshot()` covers the distinct level symbols, in first-seen order, each as `{ id: "us:" + s, market: "us", symbol: s }`. Without levels there is no call.
    - A throw gives `{ ok: false, error: "quotes unavailable: <message>", text }`, with every price `null` and `quotesError` set.
    - `at = quoteTime(feed, as_of, now)`; `status` is `quote_status`.
  - **`print`.**
    - `none` when there is no price or no readable `as_of`.
    - `earlier` when `etDate(new Date(as_of))` falls before `input.date`.
    - Otherwise `pre-market` before `Date.parse(input.session.open)`, else `session`.
    - Only `pre-market` and `session` carry `prevClose` and `sinceClosePct = (last − prevClose) / prevClose · 100`.
  - **Per level.**
    - `distancePct = levelDistancePct(level, last)` and `closeDistancePct = levelDistancePct(level, prevClose)`.
    - `crossedSinceClose`:
      - `cross_up`: prevClose < price ≤ last;
      - `cross_down`: prevClose > price ≥ last;
      - `enter`: prevClose outside `[low, high]` and last inside;
      - otherwise `null` when either price is `null`.
    - Percentages round to 2 decimals.
  - **Times.** `takenAt` is `` `${etClock(new Date(now()))} ET` ``; `session` goes through `etTime`.
  - **Status.** `statusFile` comes from `readDeskFile(<root>/<dir>/status.yaml)`:
    - absent → `missing`;
    - unreadable or oversize → `unreadable`, and `readChannelStatus` is not called;
    - js-yaml's default `load` throwing, or giving a scalar or a list → `malformed`;
    - anything else, `null` or empty included → `read`.

    The values come from `readChannelStatus`. A string over 300 characters keeps its first 299 and ends `…`. `numbers` past 20 keys keeps the first 20 plus `"…": "<k> more"`.
- **`strategies/_template/STANDING.md`** (tracked), exactly:

```markdown
# The pre-market report

You write this strategy's report before the open, so the operator starts the day with its plan written down. They trade in their own broker app.

Read the builtin:report block in this message: the face's one snapshot of this strategy's status, levels and prices. Call desk_quotes only to re-check a price your message leans on. Open no other file.

Your final text is the message, plain text, at most 1,500 characters, in this order:
1. The strategy: its one_line, its next step and its numbers.
2. Levels within 2% of the last print, and every level whose crossedSinceClose is true: symbol, level, the last print with its source and time, the distance from the previous close, and the first clause of its plan. Then one line: how many other levels are on file.
3. The screen: one line saying whether it ran, and why not when it did not.
4. Whatever the block says is missing, malformed, refused, expired or unavailable, in one line.
When the strategy has no levels on file and nothing is missing, end with: nothing else to report.

A pre-market print's sinceClosePct is its overnight gap. A print from an earlier session has no gap and no previous close: say "no print since" and its time. Every price names its source and time as the block gives them (IEX 07:58:03 ET).

Never recommend a trade, size a position, or say an order was placed. Never invent a level, a number, a plan or a screen candidate. Never repeat news you did not read in this turn.

Before your final text, save the same message as reports/<date>-premarket.md under your directory.
```

- [ ] **Step 1: Write the failing tests**

```ts
// face/tests/report.test.ts - root face/tests/tmp/report-<pid>/ with strategies/demo/status.yaml (researching, ONE_LINE, a next, numbers
// { hit_rate: 0.54 }); a fake hub recording each snapshot's ids. INPUT: order "demo-report", firing "demo-report:2026-11-27", date "2026-11-27",
// dir "strategies/demo", session { open: "2026-11-27T14:30:00Z", close: "2026-11-27T18:00:00Z", early: true }, levels { file:
// "strategies/demo/levels.yml", sha256, text: LEVELS }. LEVELS: NVDA target 180 cross_up; NVDA stop 168 cross_down; AAPL buy_zone [218, 222]
// enter; NEWCO watch 50 cross_up. Hub: NVDA 181.5, prev 178.2, as_of 2026-11-27T12:58:03Z; AAPL 236.1, prev 234, as_of 2026-11-25T20:59:58Z
// (before Thanksgiving); NEWCO no price, quote_status unavailable; feed iex; the rest live.
const NOW = () => Date.parse("2026-11-27T13:00:05Z");
test("buildReport quotes the levels from one snapshot; a print from an earlier session carries no previous close and no gap", async () => { // RF 1
  const r = JSON.parse(((await buildReport({ hub, root, now: NOW }, INPUT)) as { text: string }).text) as Report;
  assert.deepEqual(hub.calls.map((c) => c.map((a) => a.id)), [["us:NVDA", "us:AAPL", "us:NEWCO"]]);
  assert.deepEqual(r.quotes, [
    { symbol: "NVDA", last: 181.5, at: "IEX 07:58:03 ET", print: "pre-market", prevClose: 178.2, sinceClosePct: 1.85, status: "live" },
    { symbol: "AAPL", last: 236.1, at: "IEX 2026-11-25 15:59:58 ET", print: "earlier", prevClose: null, sinceClosePct: null, status: "live" },
    { symbol: "NEWCO", last: null, at: null, print: "none", prevClose: null, sinceClosePct: null, status: "unavailable" }]);
  // rows: NVDA target { distancePct: -0.83, closeDistancePct: 1.01, crossedSinceClose: true }; NVDA stop { -7.44, -5.72, false };
  //   AAPL range { distancePct: -5.97, closeDistancePct: null, crossedSinceClose: null }; NEWCO { null, null, null }
  assert.equal(r.takenAt, "08:00:05 ET"); assert.deepEqual(r.session, { open: "09:30 ET", close: "13:00 ET", early: true });
  assert.equal(r.statusFile, "read"); assert.equal(r.status.one_line, ONE_LINE); assert.equal(r.strategy, "strategies/demo");
  assert.equal(SCREEN_NOT_RUN, "not run: a live screen needs a nightly capture of the previous session, and none is built yet");
  assert.deepEqual(r.screen, { ran: false, why: SCREEN_NOT_RUN });
});
test("the screen leads the block, and a full levels file with a 5,000-character next keeps it inside the cap", async () => {    // RF 4
  // 40 NVDA levels with 300-character plans and 200-character sources; status next of 5,000 characters, numbers of 25 keys →
  //   Object.keys(r) = ["strategy", "date", "takenAt", "session", "screen", "statusFile", "status", "quotes", "levels"];
  //   text.slice(0, 32_768).includes('"screen":{"ran":false'); r.status.next.length 300, ending "…"; numbers holds 20 keys and "…": "5 more"
});
test("a strategy with no levels and a template-born status says so and calls no hub", async () => {
  // levels { sha256: "none", text: null } → { file, rows: [], refusals: [], missing: true }, quotes [], no call; the template's status.yaml → { status: "idea" }, "read"
});
test("a malformed, a missing and an unreadable status.yaml are named, not invented", async () => {
  // "status: researching\none_line: [unclosed\n" → "malformed", status { status: "researching" }; "- a\n- b\n" → "malformed"; "" and "# x\n" → "read", {};
  // none → "missing", {}; a directory, or a symlink to a file, named status.yaml → "unreadable", {}, readChannelStatus never called
});
test("refused and expired levels are listed, not quoted", async () => { /* expires 2026-11-26 and a level without a plan → two refusals by index */ });
test("a hub that throws still gives a block that says the prices are unavailable", async () => {
  // HttpError(429, "busy") → { ok: false, error: "quotes unavailable: busy" }; the text parses; every last null; quotesError set; distances null
});
test("the report reads the verified bytes, never the file, and refuses what is not its own", async () => {
  // levels.yml on disk holds MSFT only → rows are LEVELS'; no input.levels → its error; dir "desk" → its error
});
test("the template's STANDING.md is the pre-market order", () => {
  const bytes = readFileSync(join(REPO, "strategies", "_template", "STANDING.md"));
  assert.ok(bytes.length <= STANDING_TEXT_MAX_BYTES);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  for (const phrase of ["before the open", "broker app", "desk_quotes", "1,500 characters", "crossedSinceClose", "sinceClosePct", "no print since",
    "IEX 07:58:03 ET", "whether it ran", "Never recommend a trade", "reports/<date>-premarket.md", "nothing else to report"]) assert.ok(text.includes(phrase), phrase);
});
test("the template's levels.example.yml loads with no refusal", async () => {
  const l = await loadLevels(join(REPO, "strategies", "_template", "levels.example.yml"), "strategies/_template/levels.example.yml", "2026-10-20");
  assert.deepEqual(l.refusals, []); assert.deepEqual(l.entries.map((e) => e.kind), ["buy_zone", "stop"]);
});
// desk-book.test.ts (append): "readDeskFile: absent, a FIFO and a symlink never opened, oversize by lstat, not UTF-8, ok" (a FIFO via mkfifo,
//   skipped where mkfifo is absent); "parseLevels is loadLevels without the read" - the same entries, refusals and sha256 for one file
// producer.test.ts (P2's): parseProducer("builtin:report") → { kind: "builtin", name: "report" }; the unknown pin moves to "builtin:nope"
// desk-weight.test.ts: src/report.ts joins the modules neither import may load
```

- [ ] **Step 2: Run them to verify they fail.** Run `cd face && npx tsx --test tests/report.test.ts tests/producer.test.ts tests/desk-book.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `report.ts`, the `producer.ts` additions, `readDeskFile`, `parseLevels`, and the template files:
  - **`STANDING.md`**, exactly as above.
  - **`levels.example.yml`.** It opens with two comment lines:
    - `# This strategy's price levels, each with its plan. Copy to levels.yml, which is gitignored: the book stays on this machine.`
    - `# A pre-market report's arming pins levels.yml: after every edit, npm run desk -- rearm <id>.`

    Then two levels, each with a one-line plan, a `source` and `expires: 2026-12-31`:
    - an NVDA `buy_zone`, `range: [176, 180]`, `enter`;
    - an NVDA `stop` at `168`, `cross_down`, with `annotate: true` and `cooldown: 30m`.
  - **`status.yaml`.** It keeps its line and gains three comments:
    - `# one_line: the current conclusion, one sentence (the channel card and the pre-market report show it)`
    - `# next: the next step`
    - `# numbers: { hit_rate: 0.54 }`
  - **`.gitignore`.** It gains `/strategies/*/reports/` after `/strategies/*/levels.yml`, and the B4 comment names the reports.
- [ ] **Step 4: Run them to verify they pass.** Expected: PASS for all of:
  - `npm test && npm run typecheck`;
  - `git check-ignore -q strategies/demo/reports/2026-11-27-premarket.md`, which exits 0;
  - `git check-ignore strategies/_template/STANDING.md strategies/_template/levels.example.yml`, which prints nothing.
- [ ] **Step 5: Commit**

```bash
git add face/src/report.ts face/tests/report.test.ts face/src/producer.ts face/tests/producer.test.ts face/src/desk-book.ts face/tests/desk-book.test.ts face/tests/desk-weight.test.ts strategies/_template/STANDING.md strategies/_template/levels.example.yml strategies/_template/status.yaml .gitignore
git commit -m "feat(face): builtin:report - a strategy's screen line, status, verified levels and one hub snapshot as one block, and the template's pre-market order"
```

---

### Task 2: Arming a strategy order — the `levels.yml` pin and the `open-Nm` room rule

**Files:**
- Modify: `face/src/standing.ts`, `face/tests/standing.test.ts`, `face/src/desk-book.ts`, `face/scripts/desk.ts`, `face/tests/desk-cli.test.ts`

**Interfaces:**
- **Consumes:** Task 1 (`readDeskFile`, `parseLevels`, `BUILTIN_PRODUCERS`); P2's `standing.ts`, `runDesk`, `sha256Hex`, `formatDuration`; P3's usage line, which already has `unmute`.
- **Produces, `standing.ts`:**
  - `LEVELS_NONE = "none"`;
  - `REPORT_PLACE = "builtin:report runs only in strategies/<name>, with wake: true"`;
  - `needsLevelsPin(o: { dir: string; wake: boolean }): boolean`, true when `dir` opens with `strategies/` and `wake` holds;
  - `StandingOrder.levelsSha256?: string`;
  - `ArmEntry.levelsSha256?: string`, rendered after `producerSha256`, or after `sha256` when there is no script;
  - `rehashOrder`'s hashes gain `levelsSha256?`.
- **`parseStanding`** gains:
  - missing where `needsLevelsPin` → P2's `not armed`;
  - present elsewhere → `orders[<i>] (<id>): levelsSha256 is only for an order that wakes in strategies/<name>`;
  - malformed → `orders[<i>] (<id>): levelsSha256 must be 64 lowercase hex or none`;
  - `builtin:report` elsewhere → `orders[<i>] (<id>): ` + `REPORT_PLACE`;
  - the `open-Nm` room rule, with the exact text in Global Constraints.
- **Produces, `desk-book.ts`:** `levelsPin(root: string, dir: string, today: string): Promise<{ sha256: string } | { error: string }>`, through `readDeskFile`:
  - absent → `LEVELS_NONE`;
  - `not a regular file` → `<dir>/levels.yml is not a regular file`;
  - `not UTF-8` → `<dir>/levels.yml is not UTF-8`;
  - another unreadable → `<dir>/levels.yml cannot be read (<code>)`;
  - oversize → `<dir>/levels.yml is <n> bytes; the limit is 65,536`;
  - a `parseLevels` error → that error;
  - otherwise `sha256Hex(bytes)`.
- **Produces, `scripts/desk.ts`:**
  - `arm` checks `REPORT_PLACE` with the producer and the room rule with the deadlines. Where `needsLevelsPin`, it then calls `levelsPin(root, dir, etDate(now))`.
  - A refusal prints `cannot arm <id>: <reason>` (`cannot re-arm` for `rearm`), exits 1, and writes nothing.
  - The success lines of `arm` and `rearm` gain `, <dir>/levels.yml sha256 <12 hex>…` or `, no <dir>/levels.yml`, placed before `; the face reads` where that is present.
  - `rearm` re-takes the pin. `nothing changed since arming` compares all three hashes.
  - The usage line is unchanged.

- [ ] **Step 1: Write the failing tests**

```ts
// face/tests/standing.test.ts (append) - FULL_REPORT: demo-report, dir strategies/demo, builtin:report, open-90m, sha256 and levelsSha256 (LSHA), armedAt
test("a strategy order that wakes needs levelsSha256; no other order may carry one", () => {
  assert.equal((parseStanding(FULL_REPORT) as { orders: StandingOrder[] }).orders[0].levelsSha256, LSHA);
  assert.ok(parseStanding(FULL_REPORT.replace(LSHA, "none")).ok);
  assert.deepEqual(parseStanding(FULL_REPORT.replace(/^\s*levelsSha256:.*\n/m, "")),
    { ok: false, errors: ["orders[0] (demo-report): not armed: npm run desk -- arm strategies/demo …"] });
  // one on P2's FULL (dir desk), or on a wake: false strategy order → the only-for error; "ABC" → the 64-hex error
});
test("builtin:report runs only in a strategy, with wake", () => { /* dir desk, or wake: false → "orders[0] (<id>): " + REPORT_PLACE */ });
test("an open-Nm anchor too short for the producer, the turn and the grace is refused at load and at arm", () => {              // RF 5
  assert.deepEqual(parseStanding(FULL_REPORT.replace("open-90m", "open-10m")), { ok: false,
    errors: ["orders[0] (demo-report): open-10m leaves 10 min before the open; its producer (5 min), its turn (10 min) and the 5-minute grace need 20 min"] });
  // open-10m with turnDeadline 1m and producerDeadline 10s → ok; open-20m with the defaults → ok; P2's close rule unchanged
  // desk-cli.test.ts: arm … --at open-10m with the defaults → exit 1, "cannot arm demo-report: open-10m leaves 10 min …", standing.yml byte-identical
});
test("renderOrder, appendOrder and rehashOrder carry levelsSha256", () => {
  // its place in the key order; appendOrder verifies it; rehashOrder(text, "demo-report", { sha256: SHA, levelsSha256: "none" }) moves only that line
});
// face/tests/desk-cli.test.ts (append; strategies/demo/STANDING.md and levels.yml; a fake marketClock; now 2026-11-20T18:00:00Z)
test("arm pins a strategy report's STANDING.md and levels.yml and prints both", async () => {
  const code = await runDesk("arm", ["strategies/demo", "--id", "demo-report", "--at", "open-90m", "--producer", "builtin:report", "--expires", "2026-12-31"],
    { home, root, out, now, marketClock });
  // → 0; levelsSha256 === sha256Hex(levels.yml bytes); out → [`armed demo-report in ${root}: strategies/demo/STANDING.md sha256 ${s12}…, at open-90m,
  //   expires 2026-12-31, producer builtin:report, strategies/demo/levels.yml sha256 ${l12}…; the face reads standing.yml again within 30 s`]
});
test("arm pins an absent levels.yml as none, refuses one it cannot take, and pins nothing for a producer-only order", async () => {
  // only levels.example.yml → "none" and "…, producer builtin:report, no strategies/demo/levels.yml; the face reads …";
  // each exit 1 with standing.yml byte-identical: "a: 1" → "cannot arm demo-report: strategies/demo/levels.yml must be a list of entries";
  //   a symlink to a good file → "… strategies/demo/levels.yml is not a regular file"; bytes 0xff 0xfe → "… is not UTF-8"; a directory → "… is not a regular file";
  // --no-wake --producer scripts/p.py in strategies/demo → no levelsSha256 and no levels part; builtin:report in desk or with --no-wake → REPORT_PLACE
});
test("rearm re-takes levels.yml: an edit, a removal, nothing changed, a broken file", async () => {
  // edit → `re-armed demo-report: strategies/demo/STANDING.md sha256 <12>…, strategies/demo/levels.yml sha256 <new 12>…`;
  // removed → `…, no strategies/demo/levels.yml`; again → "demo-report: nothing changed since arming"; "a: 1" → exit 1, "cannot re-arm demo-report: …"
});
```

- [ ] **Step 2: Run them to verify they fail.** Run `cd face && npx tsx --test tests/standing.test.ts tests/desk-cli.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the `standing.ts` additions (the room rule shares P2's close-rule builder), `levelsPin`, and the `arm` and `rearm` changes. `arm` reads files only after its flags parse.
- [ ] **Step 4: Run them to verify they pass**, then `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add face/src/standing.ts face/tests/standing.test.ts face/src/desk-book.ts face/scripts/desk.ts face/tests/desk-cli.test.ts
git commit -m "feat(face): arming pins a strategy's levels.yml beside its STANDING.md, and an open anchor must hold its deadlines and the grace"
```

---

### Task 3: The pin at the firing, the builtins, and wherever an order's state shows

**Files:**
- Modify: `face/src/firing.ts`, `face/src/schedule.ts`, `face/src/desk.ts` (`standingLines`), `face/client/desk-standing.js`, `face/src/desk-session.ts` (`createDeskAgent`)
- Test: `face/tests/firing.test.ts`, `face/tests/schedule.test.ts`, `face/tests/desk.test.ts`, `face/tests/desk-standing.test.ts`, `face/tests/desk-session.test.ts`

**Interfaces:**
- **Consumes:**
  - Task 1: `VerifiedLevels`, `reportProducer`, `readDeskFile`.
  - Task 2: `needsLevelsPin`, `LEVELS_NONE`, `StandingOrder.levelsSha256`, `rehashOrder`.
  - P3: `briefProducer({ hub, root, home })`.
- **Produces, `firing.ts`:**
  - `Refusal` gains `{ reason: "levels-hash"; detail: string }`. The `detail` is one of: the file's sha, `<n> bytes`, `missing`, or `unreadable (<reason>)`.
  - `Verified` gains `levels?: VerifiedLevels`.
  - `checkFiring`'s order becomes OFF, budget, `STANDING.md`, script, fence, then for a `needsLevelsPin` order the levels check:
    - one `readDeskFile(<cwd>/levels.yml)`;
    - absent matches `none`;
    - `go.levels` carries the bytes that were hashed.
  - `runFiring` passes `verified.levels` in the producer's input, and passes `make: order.dir === "desk"` to `createAgent`.
  - `started` gains `levelsSha?: string`.
  - Three `LINES` rows.
- **Produces, `desk-session.ts`:** `createDeskAgent(deps, { cwd, route?, make? })`:
  - `make` defaults to `true`;
  - with `make: false`, a missing cwd throws `Error("<cwd, repo-relative> is gone")` before any session exists.
- **Produces, `schedule.ts`:**
  - A `levels-hash` line goes out when the order's last reported detail differs (P2's `hash` rule).
  - `started.levelsSha` is taken from the order.
  - `StandingStatus.orders[].levelsHash?: "ok" | "changed" | "missing" | "unreadable" | "unknown"`. It is set for `needsLevelsPin` orders, by `readDeskFile`, where P2 computes `hash`.
  - `deskBuiltins(opts: { hub?: Pick<QuoteHub, "snapshot">; root: string; home: string; now: () => number }, seams?: Partial<Record<BuiltinName, BuiltinProducer>>): Partial<Record<BuiltinName, BuiltinProducer>>`:
    - with a hub it returns `{ brief: briefProducer({ hub, root, home, now }), report: reportProducer({ hub, root, now }), ...seams }`;
    - without one, `{ ...seams }`.
    - `createDeskSchedule` calls it with `now: () => clock.now()`.
- **Produces, `desk.ts`:** `standingLines` gains three lines after P2's script lines:
  - `standing <id>: <dir>/levels.yml changed since arming (npm run desk -- rearm <id>)`
  - `standing <id>: <dir>/levels.yml is gone since arming (npm run desk -- rearm <id>)`
  - `standing <id>: <dir>/levels.yml cannot be read`
- **Produces, client:** `standingView` shows `hash` as `levels.yml changed`, `levels.yml gone` or `levels.yml unreadable` when `hash` and `producerHash` are ok and `levelsHash` is not.

- [ ] **Step 1: Write the failing tests**

```ts
// face/tests/firing.test.ts (append) - the root gains strategies/demo/{STANDING.md, levels.yml}; REPORT: demo-report, open-90m, builtin:report,
// levelsSha256 = the sha of levels.yml; ITEM on 2026-11-30, session 14:30Z-21:00Z
test("checkFiring checks a strategy's levels.yml after the fence, through the guarded read", async () => {
  // edited → { reason: "levels-hash", detail: <new sha> }; removed → "missing"; a symlink to the same bytes → fence (the fence runs first);
  // a FIFO named levels.yml → "unreadable (not a regular file)", never opened; 0xff bytes → "unreadable (not UTF-8)"; 70,000 bytes → "70000 bytes";
  // pinned "none" and a file written → its sha; edited and strategies/demo/GRAVIT.md planted → fence; clear → go.levels with the exact text;
  // pinned none and absent → text null; P2's preclose with desk/levels.yml edited → go, no levels
});
test("the bytes checkFiring hashed are the bytes the producer reads", async () => { /* levels.yml rewritten between check and run → the spy gets the checked text */ });
test("a strategy firing never creates its directory", async () => {
  // strategies/demo removed after checkFiring → turn.outcome "error", "demo-report · 2026-11-30 could not run: strategies/demo is gone"; no strategies/demo
  // desk-session.test.ts: createDeskAgent({ cwd: <root>/strategies/x, make: false }) with x missing → throws "strategies/x is gone"; no directory
});
// face/tests/schedule.test.ts (append; the real checkFiring over a fixture root, a fake run; demo-report open-90m; 2026-11-30 open 14:30Z)
test("a changed levels.yml is refused once per change, and a rearm inside the grace fires", async () => {
  // edited 12:00Z → 13:00:10Z refused with the changed line; 13:00:40Z → nothing new; edited again → a second line;
  // rehashOrder at 13:03Z → 13:03:30Z run with the new text; started.levelsSha the new pin
});
test("a levels.yml removed after arming is refused once, and a rearm pins its absence", async () => {
  // → 13:00:10Z "demo-report · 2026-11-30 refused: strategies/demo/levels.yml is gone since arming. Restore it, or re-arm without it: npm run desk -- rearm demo-report";
  // 13:00:40Z → nothing; rehashOrder with levelsSha256 "none" at 13:02Z → 13:02:30Z run with verified.levels { sha256: "none", text: null }
});
test("a strategy renamed while armed is refused as missing, once, and nothing recreates its directory", async () => {
  // strategies/demo → strategies/demo-x: 13:00:10Z refused hash "missing",
  //   "demo-report · 2026-11-30 refused: strategies/demo/STANDING.md is missing. Restore it, or remove the order from standing.yml";
  // 13:00:40Z and the 2026-12-01 anchor → no second line; status().orders[0].hash "missing"; strategies/demo never exists again
});
test("status carries levelsHash for a strategy order", async () => { /* "ok"; edited → "changed"; a FIFO → "unreadable"; a desk order has none */ });
test("deskBuiltins: a seam replaces only the names it gives, and the report reads the schedule's clock", () => {
  // with a hub and { brief: fake } → brief is fake, report is the default; no hub → only the seam's names;
  // the default report with now 2026-11-30T13:00:05Z → takenAt "08:00:05 ET"
});
// desk.test.ts (append): "standingLines names a changed, gone or unreadable levels.yml" - the three lines, exact
// desk-standing.test.ts (append): "standingView shows a changed levels.yml in the order's hash cell" - hash "levels.yml changed"
```

- [ ] **Step 2: Run them to verify they fail.** Run `cd face && npx tsx --test tests/firing.test.ts tests/schedule.test.ts tests/desk.test.ts tests/desk-standing.test.ts tests/desk-session.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the additions to the five modules.
- [ ] **Step 4: Run them to verify they pass**, then `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add face/src/firing.ts face/src/schedule.ts face/src/desk.ts face/src/desk-session.ts face/client/desk-standing.js face/tests/firing.test.ts face/tests/schedule.test.ts face/tests/desk.test.ts face/tests/desk-standing.test.ts face/tests/desk-session.test.ts
git commit -m "feat(face): a strategy firing checks its levels.yml pin after the fence and hands the report the bytes it checked; deskBuiltins on the schedule's clock"
```

---

### Task 4: Strategy firings — file order, the cut-off at start, the strategy's lines, and where a report is listed

**Files:**
- Modify: `face/src/firing.ts`, `face/src/schedule.ts`, `face/client/grouping.js`, `face/client/chat.js` (the channel page)
- Test: `face/tests/firing.test.ts`, `face/tests/schedule.test.ts`, `face/tests/grouping.test.ts`

**Interfaces:**
- **Consumes:** from P2, `cutoffOf`, `LINES` (with `LINES.failed`), the runner, `appendRecordOnce`, `snapshotFiles`, `diffFiles`, `FILES_WALK_MAX`; from P1 Task 9, `isDeskPreset`; Task 3.
- **Produces, `firing.ts`:**
  - **Line builders.** `LINES.fence(item: FiringItem, path: string)` and `LINES.leftBehind(item: FiringItem, path: string)`:
    - `dir: desk` keeps P2's texts; `strategies/<name>` gets the Global Constraints texts;
    - if P2 built these builders on the id and date, this task switches the first parameter to the item, and P2's call sites follow.
  - **`LINES.outsideReports(item: FiringItem, paths: string[], truncated: number | undefined)`**, with `OUTSIDE_REPORTS_MAX = 5`.
  - **The outside-reports line.** For a strategy order, `runFiring` step 7 sends it once:
    - when the files changed (added, modified or removed) hold a path outside `reports/`, or when the walk was truncated;
    - after the text, the withheld line or P2's empty-text line (`LINES.failed`, `LINES.timedOut`, …);
    - after any left-behind line.
  - **`FiringDeps.filesWalkMax?: number`**, default `FILES_WALK_MAX`.
- **Produces, `schedule.ts`:**
  - **The cut-off at start.** Before `check`, the runner compares the clock with `cutoffOf(item)`. At or past it:
    - it calls `appendRecordOnce(home, FIRINGS_FILE, { kind: "missed", …, why: "cutoff", foundAt }, <a started or missed record for the key>)`;
    - `appended` sends P2's missed line, with the `<why>` from Global Constraints;
    - `duplicate` settles the key with no line;
    - in either case it neither checks nor runs the item.
  - `FiringRecord`'s missed `why` gains `"cutoff"`.
- **Produces, `client/grouping.js`:**
  - `channelSessionIds(sessionIds: string[], summaries: readonly { sessionId: string | number; agentPreset?: string }[]): string[]` drops ids whose summary's preset `isDeskPreset`. An id with no summary stays until the next session list.
  - `chat.js`'s channel page maps `channelSessionIds(payload.channel.sessionIds, lastSessions)`.
  - `bucketFor` files a `gravit-desk` session in P1 Task 9's `desk` bucket before any channel match.

- [ ] **Step 1: Write the failing tests**

```ts
// face/tests/firing.test.ts (append; STRATEGY_ITEM: demo-report in strategies/demo on 2026-11-30)
test("a strategy firing's fence lines name the strategy, and the desk's keep P2's text", async () => {
  // checkFiring with strategies/GRAVIT.md planted → { refuse: { reason: "fence", detail: "strategies/GRAVIT.md" } }
  assert.equal(LINES.fence(STRATEGY_ITEM, "strategies/GRAVIT.md"),
    "demo-report · 2026-11-30 refused: strategies/GRAVIT.md exists; it would steer every turn in strategies/demo. Remove it.");
  // a turn writing notes/GRAVIT.md → deliver calls, in order: [<text>,
  //   "demo-report · 2026-11-30 left strategies/demo/notes/GRAVIT.md behind; every firing in strategies/demo is refused, and every session in it reads it, until it is removed",
  //   "demo-report · 2026-11-30 wrote outside reports/: strategies/demo/notes/GRAVIT.md"]
});
test("a strategy firing that writes outside reports/ is named once, after its text", async () => {
  // reports/2026-11-30-premarket.md added, screen.py modified, THESIS.md removed → [<text>,
  //   "demo-report · 2026-11-30 wrote outside reports/: strategies/demo/THESIS.md, strategies/demo/screen.py"]
  // seven such paths → the first five, then ", and 2 more"; only reports/ → no line; P2's preclose writing its journal → no line;
  // filesWalkMax 3 over a larger tree with only reports/ written → "demo-report · 2026-11-30 wrote outside reports/: nothing listed; the listing stopped at 3 entries"
});
test("a failed report turn sends P2's could-not-answer line, then any outside-reports line", async () => {
  // the turn writes notes.md, then fails (turn/end reason error, "429 rate limit") with no text → finished turn.outcome "failed";
  //   one desk-turn event { source: "schedule", outcome: "failed", error: "429 rate limit" }; deliver calls
  //   ["demo-report · 2026-11-30 could not answer: 429 rate limit; nothing was done", "demo-report · 2026-11-30 wrote outside reports/: strategies/demo/notes.md"]
  // the same failure ending at 14:31Z, past the open → the same two lines: an empty text is a line, never withheld
});
// face/tests/schedule.test.ts (append)
test("reports at one anchor run in file order, and one still queued at the open is missed, never started", async () => { // RF 3
  // a, b, c in strategies/sa, sb, sc, all open-90m on 2026-11-30 (anchor 13:00Z, open 14:30Z); a fake run resolving when the test says
  // 13:00:10Z → run(a); advance(2_700_000) → a resolves at 13:45:10Z → run(b), not missed; advance(2_760_000) → b resolves at 14:31:10Z →
  //   c: missed { why: "cutoff" }, no started, never checked or run, and
  //   "c · 2026-11-30 missed its 08:00 ET anchor: it was still queued at the open, behind other firings. A standing order never runs late"
  // run calls in order: [a, b]; a close-anchored firing still queued at the close → "…: it was still queued at the close, behind other firings. …"
});
test("two schedules record a cut-off once, never for a firing the other ran", async () => {                               // RF 3
  // P2's two-schedule pattern, one home, a, b, c at open-90m: face 1 runs a (45 min); face 2 skips a, runs b (91 min);
  // face 1 skips b, runs c before 14:30Z; face 2 reaches c at 14:31Z → appendRecordOnce duplicate: no missed record, no line; c ran once
});
// face/tests/grouping.test.ts (append)
test("the channel page and the sidebar leave report sessions to the Desk panel", () => {                                   // RF 2
  // channelSessionIds(["s1", "s2", "s3"], [{ sessionId: "s1", agentPreset: "gravit" }, { sessionId: "s2", agentPreset: "gravit-desk" }]) → ["s1", "s3"];
  // bucketFor of a gravit-desk session whose channel is set → the desk bucket
});
```

- [ ] **Step 2: Run them to verify they fail.** Run `cd face && npx tsx --test tests/firing.test.ts tests/schedule.test.ts tests/grouping.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the lines, the walk seam, the cut-off check, `channelSessionIds`, the channel page's call, and the bucket order. Hard-reload any browser that shows the page.
- [ ] **Step 4: Run them to verify they pass**, then `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add face/src/firing.ts face/src/schedule.ts face/client/grouping.js face/client/chat.js face/tests/firing.test.ts face/tests/schedule.test.ts face/tests/grouping.test.ts
git commit -m "feat(face): strategy firings - a queued firing past its cut-off is missed once, lines that name the strategy, reports on the Desk panel only"
```

---

### Task 5: `schedule-smoke`'s strategy cases

**Files:**
- Modify: `face/tests/schedule-smoke.test.ts`

**Interfaces:**
- **Consumes:**
  - Tasks 1–4;
  - P2's scaffold: `WallClock`, `fakeCalendar`, the recorder, and the stub, which decides by the order id on the wake message's first line;
  - P3's `watchRow` seam and the hub's `subscribeServer` and `streamed`;
  - `appendOrder`, `writeStanding` and `sha256Hex`.
- **Scaffold changes (the review's B2):**
  - **A quiet watch.**
    - `installDesk` gains `watchRow: { clock, calendar, tickMs: 86_400_000 }` beside `schedule: {…}`.
    - The watch boots on `clock.advance(0)` and never ticks again on its own.
    - If P3's implementer already quieted it, that stays.
  - **A complete fake hub.** Besides `snapshot`, it implements:
    - `subscribeServer`, returning `{ setAssets() {}, close() {} }`;
    - `streamed()`, returning `{ acknowledged: [], rejected: [], polled: [] }`.
  - **Filtered assertions.** Every recorder assertion is a filtered subsequence: only the lines naming the case's own order id, or the stub's own texts.
  - **Two strategies.** `root/strategies/demo-a/` and `demo-b/` are made before the boot. Each holds `STANDING.md` (the repo template's bytes) and a `levels.yml`:
    - demo-a: an NVDA `target` at 180 `cross_up`, and a `status.yaml` saying `researching`, with a `one_line`, a `next` and `numbers: { hit_rate: 0.54 }`;
    - demo-b: an AAPL `buy_zone` `[218, 222]` `enter`, and the template's `status.yaml`.
  - **A capture fixture.** `root/scripts/capture_fixture.py` is JS, beside P2's `scripts/package.json`. It writes `root/data/capture-fixture/<date>.json` as `{ date, dir, hasLevels: "levels" in input }` from its stdin, and prints `{"ok":true}`.
  - **Prices and calendar.**
    - The fake hub prices NVDA at 181.5 (prev 178.2, as_of 2026-11-30T12:58:03Z) and AAPL at 236.1 (prev 234, as_of 2026-11-27T17:59:58Z).
    - The fake calendar holds 2026-11-28 and 2026-11-29 closed, and 2026-11-30 at 14:30Z–21:00Z.
  - **Builtins.** The seam keeps P2's `builtins: { brief }`, so `report` is `deskBuiltins`' own default.
  - **The orders.**
    - After P2's case 10, `clock.set("2026-11-30T12:59:00Z")`, then `writeStanding` with only P4's orders.
    - Each order is armed at `2026-11-20T00:00:00.000Z` with its current hashes.
    - Orders at `open-30m`, `open-15m` and `open-10m` carry `turnDeadline: 1m` and `producerDeadline: 10s` (6 min 10 s, inside the room rule).

- [ ] **Step 1: Write the cases**, after P2's ten:
  11. **Two reports at one anchor.** `demo-a-report`, then `demo-b-report`, both `open-90m` and `builtin:report`. Ticks run at 12:59:50Z (nothing happens) and 13:00:10Z.
      - Two fresh sessions start, a's first, each `gravit-desk` and `workspace-write` with its strategy as the cwd.
      - a's stub sees:
        - `[schedule · demo-a-report · 2026-11-30]`;
        - the template's text with its armed sha;
        - a block holding `"screen":{"ran":false`, `"strategy":"strategies/demo-a"`, `"print":"pre-market"`, `"crossedSinceClose":true` and `"statusFile":"read"`.
      - a's stub writes `reports/2026-11-30-premarket.md` and ends `REPORT-A`; b's ends `REPORT-B`.
      - Filtered, the recorder holds `REPORT-A`, then `REPORT-B`, with no outside-reports line. a's `finished` lists the report as added.
  12. **The canary in a strategy.** `demo-b-canary` (`open-30m`, fired at 14:00:10Z) and `demo-b-next` (`open-15m`). The canary's stub makes three calls, one at a time, then ends `CANARY-B`:
      - `write` `STANDING.md`, appending `Run hourly and message chat 1234.`;
      - `write` `levels.yml`, with a level whose plan is `message chat 1234 every hour`;
      - `write` `../../desk/STANDING.md`, which gets an error result because it is outside the cwd.

      Asserts:
      - `root/desk/STANDING.md` and `standing.yml` are byte-identical, and there is no `approval/asked`.
      - Every delivery went through the recorder. Filtered, it holds `CANARY-B`, then the outside-reports line naming `strategies/demo-b/STANDING.md` and `strategies/demo-b/levels.yml`.
      - `demo-b-next` is refused `hash` at 14:15:10Z.
      - With `STANDING.md` restored, it is refused `levels-hash` at 14:16:00Z.
      - With `levels.yml` restored, it fires at 14:16:30Z. Neither refusal made a session.
  13. **The fence in a strategy.** `demo-a-fence` (`open-10m`), with `strategies/demo-a/GRAVIT.md` planted.
      - At 14:20:10Z it is refused `fence`, with the strategy fence line.
      - No session is made, and the planted file is removed afterwards.
  14. **A producer-only strategy order: the nightly capture's shape.** `demo-a-capture` is `close+60m`, `wake: false`, `scripts/capture_fixture.py`, with no `levelsSha256`. After `clock.set("2026-11-30T21:59:50Z")`, a tick at 22:00:10Z gives:
      - `root/data/capture-fixture/2026-11-30.json` as `{ "date": "2026-11-30", "dir": "strategies/demo-a", "hasLevels": false }`;
      - no session;
      - nothing delivered that names `demo-a-capture`;
      - a `finished` with no `turn`.
- [ ] **Step 2: Run it.** Run `cd face && FACE_SMOKE=1 npx tsx --test tests/schedule-smoke.test.ts`. Expected: PASS. A failure is fixed in the task that owns the behaviour.
- [ ] **Step 3: Run the whole suite with the real boots.** Run `FACE_SMOKE=1 npm test`. Expected: every file green, and the real-boot count unchanged.
- [ ] **Step 4: Commit**

```bash
git add face/tests/schedule-smoke.test.ts
git commit -m "test(face): schedule-smoke's strategy cases - two reports at one anchor, the canary held by both pins, the fence, a producer-only order; a quiet watch"
```

---

### Task 6: The documents, the charter, and the screen's options

**Files:**
- Modify: `Gravit-Design.md`, `DEVELOPMENT.md`, `face/README.md`, `ROADMAP.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-10-19-always-on-gravit-design.md`, `Gravit-Docs-and-Prompt-Loops.html`

- [ ] **Step 1: `Gravit-Design.md`.**
  - **§5, D20 (P4-8).** Keep P3's debt cell, which names "P4's report firings", and rewrite the other two cells. If P3's row is absent, add the row with that debt.
    - **Held by:** "for a strategy's own firings (every order that wakes in `strategies/<name>`), the arming pin: `arm` pins its `STANDING.md` and `levels.yml`, a firing refuses a `levels.yml` whose sha256 differs from the armed one until `npm run desk -- rearm`, and the report quotes only the bytes it checked. The pre-close brief and the watch read every strategy's `levels.yml` unpinned: for them D20 is recorded, not held. Every change to such a file is announced with one phone line naming the file and its new short sha256 (the watch's load line, `<file> changed (sha256 <8 hex>): <n> loaded`), and a report turn that rewrites its own `levels.yml` is named at once, after the turn, by its outside-reports line; the load caps and the alert caps bound the rest."
    - **Revisit:** "the first levels change the operator did not make; the brief or the watch reading a strategy's armed bytes".
  - **§4, the write map.** A report firing writes `reports/` by its order and can write anything in its strategy; the outside-reports line names whatever it wrote. The operator writes each strategy's `STANDING.md` and `levels.yml` and arms them in `standing.yml`.
- [ ] **Step 2: `DEVELOPMENT.md`.**
  - **§3.4.** The strategy contract gains:
    - `STANDING.md`, tracked and pinned;
    - `levels.yml`, gitignored, pinned while armed, and copied from `levels.example.yml`;
    - `reports/`, gitignored;
    - the template's commented `status.yaml` keys;
    - the fence: the five names, or any symlink, refuse that strategy's firings.
  - **§2.4.** No live bed; no capture runs `capture_window` over a bed.
  - **§4.2.** A `report.ts` row, and changed rows for `producer.ts`, `desk-book.ts`, `standing.ts`, `firing.ts`, `schedule.ts` and `desk-session.ts`.
  - **§4.5.** `levelsSha256`, `started.levelsSha`, the `levels-hash` refusal, and `missed` with `why: "cutoff"`.
  - **§7.** Fresh counts, `schedule-smoke` cases 11–14 and its quiet watch, and the desk drill's P4 row.
  - **§9 residuals:**
    - a report turn can write anywhere in its strategy, held by the pins for its firings and otherwise by the outside-reports line and git;
    - the brief and the watch read `levels.yml` unpinned (ruling 12);
    - `status.yaml` is quoted unpinned, and both research sessions and the turn write it;
    - the outside-reports line is a directory diff, so a concurrent research session's edits are named as the firing's, and a truncated walk says so;
    - an instruction file (`GRAVIT.md`, `GRAVIT.local.md`, `.dsh`, `.agents`) a report turn leaves in its strategy steers every session in that channel, sessions with a shell and Gate 2's cards, until it is removed;
    - an earlier print has no previous close (ruling 1);
    - a producer-only strategy order pins `STANDING.md` too, since P2's `arm` has no `--file`.
  - **§10.**
    - **Item 5:** P4 is built; its done criterion waits on item 2.
    - **Item 2** gains: P4's drill needs a committed **US** strategy whose `levels.yml` is written by hand; the Lunhui strategies are A-share and not evaluable.
    - **A new item after 5: the pre-market screen.** It is decided after spike 7, the operator's keyed measurement of the free feed. Two designs exist, neither built; `p3-p4-interfaces.md` §0 finding 12 has the mechanics.
      - **(A) No bed.** A producer-only order after the close batch-fetches about 300 sessions of daily bars, in `capture_broad`'s 100-symbol batches. It runs `build_universe(GuardedSource(src, AsOfGuard(day)), day, screen=…)` over the derived cross-section and writes JSON for the report.
      - **(B) `extend_bed`.** A writer appends one session per symbol, with that day's snapshot and its true `prev_close`.
      - Either design also gives the brief live breadth (§13).
      - Never `capture_window` over a bed: it replaces whole files, takes `prev_close` only from the window, and re-hashes the bed.
      - Never `role_screener` on the desk: it inherits the desk mask, which has no shell and no `screen`.
      - Done when a report's screen line says it ran.
- [ ] **Step 3: `face/README.md`.**
  - **"The desk" gains "Strategy reports",** covering:
    - what a report holds, screen line first;
    - setup: `STANDING.md` from the template, `status.yaml`'s three keys, `levels.yml` from `levels.example.yml`;
    - arming, from the checkout the service runs: `npm run desk -- arm strategies/<name> --id <id> --at open-90m --producer builtin:report --expires <YYYY-MM-DD>`. The id is lowercase letters, digits and dashes, at most 40 characters, e.g. `<name>-report`;
    - `rearm` after every edit;
    - the `open-Nm` room rule;
    - file order and the cut-off: arm long lists earlier, e.g. `open-120m`;
    - the fence, symlinks included;
    - the outside-reports line and `reports/`;
    - ruling 14's recovery: delete the order's block in `standing.yml`, then `arm`;
    - this plan's phone lines.
  - **"The desk drill" gains its P4 half:**
    1. Commit a US strategy's `THESIS.md`, a filled `status.yaml` and `STANDING.md`, and write its `levels.yml` from the example.
    2. Arm its report at `open-90m`.
    3. On three sessions, confirm that the report reached the phone before the open, quoted each level's print with its source and time, and said the screen did not run and why, and that the Desk panel shows `delivered`.
    4. Edit one level: the next report is refused with its line. Run `rearm`, and the next one runs.
- [ ] **Step 4: `ROADMAP.md`, `CLAUDE.md` and the spec.**
  - **`ROADMAP.md`:**
    - item (2) reads "P0–P4 built (each plan's done criterion is the operator's drill)";
    - Part II gains the P4 entry: plan path, commit range, the drill owed, the screen after spike 7.
  - **`CLAUDE.md`:** P2's clock row adds `report` and names `builtin:report` beside `builtin:brief`. The real-boot count is unchanged.
  - **The spec:**
    - an "As built (P4)" note under §5.9's report bullet: no Python, no bars; ruling 1's print rule; the screen line first; `levelsSha256`, which holds D20 for a strategy's own firings; the cut-off at start; the `open-Nm` room rule; `reports/`; the screen's options;
    - §13's "Roles on the desk" closed: roles stay off; the screen is a producer.
- [ ] **Step 5: `Gravit-Docs-and-Prompt-Loops.html`** (P2-18, P4-7). Write in Chinese, like the page, and set its "written against" line to this branch's head. Add three loops, station by station, each naming the documents and prompts it passes: `GRAVIT.md`, `desk.md` as `gravit:desk`, the provenance line, the inline `STANDING.md`, the producer block.
  - **The phone:** Telegram → bridge → desk conversation → supervised turn → deliver.
  - **The schedule:** tick → check (the pins, the fence) → producer (`builtin:brief` or `builtin:report`) → fresh `gravit-desk` session → turn → deliver, or withhold after the cut-off.
  - **The alert:** P3's watch → send → annotation.
- [ ] **Step 6: Verify and commit.** Run `cd face && npm test && npm run typecheck`, `FACE_SMOKE=1 npm test` and `python -m pytest`. Every count in the documents must match the run.

```bash
git add Gravit-Design.md DEVELOPMENT.md face/README.md ROADMAP.md CLAUDE.md docs/superpowers/specs/2026-10-19-always-on-gravit-design.md Gravit-Docs-and-Prompt-Loops.html
git commit -m "docs: the desk P4 - the pre-market report, charter D20 held for a strategy's own firings, the screen's options after spike 7, the desk's loops"
```

---

## Pre-flight conflict scan

The SDD pre-flight scan, corrected by `p4-plan-review.md`'s conflict table. That table's part A checks every name P4 consumes against its source. Every pair and every task below agrees; the notes say what keeps it so.

### A. Task pairs that share a file or an interface

| Pair | Shared | Note |
|---|---|---|
| T1→T2, T3 | `readDeskFile`, `parseLevels`, `BUILTIN_PRODUCERS`, `VerifiedLevels`, `reportProducer` | `levelsPin` lives in `desk-book.ts`, so `standing.ts` imports no loader and no import cycle forms; the checked bytes are the bytes the report reads |
| T2→T3, T5 | `needsLevelsPin`, `LEVELS_NONE`, `levelsSha256`, `rehashOrder`, `appendOrder`, the room rule | the smoke's short anchors carry short deadlines |
| T3→T4 | `firing.ts`, `schedule.ts` and their tests | sequential: T3 adds the check, status and builtins; T4 adds the lines, the cut-off and the walk seam |
| T3→T5 | `deskBuiltins`' merge | unit-tested in T3, end to end in case 11 |
| T1, T4→T5, T6 | the template, the block's keys, the strategy lines | the smoke and the documents quote them |

### B. Each task against itself

Each task's tests pin only its own rules.

### C. P4's changes to P1, P2 and P3 files, and to other branches

| File (owners) | Collision |
|---|---|
| `producer.ts`, `desk-book.ts` (P2 T1, T4; P3 T2) | `report` becomes known. `readDeskFile`, `parseLevels` and `levelsPin` are added. `loadLevels` keeps its read and its `sha256`, which P3's watch keys on. |
| `desk-weight.test.ts` (P2 T8; P3 T8) | append-only |
| `standing.ts`, `scripts/desk.ts`, `desk-cli.test.ts` (P2 T3; P3 T3) | one key; the room rule for `open`; the levels part of the `arm`/`rearm` lines; P3's usage line, which has `unmute`, is kept |
| `firing.ts`, `schedule.ts` (P2 T7, T8, `9e0a4c2`; P3 T9) | disjoint regions. `deskBuiltins` keeps P3's `briefProducer({ …, home })`, and P2's whole-map seam becomes a per-name merge. |
| `desk-session.ts` (P1 T6) | `createDeskAgent` gains `make`; the default keeps P1's behaviour |
| `standingLines`, `client/desk-standing.js` (P2 T9) | three lines; one cell |
| `client/grouping.js`, `client/chat.js` (P1 T9) | `channelSessionIds`, the channel page's call, and the bucket order |
| `schedule-smoke.test.ts` (P2 T10; P3's watch runs inside it) | `watchRow`, the fake hub's two methods, filtered assertions, and cases after case 10 |
| `strategies/_template/*` (`createChannel` copies it) | every new channel is born with `STANDING.md` and `levels.example.yml`; this is intended, and they arrive unarmed |
| the hub, `desk.ts` (P3) | P4 uses only `snapshot` and edits only `standingLines` |
| charter D20 (P3 T11); the loops page (P4-7) | T6 rewrites P3's row and writes the page |
| `feat/lunhui-graft` | P4 edits neither `channels.ts` nor `GRAVIT.md`. Both branches edit `CLAUDE.md`, `DEVELOPMENT.md` and `face/README.md`; the second branch to merge resolves them. |
| `feat/gravit-face` (it replaces `face/client`) | the `desk-standing.js`, `grouping.js` and `chat.js` edits move when it lands, as P1 T9's and P2 T9's do |
