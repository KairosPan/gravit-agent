"""Daily bars for one US symbol, for the face's Market page chart (GET /data/bars).

Keys first: with both APCA keys in the environment the live Alpaca source is
read - RAW, unadjusted - under a deadline; without them, or when the live read
fails or runs out of time, the PIT bed is read instead and stamped with the
bed's as-of day. Every read goes through GuardedSource + AsOfGuard at the
window's end. The route passes exactly two arguments, both checked there and
checked again here: the symbol (the face's us grammar) and a day count.
Nothing from an exception reaches stdout.
"""
from __future__ import annotations

import json
import math
import os
import re
import signal
import sys
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

from alpaca_kit.firewall import AsOfGuard
from alpaca_kit.source import GuardedSource

REPO_ROOT = Path(__file__).resolve().parents[1]
SYMBOL_RE = re.compile(r"^[A-Z][A-Z0-9.-]{0,14}$")
DAYS_RANGE = (5, 730)
LIVE_DEADLINE_S = 12.0
COLUMNS = ("open", "high", "low", "close", "volume")


def _number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def bars_payload(source, symbol, start, end, *, source_name, feed, as_of):
    """One window of daily bars, oldest first; missing values stay null, never zero."""
    frame = GuardedSource(source, AsOfGuard(end)).daily_bars(symbol, start, end)
    rows = []
    if frame is not None and not frame.empty and "date" in frame:
        frame = frame.copy()
        frame["date"] = pd.to_datetime(frame["date"]).dt.date
        # GuardedSource checks the request; slice too in case a source ignores the bounds.
        frame = frame[(frame["date"] >= start) & (frame["date"] <= end)].sort_values("date")
        for record in frame.to_dict(orient="records"):
            rows.append({"date": record["date"].isoformat(), **{key: _number(record.get(key)) for key in COLUMNS}})
    return {"ok": True, "id": f"us:{symbol}", "symbol": symbol, "source": source_name, "feed": feed,
            "as_of": as_of.isoformat(), "rows": rows}


def _with_deadline(read, seconds):
    """Run `read`, raising TimeoutError once `seconds` pass (SIGALRM: the CLI runs on the main thread)."""
    def on_alarm(signum, frame):
        raise TimeoutError("the live read ran past its deadline")

    previous = signal.signal(signal.SIGALRM, on_alarm)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        return read()
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


def _has_keys(env):
    return bool(env.get("APCA_API_KEY_ID")) and bool(env.get("APCA_API_SECRET_KEY"))


def pick(env, symbol, days, today, *, live_factory, bed_factory, deadline_s=LIVE_DEADLINE_S):
    """Live bars when the keys are there and the read succeeds in time, else the bed's, else a fixed error."""
    if _has_keys(env):
        def live():
            feed = (env.get("ALPHA_DATA_FEED") or "iex").strip().lower() or "iex"
            payload = bars_payload(live_factory(), symbol, today - timedelta(days=days), today,
                                   source_name="alpaca", feed=feed, as_of=today)
            if payload["rows"]:
                payload["as_of"] = payload["rows"][-1]["date"]
            return payload

        try:
            return _with_deadline(live, deadline_s)
        except Exception:
            pass  # the bed below; why the live read failed never reaches stdout
    bed = bed_factory()
    if bed is None:
        return {"ok": False, "error": "no bar source"}
    source, as_of = bed
    return bars_payload(source, symbol, as_of - timedelta(days=days), as_of, source_name="bed", feed=None, as_of=as_of)


def _live_source():
    from alpaca_kit.registry import make_source

    return make_source("alpaca")


def _bed():
    """The PIT bed's source and its as-of day: the last calendar day with a captured snapshot."""
    from alpaca_kit.pit.pit_store import PITStore
    from alpaca_kit.pit.snapshot_source import SnapshotSource

    root = Path(os.environ.get("ALPHA_PIT_ROOT") or REPO_ROOT / "data/pit/2yr").resolve()
    if not root.exists():
        return None
    store = PITStore(root)
    days = [day for day in store.get_calendar() or [] if store.has_snapshot(day)]
    if not days:
        return None
    return SnapshotSource(store), max(days)


def main(argv) -> int:
    if (len(argv) != 3 or not SYMBOL_RE.fullmatch(argv[1]) or not re.fullmatch(r"[0-9]+", argv[2])
            or not DAYS_RANGE[0] <= int(argv[2]) <= DAYS_RANGE[1]):
        print(json.dumps({"ok": False, "error": "invalid request"}))
        return 1
    try:
        payload = pick(os.environ, argv[1], int(argv[2]), date.today(), live_factory=_live_source, bed_factory=_bed)
        output = json.dumps(payload, allow_nan=False)
    except Exception as exc:
        # The route serves its previous cache after a broken read. Never a path, an
        # environment value or a traceback in a response: the type name goes to stderr only.
        print(f"face_bars: failed ({type(exc).__name__})", file=sys.stderr)
        print(json.dumps({"ok": False, "error": "bars unavailable"}))
        return 1
    print(output)
    return 0 if payload.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
