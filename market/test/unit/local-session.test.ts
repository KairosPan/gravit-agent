import { describe, expect, it } from "vitest";
import { SESSIONS, localSession } from "../../src/live/local-session.ts";

const at = (iso: string) => Date.parse(iso);

describe("localSession", () => {
  it("Hong Kong: trading, midday, closed", () => {
    expect(localSession(SESSIONS.hk, at("2026-11-23T10:00:00+08:00")).phase).toBe("trading");
    expect(localSession(SESSIONS.hk, at("2026-11-23T12:30:00+08:00"))).toEqual({ phase: "midday", lastSession: "2026-11-23" });
    expect(localSession(SESSIONS.hk, at("2026-11-23T16:01:00+08:00")).phase).toBe("closed");
  });
  it("a weekend is closed with the Friday as last session", () => {
    for (const h of [0, 10, 23]) {
      const s = localSession(SESSIONS.hk, at(`2026-11-21T${String(h).padStart(2, "0")}:00:00+08:00`));
      expect(s).toEqual({ phase: "closed", lastSession: "2026-11-20" });
    }
    expect(localSession(SESSIONS.hk, at("2026-11-22T12:00:00+08:00")).lastSession).toBe("2026-11-20");
  });
  it("before the first window the last session is the weekday before", () => {
    expect(localSession(SESSIONS.hk, at("2026-11-23T08:00:00+08:00"))).toEqual({ phase: "closed", lastSession: "2026-11-20" });
    expect(localSession(SESSIONS.hk, at("2026-11-24T08:00:00+08:00")).lastSession).toBe("2026-11-23");
  });
  it("a last trade that is not today's makes the weekday closed", () => {
    const now = at("2026-11-23T10:00:00+09:00");
    expect(localSession(SESSIONS.kr, now, "2026-11-20").phase).toBe("closed");
    expect(localSession(SESSIONS.kr, now, "2026-11-23").phase).toBe("trading");
    expect(localSession(SESSIONS.kr, now, "2026-11-23T09:58:00+09:00").phase).toBe("trading");
    expect(localSession(SESSIONS.kr, now, "2026-11-20T06:00:00Z").phase).toBe("closed");
  });
  it("Tokyo at 15:29 trades; Tokyo lunch is midday", () => {
    expect(localSession(SESSIONS.jp, at("2026-11-24T15:29:00+09:00")).phase).toBe("trading");
    expect(localSession(SESSIONS.jp, at("2026-11-24T12:00:00+09:00")).phase).toBe("midday");
  });
  it("a single-window market has no midday", () => {
    expect(localSession(SESSIONS.tw, at("2026-11-23T14:00:00+08:00")).phase).toBe("closed");
  });
});
