"""Unit and integration tests for generate_weekend_telemetry."""

import json
from pathlib import Path
from typing import Any

import pytest

from generate_weekend_telemetry import generate_weekend_telemetry


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

    # Verify Practice block
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

    # Verify Qualifying block
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

    # Verify Qualifying traces
    traces = qualifying["traces"]
    assert len(traces["distance_pct"]) == 51
    for code in ("NOR", "VER", "LEC"):
        driver_trace = traces["drivers"][code]
        assert len(driver_trace["speed"]) == 51
        assert len(driver_trace["throttle"]) == 51
        assert len(driver_trace["brake"]) == 51
        assert len(driver_trace["cum_time"]) == 51

    # Verify Race Telemetry block
    race_tel = enriched["race_telemetry"]
    assert len(race_tel["stints"]) >= 24  # 12 drivers x 2 stints
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
