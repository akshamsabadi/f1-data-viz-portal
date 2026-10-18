"""Unit and integration tests for generate_corner_speeds."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from generate_corner_speeds import (
    _DEFAULT_TRACK_PROFILE,
    _calculate_single_corner_speed,
    _calculate_team_top_lap_averages,
    _generate_corners_data,
    _group_drivers_by_team,
    _load_track_profiles,
    _resolve_track_profile,
    calculate_corner_speeds,
)


def _create_sample_race_payload(
    gp_name: str = "Monaco Grand Prix",
    laps: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Builds a minimal valid race data dictionary for testing.

    Args:
        gp_name: Name of the Grand Prix to include in ``race_info``.
        laps: Optional explicit list of lap records. Defaults to 6 laps per
            team across two teams with distinct lap time performance.

    Returns:
        A race data dictionary matching the schema consumed by
        ``calculate_corner_speeds``.
    """
    default_laps: list[dict[str, Any]] = [
        {"driver": "VER", "lap": 1, "time": 75.0},
        {"driver": "VER", "lap": 2, "time": 75.2},
        {"driver": "VER", "lap": 3, "time": 75.4},
        {"driver": "LAW", "lap": 1, "time": 75.6},
        {"driver": "LAW", "lap": 2, "time": 75.8},
        {"driver": "LAW", "lap": 3, "time": 95.0},
        {"driver": "LEC", "lap": 1, "time": 85.0},
        {"driver": "LEC", "lap": 2, "time": 85.2},
        {"driver": "LEC", "lap": 3, "time": 85.4},
        {"driver": "HAM", "lap": 1, "time": 85.6},
        {"driver": "HAM", "lap": 2, "time": 85.8},
        {"driver": "HAM", "lap": 3, "time": 105.0},
    ]
    return {
        "race_info": {"gp": gp_name, "year": 2026},
        "drivers": [
            {"code": "VER", "team": "Red Bull Racing", "color": "#3671C6"},
            {"code": "LAW", "team": "Red Bull Racing", "color": "#3671C6"},
            {"code": "LEC", "team": "Ferrari", "color": "#E8002D"},
            {"code": "HAM", "team": "Ferrari", "color": "#E8002D"},
        ],
        "laps": default_laps if laps is None else laps,
    }


@pytest.mark.parametrize(
    ("gp_name", "expected_turns", "expected_base_speed"),
    [
        ("Monaco Grand Prix", 19, 100),
        ("Italian Grand Prix", 11, 210),
        ("British Grand Prix", 18, 190),
    ],
)
def test_calculate_corner_speeds_normal_tracks(
    tmp_path: Path,
    gp_name: str,
    expected_turns: int,
    expected_base_speed: int,
) -> None:
    """Verifies corner speed generation and file persistence for known circuits."""
    race_file_path = tmp_path / "race.json"
    payload = _create_sample_race_payload(gp_name=gp_name)
    race_file_path.write_text(json.dumps(payload), encoding="utf-8")

    corners = calculate_corner_speeds(str(race_file_path))

    expected_record_count = expected_turns * 2
    assert len(corners) == expected_record_count

    persisted_data = json.loads(race_file_path.read_text(encoding="utf-8"))
    assert "corners" in persisted_data
    assert persisted_data["corners"] == corners

    turns_seen = {record["turn"] for record in corners}
    assert turns_seen == set(range(1, expected_turns + 1))

    red_bull_speeds = [
        record["speed"]
        for record in corners
        if record["team"] == "Red Bull Racing"
    ]
    ferrari_speeds = [
        record["speed"] for record in corners if record["team"] == "Ferrari"
    ]
    assert len(red_bull_speeds) == expected_turns
    assert len(ferrari_speeds) == expected_turns

    # Red Bull has significantly faster lap times (75.4s vs 85.4s average),
    # so its mean corner speed across the circuit must exceed Ferrari's.
    mean_red_bull_speed = sum(red_bull_speeds) / len(red_bull_speeds)
    mean_ferrari_speed = sum(ferrari_speeds) / len(ferrari_speeds)
    assert mean_red_bull_speed > mean_ferrari_speed
    assert abs(mean_red_bull_speed - expected_base_speed) < 40.0

    for record in corners:
        if record["team"] == "Red Bull Racing":
            assert record["color"] == "#3671C6"
        else:
            assert record["color"] == "#E8002D"


def test_calculate_corner_speeds_unrecognized_gp_uses_default_profile(
    tmp_path: Path,
) -> None:
    """Verifies fallback to the 15-turn default profile for unknown GP names."""
    race_file_path = tmp_path / "unknown_gp.json"
    payload = _create_sample_race_payload(gp_name="Antarctica Grand Prix")
    race_file_path.write_text(json.dumps(payload), encoding="utf-8")

    corners = calculate_corner_speeds(str(race_file_path))

    expected_turns = _DEFAULT_TRACK_PROFILE["turns"]
    assert len(corners) == expected_turns * 2
    assert {record["turn"] for record in corners} == set(
        range(1, expected_turns + 1)
    )


def test_calculate_corner_speeds_missing_profiles_file_falls_back_to_default(
    tmp_path: Path,
) -> None:
    """Verifies graceful fallback when track_profiles.json does not exist."""
    race_file_path = tmp_path / "race.json"
    non_existent_profiles_path = tmp_path / "missing_profiles.json"
    payload = _create_sample_race_payload(gp_name="Monaco Grand Prix")
    race_file_path.write_text(json.dumps(payload), encoding="utf-8")

    corners = calculate_corner_speeds(
        str(race_file_path),
        profiles_path=str(non_existent_profiles_path),
    )

    expected_turns = _DEFAULT_TRACK_PROFILE["turns"]
    assert len(corners) == expected_turns * 2


@pytest.mark.parametrize(
    "invalid_laps",
    [
        [],
        [
            {"driver": "VER", "lap": 1, "time": 0.0},
            {"driver": "LEC", "lap": 1, "time": -5.2},
        ],
    ],
)
def test_calculate_corner_speeds_no_valid_laps_leaves_file_unchanged(
    tmp_path: Path,
    invalid_laps: list[dict[str, Any]],
) -> None:
    """Verifies empty or non-positive lap times return empty list cleanly."""
    race_file_path = tmp_path / "empty_laps.json"
    payload = _create_sample_race_payload(laps=invalid_laps)
    original_content = json.dumps(payload, indent=2)
    race_file_path.write_text(original_content, encoding="utf-8")

    corners = calculate_corner_speeds(str(race_file_path))

    assert corners == []
    persisted_data = json.loads(race_file_path.read_text(encoding="utf-8"))
    assert "corners" not in persisted_data


def test_calculate_corner_speeds_fewer_than_five_laps_per_team(
    tmp_path: Path,
) -> None:
    """Verifies teams with fewer than 5 clean laps still produce corner speeds."""
    sparse_laps = [
        {"driver": "VER", "lap": 1, "time": 80.0},
        {"driver": "LAW", "lap": 1, "time": 82.0},
        {"driver": "LEC", "lap": 1, "time": 84.0},
    ]
    race_file_path = tmp_path / "sparse_laps.json"
    payload = _create_sample_race_payload(
        gp_name="Austrian Grand Prix",
        laps=sparse_laps,
    )
    race_file_path.write_text(json.dumps(payload), encoding="utf-8")

    corners = calculate_corner_speeds(str(race_file_path))

    # Austrian GP has 10 turns and 2 valid teams -> 20 records.
    assert len(corners) == 10 * 2


def test_calculate_corner_speeds_raises_on_missing_race_file(
    tmp_path: Path,
) -> None:
    """Verifies FileNotFoundError is raised when json_path does not exist."""
    missing_race_file = tmp_path / "does_not_exist.json"
    with pytest.raises(FileNotFoundError):
        calculate_corner_speeds(str(missing_race_file))


def test_calculate_corner_speeds_raises_on_corrupted_race_json(
    tmp_path: Path,
) -> None:
    """Verifies JSONDecodeError is raised when json_path contains invalid JSON."""
    corrupted_race_file = tmp_path / "corrupted.json"
    corrupted_race_file.write_text("{invalid json", encoding="utf-8")
    with pytest.raises(json.JSONDecodeError):
        calculate_corner_speeds(str(corrupted_race_file))


def test_pure_helpers_top_five_filtering_and_deterministic_speed() -> None:
    """Verifies helper functions filter top 5 clean laps and compute speeds."""
    drivers = [
        {"code": "VER", "team": "Red Bull Racing", "color": "#3671C6"},
        {"code": "LAW", "team": "Red Bull Racing", "color": "#3671C6"},
    ]
    teams_info = _group_drivers_by_team(drivers)
    assert teams_info == {
        "Red Bull Racing": {"drivers": ["VER", "LAW"], "color": "#3671C6"}
    }

    laps = [
        {"driver": "VER", "time": -1.0},
        {"driver": "VER", "time": 0.0},
        {"driver": "VER", "time": 90.0},
        {"driver": "VER", "time": 80.0},
        {"driver": "VER", "time": 81.0},
        {"driver": "LAW", "time": 82.0},
        {"driver": "LAW", "time": 83.0},
        {"driver": "LAW", "time": 84.0},
    ]
    averages = _calculate_team_top_lap_averages(laps, teams_info)
    # Top 5 valid times are 80, 81, 82, 83, 84 -> mean = 82.0 (90.0 and <=0 excluded)
    assert averages["Red Bull Racing"] == pytest.approx(82.0)

    speed_first = _calculate_single_corner_speed(
        turn_base_speed=150.0,
        time_delta_ratio=1.0,
        turn_number=1,
        team_name="Red Bull Racing",
    )
    speed_second = _calculate_single_corner_speed(
        turn_base_speed=150.0,
        time_delta_ratio=1.0,
        turn_number=1,
        team_name="Red Bull Racing",
    )
    assert speed_first == speed_second
    assert 147.0 <= speed_first <= 153.0

    assert _generate_corners_data(_DEFAULT_TRACK_PROFILE, {}, teams_info) == []
    assert _load_track_profiles("/nonexistent/path/track_profiles.json") == {}
    assert (
        _resolve_track_profile("Unknown GP", {"monaco": {"turns": 19, "base_speed": 100, "variation": 40}})
        == _DEFAULT_TRACK_PROFILE
    )


def test_corner_speeds_prevent_slow_team_resonance_and_match_country_profiles() -> None:
    """Verifies golden-angle corner variance prevents slow teams from beating pole team in most corners."""
    profiles = _load_track_profiles(
        str(Path(__file__).resolve().parent / "track_profiles.json")
    )
    for gp_name, expected_turns in (
        ("China Grand Prix", 16),
        ("Chinese Grand Prix", 16),
        ("Japan Grand Prix", 18),
        ("Canada Grand Prix", 14),
        ("Singapore Grand Prix", 19),
    ):
        prof = _resolve_track_profile(gp_name, profiles)
        assert prof["turns"] == expected_turns

    singapore_profile = _resolve_track_profile("Singapore Grand Prix", profiles)
    teams_info = {
        "Red Bull Racing": {"drivers": ["VER", "LAW"], "color": "#3671C6"},
        "Ferrari": {"drivers": ["LEC", "HAM"], "color": "#E8002D"},
        "Mercedes": {"drivers": ["RUS", "ANT"], "color": "#00E3C0"},
        "McLaren": {"drivers": ["NOR", "PIA"], "color": "#FE7B04"},
        "Haas F1 Team": {"drivers": ["BEA", "OCO"], "color": "#FEFEFE"},
    }
    team_perf = {
        "Red Bull Racing": 91.373,
        "Ferrari": 91.427,
        "Mercedes": 91.562,
        "McLaren": 91.712,
        "Haas F1 Team": 92.908,
    }
    corners = _generate_corners_data(singapore_profile, team_perf, teams_info)
    by_turn: dict[int, dict[str, float]] = {}
    for item in corners:
        by_turn.setdefault(int(item["turn"]), {})[str(item["team"])] = float(
            item["speed"]
        )
    haas_wins_vs_rbr = sum(
        1
        for turn_speeds in by_turn.values()
        if turn_speeds["Haas F1 Team"] > turn_speeds["Red Bull Racing"]
    )
    assert haas_wins_vs_rbr == 0

