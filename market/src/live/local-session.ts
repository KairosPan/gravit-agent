/** The local regions' session clock: trading, midday or closed from a market's own hours in its own zone, weekdays only. A weekday holiday is
 * caught by the source's last trade: when it is not today's local date the word is "closed". Other holidays are not modelled. */
import type { CnSession } from "./cn-session.ts";

export interface SessionHours { zone: string; windows: Array<[string, string]> }

export const SESSIONS: Record<"us" | "hk" | "kr" | "tw" | "jp" | "in" | "xetr" | "xlon" | "xpar", SessionHours> = {
  us: { zone: "America/New_York", windows: [["09:30", "16:00"]] },
  hk: { zone: "Asia/Hong_Kong", windows: [["09:30", "12:00"], ["13:00", "16:00"]] },
  kr: { zone: "Asia/Seoul", windows: [["09:00", "15:30"]] },
  tw: { zone: "Asia/Taipei", windows: [["09:00", "13:30"]] },
  jp: { zone: "Asia/Tokyo", windows: [["09:00", "11:30"], ["12:30", "15:30"]] },
  in: { zone: "Asia/Kolkata", windows: [["09:15", "15:30"]] },
  xetr: { zone: "Europe/Berlin", windows: [["09:00", "17:30"]] },
  xlon: { zone: "Europe/London", windows: [["08:00", "16:30"]] },
  xpar: { zone: "Europe/Paris", windows: [["09:00", "17:30"]] },
};

const formats = new Map<string, Intl.DateTimeFormat>();
function parts(zone: string, ms: number): { date: string; weekday: number; minutes: number } {
  let f = formats.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    formats.set(zone, f);
  }
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(ms)) p[x.type] = x.value;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday!);
  return { date: `${p.year}-${p.month}-${p.day}`, weekday, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
const minutesOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** The weekday on or before `date` (`YYYY-MM-DD`), going back one day first when `before` is set */
function weekdayOnOrBefore(date: string, weekday: number, before: boolean): string {
  let back = before ? 1 : 0;
  let wd = before ? (weekday + 6) % 7 : weekday;
  if (wd === 0) { back += 2; } else if (wd === 6) { back += 1; }
  if (back === 0) return date;
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

export function localSession(h: SessionHours, nowMs: number, lastTrade?: string | null): CnSession {
  const now = parts(h.zone, nowMs);
  const first = minutesOf(h.windows[0]![0]);
  const weekday = now.weekday >= 1 && now.weekday <= 5;
  // the latest weekday whose first window has opened: today once it has, else the weekday before
  const opened = weekday && now.minutes >= first;
  const lastSession = weekdayOnOrBefore(now.date, now.weekday, !opened && weekday);
  if (!weekday) return { phase: "closed", lastSession };
  let phase: CnSession["phase"] = "closed";
  const inside = h.windows.some(([a, b]) => now.minutes >= minutesOf(a) && now.minutes < minutesOf(b));
  if (inside) phase = "trading";
  else if (h.windows.length > 1 && now.minutes >= minutesOf(h.windows[0]![1]) && now.minutes < minutesOf(h.windows[h.windows.length - 1]![0])) phase = "midday";
  if (phase !== "closed" && lastTrade) {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(lastTrade) ? lastTrade : (Number.isNaN(Date.parse(lastTrade)) ? null : parts(h.zone, Date.parse(lastTrade)).date);
    if (day !== null && day !== now.date) phase = "closed";
  }
  return { phase, lastSession };
}
