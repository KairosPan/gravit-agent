"""market_clock - the face's market clock: XNYS sessions from pandas_market_calendars, as JSON.

    python3 scripts/market_clock.py sessions --from 2026-11-24 --days 10

prints every session from --from through the --days-th day (1-31): its date, its open and its close
as UTC instants to the second (`2026-11-27T14:30:00Z`), and `early` on the exchange's early closes.
A holiday or a weekend is a date with no session. DST is inside the instants, and New York changes
its offset on Sundays, when XNYS never trades, so the offset is constant on every session date. The
face (face/src/market-clock.ts) asks for ten days at its boot and on each New York date change, and
anchors its standing orders on these instants (rulings P2-1, P2-10).

Exit contract, JSON always on stdout: 0 with `{"ok": true, ...}`; 2 with the usage line for any other
argv, checked before the calendar is imported; 1 with `{"ok": false, "error": ...}` when
pandas_market_calendars is not importable in this interpreter - the error names it, since the face
runs `FACE_PYTHON || python3` - or when the calendar itself fails.

Read-only and keyless: it imports no network or order path and reads no key; the face runs it with
PATH, HOME, LANG, TZ and LC_* only, and a test greps the source for it. The calendar is as good as the
installed pandas_market_calendars: a closure announced after its release is unknown until an upgrade.

Pinned by a constant in the face's own code: the face runs this file only when its bytes hash to
MARKET_CLOCK_SHA256 (face/src/market-clock.ts), from a private copy under $DSH_HOME/face/desk/run,
as `python -I` - isolated, so neither the repository nor this file's directory is on sys.path. It
imports nothing from the repository. An edit here moves that constant too; a test fails until it does.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import date, timedelta, timezone

CALENDAR = "XNYS"
MAX_DAYS = 31
USAGE = f"usage: market_clock.py sessions --from YYYY-MM-DD --days N (1-{MAX_DAYS})"
_DATE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
_DAYS = re.compile(r"[1-9][0-9]?")


def _instant(ts) -> str:
    """A zoned timestamp (a pandas Timestamp or a datetime) as a UTC instant to the second. A time
    without a zone is refused: read in the machine's zone, it would move every anchor silently."""
    if ts.tzinfo is None:
        raise ValueError(f"the calendar gave a time without a zone: {ts}")
    return ts.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sessions_payload(cal, start: date, days: int, source: str) -> dict:
    """The sessions of `cal` (a pandas_market_calendars calendar, or anything with its `schedule` and
    `early_closes`) from `start` through `start + days - 1`, in the clock's JSON shape. Pure: `cal` is
    only read. An empty schedule never reaches `early_closes`, which pandas_market_calendars 5.4.0
    cannot run on one."""
    schedule = cal.schedule(start_date=start, end_date=start + timedelta(days=days - 1))
    sessions = []
    if not schedule.empty:
        early = {ts.date() for ts in cal.early_closes(schedule).index}
        for ts, opens, closes in zip(schedule.index, schedule["market_open"], schedule["market_close"]):
            day = ts.date()
            sessions.append({"date": day.isoformat(), "open": _instant(opens), "close": _instant(closes), "early": day in early})
    return {"ok": True, "calendar": CALENDAR, "source": source, "python": sys.executable,
            "from": start.isoformat(), "days": days, "sessions": sessions}


def _arguments(argv: list[str]) -> tuple[date, int] | None:
    """`(start, days)` from exactly `sessions --from YYYY-MM-DD --days N`, N 1-31 in ASCII digits; else None."""
    if len(argv) != 5 or argv[0] != "sessions" or argv[1] != "--from" or argv[3] != "--days":
        return None
    if not _DATE.fullmatch(argv[2]) or not _DAYS.fullmatch(argv[4]) or int(argv[4]) > MAX_DAYS:
        return None
    try:
        return date.fromisoformat(argv[2]), int(argv[4])
    except ValueError:
        return None


def _emit(payload: dict, code: int) -> int:
    print(json.dumps(payload))
    return code


def main(argv: list[str]) -> int:
    parsed = _arguments(argv)
    if parsed is None:
        return _emit({"ok": False, "error": USAGE}, 2)
    try:
        import pandas_market_calendars as mcal
    except Exception:
        return _emit({"ok": False, "error": f"pandas_market_calendars is not importable in {sys.executable}"}, 1)
    try:
        payload = sessions_payload(mcal.get_calendar(CALENDAR), *parsed, f"pandas_market_calendars {mcal.__version__}")
    except Exception as error:
        return _emit({"ok": False, "error": f"the {CALENDAR} calendar failed: {type(error).__name__}: {error}"}, 1)
    return _emit(payload, 0)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
