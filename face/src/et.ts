/** America/New_York, the desk's clock: the operator's and the market's. Every time the desk shows
 * the operator is written in it - `14:03 ET` on the phone and in `npm run service -- status`,
 * `2026-10-20` in a provenance line, `IEX 15:21:03 ET` on a quote - and its day, from 00:00 ET, is
 * the day the desk counts its turns and their tokens in (spec §5.8). The zone is named rather than
 * taken from the machine, so a face or a test run under another zone reads the same.
 *
 * One `Intl.DateTimeFormat` serves all four helpers: `hourCycle: "h23"`, so midnight is `00` and
 * never `24`; and `timeZoneName: "shortOffset"`, whose `GMT-4` or `GMT-5` is how
 * {@link etDayStart} finds the offset in force at a midnight. EDT and EST both print as `ET`: the
 * operator reads the hour on the wall clock, not the offset.
 *
 * An A share's time is read on its own exchange's clock, Asia/Shanghai ({@link bjDate}, {@link bjClock},
 * {@link bjStamp}: `TENCENT 14:03:12 Beijing` on a quote), from a format of its own; Beijing keeps no daylight time.
 * @module
 */

const FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZoneName: "shortOffset",
});

/** The fields of {@link FORMAT}'s parts the helpers read. */
type Field = "year" | "month" | "day" | "hour" | "minute" | "second" | "timeZoneName";

/** `d` in New York, field by field: `2026`, `10`, `20`, `14`, `03`, `09`, `GMT-4`. */
function partsOf(d: Date): Record<Field, string> {
  const parts: Record<Field, string> = { year: "", month: "", day: "", hour: "", minute: "", second: "", timeZoneName: "" };
  for (const { type, value } of FORMAT.formatToParts(d)) {
    if (Object.hasOwn(parts, type)) parts[type as Field] = value;
  }
  return parts;
}

/** A `shortOffset` name as milliseconds ahead of UTC: `GMT-4` is -14,400,000, a bare `GMT` 0. The
 * sign may be ICU's minus sign as well as a hyphen. */
function offsetMsOf(name: string): number {
  const match = /^GMT(?:([+\-−])(\d{1,2})(?::(\d{2}))?)?$/.exec(name);
  if (match === null) throw new RangeError(`unexpected UTC offset from Intl: ${name}`);
  if (match[1] === undefined) return 0;
  const ms = (Number(match[2]) * 60 + Number(match[3] ?? 0)) * 60_000;
  return match[1] === "+" ? ms : -ms;
}

/** New York's offset at the instant `ms`, in milliseconds ahead of UTC - negative, New York being behind it. */
function offsetAt(ms: number): number {
  return offsetMsOf(partsOf(new Date(ms)).timeZoneName);
}

/**
 * The wall-clock time in New York, hours and minutes: `"14:03 ET"`, `"00:00 ET"` at midnight.
 * @param d - the instant.
 */
export function etTime(d: Date): string {
  const { hour, minute } = partsOf(d);
  return `${hour}:${minute} ET`;
}

/**
 * The wall-clock time in New York to the second, bare: `"15:21:03"`, `"00:00:00"` at midnight -
 * for a time quoted with its source, as a quote's is (`IEX 15:21:03 ET`).
 * @param at - the instant.
 */
export function etClock(at: Date): string {
  const { hour, minute, second } = partsOf(at);
  return `${hour}:${minute}:${second}`;
}

/**
 * The date in New York: `"2026-10-20"` - still the 20th at 02:30 UTC on the 21st.
 * @param d - the instant.
 */
export function etDate(d: Date): string {
  const { year, month, day } = partsOf(d);
  return `${year}-${month}-${day}`;
}

/**
 * The instant 00:00 America/New_York began the ET date that `ms` falls on, in ms since the epoch.
 *
 * The date's midnight read as if it were UTC, less the offset in force at that midnight. The
 * offset is asked twice: first at that UTC reading (19:00 or 20:00 ET the evening before), then at
 * the instant the first answer gives, which settles it should the offset change between the two.
 * New York changes it at 02:00, never across midnight, so the day of a change begins on the
 * offset of the night before it: the first Sunday of November begins at 00:00 EDT and runs 25
 * hours, the second Sunday of March at 00:00 EST and runs 23.
 * @param ms - an instant, in ms since the epoch.
 */
export function etDayStart(ms: number): number {
  const { year, month, day } = partsOf(new Date(ms));
  const wall = Date.UTC(Number(year), Number(month) - 1, Number(day));
  const first = wall - offsetAt(wall);
  return wall - offsetAt(first);
}

/* ---------- Beijing ---------- */

/** Asia/Shanghai, the A shares' clock: UTC+8 all year, with no daylight time. A separate format, so an A share's
 * time is read on its own exchange's wall clock, as a US share's is read on New York's. */
const BJ_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** `d` in Beijing, field by field. */
function bjPartsOf(d: Date): Record<Exclude<Field, "timeZoneName">, string> {
  const parts = { year: "", month: "", day: "", hour: "", minute: "", second: "" };
  for (const { type, value } of BJ_FORMAT.formatToParts(d)) {
    if (Object.hasOwn(parts, type)) parts[type as keyof typeof parts] = value;
  }
  return parts;
}

/**
 * The date in Beijing: `"2026-11-02"` at 16:30 UTC on the 1st.
 * @param d - the instant.
 */
export function bjDate(d: Date): string {
  const { year, month, day } = bjPartsOf(d);
  return `${year}-${month}-${day}`;
}

/**
 * The wall-clock time in Beijing to the second, bare: `"14:03:12"`, `"00:00:00"` at midnight.
 * @param d - the instant.
 */
export function bjClock(d: Date): string {
  const { hour, minute, second } = bjPartsOf(d);
  return `${hour}:${minute}:${second}`;
}

/**
 * An A share's quote time as the desk quotes one: `"14:03:12 Beijing"`, or `"2026-11-27 15:00:00 Beijing"` when
 * `asOf` falls on another Beijing date than `now`.
 * @param asOf - the quote's time.
 * @param now - the time the quote is read at.
 */
export function bjStamp(asOf: Date, now: Date): string {
  const date = bjDate(asOf);
  return date === bjDate(now) ? `${bjClock(asOf)} Beijing` : `${date} ${bjClock(asOf)} Beijing`;
}
