"""Unit tests for the OpenF1 data fetching and lap processing pipeline."""

import json
import os
from pathlib import Path
import sys
from typing import Any
import unittest
from unittest.mock import MagicMock, patch
import pytest

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from fetch_openf1 import (
    _find_matching_session,
    _is_matching_session,
    fetch_openf1_data,
    process_laps_data,
)


class TestProcessLapsData(unittest.TestCase):
    """Tests for `process_laps_data` covering normal, interpolation, and edge cases."""

    def setUp(self) -> None:
        """Initializes sample driver and stint fixtures for lap processing tests."""
        self.drivers_dict: dict[int, dict[str, str]] = {
            1: {
                "code": "VER",
                "name": "Max Verstappen",
                "team": "Red Bull",
                "color": "#ffffff",
            },
            44: {
                "code": "HAM",
                "name": "Lewis Hamilton",
                "team": "Mercedes",
                "color": "#ffffff",
            },
        }
        self.stints_data: list[dict[str, Any]] = [
            {
                "driver_number": 1,
                "lap_start": 1,
                "lap_end": 10,
                "tyre_age_at_start": 0,
                "compound": "SOFT",
            },
            {
                "driver_number": 44,
                "lap_start": 1,
                "lap_end": 10,
                "tyre_age_at_start": 2,
                "compound": "MEDIUM",
            },
        ]

    def test_normal_laps(self) -> None:
        """Verifies normal lap ordering, session times, and tyre life calculation."""
        laps_data: list[dict[str, Any]] = [
            {"driver_number": 1, "lap_number": 1, "lap_duration": 90.0},
            {"driver_number": 1, "lap_number": 2, "lap_duration": 91.0},
            {"driver_number": 44, "lap_number": 1, "lap_duration": 92.0},
            {"driver_number": 44, "lap_number": 2, "lap_duration": 89.0},
        ]

        final_laps, max_lap = process_laps_data(
            laps_data, self.drivers_dict, self.stints_data
        )
        self.assertEqual(max_lap, 2)
        self.assertEqual(len(final_laps), 4)

        lap1 = sorted(
            [lap for lap in final_laps if lap["lap"] == 1],
            key=lambda item: int(item["position"]),
        )
        self.assertEqual(lap1[0]["driver"], "VER")
        self.assertEqual(lap1[0]["position"], 1)
        self.assertEqual(lap1[0]["session_time"], 90.0)
        self.assertEqual(lap1[0]["compound"], "SOFT")
        self.assertEqual(lap1[0]["tyre_life"], 1)

        self.assertEqual(lap1[1]["driver"], "HAM")
        self.assertEqual(lap1[1]["position"], 2)
        self.assertEqual(lap1[1]["session_time"], 92.0)
        self.assertEqual(lap1[1]["compound"], "MEDIUM")
        self.assertEqual(lap1[1]["tyre_life"], 3)

        lap2_ver = next(
            lap for lap in final_laps if lap["lap"] == 2 and lap["driver"] == "VER"
        )
        lap2_ham = next(
            lap for lap in final_laps if lap["lap"] == 2 and lap["driver"] == "HAM"
        )
        self.assertEqual(lap2_ver["session_time"], 181.0)
        self.assertEqual(lap2_ham["session_time"], 181.0)

    def test_missing_lap_duration_interpolation(self) -> None:
        """Verifies linear interpolation when a lap record has a null duration."""
        laps_data: list[dict[str, Any]] = [
            {"driver_number": 44, "lap_number": 1, "lap_duration": 90.0},
            {"driver_number": 44, "lap_number": 2, "lap_duration": None},
            {"driver_number": 44, "lap_number": 3, "lap_duration": 92.0},
        ]

        final_laps, max_lap = process_laps_data(
            laps_data, self.drivers_dict, self.stints_data
        )
        self.assertEqual(max_lap, 3)

        lap2 = next(lap for lap in final_laps if lap["lap"] == 2)
        self.assertTrue(lap2["interpolated"])
        self.assertEqual(lap2["time"], 91.0)
        self.assertEqual(lap2["session_time"], 181.0)

    def test_missing_lap_number_interpolation(self) -> None:
        """Verifies linear interpolation when a lap number is absent from input."""
        laps_data: list[dict[str, Any]] = [
            {"driver_number": 1, "lap_number": 1, "lap_duration": 90.0},
            {"driver_number": 1, "lap_number": 3, "lap_duration": 94.0},
        ]

        final_laps, max_lap = process_laps_data(
            laps_data, self.drivers_dict, self.stints_data
        )
        self.assertEqual(max_lap, 3)

        lap2 = next(lap for lap in final_laps if lap["lap"] == 2)
        self.assertTrue(lap2["interpolated"])
        self.assertEqual(lap2["time"], 92.0)
        self.assertEqual(lap2["session_time"], 182.0)

    def test_extrapolation_scenarios(self) -> None:
        """Verifies backward and forward extrapolation at the start and end of a race."""
        laps_data: list[dict[str, Any]] = [
            {"driver_number": 44, "lap_number": 2, "lap_duration": 91.0},
            {"driver_number": 44, "lap_number": 3, "lap_duration": 92.0},
            {"driver_number": 1, "lap_number": 1, "lap_duration": 88.0},
            {"driver_number": 1, "lap_number": 2, "lap_duration": 89.0},
            {"driver_number": 1, "lap_number": 3, "lap_duration": None},
        ]

        final_laps, max_lap = process_laps_data(
            laps_data, self.drivers_dict, self.stints_data
        )
        self.assertEqual(max_lap, 3)

        ham_lap1 = next(
            lap for lap in final_laps if lap["lap"] == 1 and lap["driver"] == "HAM"
        )
        self.assertTrue(ham_lap1["interpolated"])
        self.assertEqual(ham_lap1["time"], 91.0)

        ver_lap3 = next(
            lap for lap in final_laps if lap["lap"] == 3 and lap["driver"] == "VER"
        )
        self.assertTrue(ver_lap3["interpolated"])
        self.assertEqual(ver_lap3["time"], 89.0)

    def test_fallback_to_lap_average_and_default_duration(self) -> None:
        """Verifies fallback to cross-driver lap average or 90.0s when a driver has no valid times."""
        laps_data: list[dict[str, Any]] = [
            {"driver_number": 1, "lap_number": 1, "lap_duration": 84.0},
            {"driver_number": 44, "lap_number": 1, "lap_duration": None},
            {"driver_number": 44, "lap_number": 2, "lap_duration": None},
        ]

        final_laps, max_lap = process_laps_data(
            laps_data, self.drivers_dict, self.stints_data
        )
        self.assertEqual(max_lap, 2)

        ham_lap1 = next(
            lap for lap in final_laps if lap["lap"] == 1 and lap["driver"] == "HAM"
        )
        ham_lap2 = next(
            lap for lap in final_laps if lap["lap"] == 2 and lap["driver"] == "HAM"
        )
        self.assertEqual(ham_lap1["time"], 84.0)
        self.assertEqual(ham_lap2["time"], 90.0)

    def test_empty_laps_and_unknown_driver_and_null_compound(self) -> None:
        """Verifies empty inputs, unknown drivers, and null stint compounds."""
        empty_laps, max_lap = process_laps_data([], self.drivers_dict, self.stints_data)
        self.assertEqual(empty_laps, [])
        self.assertEqual(max_lap, 0)

        stints_with_null_compound: list[dict[str, Any]] = [
            {
                "driver_number": 1,
                "lap_start": 1,
                "lap_end": 5,
                "tyre_age_at_start": 0,
                "compound": None,
            }
        ]
        laps_data: list[dict[str, Any]] = [
            {"driver_number": 99, "lap_number": 1, "lap_duration": 85.0},
            {"driver_number": 1, "lap_number": 1, "lap_duration": 88.0},
            {"driver_number": 1, "lap_number": 6, "lap_duration": 90.0},
        ]
        final_laps, max_lap = process_laps_data(
            laps_data, self.drivers_dict, stints_with_null_compound
        )
        self.assertEqual(max_lap, 6)
        self.assertTrue(all(lap["driver"] == "VER" for lap in final_laps))

        ver_lap1 = next(lap for lap in final_laps if lap["lap"] == 1)
        ver_lap6 = next(lap for lap in final_laps if lap["lap"] == 6)
        self.assertEqual(ver_lap1["compound"], "UNKNOWN")
        self.assertEqual(ver_lap6["compound"], "UNKNOWN")
        self.assertEqual(ver_lap6["tyre_life"], 1)


@pytest.mark.parametrize(
    ("gp_query", "expected_gp_title"),
    [
        ("Bahrain", "Bahrain Grand Prix"),
        ("Sakhir", "Bahrain Grand Prix"),
        ("Bahrain International", "Bahrain Grand Prix"),
        ("Kuala Lumpur", "Bahrain Grand Prix"),
    ],
)
def test_fetch_openf1_data_success(
    tmp_path: Path,
    gp_query: str,
    expected_gp_title: str,
) -> None:
    """Verifies end-to-end fetching, driver deduplication, and JSON serialization."""
    out_file = tmp_path / "nested" / "race.json"

    mock_responses: list[Any] = [
        [
            {
                "session_key": 9001,
                "country_name": "Bahrain",
                "circuit_short_name": "Sakhir",
                "location": "Kuala Lumpur",
            }
        ],
        [
            {
                "driver_number": 1,
                "name_acronym": "VER",
                "full_name": "Max Verstappen",
                "team_name": "Red Bull Racing",
                "team_colour": "3671C6",
            },
            {
                "driver_number": 1,
                "name_acronym": "VER",
                "full_name": "Max Verstappen",
                "team_name": "Red Bull Racing",
                "team_colour": "3671C6",
            },
            {
                "driver_number": 44,
                "name_acronym": "HAM",
                "full_name": "Lewis Hamilton",
                "team_name": "Mercedes",
                "team_colour": None,
            },
        ],
        [
            {"driver_number": 1, "lap_number": 1, "lap_duration": 90.1234},
            {"driver_number": 44, "lap_number": 1, "lap_duration": 91.5},
        ],
        [
            {
                "driver_number": 1,
                "lap_start": 1,
                "lap_end": 10,
                "tyre_age_at_start": 0,
                "compound": "SOFT",
            }
        ],
    ]

    def _side_effect(url: str) -> MagicMock:
        response = MagicMock()
        response.json.return_value = mock_responses.pop(0)
        return response

    with (
        patch("fetch_openf1.requests.get", side_effect=_side_effect) as mock_get,
        patch("fetch_openf1.time.sleep") as mock_sleep,
    ):
        fetch_openf1_data(2023, gp_query, str(out_file))

    assert mock_get.call_count == 4
    assert mock_sleep.call_count == 4
    assert out_file.exists()

    saved_payload = json.loads(out_file.read_text(encoding="utf-8"))
    assert saved_payload["race_info"] == {
        "year": 2023,
        "gp": expected_gp_title,
        "total_laps": 1,
        "winner": "VER",
    }
    assert len(saved_payload["drivers"]) == 2
    assert saved_payload["drivers"][0]["color"] == "#3671C6"
    assert saved_payload["drivers"][1]["color"] == "#ffffff"
    assert len(saved_payload["laps"]) == 2
    assert saved_payload["laps"][0]["time"] == 90.123


@pytest.mark.parametrize(
    "mock_payloads",
    [
        [{"error": "rate_limited"}],
        [
            [
                {
                    "session_key": 9001,
                    "country_name": "Monaco",
                    "circuit_short_name": "Monte Carlo",
                }
            ]
        ],
        [
            [
                {
                    "session_key": 9001,
                    "country_name": "Bahrain",
                    "circuit_short_name": "Sakhir",
                }
            ],
            {"error": "drivers_unavailable"},
        ],
        [
            [
                {
                    "session_key": 9001,
                    "country_name": "Bahrain",
                    "circuit_short_name": "Sakhir",
                }
            ],
            [{"driver_number": 1}],
            {"error": "laps_unavailable"},
        ],
        [
            [
                {
                    "session_key": 9001,
                    "country_name": "Bahrain",
                    "circuit_short_name": "Sakhir",
                }
            ],
            [{"driver_number": 1}],
            [],
        ],
    ],
)
def test_fetch_openf1_data_early_exit_on_errors(
    tmp_path: Path,
    mock_payloads: list[Any],
) -> None:
    """Verifies that `fetch_openf1_data` exits cleanly without writing when an API call fails."""
    out_file = tmp_path / "should_not_exist.json"
    payload_queue = list(mock_payloads)

    def _side_effect(url: str) -> MagicMock:
        response = MagicMock()
        response.json.return_value = payload_queue.pop(0)
        return response

    with (
        patch("fetch_openf1.requests.get", side_effect=_side_effect),
        patch("fetch_openf1.time.sleep"),
    ):
        fetch_openf1_data(2023, "Bahrain", str(out_file))

    assert not out_file.exists()


def test_fetch_openf1_data_stints_api_error_fallback(tmp_path: Path) -> None:
    """Verifies that an API error on the stints endpoint falls back to empty stints."""
    out_file = tmp_path / "race_stints_fallback.json"
    payload_queue: list[Any] = [
        [
            {
                "session_key": 9001,
                "country_name": "Bahrain",
                "circuit_short_name": "Sakhir",
            }
        ],
        [{"driver_number": 1, "name_acronym": "VER"}],
        [{"driver_number": 1, "lap_number": 1, "lap_duration": 88.5}],
        {"detail": "Stints error"},
    ]

    def _side_effect(url: str) -> MagicMock:
        response = MagicMock()
        response.json.return_value = payload_queue.pop(0)
        return response

    with (
        patch("fetch_openf1.requests.get", side_effect=_side_effect),
        patch("fetch_openf1.time.sleep"),
    ):
        fetch_openf1_data(2023, "Bahrain", str(out_file))

    assert out_file.exists()
    saved_payload = json.loads(out_file.read_text(encoding="utf-8"))
    assert saved_payload["laps"][0]["compound"] == "UNKNOWN"
    assert saved_payload["laps"][0]["tyre_life"] == 1


def test_fetch_openf1_data_falls_through_empty_laps_session(
    tmp_path: Path,
) -> None:
    """Verifies fallback to the second matching session when the first has empty laps."""
    out_file = tmp_path / "bahrain_fallback.json"
    payload_queue: list[Any] = [
        [
            {
                "session_key": 11261,
                "country_name": "Bahrain",
                "location": "Sakhir",
                "circuit_short_name": "Sakhir",
            },
            {
                "session_key": 11731,
                "country_name": "Bahrain",
                "location": "Kuala Lumpur",
                "circuit_short_name": "Kuala Lumpur",
            },
        ],
        [{"driver_number": 16, "name_acronym": "LEC"}],
        [],
        [
            {
                "driver_number": 12,
                "name_acronym": "ANT",
                "full_name": "Kimi Antonelli",
                "team_name": "Mercedes",
                "team_colour": "00D7B6",
            }
        ],
        [{"driver_number": 12, "lap_number": 1, "lap_duration": 95.4}],
        [
            {
                "driver_number": 12,
                "lap_start": 1,
                "lap_end": 20,
                "tyre_age_at_start": 0,
                "compound": "MEDIUM",
            }
        ],
    ]

    requested_urls: list[str] = []

    def _side_effect(url: str) -> MagicMock:
        requested_urls.append(url)
        response = MagicMock()
        response.json.return_value = payload_queue.pop(0)
        return response

    with (
        patch("fetch_openf1.requests.get", side_effect=_side_effect),
        patch("fetch_openf1.time.sleep"),
    ):
        fetch_openf1_data(2026, "Bahrain", str(out_file))

    assert out_file.exists()
    assert any("session_key=11261" in url for url in requested_urls)
    assert any("session_key=11731" in url for url in requested_urls)
    saved_payload = json.loads(out_file.read_text(encoding="utf-8"))
    assert saved_payload["race_info"]["winner"] == "ANT"
    assert saved_payload["race_info"]["total_laps"] == 1


def test_fetch_openf1_data_with_explicit_session_key(tmp_path: Path) -> None:
    """Verifies explicit `session_key` selects the exact session directly."""
    out_file = tmp_path / "bahrain_explicit.json"
    payload_queue: list[Any] = [
        [
            {
                "session_key": 11261,
                "country_name": "Bahrain",
                "location": "Sakhir",
                "circuit_short_name": "Sakhir",
            },
            {
                "session_key": 11731,
                "country_name": "Bahrain",
                "location": "Kuala Lumpur",
                "circuit_short_name": "Kuala Lumpur",
            },
        ],
        [
            {
                "driver_number": 63,
                "name_acronym": "RUS",
                "full_name": "George Russell",
                "team_name": "Mercedes",
                "team_colour": "00D7B6",
            }
        ],
        [{"driver_number": 63, "lap_number": 1, "lap_duration": 94.2}],
        [],
    ]

    requested_urls: list[str] = []

    def _side_effect(url: str) -> MagicMock:
        requested_urls.append(url)
        response = MagicMock()
        response.json.return_value = payload_queue.pop(0)
        return response

    with (
        patch("fetch_openf1.requests.get", side_effect=_side_effect),
        patch("fetch_openf1.time.sleep"),
    ):
        fetch_openf1_data(2026, "Bahrain", str(out_file), session_key=11731)

    assert out_file.exists()
    assert not any("session_key=11261" in url for url in requested_urls)
    assert any("session_key=11731" in url for url in requested_urls)
    saved_payload = json.loads(out_file.read_text(encoding="utf-8"))
    assert saved_payload["race_info"]["winner"] == "RUS"


def test_find_matching_session_and_empty_query() -> None:
    """Verifies `_find_matching_session` helper and empty query handling."""
    sessions: list[dict[str, Any]] = [
        {
            "session_key": 11261,
            "country_name": "Bahrain",
            "location": "Sakhir",
            "circuit_short_name": "Sakhir",
        },
        {
            "session_key": 11731,
            "country_name": "Bahrain",
            "location": "Kuala Lumpur",
            "circuit_short_name": "Kuala Lumpur",
        },
    ]
    assert not _is_matching_session(sessions[0], "")
    first = _find_matching_session(sessions, "Bahrain")
    assert first is not None and first["session_key"] == 11261
    second = _find_matching_session(sessions, "Bahrain", session_key=11731)
    assert second is not None and second["session_key"] == 11731
    assert _find_matching_session(sessions, "Nonexistent") is None


if __name__ == "__main__":
    unittest.main()

