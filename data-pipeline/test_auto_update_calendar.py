"""Unit tests for the automated OpenF1 calendar update pipeline."""

import json
import os
from pathlib import Path
import sys
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
import requests

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import auto_update_calendar  # noqa: E402


def _create_manifest(base_dir: Path, races: list[dict[str, Any]]) -> Path:
    """Creates a `races_manifest.json` file under the given temporary base directory.

    Args:
        base_dir: The temporary repository root path.
        races: Initial list of race entries to write to the manifest.

    Returns:
        Path to the created `races_manifest.json` file.
    """
    manifest_path = base_dir / "src" / "assets" / "data" / "races_manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps({"races": races}, indent=2), encoding="utf-8"
    )
    return manifest_path


def _make_mock_response(
    status_code: int = 200,
    json_data: Any = None,
    text: str = "",
) -> MagicMock:
    """Constructs a mock `requests.Response` object.

    Args:
        status_code: HTTP status code to return.
        json_data: Payload to return from `.json()`.
        text: Response body text.

    Returns:
        Configured `MagicMock` simulating a `requests.Response`.
    """
    mock_response = MagicMock()
    mock_response.status_code = status_code
    mock_response.json.return_value = json_data
    mock_response.text = text
    return mock_response


class TestAutoUpdateCalendarNormalCases:
    """Tests for standard new race discovery and ingestion workflows."""

    @patch("auto_update_calendar.calculate_corner_speeds")
    @patch("auto_update_calendar.fetch_openf1_data")
    @patch("auto_update_calendar.requests.get")
    def test_discovers_and_ingests_new_races_including_spain_override(
        self,
        mock_get: MagicMock,
        mock_fetch_data: MagicMock,
        mock_calc_corners: MagicMock,
        tmp_path: Path,
    ) -> None:
        """Verifies new races (Italy and Spain) are fetched, processed, and added."""
        manifest_path = _create_manifest(
            tmp_path,
            [
                {
                    "year": 2026,
                    "id": "australia",
                    "name": "Australia Grand Prix",
                    "file": "races/2026/australia.json",
                }
            ],
        )

        mock_get.return_value = _make_mock_response(
            status_code=200,
            json_data=[
                {
                    "country_name": "Australia",
                    "circuit_short_name": "Melbourne",
                    "session_key": 1001,
                },
                {
                    "country_name": "Italy",
                    "circuit_short_name": "Monza",
                    "session_key": 1002,
                },
                {
                    "country_name": "Spain",
                    "circuit_short_name": "Catalunya",
                    "session_key": 1003,
                },
            ],
        )

        forwarded_session_keys: list[int | None] = []

        def fake_fetch(
            year: int,
            country: str,
            out_path: str,
            session_key: int | None = None,
        ) -> None:
            forwarded_session_keys.append(session_key)
            Path(out_path).parent.mkdir(parents=True, exist_ok=True)
            Path(out_path).write_text("{}", encoding="utf-8")

        mock_fetch_data.side_effect = fake_fetch

        result = auto_update_calendar.main(str(tmp_path))

        assert result is True
        assert mock_fetch_data.call_count == 2
        assert forwarded_session_keys == [1002, 1003]
        assert mock_calc_corners.call_count == 2

        updated_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        races = updated_manifest["races"]
        assert len(races) == 3
        assert races[1] == {
            "year": 2026,
            "id": "italy",
            "name": "Italy Grand Prix",
            "file": "races/2026/italy.json",
        }
        assert races[2] == {
            "year": 2026,
            "id": "spain",
            "name": "Barcelona-Catalunya Grand Prix",
            "file": "races/2026/spain.json",
        }

    @patch("auto_update_calendar.calculate_corner_speeds")
    @patch("auto_update_calendar.fetch_openf1_data")
    @patch("auto_update_calendar.requests.get")
    def test_falls_through_duplicate_country_session_when_first_has_no_data(
        self,
        mock_get: MagicMock,
        mock_fetch_data: MagicMock,
        mock_calc_corners: MagicMock,
        tmp_path: Path,
    ) -> None:
        """Verifies second session for same country is ingested if first produced no file."""
        manifest_path = _create_manifest(tmp_path, [])
        mock_get.return_value = _make_mock_response(
            status_code=200,
            json_data=[
                {
                    "country_name": "Bahrain",
                    "circuit_short_name": "Sakhir",
                    "session_key": 11261,
                },
                {
                    "country_name": "Bahrain",
                    "circuit_short_name": "Kuala Lumpur",
                    "session_key": 11731,
                },
            ],
        )

        forwarded_session_keys: list[int | None] = []

        def fake_fetch(
            year: int,
            country: str,
            out_path: str,
            session_key: int | None = None,
        ) -> None:
            forwarded_session_keys.append(session_key)
            if session_key == 11731:
                Path(out_path).parent.mkdir(parents=True, exist_ok=True)
                Path(out_path).write_text("{}", encoding="utf-8")

        mock_fetch_data.side_effect = fake_fetch

        result = auto_update_calendar.main(str(tmp_path))

        assert result is True
        assert forwarded_session_keys == [11261, 11731]
        assert mock_calc_corners.call_count == 1
        updated_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        assert len(updated_manifest["races"]) == 1
        assert updated_manifest["races"][0]["id"] == "bahrain"


class TestAutoUpdateCalendarEdgeCases:
    """Tests for boundary conditions and non-error early exits."""

    @patch("auto_update_calendar._save_manifest")
    @patch("auto_update_calendar.fetch_openf1_data")
    @patch("auto_update_calendar.requests.get")
    def test_all_sessions_already_registered_returns_false(
        self,
        mock_get: MagicMock,
        mock_fetch_data: MagicMock,
        mock_save_manifest: MagicMock,
        tmp_path: Path,
    ) -> None:
        """Verifies manifest is not rewritten when all sessions are already present."""
        _create_manifest(
            tmp_path,
            [
                {
                    "year": 2026,
                    "id": "bahrain",
                    "name": "Bahrain Grand Prix",
                    "file": "races/2026/bahrain.json",
                }
            ],
        )
        mock_get.return_value = _make_mock_response(
            status_code=200,
            json_data=[
                {
                    "country_name": "Bahrain",
                    "circuit_short_name": "Sakhir",
                    "session_key": 2001,
                }
            ],
        )

        result = auto_update_calendar.main(str(tmp_path))

        assert result is False
        mock_fetch_data.assert_not_called()
        mock_save_manifest.assert_not_called()

    @patch("auto_update_calendar.fetch_openf1_data")
    @patch("auto_update_calendar.requests.get")
    def test_session_missing_country_name_is_skipped(
        self,
        mock_get: MagicMock,
        mock_fetch_data: MagicMock,
        tmp_path: Path,
    ) -> None:
        """Verifies sessions without a valid `country_name` are ignored."""
        _create_manifest(tmp_path, [])
        mock_get.return_value = _make_mock_response(
            status_code=200,
            json_data=[
                {"circuit_short_name": "Unknown", "session_key": 3001},
                {"country_name": "", "circuit_short_name": "Empty", "session_key": 3002},
            ],
        )

        result = auto_update_calendar.main(str(tmp_path))

        assert result is False
        mock_fetch_data.assert_not_called()
        assert auto_update_calendar._ingest_new_race_session({}, str(tmp_path)) is None

    @patch("auto_update_calendar.fetch_openf1_data")
    @patch("auto_update_calendar.requests.get")
    def test_api_locked_during_live_session_exits_gracefully(
        self,
        mock_get: MagicMock,
        mock_fetch_data: MagicMock,
        tmp_path: Path,
    ) -> None:
        """Verifies OpenF1 live-session lock dictionary payload is handled gracefully."""
        _create_manifest(tmp_path, [])
        mock_get.return_value = _make_mock_response(
            status_code=200,
            json_data={"detail": "Restricted during live session"},
        )

        result = auto_update_calendar.main(str(tmp_path))

        assert result is False
        mock_fetch_data.assert_not_called()

    @patch("auto_update_calendar.calculate_corner_speeds")
    @patch("auto_update_calendar.fetch_openf1_data")
    @patch("auto_update_calendar.requests.get")
    def test_fetch_producing_no_output_file_skips_registration(
        self,
        mock_get: MagicMock,
        mock_fetch_data: MagicMock,
        mock_calc_corners: MagicMock,
        tmp_path: Path,
    ) -> None:
        """Verifies race is not added to manifest if output JSON file was not created."""
        manifest_path = _create_manifest(tmp_path, [])
        mock_get.return_value = _make_mock_response(
            status_code=200,
            json_data=[
                {
                    "country_name": "Monaco",
                    "circuit_short_name": "Monte Carlo",
                    "session_key": 4001,
                }
            ],
        )

        result = auto_update_calendar.main(str(tmp_path))

        assert result is False
        mock_fetch_data.assert_called_once()
        mock_calc_corners.assert_not_called()
        saved_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        assert saved_manifest["races"] == []


class TestAutoUpdateCalendarFailureCases:
    """Tests for error handling across filesystem, network, and downstream failures."""

    @patch("auto_update_calendar.requests.get")
    def test_missing_manifest_file_returns_false(
        self,
        mock_get: MagicMock,
        tmp_path: Path,
    ) -> None:
        """Verifies `main` returns False immediately when `races_manifest.json` is absent."""
        result = auto_update_calendar.main(str(tmp_path))

        assert result is False
        mock_get.assert_not_called()

    @patch("auto_update_calendar.requests.get")
    def test_network_exception_returns_false(
        self,
        mock_get: MagicMock,
        tmp_path: Path,
    ) -> None:
        """Verifies network errors when querying OpenF1 are caught and return False."""
        _create_manifest(tmp_path, [])
        mock_get.side_effect = requests.RequestException("Connection timed out")

        result = auto_update_calendar.main(str(tmp_path))

        assert result is False

    @patch("auto_update_calendar.requests.get")
    def test_non_200_http_status_returns_false(
        self,
        mock_get: MagicMock,
        tmp_path: Path,
    ) -> None:
        """Verifies non-200 HTTP responses from OpenF1 are handled and return False."""
        _create_manifest(tmp_path, [])
        mock_get.return_value = _make_mock_response(
            status_code=503,
            text="Service Unavailable",
        )

        result = auto_update_calendar.main(str(tmp_path))

        assert result is False

    @patch("auto_update_calendar.requests.get")
    def test_unexpected_non_list_json_payload_returns_false(
        self,
        mock_get: MagicMock,
        tmp_path: Path,
    ) -> None:
        """Verifies unexpected JSON types (e.g., dict without 'detail' or int) return False."""
        _create_manifest(tmp_path, [])
        mock_get.return_value = _make_mock_response(
            status_code=200,
            json_data={"unexpected_key": "value"},
        )

        result = auto_update_calendar.main(str(tmp_path))

        assert result is False

    @patch("auto_update_calendar.calculate_corner_speeds")
    @patch("auto_update_calendar.fetch_openf1_data")
    @patch("auto_update_calendar.requests.get")
    def test_exception_in_fetch_openf1_data_skips_session(
        self,
        mock_get: MagicMock,
        mock_fetch_data: MagicMock,
        mock_calc_corners: MagicMock,
        tmp_path: Path,
    ) -> None:
        """Verifies an exception inside `fetch_openf1_data` is caught and skips registration."""
        _create_manifest(tmp_path, [])
        mock_get.return_value = _make_mock_response(
            status_code=200,
            json_data=[
                {
                    "country_name": "Japan",
                    "circuit_short_name": "Suzuka",
                    "session_key": 5001,
                }
            ],
        )
        mock_fetch_data.side_effect = RuntimeError("Telemetry endpoint failed")

        result = auto_update_calendar.main(str(tmp_path))

        assert result is False
        mock_calc_corners.assert_not_called()

    @patch("auto_update_calendar.calculate_corner_speeds")
    @patch("auto_update_calendar.fetch_openf1_data")
    @patch("auto_update_calendar.requests.get")
    def test_exception_in_calculate_corner_speeds_still_registers_race(
        self,
        mock_get: MagicMock,
        mock_fetch_data: MagicMock,
        mock_calc_corners: MagicMock,
        tmp_path: Path,
    ) -> None:
        """Verifies an exception in `calculate_corner_speeds` logs error but registers race."""
        manifest_path = _create_manifest(tmp_path, [])
        mock_get.return_value = _make_mock_response(
            status_code=200,
            json_data=[
                {
                    "country_name": "Canada",
                    "circuit_short_name": "Montreal",
                    "session_key": 5002,
                }
            ],
        )

        def fake_fetch(
            year: int,
            country: str,
            out_path: str,
            session_key: int | None = None,
        ) -> None:
            Path(out_path).parent.mkdir(parents=True, exist_ok=True)
            Path(out_path).write_text("{}", encoding="utf-8")

        mock_fetch_data.side_effect = fake_fetch
        mock_calc_corners.side_effect = ValueError("Corner profile error")

        result = auto_update_calendar.main(str(tmp_path))

        assert result is True
        saved_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        assert len(saved_manifest["races"]) == 1
        assert saved_manifest["races"][0]["id"] == "canada"

    def test_resolve_base_dir_defaults_to_repo_root(self) -> None:
        """Verifies `_resolve_base_dir(None)` resolves to the parent of `data-pipeline`."""
        resolved = auto_update_calendar._resolve_base_dir(None)
        expected = os.path.dirname(
            os.path.dirname(os.path.abspath(auto_update_calendar.__file__))
        )
        assert resolved == expected
