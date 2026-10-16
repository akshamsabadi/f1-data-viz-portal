"""Generates simulated telemetry corner speed profiles for F1 race datasets.

This module reads processed race JSON files, matches the Grand Prix against
known circuit corner profiles, and derives per-turn average corner speeds for
each constructor based on their top five clean lap times.
"""

from collections.abc import Mapping, Sequence
import glob
import json
import math
import os
from typing import Any, Final

_TRACK_PROFILES_FILENAME: Final[str] = "track_profiles.json"
_DEFAULT_TRACK_PROFILE: Final[dict[str, int]] = {
    "turns": 15,
    "base_speed": 160,
    "variation": 60,
}
_TOP_CLEAN_LAPS_COUNT: Final[int] = 5
_CORNER_VARIANCE_AMPLITUDE_KMH: Final[float] = 3.0
_SPEED_ROUNDING_DECIMALS: Final[int] = 1
_JSON_INDENT_SPACES: Final[int] = 2
_DEFAULT_RACES_RELATIVE_DIR: Final[tuple[str, ...]] = (
    "..",
    "src",
    "assets",
    "data",
    "races",
    "2026",
)


def _load_track_profiles(profiles_path: str) -> dict[str, dict[str, int]]:
    """Loads circuit corner profiles from a JSON configuration file.

    Args:
        profiles_path: Path to the track profiles JSON file.

    Returns:
        A dictionary mapping circuit keyword substrings to their turn count,
        base speed, and speed variation parameters. Returns an empty dictionary
        if the file cannot be read or parsed.
    """
    try:
        with open(profiles_path, "r", encoding="utf-8") as profile_file:
            loaded_profiles: dict[str, dict[str, int]] = json.load(profile_file)
            return loaded_profiles
    except (OSError, json.JSONDecodeError) as error:
        print(
            f"Warning: Failed to load {_TRACK_PROFILES_FILENAME} ({error}). "
            "Using empty profile database."
        )
        return {}


def _resolve_track_profile(
    gp_name: str,
    track_profiles: Mapping[str, Mapping[str, int]],
) -> dict[str, int]:
    """Matches a Grand Prix name to a circuit profile or falls back to default.

    Args:
        gp_name: Name of the Grand Prix from race metadata.
        track_profiles: Mapping of circuit keywords to profile configurations.

    Returns:
        A dictionary containing ``turns``, ``base_speed``, and ``variation``.
    """
    normalized_gp_name = gp_name.lower()
    for track_key, profile_config in track_profiles.items():
        if track_key in normalized_gp_name:
            return dict(profile_config)
    return dict(_DEFAULT_TRACK_PROFILE)


def _group_drivers_by_team(
    drivers: Sequence[Mapping[str, Any]],
) -> dict[str, dict[str, Any]]:
    """Groups driver codes by constructor team name and records team color.

    Args:
        drivers: Sequence of driver metadata dictionaries containing ``team``,
            ``code``, and ``color`` keys.

    Returns:
        A dictionary keyed by team name with ``drivers`` (list of driver codes)
        and ``color`` (hex color string).
    """
    teams_info: dict[str, dict[str, Any]] = {}
    for driver in drivers:
        team_name = str(driver["team"])
        if team_name not in teams_info:
            teams_info[team_name] = {
                "drivers": [],
                "color": driver["color"],
            }
        teams_info[team_name]["drivers"].append(driver["code"])
    return teams_info


def _calculate_team_top_lap_averages(
    laps: Sequence[Mapping[str, Any]],
    teams_info: Mapping[str, Mapping[str, Any]],
) -> dict[str, float]:
    """Calculates each team's mean lap time across their fastest clean laps.

    Args:
        laps: Sequence of lap records containing ``driver`` and ``time`` keys.
        teams_info: Mapping of team names to driver code lists and colors.

    Returns:
        A dictionary mapping each team with at least one valid lap to the mean
        lap time of its fastest ``_TOP_CLEAN_LAPS_COUNT`` laps.
    """
    team_performance: dict[str, float] = {}
    for team_name, team_metadata in teams_info.items():
        team_laps: list[Mapping[str, Any]] = []
        for driver_code in team_metadata["drivers"]:
            driver_laps = [
                lap_record
                for lap_record in laps
                if lap_record["driver"] == driver_code and lap_record["time"] > 0
            ]
            team_laps.extend(driver_laps)

        team_laps.sort(key=lambda lap_record: float(lap_record["time"]))
        top_clean_laps = team_laps[:_TOP_CLEAN_LAPS_COUNT]
        if not top_clean_laps:
            continue

        average_top_lap_time = sum(
            float(lap_record["time"]) for lap_record in top_clean_laps
        ) / len(top_clean_laps)
        team_performance[team_name] = average_top_lap_time

    return team_performance


def _calculate_single_corner_speed(
    turn_base_speed: float,
    time_delta_ratio: float,
    turn_number: int,
    team_name: str,
) -> float:
    """Computes the simulated apex/corner speed for a single turn and team.

    Args:
        turn_base_speed: Baseline speed for the turn in km/h.
        time_delta_ratio: Ratio of the fastest team's average lap time to this
            team's average lap time.
        turn_number: 1-based turn index on the circuit.
        team_name: Name of the constructor team, used to seed deterministic
            per-corner variance.

    Returns:
        Simulated corner speed in km/h rounded to ``_SPEED_ROUNDING_DECIMALS``.
    """
    team_seed = sum(ord(character) for character in team_name)
    corner_variance = (
        math.cos(turn_number * team_seed) * _CORNER_VARIANCE_AMPLITUDE_KMH
    )
    raw_corner_speed = (turn_base_speed * time_delta_ratio) + corner_variance
    return round(raw_corner_speed, _SPEED_ROUNDING_DECIMALS)


def _generate_corners_data(
    profile: Mapping[str, int],
    team_performance: Mapping[str, float],
    teams_info: Mapping[str, Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Generates corner speed records for all turns and teams in a race.

    Args:
        profile: Circuit profile containing ``turns``, ``base_speed``, and
            ``variation``.
        team_performance: Mapping of team names to their average top lap times.
        teams_info: Mapping of team names to driver lists and team hex colors.

    Returns:
        List of corner speed dictionaries with ``turn``, ``team``, ``speed``,
        and ``color`` keys.
    """
    if not team_performance:
        return []

    fastest_average_time = min(team_performance.values())
    corners_data: list[dict[str, Any]] = []

    for turn_number in range(1, profile["turns"] + 1):
        turn_base_speed = profile["base_speed"] + (
            math.sin(turn_number) * profile["variation"]
        )
        for team_name, average_lap_time in team_performance.items():
            time_delta_ratio = fastest_average_time / average_lap_time
            corner_speed = _calculate_single_corner_speed(
                turn_base_speed=turn_base_speed,
                time_delta_ratio=time_delta_ratio,
                turn_number=turn_number,
                team_name=team_name,
            )
            corners_data.append(
                {
                    "turn": turn_number,
                    "team": team_name,
                    "speed": corner_speed,
                    "color": teams_info[team_name]["color"],
                }
            )

    return corners_data


def calculate_corner_speeds(
    json_path: str,
    profiles_path: str | None = None,
) -> list[dict[str, Any]]:
    """Calculates team corner speeds for a race JSON file and updates it in place.

    Args:
        json_path: Path to the target race JSON file to enrich with ``corners``
            telemetry data.
        profiles_path: Optional override path to the track profiles JSON file.
            Defaults to ``track_profiles.json`` alongside this module.

    Returns:
        The list of generated corner speed records written to ``json_path``, or
        an empty list if no valid laps were present.
    """
    print(f"Processing {json_path}...")
    with open(json_path, "r", encoding="utf-8") as race_file:
        race_data: dict[str, Any] = json.load(race_file)

    resolved_profiles_path = (
        profiles_path
        if profiles_path is not None
        else os.path.join(os.path.dirname(__file__), _TRACK_PROFILES_FILENAME)
    )
    track_profiles = _load_track_profiles(resolved_profiles_path)
    gp_name = str(race_data["race_info"]["gp"])
    track_profile = _resolve_track_profile(gp_name, track_profiles)

    teams_info = _group_drivers_by_team(race_data["drivers"])
    team_performance = _calculate_team_top_lap_averages(
        race_data["laps"], teams_info
    )
    if not team_performance:
        print("No valid laps found.")
        return []

    corners_data = _generate_corners_data(
        track_profile, team_performance, teams_info
    )
    race_data["corners"] = corners_data

    with open(json_path, "w", encoding="utf-8") as race_file:
        json.dump(race_data, race_file, indent=_JSON_INDENT_SPACES)
    print(f"Added {len(corners_data)} corner speed records to {json_path}")
    return corners_data


def _main() -> None:
    """Processes all 2026 race JSON files in the default assets directory."""
    target_directory = os.path.join(
        os.path.dirname(__file__), *_DEFAULT_RACES_RELATIVE_DIR
    )
    race_json_paths = glob.glob(os.path.join(target_directory, "*.json"))
    for race_json_path in race_json_paths:
        calculate_corner_speeds(race_json_path)


if __name__ == "__main__":
    _main()
