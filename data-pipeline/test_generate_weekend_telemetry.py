"""Unit and integration tests for generate_weekend_telemetry."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
import requests

from generate_weekend_telemetry import (
    _build_fia_position_timeline,
    _build_practice_telemetry,
    _build_qualifying_telemetry,
    _build_race_telemetry,
    _calibrate_race_laps_with_session_result,
    _extract_sc_vsc_windows,
    _fetch_openf1_json,
    _group_driver_laps_into_stints,
    _lookup_fia_position_at_timestamp,
    _merge_single_lap_stint_artifacts,
    _parse_int_position,
    _parse_iso_timestamp,
    _parse_openf1_lap_timestamps,
    enrich_all_races,
    generate_weekend_telemetry,
)


def _create_sample_gp_payload() -> dict[str, Any]:
    """Creates a representative 12-driver Grand Prix JSON payload for testing."""
    drivers = [
        {"code": "NOR", "name": "Lando Norris", "team": "McLaren", "color": "#fe7b04"},
        {"code": "PIA", "name": "Oscar Piastri", "team": "McLaren", "color": "#fe7b04"},
        {"code": "VER", "name": "Max Verstappen", "team": "Red Bull Racing", "color": "#3671c6"},
        {"code": "LAW", "name": "Liam Lawson", "team": "Red Bull Racing", "color": "#3671c6"},
        {"code": "LEC", "name": "Charles Leclerc", "team": "Ferrari", "color": "#e30002"},
        {"code": "HAM", "name": "Lewis Hamilton", "team": "Ferrari", "color": "#e30002"},
        {"code": "RUS", "name": "George Russell", "team": "Mercedes", "color": "#00e3c0"},
        {"code": "ANT", "name": "Kimi Antonelli", "team": "Mercedes", "color": "#00e3c0"},
        {"code": "ALO", "name": "Fernando Alonso", "team": "Aston Martin", "color": "#229971"},
        {"code": "STR", "name": "Lance Stroll", "team": "Aston Martin", "color": "#229971"},
        {"code": "GAS", "name": "Pierre Gasly", "team": "Alpine", "color": "#ff7ed1"},
        {"code": "DOO", "name": "Jack Doohan", "team": "Alpine", "color": "#ff7ed1"},
    ]
    laps: list[dict[str, Any]] = []
    for idx, driver in enumerate(drivers):
        cum_time = 0.0
        for lap_num in range(1, 25):
            is_pit = lap_num == 12
            compound = "MEDIUM" if lap_num < 12 else "HARD"
            tyre_life = lap_num if lap_num < 12 else (lap_num - 11)
            lap_time = 90.0 + (idx * 0.25) + (tyre_life * 0.04) + (22.0 if is_pit else 0.0)
            cum_time += lap_time
            laps.append(
                {
                    "driver": driver["code"],
                    "lap": lap_num,
                    "time": round(lap_time, 3),
                    "compound": compound,
                    "tyre_life": tyre_life,
                    "position": idx + 1,
                    "session_time": round(cum_time, 3),
                    "interpolated": False,
                }
            )
    return {
        "race_info": {
            "year": 2026,
            "gp": "Singapore Grand Prix",
            "total_laps": 24,
            "winner": "NOR",
        },
        "drivers": drivers,
        "session_events": [],
        "laps": laps,
    }


def test_generate_weekend_telemetry_populates_all_three_sessions(tmp_path: Path) -> None:
    """Verifies Practice, Qualifying, and Race blocks are generated with valid schemas."""
    race_path = tmp_path / "singapore.json"
    race_path.write_text(json.dumps(_create_sample_gp_payload()), encoding="utf-8")

    enriched = generate_weekend_telemetry(str(race_path))

    assert "practice" in enriched
    assert "qualifying" in enriched
    assert "race_telemetry" in enriched
    assert "corners" in enriched

    practice = enriched["practice"]
    assert len(practice["classification"]) == 12
    assert practice["classification"][0]["rank"] == 1
    assert practice["classification"][0]["gap_to_p1"] == 0.0
    for item in practice["classification"]:
        assert (
            item["compound_laps"]["SOFT"]
            + item["compound_laps"]["MEDIUM"]
            + item["compound_laps"]["HARD"]
            == item["total_laps"]
        )
        assert item["long_run_q25"] <= item["long_run_avg"] <= item["long_run_q75"]
    assert len(practice["degradation_slopes"]) == 3
    assert len(practice["stint_laps"]) > 0

    qualifying = enriched["qualifying"]
    results = qualifying["results"]
    assert len(results) == 12
    assert results[0]["grid_pos"] == 1
    assert results[0]["gap_to_pole"] == 0.0
    for row in results:
        assert round(row["s1"] + row["s2"] + row["s3"], 3) == pytest.approx(row["best_time"])
        assert row["ideal_lap"] <= row["best_time"]
        assert row["time_left_on_table"] >= 0.0
        if row["grid_pos"] <= 10:
            assert row["eliminated_in"] == "Q3"
            assert row["q3_time"] is not None
        else:
            assert row["eliminated_in"] == "Q2"
            assert row["q3_time"] is None

    traces = qualifying["traces"]
    assert len(traces["distance_pct"]) == 51
    for code in ("NOR", "VER", "LEC"):
        driver_trace = traces["drivers"][code]
        assert len(driver_trace["speed"]) == 51
        assert len(driver_trace["throttle"]) == 51
        assert len(driver_trace["brake"]) == 51
        assert len(driver_trace["cum_time"]) == 51

    race_tel = enriched["race_telemetry"]
    assert len(race_tel["stints"]) >= 24
    assert len(race_tel["pit_stops"]) >= 12


def test_generate_weekend_telemetry_empty_laps_returns_cleanly(tmp_path: Path) -> None:
    """Verifies empty laps payload is returned without error."""
    race_path = tmp_path / "empty.json"
    race_path.write_text(
        json.dumps({"race_info": {"gp": "Test GP"}, "drivers": [], "laps": []}),
        encoding="utf-8",
    )
    res = generate_weekend_telemetry(str(race_path))
    assert "practice" not in res


def test_calibrate_race_laps_strips_phantom_cooldown_laps_and_matches_official_result() -> None:
    """Verifies phantom post-checkered-flag laps are stripped and positions match session_result."""
    drivers = [
        {"code": "VER", "name": "Max Verstappen", "team": "Red Bull Racing", "color": "#3671c6"},
        {"code": "NOR", "name": "Lando Norris", "team": "McLaren", "color": "#fe7b04"},
        {"code": "ANT", "name": "Kimi Antonelli", "team": "Mercedes", "color": "#00e3c0"},
    ]
    raw_laps = [
        {"driver": "VER", "lap": 1, "time": 90.5, "compound": "MEDIUM", "tyre_life": 1, "position": 2, "session_time": 90.5, "interpolated": True},
        {"driver": "VER", "lap": 2, "time": 90.0, "compound": "MEDIUM", "tyre_life": 2, "position": 2, "session_time": 180.5, "interpolated": False},
        {"driver": "NOR", "lap": 1, "time": 89.0, "compound": "MEDIUM", "tyre_life": 1, "position": 1, "session_time": 89.0, "interpolated": True},
        {"driver": "NOR", "lap": 2, "time": 91.0, "compound": "MEDIUM", "tyre_life": 2, "position": 1, "session_time": 180.0, "interpolated": False},
        {"driver": "ANT", "lap": 1, "time": 92.0, "compound": "HARD", "tyre_life": 1, "position": 3, "session_time": 92.0, "interpolated": True},
        {"driver": "ANT", "lap": 2, "time": 92.0, "compound": "HARD", "tyre_life": 2, "position": 3, "session_time": 184.0, "interpolated": False},
        {"driver": "ANT", "lap": 3, "time": 92.0, "compound": "HARD", "tyre_life": 3, "position": 1, "session_time": 276.0, "interpolated": True},
    ]
    openf1_session_result = [
        {"driver_number": 1, "position": 1, "number_of_laps": 2, "duration": 180.2, "gap_to_leader": 0.0, "dnf": False, "dns": False, "dsq": False},
        {"driver_number": 4, "position": 2, "number_of_laps": 2, "duration": 181.4, "gap_to_leader": 1.2, "dnf": False, "dns": False, "dsq": False},
        {"driver_number": 12, "position": 3, "number_of_laps": 2, "duration": 184.0, "gap_to_leader": 3.8, "dnf": False, "dns": False, "dsq": False},
    ]
    num_to_code = {1: "VER", 4: "NOR", 12: "ANT"}

    calibrated_laps, official_max_lap, official_winner, classification = (
        _calibrate_race_laps_with_session_result(
            laps=raw_laps,
            drivers=drivers,
            openf1_session_result=openf1_session_result,
            num_to_code=num_to_code,
        )
    )

    assert official_max_lap == 2
    assert official_winner == "VER"
    assert all(int(lap["lap"]) <= 2 for lap in calibrated_laps)
    assert [c["driver"] for c in classification] == ["VER", "NOR", "ANT"]
    lap2_by_pos = sorted(
        [l for l in calibrated_laps if int(l["lap"]) == 2],
        key=lambda item: int(item["position"]),
    )
    assert [l["driver"] for l in lap2_by_pos] == ["VER", "NOR", "ANT"]


def test_calibrate_race_laps_handles_dns_dnf_dsq_lapped_and_position_timeline() -> None:
    """Verifies calibration handles DNS, DNF, DSQ, lapped drivers, glitched laps, and FIA positions."""
    drivers = [
        {"code": "VER", "name": "Max Verstappen", "team": "Red Bull", "color": "#3671c6"},
        {"code": "NOR", "name": "Lando Norris", "team": "McLaren", "color": "#fe7b04"},
        {"code": "LEC", "name": "Charles Leclerc", "team": "Ferrari", "color": "#e30002"},
        {"code": "HAM", "name": "Lewis Hamilton", "team": "Ferrari", "color": "#e30002"},
        {"code": "ALO", "name": "Fernando Alonso", "team": "Aston Martin", "color": "#229971"},
    ]
    raw_laps = [
        {"driver": "VER", "lap": 1, "time": 50.0, "compound": "SOFT", "tyre_life": 1, "position": 2, "session_time": 50.0},
        {"driver": "VER", "lap": 2, "time": 90.0, "compound": "SOFT", "tyre_life": 2, "position": 1, "session_time": 140.0},
        {"driver": "VER", "lap": 3, "time": 90.0, "compound": "SOFT", "tyre_life": 3, "position": 1, "session_time": 230.0},
        {"driver": "NOR", "lap": 1, "time": 93.0, "compound": "SOFT", "tyre_life": 1, "position": 1, "session_time": 93.0},
        {"driver": "NOR", "lap": 2, "time": 40.0, "compound": "SOFT", "tyre_life": 2, "position": 2, "session_time": 133.0},
        {"driver": "NOR", "lap": 3, "time": 90.5, "compound": "SOFT", "tyre_life": 3, "position": 2, "session_time": 223.5},
        {"driver": "LEC", "lap": 1, "time": 94.0, "compound": "MEDIUM", "tyre_life": 1, "position": 3, "session_time": 94.0},
        {"driver": "LEC", "lap": 2, "time": 91.0, "compound": "MEDIUM", "tyre_life": 2, "position": 3, "session_time": 185.0},
        {"driver": "HAM", "lap": 1, "time": 95.0, "compound": "HARD", "tyre_life": 1, "position": 4, "session_time": 95.0},
    ]
    session_result = [
        {"driver_number": 1, "position": 1, "number_of_laps": 3, "duration": 273.5, "gap_to_leader": 0.0, "dnf": False, "dns": False, "dsq": False},
        {"driver_number": 4, "position": 2, "number_of_laps": 3, "duration": 273.5, "gap_to_leader": 0.0, "dnf": False, "dns": False, "dsq": True},
        {"driver_number": 16, "position": 3, "number_of_laps": 2, "duration": 185.0, "gap_to_leader": None, "dnf": False, "dns": False, "dsq": False},
        {"driver_number": 44, "position": None, "number_of_laps": 1, "duration": 95.0, "gap_to_leader": None, "dnf": True, "dns": False, "dsq": False},
        {"driver_number": 14, "position": None, "number_of_laps": 0, "duration": None, "gap_to_leader": None, "dnf": False, "dns": True, "dsq": False},
    ]
    openf1_raw_laps = [
        {"driver_number": 1, "lap_number": 1, "date_start": "2026-05-01T14:00:00Z", "lap_duration": None},
        {"driver_number": 1, "lap_number": 3, "date_start": "2026-05-01T14:03:03Z", "lap_duration": 90.0},
        {"driver_number": 4, "lap_number": 1, "date_start": "2026-05-01T14:00:00Z", "lap_duration": 93.0},
        {"driver_number": 4, "lap_number": 2, "date_start": "2026-05-01T14:01:33Z", "lap_duration": 90.5},
    ]
    openf1_positions = [
        {"driver_number": 4, "position": 1, "date": "2026-05-01T14:01:30Z"},
        {"driver_number": 1, "position": 2, "date": "2026-05-01T14:01:30Z"},
    ]
    num_to_code = {1: "VER", 4: "NOR", 16: "LEC", 44: "HAM", 14: "ALO"}

    cal_laps, max_lap, winner, cls = _calibrate_race_laps_with_session_result(
        laps=raw_laps,
        drivers=drivers,
        openf1_session_result=session_result,
        num_to_code=num_to_code,
        openf1_raw_laps=openf1_raw_laps,
        openf1_positions=openf1_positions,
    )

    assert max_lap == 3
    assert winner == "VER"
    cls_by_code = {row["driver"]: row for row in cls}
    assert cls_by_code["VER"]["status"] == "FINISHER"
    assert cls_by_code["NOR"]["status"] == "DSQ"
    assert cls_by_code["NOR"]["duration"] > cls_by_code["VER"]["duration"]
    assert cls_by_code["LEC"]["status"] == "LAPPED"
    assert cls_by_code["LEC"]["gap_to_leader"] == "+1 Lap"
    assert cls_by_code["HAM"]["status"] == "DNF"
    assert cls_by_code["ALO"]["status"] == "DNS"
    assert cls_by_code["ALO"]["is_dns"] is True

    nor_lap2 = next(l for l in cal_laps if l["driver"] == "NOR" and l["lap"] == 2)
    assert nor_lap2["time"] >= 80.0
    assert nor_lap2["interpolated"] is True


def test_calibrate_race_laps_returns_unmodified_when_no_session_result() -> None:
    """Verifies _calibrate_race_laps_with_session_result returns clean copy when session_result is empty."""
    laps = [{"driver": "LEC", "lap": 1, "time": 90.0, "position": 1, "session_time": 90.0}]
    drivers = [{"code": "LEC", "name": "Charles Leclerc", "team": "Ferrari", "color": "#e30002"}]
    cal_laps, max_lap, winner, cls = _calibrate_race_laps_with_session_result(
        laps=laps,
        drivers=drivers,
        openf1_session_result=None,
        num_to_code=None,
    )
    assert len(cal_laps) == 1
    assert max_lap == 1
    assert winner == "LEC"
    assert cls == []


def test_build_qualifying_telemetry_honors_official_session_result() -> None:
    """Verifies official /v1/session_result overrides deleted laps in /v1/laps."""
    payload = _create_sample_gp_payload()
    drivers = [
        d for d in payload["drivers"] if d["code"] in ("VER", "LEC", "NOR")
    ]
    num_to_code = {1: "VER", 16: "LEC", 4: "NOR"}

    openf1_quali_laps = [
        {"driver_number": 16, "lap_number": 5, "lap_duration": 88.9, "duration_sector_1": 28.9, "duration_sector_2": 30.0, "duration_sector_3": 30.0, "date_start": "2026-10-10T13:55:00Z"},
        {"driver_number": 1, "lap_number": 5, "lap_duration": 89.1, "duration_sector_1": 29.0, "duration_sector_2": 30.0, "duration_sector_3": 30.1, "date_start": "2026-10-10T13:56:00Z"},
    ]
    openf1_quali_results = [
        {"driver_number": 1, "position": 1, "duration": [89.8, 89.4, 89.1]},
        {"driver_number": 16, "position": 2, "duration": [89.9, 89.5, 89.3]},
        {"driver_number": 4, "position": 3, "duration": [90.1, 89.7, 89.5]},
    ]
    quali = _build_qualifying_telemetry(
        gp_name="Singapore Grand Prix",
        drivers=drivers,
        driver_pace={"VER": 91.0, "LEC": 91.2, "NOR": 91.3},
        track_profile={"turns": 19, "base_speed": 150, "variation": 60},
        race_laps=payload["laps"],
        openf1_quali_laps=openf1_quali_laps,
        openf1_quali_results=openf1_quali_results,
        num_to_code=num_to_code,
    )
    assert [r["driver"] for r in quali["results"]] == ["VER", "LEC", "NOR"]
    assert quali["results"][0]["best_time"] == 89.1
    assert quali["results"][1]["best_time"] == 89.3


def test_qualifying_null_for_no_valid_flying_lap_and_pit_out_filter() -> None:
    """Verifies drivers without a valid flying lap receive null times and do not corrupt sectors or corner speeds."""
    payload = _create_sample_gp_payload()
    drivers = [
        {"code": "RUS", "name": "George Russell", "team": "Mercedes", "color": "#00e3c0"},
        {"code": "BOT", "name": "Valtteri Bottas", "team": "Cadillac", "color": "#909090"},
        {"code": "PER", "name": "Sergio Perez", "team": "Cadillac", "color": "#909090"},
    ]
    num_to_code = {63: "RUS", 77: "BOT", 11: "PER"}
    openf1_quali_laps = [
        {
            "driver_number": 63,
            "lap_number": 2,
            "lap_duration": 91.520,
            "duration_sector_1": 24.500,
            "duration_sector_2": 27.520,
            "duration_sector_3": 39.500,
            "is_pit_out_lap": False,
            "date_start": "2026-03-20T07:05:00Z",
        },
        {
            "driver_number": 77,
            "lap_number": 2,
            "lap_duration": 95.436,
            "duration_sector_1": 25.500,
            "duration_sector_2": 28.936,
            "duration_sector_3": 41.000,
            "is_pit_out_lap": False,
            "date_start": "2026-03-20T07:05:10Z",
        },
        # PER out-lap with partial sectors (should be ignored)
        {
            "driver_number": 11,
            "lap_number": 1,
            "lap_duration": None,
            "duration_sector_1": None,
            "duration_sector_2": 29.013,
            "duration_sector_3": 37.903,
            "is_pit_out_lap": True,
            "date_start": "2026-03-20T07:02:00Z",
        },
        # PER glitched/aborted 62s lap (outside [pole*0.96, pole*1.07], should be rejected)
        {
            "driver_number": 11,
            "lap_number": 2,
            "lap_duration": 62.006,
            "duration_sector_1": 17.204,
            "duration_sector_2": 26.296,
            "duration_sector_3": 18.506,
            "is_pit_out_lap": False,
            "date_start": "2026-03-20T07:04:00Z",
        },
    ]
    openf1_quali_results = [
        {"driver_number": 63, "position": 1, "duration": [92.100, 91.800, 91.520]},
        {"driver_number": 77, "position": 2, "duration": [95.436, None, None]},
        {"driver_number": 11, "position": 3, "duration": [None, None, None]},
    ]
    quali = _build_qualifying_telemetry(
        gp_name="Chinese Grand Prix",
        drivers=drivers,
        driver_pace={"RUS": 96.0, "BOT": 98.0, "PER": 98.2},
        track_profile={"turns": 16, "base_speed": 145, "variation": 60},
        race_laps=payload["laps"],
        openf1_quali_laps=openf1_quali_laps,
        openf1_quali_results=openf1_quali_results,
        num_to_code=num_to_code,
        stage_prefix="SQ",
    )
    by_drv = {r["driver"]: r for r in quali["results"]}
    assert by_drv["PER"]["best_time"] is None
    assert by_drv["PER"]["q1_time"] is None
    assert by_drv["PER"]["q2_time"] is None
    assert by_drv["PER"]["q3_time"] is None
    assert by_drv["PER"]["s1"] is None
    assert by_drv["PER"]["s2"] is None
    assert by_drv["PER"]["s3"] is None
    assert by_drv["PER"]["ideal_lap"] is None
    assert by_drv["PER"]["gap_to_pole"] is None
    assert "PER" not in quali["traces"]["drivers"]
    cadillac_battle = next(b for b in quali["teammate_deltas"] if b["team"] == "Cadillac")
    assert cadillac_battle["delta_s"] is None
    assert cadillac_battle["faster_driver"] == "BOT"
    # Verify Mercedes beats Cadillac in Turn 1 corner speed
    t1_speeds = {c["team"]: c["speed"] for c in quali["corners"] if c["turn"] == 1}
    assert t1_speeds["Mercedes"] > t1_speeds["Cadillac"]


def test_build_qualifying_telemetry_with_phase_starts_and_twenty_drivers() -> None:
    """Verifies Q1/Q2/Q3 elimination cutoffs across 20 drivers and phase timestamps."""
    base_payload = _create_sample_gp_payload()
    extra_drivers = [
        {"code": f"D{idx:02d}", "name": f"Driver {idx}", "team": "Haas", "color": "#ffffff"}
        for idx in range(13, 21)
    ]
    drivers = base_payload["drivers"] + extra_drivers
    driver_pace = {str(d["code"]): 88.0 + idx * 0.15 for idx, d in enumerate(drivers)}
    num_to_code = {idx + 1: str(d["code"]) for idx, d in enumerate(drivers)}

    quali_rc = [
        {"qualifying_phase": 1, "message": "SESSION STARTED", "date": "2026-06-01T14:00:00Z"},
        {"qualifying_phase": 2, "message": "SESSION STARTED", "date": "2026-06-01T14:25:00Z"},
        {"qualifying_phase": 3, "message": "SESSION STARTED", "date": "2026-06-01T14:48:00Z"},
    ]
    quali_laps = []
    for idx in range(20):
        d_num = idx + 1
        quali_laps.append(
            {
                "driver_number": d_num,
                "lap_number": 2,
                "lap_duration": 86.0 + idx * 0.12,
                "duration_sector_1": 25.0 + idx * 0.04,
                "duration_sector_2": 31.0 + idx * 0.04,
                "duration_sector_3": 30.0 + idx * 0.04,
                "date_start": "2026-06-01T14:05:00Z",
            }
        )
        if idx < 16:
            quali_laps.append(
                {
                    "driver_number": d_num,
                    "lap_number": 5,
                    "lap_duration": 85.5 + idx * 0.11,
                    "date_start": "2026-06-01T14:30:00Z",
                }
            )
        if idx < 10:
            quali_laps.append(
                {
                    "driver_number": d_num,
                    "lap_number": 8,
                    "lap_duration": 85.0 + idx * 0.10,
                    "date_start": "2026-06-01T14:52:00Z",
                }
            )

    quali = _build_qualifying_telemetry(
        gp_name="Monaco Grand Prix",
        drivers=drivers,
        driver_pace=driver_pace,
        track_profile={"turns": 19, "base_speed": 140, "variation": 50},
        race_laps=base_payload["laps"],
        openf1_quali_laps=quali_laps,
        openf1_quali_rc=quali_rc,
        num_to_code=num_to_code,
        stage_prefix="SQ",
    )

    assert quali["stage_prefix"] == "SQ"
    assert len(quali["results"]) == 20
    assert quali["results"][0]["eliminated_in"] == "SQ3"
    assert quali["results"][12]["eliminated_in"] == "SQ2"
    assert quali["results"][18]["eliminated_in"] == "SQ1"
    assert quali["results"][18]["q2_time"] is None
    assert quali["results"][18]["q3_time"] is None


@pytest.mark.parametrize(
    ("rc_events", "lap_times_by_lap", "expected_types_and_bounds"),
    [
        (
            [
                {"category": "SafetyCar", "message": "VSC DEPLOYED", "lap_number": 4},
                {"category": "SafetyCar", "message": "VSC ENDING", "lap_number": 5},
                {"category": "SafetyCar", "message": "SAFETY CAR DEPLOYED", "lap_number": 10},
                {"category": "SafetyCar", "message": "SAFETY CAR IN THIS LAP", "lap_number": 13},
            ],
            {},
            [("VSC", 4, 5), ("SC", 10, 13)],
        ),
        (
            [
                {"category": "SafetyCar", "message": "VIRTUAL SAFETY CAR DEPLOYED", "lap_number": 6},
                {"category": "SafetyCar", "message": "SAFETY CAR DEPLOYED", "lap_number": 8},
                {"category": "SafetyCar", "message": "SAFETY CAR ENDING", "lap_number": 10},
                {"category": "SafetyCar", "message": "SC DEPLOYED", "lap_number": 11},
                {"category": "SafetyCar", "message": "CLEAR", "lap_number": 12},
            ],
            {},
            [("VSC", 6, 7), ("SC", 8, 12)],
        ),
        (
            [
                {"category": "SafetyCar", "message": "SAFETY CAR DEPLOYED", "lap_number": 19},
            ],
            {},
            [("SC", 19, 20)],
        ),
        (
            [],
            {2: 90.0, 3: 90.0, 4: 90.0, 5: 106.0, 6: 120.0, 7: 122.0, 8: 90.0},
            [("VSC", 5, 5), ("SC", 6, 7)],
        ),
    ],
)
def test_extract_sc_vsc_windows_scenarios(
    rc_events: list[dict[str, Any]],
    lap_times_by_lap: dict[int, float],
    expected_types_and_bounds: list[tuple[str, int, int]],
) -> None:
    """Verifies SC/VSC extraction across race control messages, VSC-to-SC escalation, merging, and lap-time fallback."""
    laps = [
        {"driver": "VER", "lap": lap_no, "time": lap_time}
        for lap_no, lap_time in lap_times_by_lap.items()
    ]
    windows = _extract_sc_vsc_windows(
        race_control_events=rc_events,
        laps=laps,
        total_laps=20,
    )
    actual = [
        (w["type"], int(w["start_lap"]), int(w["end_lap"])) for w in windows
    ]
    assert actual == expected_types_and_bounds


def test_stint_grouping_and_single_lap_artifact_merging() -> None:
    """Verifies 1-lap tyre stint artifacts at start, middle, and end are merged into adjacent stints."""
    driver_laps = [
        {"driver": "VER", "lap": 1, "time": 95.0, "compound": "SOFT", "tyre_life": 1},
        {"driver": "VER", "lap": 2, "time": 91.0, "compound": "MEDIUM", "tyre_life": 1},
        {"driver": "VER", "lap": 3, "time": 91.2, "compound": "MEDIUM", "tyre_life": 2},
        {"driver": "VER", "lap": 4, "time": 91.4, "compound": "MEDIUM", "tyre_life": 3},
        {"driver": "VER", "lap": 5, "time": 92.0, "compound": "HARD", "tyre_life": 1},
        {"driver": "VER", "lap": 6, "time": 90.5, "compound": "SOFT", "tyre_life": 1},
        {"driver": "VER", "lap": 7, "time": 90.7, "compound": "SOFT", "tyre_life": 2},
        {"driver": "VER", "lap": 8, "time": 91.0, "compound": "MEDIUM", "tyre_life": 1},
    ]
    raw_groups = _group_driver_laps_into_stints(driver_laps)
    assert len(raw_groups) == 5

    merged = _merge_single_lap_stint_artifacts(
        raw_stint_groups=raw_groups,
        driver_laps=driver_laps,
        gp_name="Test GP",
        code="VER",
        has_openf1_stints=True,
    )
    assert all(len(grp) > 1 for grp in merged)
    assert sum(len(grp) for grp in merged) == len(driver_laps)


def test_build_practice_and_race_telemetry_with_real_openf1_inputs() -> None:
    """Verifies real OpenF1 practice and pit stop records are incorporated when provided."""
    payload = _create_sample_gp_payload()
    drivers = payload["drivers"][:2]
    num_to_code = {4: "NOR", 81: "PIA"}

    prac = _build_practice_telemetry(
        gp_name="Singapore Grand Prix",
        drivers=drivers,
        driver_pace={"NOR": 90.0, "PIA": 90.3},
        track_profile={"turns": 19, "base_speed": 150, "variation": 60},
        corners=[
            {"turn": 1, "team": "McLaren", "speed": 145.0, "color": "#fe7b04"}
        ],
        openf1_practice_laps=[
            {"driver_number": 4, "lap_duration": 88.123, "st_speed": 325.4},
            {"driver_number": 81, "lap_duration": 88.456, "i2_speed": 322.1},
        ],
        openf1_practice_stints=[
            {"driver_number": 4, "compound": "SOFT", "lap_start": 1, "lap_end": 6},
            {"driver_number": 4, "compound": "MEDIUM", "lap_start": 7, "lap_end": 16},
            {"driver_number": 4, "compound": "INTERMEDIATE", "lap_start": 17, "lap_end": 18},
        ],
        openf1_practice_results=[
            {"driver_number": 81, "position": 1, "duration": 88.05},
            {"driver_number": 4, "position": 2, "duration": 88.123},
        ],
        num_to_code=num_to_code,
    )
    assert [c["driver"] for c in prac["classification"]] == ["PIA", "NOR"]
    assert prac["classification"][0]["best_lap"] == 88.05
    assert prac["classification"][1]["speed_trap_kmh"] == 325.4

    race_tel = _build_race_telemetry(
        gp_name="Singapore Grand Prix",
        drivers=drivers,
        laps=[l for l in payload["laps"] if l["driver"] in ("NOR", "PIA")],
        total_laps=24,
        openf1_stints=[{"driver_number": 4, "compound": "MEDIUM", "lap_start": 1, "lap_end": 11}],
        openf1_pits=[
            {"driver_number": 4, "lap_number": 11, "stop_duration": 2.34, "pit_duration": 21.8},
            {"driver_number": 81, "lap_number": 11, "lane_duration": 22.9},
        ],
        openf1_rc=[],
        num_to_code=num_to_code,
    )
    pit_by_drv = {p["driver"]: p for p in race_tel["pit_stops"]}
    assert pit_by_drv["NOR"]["stationary_s"] == 2.34
    assert pit_by_drv["NOR"]["pit_loss_s"] == 21.8
    assert pit_by_drv["PIA"]["pit_loss_s"] == 22.9


def test_generate_weekend_telemetry_live_sprint_and_enrich_all_races(
    tmp_path: Path,
) -> None:
    """Verifies live fetch mode with Sprint sessions and batch enrich_all_races execution."""
    race_path = tmp_path / "china.json"
    race_path.write_text(
        json.dumps(_create_sample_gp_payload()), encoding="utf-8"
    )

    sessions_cache = [
        {"meeting_key": 1280, "session_name": "Practice 1", "session_key": 101},
        {"meeting_key": 1280, "session_name": "Sprint Qualifying", "session_key": 102},
        {"meeting_key": 1280, "session_name": "Sprint", "session_key": 103},
        {"meeting_key": 1280, "session_name": "Qualifying", "session_key": 104},
        {"meeting_key": 1280, "session_name": "Race", "session_key": 105},
    ]

    def _fake_fetch(endpoint: str, params: dict[str, Any]) -> list[dict[str, Any]]:
        if endpoint == "drivers":
            return [
                {"driver_number": 4, "name_acronym": "NOR", "full_name": "Lando Norris", "team_name": "McLaren", "team_colour": "fe7b04"},
                {"driver_number": 81, "name_acronym": "PIA", "full_name": "Oscar Piastri", "team_name": "McLaren", "team_colour": "fe7b04"},
            ]
        if endpoint == "laps":
            return [
                {"driver_number": 4, "lap_number": 1, "lap_duration": 92.0, "date_start": "2026-03-20T07:00:00Z"},
                {"driver_number": 4, "lap_number": 2, "lap_duration": 90.0, "date_start": "2026-03-20T07:01:32Z"},
                {"driver_number": 81, "lap_number": 1, "lap_duration": 92.5, "date_start": "2026-03-20T07:00:00Z"},
                {"driver_number": 81, "lap_number": 2, "lap_duration": 90.5, "date_start": "2026-03-20T07:01:32Z"},
            ]
        if endpoint == "session_result":
            return [
                {"driver_number": 4, "position": 1, "number_of_laps": 2, "duration": 182.0, "gap_to_leader": 0.0},
                {"driver_number": 81, "position": 2, "number_of_laps": 2, "duration": 183.0, "gap_to_leader": 1.0},
            ]
        return []

    with (
        patch("generate_weekend_telemetry._fetch_openf1_json", side_effect=_fake_fetch),
        patch("generate_weekend_telemetry._fetch_openf1_location_window", return_value=[]),
    ):
        enriched_list = enrich_all_races(races_dir=str(tmp_path), fetch_live=False)
        assert len(enriched_list) == 1
        assert enriched_list[0]["is_sprint_weekend"] is True
        assert "sprint_qualifying" in enriched_list[0]
        assert "sprint" in enriched_list[0]

        live_enriched = generate_weekend_telemetry(
            str(race_path),
            fetch_live=True,
            all_sessions_cache=sessions_cache,
        )
        assert live_enriched["is_sprint_weekend"] is True
        assert live_enriched["sprint"]["winner"] == "NOR"


def test_fetch_openf1_json_retries_and_handles_failures() -> None:
    """Verifies _fetch_openf1_json handles HTTP 429 retry, non-list JSON, and network exceptions."""
    resp_429 = MagicMock(status_code=429)
    resp_200 = MagicMock(status_code=200)
    resp_200.json.return_value = [{"session_key": 1}]

    with (
        patch("generate_weekend_telemetry.requests.get", side_effect=[resp_429, resp_200]) as mock_get,
        patch("generate_weekend_telemetry.time.sleep"),
    ):
        res = _fetch_openf1_json("sessions", {"year": 2026})
        assert res == [{"session_key": 1}]
        assert mock_get.call_count == 2

    with (
        patch("generate_weekend_telemetry.requests.get", side_effect=requests.RequestException("offline")),
        patch("generate_weekend_telemetry.time.sleep"),
    ):
        assert _fetch_openf1_json("sessions", {"year": 2026}) == []


def test_helper_parsers_and_failure_exceptions(tmp_path: Path) -> None:
    """Verifies utility parsers and file error handling for generate_weekend_telemetry."""
    assert _parse_int_position(5) == 5
    assert _parse_int_position(" 12 ") == 12
    assert _parse_int_position("NC") is None
    assert _parse_iso_timestamp(None) is None
    assert _parse_iso_timestamp("not-a-timestamp") is None
    assert _parse_iso_timestamp("2026-03-15T14:00:00Z") is not None

    timeline = _build_fia_position_timeline(
        [{"driver_number": 1, "position": 3, "date": "2026-03-15T14:00:00Z"}],
        {1: "VER"},
    )
    assert _lookup_fia_position_at_timestamp("VER", 9999999999.0, timeline, {"VER": 1}) == 3
    assert _lookup_fia_position_at_timestamp("NOR", 9999999999.0, timeline, {"NOR": 2}) == 2

    end_by_code, end_by_lap = _parse_openf1_lap_timestamps(None, {}, 10, 90.0)
    assert end_by_code == {}
    assert end_by_lap == {}

    with pytest.raises(FileNotFoundError):
        generate_weekend_telemetry(str(tmp_path / "missing.json"))

    bad_json = tmp_path / "corrupt.json"
    bad_json.write_text("{corrupt", encoding="utf-8")
    with pytest.raises(json.JSONDecodeError):
        generate_weekend_telemetry(str(bad_json))


def test_production_2026_dataset_and_manifest_guardrails() -> None:
    """Guardrail verifying all 2026 GP files in races_manifest.json are complete and consistent."""
    repo_root = Path(__file__).resolve().parent.parent
    manifest_path = repo_root / "src" / "assets" / "data" / "races_manifest.json"
    races_dir = repo_root / "src" / "assets" / "data" / "races" / "2026"

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest_races = manifest.get("races", [])
    manifest_ids = [r["id"] for r in manifest_races]

    assert len(manifest_ids) == len(set(manifest_ids)), "Duplicate GP IDs in races_manifest.json"
    assert "madring" in manifest_ids, "Madring GP must be present in races_manifest.json"

    manifest_files = {r["file"] for r in manifest_races}
    disk_files = {f"races/2026/{p.name}" for p in races_dir.glob("*.json")}
    assert manifest_files == disk_files, (
        f"Manifest files and disk files out of sync: {manifest_files ^ disk_files}"
    )

    for entry in manifest_races:
        gp_path = repo_root / "src" / "assets" / "data" / entry["file"]
        data = json.loads(gp_path.read_text(encoding="utf-8"))
        gp_id = entry["id"]

        total_laps = int(data["race_info"]["total_laps"])
        winner = data["race_info"]["winner"]
        laps = data["laps"]
        assert total_laps > 0, f"{gp_id}: total_laps must be > 0"
        assert laps, f"{gp_id}: laps must not be empty"

        max_lap_in_laps = max(int(l["lap"]) for l in laps)
        assert max_lap_in_laps == total_laps, (
            f"{gp_id}: max lap in laps ({max_lap_in_laps}) != total_laps ({total_laps})"
        )

        final_lap_p1 = [
            l["driver"]
            for l in laps
            if int(l["lap"]) == total_laps and int(l["position"]) == 1
        ]
        assert final_lap_p1 == [winner], (
            f"{gp_id}: race_info.winner ({winner}) != final lap P1 ({final_lap_p1})"
        )
        race_cls = data.get("race_telemetry", {}).get("classification", [])
        if race_cls:
            assert race_cls[0]["driver"] == winner, (
                f"{gp_id}: race_telemetry.classification P1 ({race_cls[0]['driver']}) != winner ({winner})"
            )

        quali_results = data.get("qualifying", {}).get("results", [])
        assert len(quali_results) >= 18, f"{gp_id}: missing qualifying results"
        assert [r["grid_pos"] for r in quali_results] == list(
            range(1, len(quali_results) + 1)
        )
        assert quali_results[0]["gap_to_pole"] == 0.0

        prac_cls = data.get("practice", {}).get("classification", [])
        assert len(prac_cls) >= 18, f"{gp_id}: missing practice classification"
        assert [r["rank"] for r in prac_cls] == list(range(1, len(prac_cls) + 1))
        prac_long_runs = [float(r["long_run_avg"]) for r in prac_cls if r.get("long_run_avg") is not None]
        assert max(prac_long_runs) - min(prac_long_runs) <= 6.5, (
            f"{gp_id}: practice long_run_avg spread too large ({max(prac_long_runs) - min(prac_long_runs):.3f}s)"
        )
        prac_traps = [float(r["speed_trap_kmh"]) for r in prac_cls if r.get("speed_trap_kmh") is not None]
        assert max(prac_traps) - min(prac_traps) <= 35.0, (
            f"{gp_id}: practice speed_trap_kmh spread too large ({min(prac_traps)}..{max(prac_traps)} km/h)"
        )

        # Guardrail for Qualifying valid flying laps vs null No-Time rows
        q_pole = float(quali_results[0]["best_time"])
        for qr in quali_results:
            if qr["best_time"] is None:
                assert qr["s1"] is None and qr["s2"] is None and qr["s3"] is None
                assert qr["ideal_lap"] is None
                assert qr["gap_to_pole"] is None
            else:
                bt = float(qr["best_time"])
                assert q_pole <= bt <= q_pole * 1.12, (
                    f"{gp_id}: unrealistic qualifying best_time for {qr['driver']}: {bt} vs pole {q_pole}"
                )
                assert qr["s1"] + qr["s2"] + qr["s3"] == pytest.approx(bt, abs=0.05)
                assert float(qr["gap_to_pole"]) >= 0.0

        lap_times_sorted = sorted(float(l["time"]) for l in laps if float(l.get("time") or 0) > 0)
        field_median = lap_times_sorted[len(lap_times_sorted) // 2]
        min_allowed_lap = field_median * 0.85
        max_allowed_lap = field_median * 1.85
        unrealistic_laps = [
            (l["driver"], l["lap"], l["time"])
            for l in laps
            if float(l["time"]) < min_allowed_lap or float(l["time"]) > max_allowed_lap
        ]
        assert not unrealistic_laps, (
            f"{gp_id}: unrealistic lap times (outside [{min_allowed_lap:.2f}s, {max_allowed_lap:.2f}s]): {unrealistic_laps[:5]}"
        )

        stints = data.get("race_telemetry", {}).get("stints", [])
        unrealistic_stints = [
            (s["driver"], s["stint"], s["avg_pace"])
            for s in stints
            if float(s["avg_pace"]) < min_allowed_lap or float(s["avg_pace"]) > field_median * 1.35
        ]
        assert not unrealistic_stints, (
            f"{gp_id}: unrealistic stint avg_pace: {unrealistic_stints[:5]}"
        )

        pits = data.get("race_telemetry", {}).get("pit_stops", [])
        unrealistic_pits = [
            (p["driver"], p["lap"], p["stationary_s"])
            for p in pits
            if float(p["stationary_s"]) < 1.8 or float(p["stationary_s"]) > 12.0
        ]
        assert not unrealistic_pits, (
            f"{gp_id}: unrealistic pit stop stationary_s: {unrealistic_pits[:5]}"
        )
        laps_per_driver: dict[str, int] = {}
        for l in laps:
            laps_per_driver[l["driver"]] = laps_per_driver.get(l["driver"], 0) + 1
        one_lap_stints = [
            (s["driver"], s["stint"], s["compound"], s["start_lap"], s["end_lap"])
            for s in stints
            if int(s["laps_count"]) <= 1 and laps_per_driver.get(s["driver"], 0) > 1
        ]
        assert not one_lap_stints, (
            f"{gp_id}: 1-lap tyre stint artifacts detected: {one_lap_stints}"
        )

        lap1_laps = [l for l in laps if int(l["lap"]) == 1]
        lap1_positions = sorted(int(l["position"]) for l in lap1_laps)
        assert lap1_positions == list(range(1, len(lap1_positions) + 1)), (
            f"{gp_id}: invalid Lap 1 positions: {lap1_positions}"
        )
        lap1_session_times = [float(l["session_time"]) for l in lap1_laps]
        assert max(lap1_session_times) - min(lap1_session_times) <= 35.0, (
            f"{gp_id}: Lap 1 session_time spread ({max(lap1_session_times) - min(lap1_session_times):.2f}s) exceeds 35.0s"
        )

        if data.get("is_sprint_weekend"):
            sq_results = data.get("sprint_qualifying", {}).get("results", [])
            assert len(sq_results) >= 18, f"{gp_id}: missing sprint_qualifying results"
            assert [r["grid_pos"] for r in sq_results] == list(
                range(1, len(sq_results) + 1)
            )
            sq_pole = float(sq_results[0]["best_time"])
            for sqr in sq_results:
                if sqr["best_time"] is None:
                    assert sqr["s1"] is None and sqr["s2"] is None and sqr["s3"] is None
                    assert sqr["ideal_lap"] is None
                    assert sqr["gap_to_pole"] is None
                else:
                    sq_bt = float(sqr["best_time"])
                    assert sq_pole <= sq_bt <= sq_pole * 1.12, (
                        f"{gp_id}: unrealistic sprint_qualifying best_time for {sqr['driver']}: {sq_bt} vs pole {sq_pole}"
                    )
                    assert sqr["s1"] + sqr["s2"] + sqr["s3"] == pytest.approx(sq_bt, abs=0.05)
                    assert float(sqr["gap_to_pole"]) >= 0.0
            sprint = data.get("sprint", {})
            sp_total = int(sprint.get("total_laps", 0))
            sp_winner = sprint.get("winner")
            sp_laps = sprint.get("laps", [])
            assert sp_total > 0 and sp_laps, f"{gp_id}: empty sprint laps"
            assert max(int(l["lap"]) for l in sp_laps) == sp_total
            sp_p1 = [
                l["driver"]
                for l in sp_laps
                if int(l["lap"]) == sp_total and int(l["position"]) == 1
            ]
            assert sp_p1 == [sp_winner], (
                f"{gp_id}: sprint winner ({sp_winner}) != sprint final lap P1 ({sp_p1})"
            )
            sp_times_sorted = sorted(
                float(l["time"]) for l in sp_laps if float(l.get("time") or 0) > 0
            )
            sp_median = sp_times_sorted[len(sp_times_sorted) // 2]
            sp_bad_laps = [
                (l["driver"], l["lap"], l["time"])
                for l in sp_laps
                if float(l["time"]) < sp_median * 0.85
            ]
            assert not sp_bad_laps, (
                f"{gp_id}: unrealistic sprint lap times: {sp_bad_laps[:5]}"
            )
            sp_stints = sprint.get("race_telemetry", {}).get("stints", [])
            sp_lpd: dict[str, int] = {}
            for l in sp_laps:
                sp_lpd[l["driver"]] = sp_lpd.get(l["driver"], 0) + 1
            sp_one_lap = [
                (s["driver"], s["stint"], s["compound"])
                for s in sp_stints
                if int(s["laps_count"]) <= 1 and sp_lpd.get(s["driver"], 0) > 1
            ]
            assert not sp_one_lap, (
                f"{gp_id}: 1-lap sprint stint artifacts: {sp_one_lap}"
            )

        # Guardrail for circuit track_map geometry and turn apexes
        track_map = data.get("track_map", {})
        assert len(track_map.get("points", [])) >= 100, (
            f"{gp_id}: missing or incomplete track_map.points"
        )
        turns_in_corners = sorted({int(c["turn"]) for c in data.get("corners", [])})
        turns_in_map = [int(t["turn"]) for t in track_map.get("turns", [])]
        assert turns_in_map == turns_in_corners, (
            f"{gp_id}: track_map.turns ({turns_in_map}) != corners turns ({turns_in_corners})"
        )

