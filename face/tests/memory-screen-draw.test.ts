/** The Memory screen drawn from a real home: a gravit-memory home made by the package's own `initHome` under the system's
 * temporary directory and filled through its API - cards armed, changed, unarmed, retired, broken and refused; decisions
 * of the owner's and an agent's, one void and one with no symbol; proposals of the three kinds; a price run that asked the
 * source and was refused - read through src/memory-screen.ts `createMemoryScreen`, passed through JSON as the routes send
 * it, and drawn by the client's `renderMemoryScreen` on each of the four tabs. No tab's HTML holds `undefined`, `NaN`,
 * `[object Object]` or an empty pair of quotes, and each holds one true sentence taken from the home's content.
 *
 * A pure read of the package and the screen: nothing of the face is booted or composed, nothing reaches the network (the
 * price source is a stub `fetch` handed to the package), and the home is removed afterwards.
 * @module
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initHome, openMemory } from "gravit-memory";
import { createMemoryScreen } from "../src/memory-screen.ts";
import { reducers as R } from "../client/js/reducers/index.js";
import { emptyState } from "../client/js/data/empty.js";
import { renderMemoryScreen } from "../client/js/render/memory-page.js";

const DAY = 24 * 60 * 60 * 1000;
const TABS = ["lessons", "decisions", "waiting", "health"] as const;

/** A card the package accepts: every checked fact defined by the card. */
const card = (id: string, extra: Record<string, unknown> = {}) => ({ id, says: "dont", actions: ["buy", "add"], strength: "caveat", scope: { market: ["US"] }, words: `Words of ${id}.`, ...extra });

/** A page's text: its tags dropped, its entities read. */
const textOf = (html: string): string => html.replace(/<[^>]*>/g, " ").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ");

test("the four tabs drawn from a real home: no undefined, NaN, object or empty quotes, and a true sentence on each", async () => {
  const parent = await mkdtemp(join(tmpdir(), "face-memory-screen-draw-"));
  const home = join(parent, "home dir");
  try {
    await initHome(home);
    const memory = openMemory(home);
    const propose = (id: string, extra: Record<string, unknown> = {}) => memory.propose("gravit", { what: "new", lesson: id, reason: `why ${id}`, card: card(id, extra) });

    /* The cards: armed with a check on a face fact and one on its own, changed, unarmed, retired, broken, refused. */
    const armed = await propose("no-chasing", { check: [{ fact: "change_5d_pct", op: ">", value: 8 }, { fact: "sector", op: "==", value: "semis" }],
      facts: { change_5d_pct: "How far the name ran in five sessions.", sector: "The sector the owner files the name under." } });
    await memory.owner.accept(armed.id);
    const changed = await propose("trim-strength");
    await memory.owner.accept(changed.id);
    await writeFile(join(home, "lessons", "trim-strength.md"), "---\nid: trim-strength\nsays: dont\nactions: [buy]\nstrength: caveat\n---\nChanged words.\n");
    const unarmed = await propose("add-below-stop");
    await memory.owner.edit(unarmed.id);
    const retired = await propose("gap-fade");
    await memory.owner.accept(retired.id);
    await memory.owner.retire("gap-fade", "not used");
    const broken = await propose("earnings-hold");
    await memory.owner.accept(broken.id);
    for (const name of await readdir(join(home, "armed"))) if (name.startsWith("earnings-hold.")) await rm(join(home, "armed", name));
    await writeFile(join(home, "lessons", "size-cap.md"), "no front matter here\n");
    await mkdir(join(home, "lessons", "a-dir.md"));

    /* The decisions: the owner's on a recall the armed card fires on, an agent's, a void one, one with no symbol. */
    const recall = await memory.recall("gravit-face", { considering: ["buy"], symbol: "NVDA", market: "US", facts: { change_5d_pct: 12, sector: "semis" }, fact_sources: { change_5d_pct: "the Market's daily bars", sector: "the owner" } });
    const own = await memory.record("gravit-face", { action: "pass", whose: "owner", thesis: "Passed on the run.", symbol: "NVDA", market: "US", wrong_if: "it holds the gap", words: "not this one", horizon: 5, recall: recall.recall_id });
    await memory.record("gravit", { action: "buy", whose: "agent", thesis: "The agent buys the read-through.", symbol: "AMD", market: "US", price: 100, price_source: "stub" });
    const gone = await memory.record("gravit", { action: "add", whose: "agent", thesis: "A mistake.", symbol: "NVDA", market: "US" });
    await memory.amend("gravit", { decision: gone.id, what: "void", reason: "typed wrong" });
    await memory.record("gravit", { action: "hold", whose: "agent", thesis: "Hold the book through the print." });

    /* The proposals: a new card, a change and a retire. */
    await propose("chase-gap", { check: [{ fact: "session", op: "in", value: ["open", "pre"] }], facts: { session: "The part of the day." } });
    await memory.propose("gravit", { what: "change", lesson: "no-chasing", reason: "eight fired too often", card: card("no-chasing", { check: [{ fact: "change_5d_pct", op: ">", value: 10 }], facts: { change_5d_pct: "The run in five sessions." } }), evidence: [own.id] });
    await memory.propose("gravit", { what: "retire", lesson: "trim-strength", reason: "unused in a year" });

    /* A price run a month on: the source named, asked for what is due, and refused. */
    const config = JSON.parse(await readFile(join(home, "config.json"), "utf8")) as { prices?: Record<string, unknown> };
    await writeFile(join(home, "config.json"), JSON.stringify({ ...config, prices: { ...config.prices, url: "http://127.0.0.1:9" } }));
    const later = openMemory(home, { now: () => Date.now() + 30 * DAY, fetch: (async () => new Response("no", { status: 503 })) as typeof fetch });
    await later.reconcile("gravit-face", { force: true });

    /* The four reads, as the routes send them, drawn on each tab. */
    const screen = createMemoryScreen({ open: async () => ({ connected: true, memory, home }) });
    const wire = async (read: () => Promise<object>) => JSON.parse(JSON.stringify({ ok: true, ...(await read()) })) as Record<string, unknown>;
    const bodies = { lessons: await wire(() => screen.lessons()), decisions: await wire(() => screen.decisions({})), waiting: await wire(() => screen.waiting()), health: await wire(() => screen.health()) };
    for (const body of Object.values(bodies)) assert.equal(body.connected, true);
    const prices = (bodies.health as { prices: { last?: { ok: boolean; refused: number; asked?: number } } }).prices;
    assert.ok(prices.last !== undefined && prices.last.ok === false && prices.last.refused > 0 && (prices.last.asked ?? 0) > 0, `a run that asked and was refused: ${JSON.stringify(prices)}`);

    const drawn: Record<string, string> = {};
    for (const tab of TABS) {
      let state = R.nav(emptyState(), { screen: "memory", tab });
      for (const read of TABS) state = R.memoryPageLoaded(state, { read, data: bodies[read], at: Date.now() });
      for (const row of bodies.lessons.lessons as { id: string }[]) state = R.memoryPageDiff(R.memoryPageToggle(state, { id: row.id }), { id: row.id });
      drawn[tab] = renderMemoryScreen(state, Date.now()) as string;
      for (const bad of ["undefined", "NaN", "[object Object]", "“”"]) assert.ok(!drawn[tab].includes(bad), `${tab} holds ${bad}`);
    }

    /* One true sentence a tab, from the home's content. */
    assert.ok(drawn.lessons.includes("<code class=\"mp-fact\">change_5d_pct &gt; 8</code>"), "the armed card's check, fact, operator and value");
    assert.ok(drawn.lessons.includes("How far the name ran in five sessions."), "the armed card's own definition of the face's fact");
    const nvda = drawn.decisions.slice(drawn.decisions.indexOf(">NVDA</h2>"));
    assert.ok(nvda.includes("“Passed on the run.”"), "the owner's thesis under its symbol's head");
    assert.ok(drawn.decisions.includes(">No symbol</h2>"), "a decision with no symbol under No symbol");
    assert.ok(textOf(drawn.waiting).includes("“eight fired too often”"), "a proposal's reason");
    assert.ok(textOf(drawn.waiting).includes("change to no-chasing"), "a change proposal's lesson");
    assert.ok(drawn.health.includes(`<code class="mp-fact">${home}</code>`), "the home's path");
    assert.match(textOf(drawn.health), /last asked \S+ \d+(, \d{4})? \d\d:\d\d · refused \d+ of \d+/, "the price run as the package wrote it");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
