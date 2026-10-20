/** America/New_York, the desk's clock: the operator's and the market's. Every time the desk shows
 * the operator is written in it - `14:03 ET` on the phone and in `npm run service -- status`,
 * `2026-10-20` in a provenance line - and its day, from 00:00 ET, is the day the desk counts its
 * turns and their tokens in (spec §5.8). The zone is named rather than taken from the machine, so
 * a face or a test run under another zone reads the same.
 *
 * One `Intl.DateTimeFormat` serves all three helpers: `hourCycle: "h23"`, so midnight is `00` and
 * never `24`; and `timeZoneName: "shortOffset"`, whose `GMT-4` or `GMT-5` is how
 * {@link etDayStart} finds the offset in force at a midnight. EDT and EST both print as `ET`: the
 * operator reads the hour on the wall clock, not the offset.
 * @module
 */

const FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZoneName: "shortOffset",
});

/** The fields of {@link FORMAT}'s parts the helpers read. */
type Field = "year" | "month" | "day" | "hour" | "minute" | "timeZoneName";

/** `d` in New York, field by field: `2026`, `10`, `20`, `14`, `03`, `GMT-4`. */
function partsOf(d: Date): Record<Field, string> {
  const parts: Record<Field, string> = { year: "", month: "", day: "", hour: "", minute: "", timeZoneName: "" };
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
