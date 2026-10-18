"""Unit tests for the synthetic F1 race generator (`generate_mock_race.py`)."""

from __future__ import annotations

import json
from pathlib import Path
import random

import pytest

from generate_mock_race import (
    _DEFAULT_DRIVERS,
    _DEFAULT_INITIAL_WINNER,
    _DEFAULT_RACE_YEAR,
    _DEFAULT_TOTAL_LAPS,
    _DriverSimulationState,
    _PIT_STOP_PENALTY_SECONDS,
    _PIT_STOP_TYRE_LIFE_THRESHOLD,
    _TYRE_COMPOUNDS,
    _determine_winner,
    _should_pit,
    _simulate_driver_lap,
    generate_mock_race,
)


def test_generate_mock_race_structure_and_file_output(tmp_path: Path) -> None:
    """Verifies top-level payload keys, lap count, and JSON file persistence."""
    out_file = "bahrain_test.json"
    payload = generate_mock_race(
        gp_name="Bahrain Grand Prix",
        out_filename=out_file,
        output_dir=str(tmp_path),
        seed=42,
    )

    saved_file = tmp_path / out_file
    assert saved_file.exists()

    disk_payload = json.loads(saved_file.read_text(encoding="utf-8"))
    assert disk_payload == payload

    assert set(payload.keys()) == {
        "race_info",
        "drivers",
        "session_events",
        "laps",
    }
    assert payload["race_info"]["year"] == _DEFAULT_RACE_YEAR
    assert payload["race_info"]["gp"] == "Bahrain Grand Prix"
    assert payload["race_info"]["total_laps"] == _DEFAULT_TOTAL_LAPS
    assert len(payload["drivers"]) == len(_DEFAULT_DRIVERS)
    assert payload["session_events"] == []
    assert len(payload["laps"]) == _DEFAULT_TOTAL_LAPS * len(_DEFAULT_DRIVERS)


def test_generate_mock_race_positions_and_winner(tmp_path: Path) -> None:
    """Verifies per-lap position ordering by session_time and winner consistency."""
    payload = generate_mock_race(
        gp_name="Monaco Grand Prix",
        out_filename="monaco.json",
        output_dir=str(tmp_path),
        seed=101,
    )

    laps = payload["laps"]
    num_drivers = len(_DEFAULT_DRIVERS)

    for lap_num in range(1, _DEFAULT_TOTAL_LAPS + 1):
        lap_records = [r for r in laps if r["lap"] == lap_num]
        assert len(lap_records) == num_drivers

        positions = [r["position"] for r in lap_records]
        assert positions == list(range(1, num_drivers + 1))

        session_times = [r["session_time"] for r in lap_records]
        assert session_times == sorted(session_times)

        for record in lap_records:
            assert record["compound"] in _TYRE_COMPOUNDS
            assert record["tyre_life"] >= 1

    final_lap_leader = next(
        r["driver"]
        for r in laps
        if r["lap"] == _DEFAULT_TOTAL_LAPS and r["position"] == 1
    )
    assert payload["race_info"]["winner"] == final_lap_leader


def test_generate_mock_race_deterministic_seed(tmp_path: Path) -> None:
    """Verifies identical seeds produce identical race payloads."""
    dir_one = tmp_path / "run_one"
    dir_two = tmp_path / "run_two"

    payload_one = generate_mock_race(
        gp_name="Silverstone Grand Prix",
        out_filename="silverstone.json",
        output_dir=str(dir_one),
        seed=2026,
    )
    payload_two = generate_mock_race(
        gp_name="Silverstone Grand Prix",
        out_filename="silverstone.json",
        output_dir=str(dir_two),
        seed=2026,
    )
    payload_different = generate_mock_race(
        gp_name="Silverstone Grand Prix",
        out_filename="silverstone_diff.json",
        output_dir=str(dir_two),
        seed=9999,
    )

    assert payload_one == payload_two
    assert payload_one["laps"] != payload_different["laps"]


def test_generate_mock_race_nested_directories_and_special_names(
    tmp_path: Path,
) -> None:
    """Verifies automatic creation of deeply nested output directories."""
    nested_dir = tmp_path / "deep" / "nested" / "2026" / "races"
    gp_name = "São Paulo Grand Prix – Interlagos"
    out_filename = "sao_paulo.json"

    payload = generate_mock_race(
        gp_name=gp_name,
        out_filename=out_filename,
        output_dir=str(nested_dir),
        seed=7,
    )

    expected_path = nested_dir / out_filename
    assert expected_path.is_file()
    assert payload["race_info"]["gp"] == gp_name


@pytest.mark.parametrize(
    ("gp_name", "out_filename"),
    [
        ("", "valid.json"),
        ("   ", "valid.json"),
        ("Valid GP", ""),
        ("Valid GP", "   "),
    ],
)
def test_generate_mock_race_invalid_inputs_raise_value_error(
    tmp_path: Path,
    gp_name: str,
    out_filename: str,
) -> None:
    """Verifies empty or whitespace-only arguments raise ValueError."""
    with pytest.raises(ValueError):
        generate_mock_race(
            gp_name=gp_name,
            out_filename=out_filename,
            output_dir=str(tmp_path),
            seed=1,
        )


def test_should_pit_and_simulate_driver_lap_pit_stop() -> None:
    """Verifies pit-stop penalty and tyre reset when threshold is exceeded."""
    state = _DriverSimulationState(
        compound="SOFT",
        tyre_life=_PIT_STOP_TYRE_LIFE_THRESHOLD,
        base_pace=95.0,
        total_time=1000.0,
    )
    # At exact threshold (20), driver should never pit regardless of RNG.
    assert not _should_pit(state, random.Random(0))

    # Find a seed where rng.random() > 0.8 on the pit check.
    pitting_state = _DriverSimulationState(
        compound="SOFT",
        tyre_life=_PIT_STOP_TYRE_LIFE_THRESHOLD + 5,
        base_pace=95.0,
        total_time=0.0,
    )
    # Seed 5 produces uniform draw then random() > 0.8; verify via helper loop.
    for candidate_seed in range(100):
        test_rng = random.Random(candidate_seed)
        _ = test_rng.uniform(-0.5, 1.0)
        if test_rng.random() > 0.8:
            chosen_seed = candidate_seed
            break

    lap_result = _simulate_driver_lap(
        "VER",
        pitting_state,
        random.Random(chosen_seed),
    )
    assert lap_result["tyre_life"] == 1
    assert lap_result["time"] >= 95.0 + _PIT_STOP_PENALTY_SECONDS - 0.5


def test_determine_winner_fallback_when_empty() -> None:
    """Verifies _determine_winner falls back to default winner when no match exists."""
    assert _determine_winner([], _DEFAULT_TOTAL_LAPS) == _DEFAULT_INITIAL_WINNER
