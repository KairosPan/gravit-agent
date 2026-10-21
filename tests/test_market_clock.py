"""market_clock (scripts/market_clock.py): the payload, the CLI's exit contract, and its fences.

sessions_payload is pure - it reads a calendar's schedule and early closes and returns JSON-ready
dicts - so a fake calendar drives it on any interpreter, while the calendar-backed tests pin the real
XNYS facts the face anchors on: 251 sessions in 2026, the two early closes at 18:00Z, the DST instants,
the holidays, and no session on a weekend or a DST-change day. Offline: the calendar is local data,
and every test that needs it calls pytest.importorskip("pandas_market_calendars") itself, so an
interpreter without it skips those. The usage, missing-calendar, planted-calendar and fence tests run
anywhere pytest does.
"""
from __future__ import annotations

import ast
import json
import os
import shutil
import subprocess
import sys
import types
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "market_clock.py"
sys.path.insert(0, str(SCRIPT.parent))
import market_clock  # noqa: E402

USAGE = {"ok": False, "error": "usage: market_clock.py sessions --from YYYY-MM-DD --days N (1-31)"}
NEW_YORK = ZoneInfo("America/New_York")


def _xnys():
    return pytest.importorskip("pandas_market_calendars").get_calendar("XNYS")


def _by_date(payload):
    return {s["date"]: s for s in payload["sessions"]}


def _instant(text):
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


class FakeCalendar:
    """The two calls sessions_payload makes, over a hand-written schedule of (date, open, close) texts.
    Its early_closes refuses an empty schedule, as pandas_market_calendars 5.4.0's does."""

    def __init__(self, rows, early=()):
        self.rows = rows
        self.early = {pd.Timestamp(d) for d in early}
        self.asked = []

    def schedule(self, start_date, end_date):
        self.asked.append((start_date, end_date))
        return pd.DataFrame(
            {"market_open": [pd.Timestamp(o) for _, o, _ in self.rows],
             "market_close": [pd.Timestamp(c) for _, _, c in self.rows]},
            index=pd.DatetimeIndex([pd.Timestamp(d) for d, _, _ in self.rows]))

    def early_closes(self, schedule):
        if schedule.empty:
            raise AttributeError("Can only use .dt accessor with datetimelike values")
        return schedule[[ts in self.early for ts in schedule.index]]


def _plant(monkeypatch, calendar=None, fail=None):
    """A stand-in pandas_market_calendars in sys.modules, so main imports it instead of the real one."""
    module = types.ModuleType("pandas_market_calendars")
    module.__version__ = "fake-1"
    module.asked = []

    def get_calendar(name):
        module.asked.append(name)
        if fail is not None:
            raise fail
        return calendar

    module.get_calendar = get_calendar
    monkeypatch.setitem(sys.modules, "pandas_market_calendars", module)
    return module


# ── the payload ─────────────────────────────────────────────────────────────────────────────────

def test_sessions_payload_is_pure_over_any_calendar():
    cal = FakeCalendar([("2026-11-24", "2026-11-24T14:30:00Z", "2026-11-24T21:00:00Z"),
                        ("2026-11-27", "2026-11-27T09:30:00-05:00", "2026-11-27T13:00:00-05:00")],
                       early=["2026-11-27"])
    p = market_clock.sessions_payload(cal, date(2026, 11, 24), 10, "fake 1.0")
    assert cal.asked == [(date(2026, 11, 24), date(2026, 12, 3))], "start through start + days - 1"
    assert p == {
        "ok": True, "calendar": "XNYS", "source": "fake 1.0", "python": sys.executable,
        "from": "2026-11-24", "days": 10,
        "sessions": [
            {"date": "2026-11-24", "open": "2026-11-24T14:30:00Z", "close": "2026-11-24T21:00:00Z", "early": False},
            # an instant in another zone is written in UTC
            {"date": "2026-11-27", "open": "2026-11-27T14:30:00Z", "close": "2026-11-27T18:00:00Z", "early": True},
        ],
    }
    assert json.loads(json.dumps(p)) == p


def test_a_schedule_without_a_session_is_an_empty_list_and_never_reaches_early_closes():
    p = market_clock.sessions_payload(FakeCalendar([]), date(2026, 11, 28), 2, "fake 1.0")
    assert (p["from"], p["days"], p["sessions"]) == ("2026-11-28", 2, [])


def test_a_time_without_a_zone_is_refused_rather_than_read_in_the_machines_zone():
    cal = FakeCalendar([("2026-11-24", "2026-11-24T14:30:00", "2026-11-24T21:00:00")])
    with pytest.raises(ValueError, match="without a zone"):
        market_clock.sessions_payload(cal, date(2026, 11, 24), 1, "fake 1.0")


def test_2026_has_251_sessions_and_two_early_closes():
    p = market_clock.sessions_payload(_xnys(), date(2026, 1, 1), 365, "x")
    assert len(p["sessions"]) == 251
    assert [(s["date"], s["close"]) for s in p["sessions"] if s["early"]] == [
        ("2026-11-27", "2026-11-27T18:00:00Z"), ("2026-12-24", "2026-12-24T18:00:00Z")]


def test_dst_instants_and_holidays():
    sessions = _by_date(market_clock.sessions_payload(_xnys(), date(2026, 1, 1), 365, "x"))
    # the last EST Friday, the first EDT Monday, the last EDT Friday, the first EST Monday
    assert [sessions[d]["open"] for d in ("2026-03-06", "2026-03-09", "2026-10-30", "2026-11-02")] == [
        "2026-03-06T14:30:00Z", "2026-03-09T13:30:00Z", "2026-10-30T13:30:00Z", "2026-11-02T14:30:00Z"]
    assert [sessions[d]["close"] for d in ("2026-03-06", "2026-03-09")] == ["2026-03-06T21:00:00Z", "2026-03-09T20:00:00Z"]
    assert sessions["2026-07-02"]["early"] is False and sessions["2026-07-02"]["close"] == "2026-07-02T20:00:00Z"
    for holiday in ("2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19",
                    "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"):
        assert holiday not in sessions, holiday


def test_no_session_in_2026_or_2027_falls_on_a_weekend():
    """DST changes fall on Sundays, so on a session date New York's offset is constant and HH:MM
    arithmetic from the date's midnight is exact."""
    p = market_clock.sessions_payload(_xnys(), date(2026, 1, 1), 730, "x")
    days = [date.fromisoformat(s["date"]) for s in p["sessions"]]
    assert len(days) == 502 and days[-1] <= date(2027, 12, 31)
    assert [d for d in days if d.weekday() >= 5] == []
    changes = [d for d in (date(2026, 1, 1) + timedelta(n) for n in range(730))
               if datetime(d.year, d.month, d.day, tzinfo=NEW_YORK).utcoffset()
               != datetime(d.year, d.month, d.day, 23, tzinfo=NEW_YORK).utcoffset()]
    assert changes == [date(2026, 3, 8), date(2026, 11, 1), date(2027, 3, 14), date(2027, 11, 7)]
    assert all(d.weekday() == 6 for d in changes)
    for s in p["sessions"]:  # every open and close falls on its session's New York date
        assert {_instant(s["open"]).astimezone(NEW_YORK).date(), _instant(s["close"]).astimezone(NEW_YORK).date()} == {
            date.fromisoformat(s["date"])}, s


# ── the CLI ─────────────────────────────────────────────────────────────────────────────────────

def test_cli_prints_the_window(capsys):
    _xnys()
    assert market_clock.main(["sessions", "--from", "2026-11-24", "--days", "10"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert (out["ok"], out["calendar"], out["from"], out["days"], out["python"]) == (True, "XNYS", "2026-11-24", 10, sys.executable)
    assert out["source"].startswith("pandas_market_calendars ")
    assert [s["date"] for s in out["sessions"]] == [
        "2026-11-24", "2026-11-25", "2026-11-27", "2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03"]
    assert _by_date(out)["2026-11-27"] == {
        "date": "2026-11-27", "open": "2026-11-27T14:30:00Z", "close": "2026-11-27T18:00:00Z", "early": True}


def test_cli_prints_an_empty_window_on_a_closed_stretch(capsys):
    _xnys()
    for argv in (["sessions", "--from", "2026-11-26", "--days", "1"],   # Thanksgiving
                 ["sessions", "--from", "2026-11-28", "--days", "2"]):  # a weekend
        assert market_clock.main(argv) == 0, argv
        assert json.loads(capsys.readouterr().out)["sessions"] == [], argv


def test_cli_runs_on_the_calendar_it_imports(monkeypatch, capsys):
    cal = FakeCalendar([("2026-11-27", "2026-11-27T14:30:00Z", "2026-11-27T18:00:00Z")], early=["2026-11-27"])
    planted = _plant(monkeypatch, calendar=cal)
    assert market_clock.main(["sessions", "--from", "2026-11-24", "--days", "10"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert planted.asked == ["XNYS"]
    assert out["source"] == "pandas_market_calendars fake-1"
    assert out["sessions"] == [{"date": "2026-11-27", "open": "2026-11-27T14:30:00Z", "close": "2026-11-27T18:00:00Z", "early": True}]


def test_a_failing_calendar_is_still_json_and_exit_1(monkeypatch, capsys):
    _plant(monkeypatch, fail=RuntimeError("no rules for XNYS"))
    assert market_clock.main(["sessions", "--from", "2026-11-24", "--days", "10"]) == 1
    assert json.loads(capsys.readouterr().out) == {"ok": False, "error": "the XNYS calendar failed: RuntimeError: no rules for XNYS"}


@pytest.mark.parametrize("argv", [
    [],
    ["sessions"],
    ["session", "--from", "2026-11-24", "--days", "10"],
    ["sessions", "--from", "2026-11-24", "--days", "0"],
    ["sessions", "--from", "2026-11-24", "--days", "32"],
    ["sessions", "--from", "2026-13-01", "--days", "10"],
    ["sessions", "--from", "2026-02-30", "--days", "10"],
    ["sessions", "--from", "20261124", "--days", "10"],
    ["sessions", "--from", "2026-11-24", "--days", "1.5"],
    ["sessions", "--from", "2026-11-24", "--days", "-1"],
    ["sessions", "--from", "2026-11-24", "--days", "07"],
    ["sessions", "--from", "2026-11-24", "--days", "１０"],  # full-width digits
    ["sessions", "--from", "2026-11-24"],
    ["sessions", "--days", "10", "--from", "2026-11-24"],
    ["sessions", "--from", "2026-11-24", "--days", "10", "--days", "10"],
    ["sessions", "--from", "2026-11-24", "--days", "10", "extra"],
])
def test_bad_arguments_exit_2(argv, monkeypatch, capsys):
    # checked before the import: with no calendar at all, a bad argv is still the usage line
    monkeypatch.setitem(sys.modules, "pandas_market_calendars", None)
    assert market_clock.main(argv) == 2
    assert json.loads(capsys.readouterr().out) == USAGE


def test_missing_calendar_exits_1_naming_the_interpreter(monkeypatch, capsys):
    monkeypatch.setitem(sys.modules, "pandas_market_calendars", None)
    assert market_clock.main(["sessions", "--from", "2026-11-24", "--days", "10"]) == 1
    assert json.loads(capsys.readouterr().out) == {"ok": False, "error": f"pandas_market_calendars is not importable in {sys.executable}"}


# ── the fences ──────────────────────────────────────────────────────────────────────────────────

def test_read_only_and_keyless():
    src = SCRIPT.read_text()
    assert "place_order" not in src and "cancel_order" not in src
    imported = set()
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.Import):
            imported |= {alias.name.split(".")[0] for alias in node.names}
        elif isinstance(node, ast.ImportFrom):
            imported.add((node.module or ".").split(".")[0])
    assert imported.isdisjoint({"requests", "urllib", "urllib3", "http", "httpx", "socket", "ssl", "alpaca", "alpaca_kit"})
    assert imported <= {"__future__", "json", "os", "re", "sys", "datetime", "pathlib", "pandas_market_calendars"}, imported
    # no key read: the one environment variable it reads is GRAVIT_ROOT, on the sys.path line
    assert "APCA_" not in src and "getenv" not in src and "importlib" not in src and "__import__" not in src
    assert src.count("os.environ") == 1


def test_repo_root_first_on_sys_path():
    assert 'sys.path.insert(0, os.environ.get("GRAVIT_ROOT") or str(Path(__file__).resolve().parents[1]))' in SCRIPT.read_text()


PLANTED = '''__version__ = "planted"
class _Schedule:
    empty = True
class _Calendar:
    def schedule(self, start_date, end_date):
        return _Schedule()
def get_calendar(name):
    return _Calendar()
'''


def _run(script, env):
    done = subprocess.run([sys.executable, str(script), "sessions", "--from", "2026-11-28", "--days", "2"],
                          capture_output=True, text=True, env=env, timeout=60)
    return done.returncode, json.loads(done.stdout)


def test_the_repo_root_comes_from_gravit_root_else_from_the_scripts_place(tmp_path):
    """A module at the root shadows the installed one: proof that the root is first on sys.path."""
    env = {k: v for k, v in os.environ.items() if k != "GRAVIT_ROOT"}
    planted = tmp_path / "planted"
    planted.mkdir()
    (planted / "pandas_market_calendars.py").write_text(PLANTED)
    code, out = _run(SCRIPT, {**env, "GRAVIT_ROOT": str(planted)})
    assert (code, out["source"], out["sessions"]) == (0, "pandas_market_calendars planted", [])
    repo = tmp_path / "repo"
    (repo / "scripts").mkdir(parents=True)
    shutil.copy(SCRIPT, repo / "scripts" / "market_clock.py")
    (repo / "pandas_market_calendars.py").write_text(PLANTED)
    code, out = _run(repo / "scripts" / "market_clock.py", env)
    assert (code, out["source"]) == (0, "pandas_market_calendars planted")
