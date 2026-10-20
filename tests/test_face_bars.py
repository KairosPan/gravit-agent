"""face_bars.py: keys-first daily bars for one US symbol, the PIT bed behind them, guarded reads, fixed words."""
import json
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import face_bars

KEYS = {"APCA_API_KEY_ID": "k", "APCA_API_SECRET_KEY": "s"}
TODAY = date(2026, 10, 19)
BED_AS_OF = date(2026, 7, 9)


class Bars:
    """A source whose daily_bars returns `closes` on consecutive days ending at `last`, ignoring the bounds asked."""

    def __init__(self, last, closes, sleep=0.0, fail=None):
        self.last, self.closes, self.sleep, self.fail = last, closes, sleep, fail
        self.calls = []

    def daily_bars(self, symbol, start, end):
        self.calls.append((symbol, start, end))
        if self.sleep:
            time.sleep(self.sleep)
        if self.fail:
            raise self.fail
        n = len(self.closes)
        days = [self.last - timedelta(days=n - 1 - i) for i in range(n)]
        return pd.DataFrame({"date": days, "open": self.closes, "high": self.closes, "low": self.closes,
                             "close": self.closes, "volume": [100] * n})


def bed_of(as_of=BED_AS_OF):
    source = Bars(as_of, [20.0, 21.0, 22.0])
    return source, (lambda: (source, as_of))


def test_payload_shape_dates_and_nulls():
    source = Bars(BED_AS_OF, [10.0, float("nan"), 12.5])
    payload = face_bars.bars_payload(source, "AAPL", date(2026, 7, 1), BED_AS_OF, source_name="bed", feed=None, as_of=BED_AS_OF)
    assert payload["ok"] is True
    assert payload["id"] == "us:AAPL" and payload["symbol"] == "AAPL"
    assert payload["source"] == "bed" and payload["feed"] is None and payload["as_of"] == "2026-07-09"
    assert [row["date"] for row in payload["rows"]] == ["2026-07-07", "2026-07-08", "2026-07-09"]
    assert [row["close"] for row in payload["rows"]] == [10.0, None, 12.5]
    assert set(payload["rows"][0]) == {"date", "open", "high", "low", "close", "volume"}
    json.dumps(payload, allow_nan=False)


def test_rows_stay_inside_the_window_when_the_source_ignores_bounds():
    source = Bars(date(2026, 7, 12), [1.0] * 10)
    payload = face_bars.bars_payload(source, "AAPL", date(2026, 7, 5), BED_AS_OF, source_name="bed", feed=None, as_of=BED_AS_OF)
    assert [row["date"] for row in payload["rows"]] == ["2026-07-05", "2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09"]


def test_keys_present_read_live_first():
    live = Bars(TODAY - timedelta(days=1), [5.0, 6.0])
    bed_calls = []

    def bed():
        bed_calls.append(1)
        return None

    payload = face_bars.pick(KEYS, "AAPL", 30, TODAY, live_factory=lambda: live, bed_factory=bed)
    assert payload["source"] == "alpaca" and payload["feed"] == "iex"
    assert payload["as_of"] == (TODAY - timedelta(days=1)).isoformat(), "the last bar's day"
    assert live.calls == [("AAPL", TODAY - timedelta(days=30), TODAY)]
    assert bed_calls == []
    sip = face_bars.pick({**KEYS, "ALPHA_DATA_FEED": " SIP "}, "AAPL", 30, TODAY, live_factory=lambda: live, bed_factory=bed)
    assert sip["feed"] == "sip"


def test_a_failing_live_read_falls_to_the_bed_with_its_as_of():
    bed_source, bed = bed_of()
    live = Bars(TODAY, [1.0], fail=RuntimeError("GET /v2/stocks -> HTTP 403"))
    payload = face_bars.pick(KEYS, "AAPL", 120, TODAY, live_factory=lambda: live, bed_factory=bed)
    assert payload["source"] == "bed" and payload["feed"] is None and payload["as_of"] == "2026-07-09"
    assert bed_source.calls == [("AAPL", BED_AS_OF - timedelta(days=120), BED_AS_OF)]
    assert all(row["date"] <= "2026-07-09" for row in payload["rows"])
    assert "403" not in json.dumps(payload)


def test_a_live_read_past_the_deadline_falls_to_the_bed():
    _, bed = bed_of()
    live = Bars(TODAY, [1.0], sleep=2.0)
    started = time.monotonic()
    payload = face_bars.pick(KEYS, "AAPL", 30, TODAY, live_factory=lambda: live, bed_factory=bed, deadline_s=0.2)
    assert time.monotonic() - started < 1.5
    assert payload["source"] == "bed"


def test_no_keys_read_the_bed():
    _, bed = bed_of()
    live_calls = []
    payload = face_bars.pick({}, "AAPL", 30, TODAY, live_factory=lambda: live_calls.append(1), bed_factory=bed)
    assert payload["source"] == "bed" and live_calls == []
    one_key = face_bars.pick({"APCA_API_KEY_ID": "k"}, "AAPL", 30, TODAY, live_factory=lambda: live_calls.append(1), bed_factory=bed)
    assert one_key["source"] == "bed" and live_calls == []


def test_no_keys_and_no_bed_is_a_fixed_error():
    payload = face_bars.pick({}, "AAPL", 30, TODAY, live_factory=lambda: None, bed_factory=lambda: None)
    assert payload == {"ok": False, "error": "no bar source"}


@pytest.mark.parametrize("argv", [
    ["x", "aapl", "120"], ["x", "AAPL", "4"], ["x", "AAPL", "731"], ["x", "-rf", "120"], ["x", "AAPL"],
    ["x", "AAPL\n", "120"], ["x", "AAPL", "1e2"], ["x", "AAPL", " 60"], ["x", "../AAPL", "60"],
])
def test_main_refuses_a_bad_symbol_or_day_count_without_reading(argv, monkeypatch, capsys):
    monkeypatch.setattr(face_bars, "pick", lambda *a, **k: pytest.fail("a refused request must not read"))
    assert face_bars.main(argv) == 1
    assert json.loads(capsys.readouterr().out) == {"ok": False, "error": "invalid request"}


def test_main_never_prints_exception_text(monkeypatch, capsys):
    def boom(*a, **k):
        raise RuntimeError("SECRET /Users/x")

    monkeypatch.setattr(face_bars, "pick", boom)
    assert face_bars.main(["x", "AAPL", "120"]) == 1
    captured = capsys.readouterr()
    assert json.loads(captured.out) == {"ok": False, "error": "bars unavailable"}
    assert "SECRET" not in captured.out and "SECRET" not in captured.err
    assert "RuntimeError" in captured.err


def test_main_prints_the_payload_and_exits_by_ok(monkeypatch, capsys):
    seen = []
    monkeypatch.setattr(face_bars, "pick", lambda env, symbol, days, today, **k: seen.append((symbol, days)) or {"ok": True, "rows": []})
    assert face_bars.main(["x", "BRK.B", "60"]) == 0
    assert json.loads(capsys.readouterr().out) == {"ok": True, "rows": []}
    assert seen == [("BRK.B", 60)]
    monkeypatch.setattr(face_bars, "pick", lambda *a, **k: {"ok": False, "error": "no bar source"})
    assert face_bars.main(["x", "AAPL", "120"]) == 1
    assert json.loads(capsys.readouterr().out) == {"ok": False, "error": "no bar source"}


def test_every_read_goes_through_the_firewall(monkeypatch):
    guarded = []
    original = face_bars.GuardedSource

    class Recording(original):
        def daily_bars(self, symbol, start, end):
            guarded.append((symbol, start, end, self._guard._as_of))
            return super().daily_bars(symbol, start, end)

    monkeypatch.setattr(face_bars, "GuardedSource", Recording)
    bed_source, bed = bed_of()
    face_bars.pick({}, "AAPL", 30, TODAY, live_factory=lambda: None, bed_factory=bed)
    live = Bars(TODAY - timedelta(days=1), [1.0, 2.0])
    face_bars.pick(KEYS, "AAPL", 30, TODAY, live_factory=lambda: live, bed_factory=bed)
    raw = bed_source.calls + live.calls
    assert [g[:3] for g in guarded] == raw, "every raw read went through GuardedSource"
    assert [g[3] for g in guarded] == [BED_AS_OF, TODAY], "guarded at the window's end"
