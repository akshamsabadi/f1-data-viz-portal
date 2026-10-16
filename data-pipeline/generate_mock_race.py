"""Synthetic Formula 1 race telemetry generator for the F1 Data Viz Portal.

This module generates deterministic or randomized mock race telemetry datasets
(including per-lap times, tyre compounds, pit stops, and track positions) and
writes the resulting JSON payload to disk.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
import json
import os
import random
import sys
from typing import Any, Final

_DEFAULT_RACE_YEAR: Final[int] = 2026
_DEFAULT_TOTAL_LAPS: Final[int] = 57
_DEFAULT_INITIAL_WINNER: Final[str] = "VER"
_TYRE_COMPOUNDS: Final[tuple[str, ...]] = ("SOFT", "MEDIUM", "HARD")
_BASE_PACE_SECONDS: Final[float] = 95.0
_DRIVER_PACE_STEP_SECONDS: Final[float] = 0.15
_TYRE_DEGRADATION_PER_LAP_SECONDS: Final[float] = 0.05
_LAP_VARIATION_MIN_SECONDS: Final[float] = -0.5
_LAP_VARIATION_MAX_SECONDS: Final[float] = 1.0
_PIT_STOP_TYRE_LIFE_THRESHOLD: Final[int] = 20
_PIT_STOP_PROBABILITY_THRESHOLD: Final[float] = 0.8
_PIT_STOP_PENALTY_SECONDS: Final[float] = 25.0
_TIME_ROUNDING_DECIMALS: Final[int] = 3

_DEFAULT_DRIVERS: Final[tuple[dict[str, str], ...]] = (
    {"code": "VER", "name": "Max Verstappen", "team": "Red Bull", "color": "#3671C6"},
    {"code": "LAW", "name": "Liam Lawson", "team": "Red Bull", "color": "#3671C6"},
    {"code": "LEC", "name": "Charles Leclerc", "team": "Ferrari", "color": "#E80020"},
    {"code": "HAM", "name": "Lewis Hamilton", "team": "Ferrari", "color": "#E80020"},
    {"code": "RUS", "name": "George Russell", "team": "Mercedes", "color": "#27F4D2"},
    {"code": "ANT", "name": "Kimi Antonelli", "team": "Mercedes", "color": "#27F4D2"},
    {"code": "NOR", "name": "Lando Norris", "team": "McLaren", "color": "#FF8000"},
    {"code": "PIA", "name": "Oscar Piastri", "team": "McLaren", "color": "#FF8000"},
    {"code": "ALO", "name": "Fernando Alonso", "team": "Aston Martin", "color": "#229971"},
    {"code": "STR", "name": "Lance Stroll", "team": "Aston Martin", "color": "#229971"},
    {"code": "HUL", "name": "Nico Hülkenberg", "team": "Audi", "color": "#00E701"},
    {"code": "BOR", "name": "Gabriel Bortoleto", "team": "Audi", "color": "#00E701"},
    {"code": "TSU", "name": "Yuki Tsunoda", "team": "RB", "color": "#6692FF"},
    {"code": "HAD", "name": "Isack Hadjar", "team": "RB", "color": "#6692FF"},
    {"code": "ALB", "name": "Alexander Albon", "team": "Williams", "color": "#005AFF"},
    {"code": "SAI", "name": "Carlos Sainz", "team": "Williams", "color": "#005AFF"},
    {"code": "OCO", "name": "Esteban Ocon", "team": "Haas", "color": "#FFFFFF"},
    {"code": "BEA", "name": "Oliver Bearman", "team": "Haas", "color": "#FFFFFF"},
    {"code": "GAS", "name": "Pierre Gasly", "team": "Alpine", "color": "#FF87BC"},
    {"code": "DOO", "name": "Jack Doohan", "team": "Alpine", "color": "#FF87BC"},
)


@dataclass
class _DriverSimulationState:
    """Mutable per-driver state tracked across laps during race simulation.

    Attributes:
        compound: Current tyre compound name (e.g., "SOFT", "MEDIUM", "HARD").
        tyre_life: Number of laps completed on the current tyre set.
        base_pace: Baseline lap time in seconds before degradation or noise.
        total_time: Cumulative elapsed race time in seconds.
    """

    compound: str
    tyre_life: int
    base_pace: float
    total_time: float


def _initialize_driver_states(
    drivers: Sequence[Mapping[str, str]],
    rng: random.Random,
) -> dict[str, _DriverSimulationState]:
    """Creates initial per-driver simulation state before lap 1.

    Args:
        drivers: Ordered sequence of driver metadata mappings.
        rng: Random number generator instance for compound selection.

    Returns:
        Mapping from three-letter driver code to `_DriverSimulationState`.
    """
    driver_states: dict[str, _DriverSimulationState] = {}
    for index, driver in enumerate(drivers):
        # Scale baseline pace slightly by grid order so front-runners have a small edge.
        base_pace = _BASE_PACE_SECONDS + (index * _DRIVER_PACE_STEP_SECONDS)
        driver_states[driver["code"]] = _DriverSimulationState(
            compound=rng.choice(_TYRE_COMPOUNDS),
            tyre_life=1,
            base_pace=base_pace,
            total_time=0.0,
        )
    return driver_states


def _should_pit(state: _DriverSimulationState, rng: random.Random) -> bool:
    """Determines whether a driver makes a pit stop on the current lap.

    Args:
        state: Current simulation state for the driver.
        rng: Random number generator instance.

    Returns:
        True if the driver's tyre life exceeds the threshold and the random
        draw triggers a pit stop; False otherwise.
    """
    return (
        state.tyre_life > _PIT_STOP_TYRE_LIFE_THRESHOLD
        and rng.random() > _PIT_STOP_PROBABILITY_THRESHOLD
    )


def _simulate_driver_lap(
    driver_code: str,
    state: _DriverSimulationState,
    rng: random.Random,
) -> dict[str, Any]:
    """Advances a single driver's state by one lap and returns raw lap metrics.

    Args:
        driver_code: Three-letter driver identifier.
        state: Mutable simulation state for the driver (updated in place).
        rng: Random number generator instance.

    Returns:
        Dictionary containing unrounded lap time, cumulative total time,
        active compound, and updated tyre life.
    """
    tyre_degradation = state.tyre_life * _TYRE_DEGRADATION_PER_LAP_SECONDS
    pace_variation = rng.uniform(
        _LAP_VARIATION_MIN_SECONDS,
        _LAP_VARIATION_MAX_SECONDS,
    )
    lap_time = state.base_pace + tyre_degradation + pace_variation

    if _should_pit(state, rng):
        lap_time += _PIT_STOP_PENALTY_SECONDS
        state.compound = rng.choice(_TYRE_COMPOUNDS)
        state.tyre_life = 1
    else:
        state.tyre_life += 1

    state.total_time += lap_time

    return {
        "driver": driver_code,
        "time": lap_time,
        "total": state.total_time,
        "compound": state.compound,
        "tyre_life": state.tyre_life,
    }


def _simulate_all_laps(
    drivers: Sequence[Mapping[str, str]],
    total_laps: int,
    rng: random.Random,
) -> list[dict[str, Any]]:
    """Simulates all laps for all drivers and computes track positions per lap.

    Args:
        drivers: Sequence of driver metadata mappings.
        total_laps: Total number of laps in the race.
        rng: Random number generator instance.

    Returns:
        Flat list of lap record dictionaries ordered by lap and position.
    """
    driver_states = _initialize_driver_states(drivers, rng)
    laps_data: list[dict[str, Any]] = []

    for lap in range(1, total_laps + 1):
        lap_results = [
            _simulate_driver_lap(
                driver["code"],
                driver_states[driver["code"]],
                rng,
            )
            for driver in drivers
        ]
        lap_results.sort(key=lambda lap_result: lap_result["total"])

        for position, lap_result in enumerate(lap_results, start=1):
            laps_data.append(
                {
                    "driver": lap_result["driver"],
                    "lap": lap,
                    "time": round(lap_result["time"], _TIME_ROUNDING_DECIMALS),
                    "compound": lap_result["compound"],
                    "tyre_life": lap_result["tyre_life"],
                    "position": position,
                    "session_time": round(
                        lap_result["total"],
                        _TIME_ROUNDING_DECIMALS,
                    ),
                }
            )

    return laps_data


def _determine_winner(
    laps_data: Sequence[Mapping[str, Any]],
    total_laps: int,
) -> str:
    """Finds the race winner from the final lap's classification.

    Args:
        laps_data: Sequence of simulated lap records.
        total_laps: Final lap number of the race.

    Returns:
        Three-letter code of the driver in position 1 on the final lap, or
        `_DEFAULT_INITIAL_WINNER` if no matching record exists.
    """
    for lap_record in laps_data:
        if lap_record["lap"] == total_laps and lap_record["position"] == 1:
            return str(lap_record["driver"])
    return _DEFAULT_INITIAL_WINNER


def _resolve_output_path(out_filename: str, output_dir: str | None) -> str:
    """Resolves the target file path for the generated race JSON file.

    Args:
        out_filename: Name of the output JSON file.
        output_dir: Optional directory path; defaults to the repository's
            `src/assets/data/races/<year>` directory when None.

    Returns:
        Resolved file system path for writing the JSON payload.
    """
    if output_dir is None:
        base_dir = os.path.join(
            os.path.dirname(__file__),
            "..",
            "src",
            "assets",
            "data",
            "races",
            str(_DEFAULT_RACE_YEAR),
        )
    else:
        base_dir = output_dir
    return os.path.join(base_dir, out_filename)


def _write_race_payload(out_path: str, payload: Mapping[str, Any]) -> None:
    """Writes the serialized race payload JSON to disk, creating directories.

    Args:
        out_path: Destination file path.
        payload: Serializable dictionary containing race telemetry data.
    """
    parent_dir = os.path.dirname(out_path)
    if parent_dir:
        os.makedirs(parent_dir, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as file_handle:
        json.dump(payload, file_handle, indent=2)


def generate_mock_race(
    gp_name: str,
    out_filename: str,
    output_dir: str | None = None,
    seed: int | None = None,
) -> dict[str, Any]:
    """Generates a mock Formula 1 race dataset and saves it as a JSON file.

    Args:
        gp_name: Display name of the Grand Prix (e.g., "Las Vegas Grand Prix").
        out_filename: Output JSON filename (e.g., "las_vegas.json").
        output_dir: Optional custom directory in which to write `out_filename`.
            Defaults to `../src/assets/data/races/2026` relative to this file.
        seed: Optional random seed for deterministic simulation output.

    Returns:
        The generated race payload dictionary written to disk.

    Raises:
        ValueError: If `gp_name` or `out_filename` is empty or whitespace-only.
    """
    if not gp_name or not gp_name.strip():
        raise ValueError("gp_name must be a non-empty string.")
    if not out_filename or not out_filename.strip():
        raise ValueError("out_filename must be a non-empty string.")

    rng = random.Random(seed)
    drivers_list: list[dict[str, str]] = [
        dict(driver) for driver in _DEFAULT_DRIVERS
    ]
    laps_data = _simulate_all_laps(
        drivers=drivers_list,
        total_laps=_DEFAULT_TOTAL_LAPS,
        rng=rng,
    )
    winner = _determine_winner(
        laps_data=laps_data,
        total_laps=_DEFAULT_TOTAL_LAPS,
    )

    race_info: dict[str, Any] = {
        "year": _DEFAULT_RACE_YEAR,
        "gp": gp_name,
        "total_laps": _DEFAULT_TOTAL_LAPS,
        "winner": winner,
    }
    payload: dict[str, Any] = {
        "race_info": race_info,
        "drivers": drivers_list,
        "session_events": [],
        "laps": laps_data,
    }

    out_path = _resolve_output_path(out_filename, output_dir)
    _write_race_payload(out_path, payload)
    print(f"Mock data for {gp_name} saved to {out_path}")
    return payload


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python generate_mock_race.py 'GP Name' filename.json")
        sys.exit(1)
    generate_mock_race(sys.argv[1], sys.argv[2])
