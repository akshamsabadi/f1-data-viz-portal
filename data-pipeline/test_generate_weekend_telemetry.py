"""Unit and integration tests for generate_weekend_telemetry."""

import json
from pathlib import Path
from typing import Any

import pytest

from generate_weekend_telemetry import (
    _build_qualifying_telemetry,
    _calibrate_race_laps_with_session_result,
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


def test_calibrate_race_laps_strips_phantom_cooldown_laps_and_matches_official_result() -> None:
    """Verifies phantom post-checkered-flag laps are stripped and positions match session_result."""
    drivers = [
        {"code": "VER", "name": "Max Verstappen", "team": "Red Bull Racing", "color": "#3671c6"},
        {"code": "NOR", "name": "Lando Norris", "team": "McLaren", "color": "#fe7b04"},
        {"code": "ANT", "name": "Kimi Antonelli", "team": "Mercedes", "color": "#00e3c0"},
    ]
    # Simulate ANT having a phantom Lap 3 cooldown lap and NOR having slightly lower raw summed time than VER
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


def test_build_qualifying_telemetry_honors_official_session_result() -> None:
    """Verifies official /v1/session_result overrides deleted laps in /v1/laps."""
    payload = _create_sample_gp_payload()
    drivers = [
        d for d in payload["drivers"] if d["code"] in ("VER", "LEC", "NOR")
    ]
    num_to_code = {1: "VER", 16: "LEC", 4: "NOR"}

    # Simulate LEC having a deleted faster lap in raw /v1/laps (88.9s), while official session_result has VER P1 (89.1s)
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
        track_profile={"turns": 19, "base_speed": 150.0, "variation": 60.0},
        race_laps=payload["laps"],
        openf1_quali_laps=openf1_quali_laps,
        openf1_quali_results=openf1_quali_results,
        num_to_code=num_to_code,
    )
    assert [r["driver"] for r in quali["results"]] == ["VER", "LEC", "NOR"]
    assert quali["results"][0]["best_time"] == 89.1
    assert quali["results"][1]["best_time"] == 89.3


def test_production_2026_dataset_and_manifest_guardrails() -> None:
    """Guardrail verifying all 2026 GP files in races_manifest.json are complete and consistent."""
    repo_root = Path(__file__).resolve().parent.parent
    manifest_path = repo_root / "src" / "assets" / "data" / "races_manifest.json"
    races_dir = repo_root / "src" / "assets" / "data" / "races" / "2026"

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest_races = manifest.get("races", [])
    manifest_ids = [r["id"] for r in manifest_races]

    # 1. No duplicate GP IDs or files in manifest, and Madring is included
    assert len(manifest_ids) == len(set(manifest_ids)), "Duplicate GP IDs in races_manifest.json"
    assert "madring" in manifest_ids, "Madring GP must be present in races_manifest.json"

    manifest_files = {r["file"] for r in manifest_races}
    disk_files = {f"races/2026/{p.name}" for p in races_dir.glob("*.json")}
    assert manifest_files == disk_files, (
        f"Manifest files and disk files out of sync: {manifest_files ^ disk_files}"
    )

    # 2. Validate every single GP JSON file
    for entry in manifest_races:
        gp_path = repo_root / "src" / "assets" / "data" / entry["file"]
        data = json.loads(gp_path.read_text(encoding="utf-8"))
        gp_id = entry["id"]

        total_laps = int(data["race_info"]["total_laps"])
        winner = data["race_info"]["winner"]
        laps = data["laps"]
        assert total_laps > 0, f"{gp_id}: total_laps must be > 0"
        assert laps, f"{gp_id}: laps must not be empty"

        # No phantom cooldown laps > total_laps
        max_lap_in_laps = max(int(l["lap"]) for l in laps)
        assert max_lap_in_laps == total_laps, (
            f"{gp_id}: max lap in laps ({max_lap_in_laps}) != total_laps ({total_laps})"
        )

        # Winner must be P1 on total_laps AND P1 in race_telemetry.classification
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

        # Qualifying results must be strictly ordered 1..N with P1 gap == 0.0
        quali_results = data.get("qualifying", {}).get("results", [])
        assert len(quali_results) >= 18, f"{gp_id}: missing qualifying results"
        assert [r["grid_pos"] for r in quali_results] == list(
            range(1, len(quali_results) + 1)
        )
        assert quali_results[0]["gap_to_pole"] == 0.0

        # Practice classification must be strictly ordered 1..N
        prac_cls = data.get("practice", {}).get("classification", [])
        assert len(prac_cls) >= 18, f"{gp_id}: missing practice classification"
        assert [r["rank"] for r in prac_cls] == list(range(1, len(prac_cls) + 1))

        # Sprint weekends must have valid sprint_qualifying and sprint blocks
        if data.get("is_sprint_weekend"):
            sq_results = data.get("sprint_qualifying", {}).get("results", [])
            assert len(sq_results) >= 18, f"{gp_id}: missing sprint_qualifying results"
            assert [r["grid_pos"] for r in sq_results] == list(
                range(1, len(sq_results) + 1)
            )
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

