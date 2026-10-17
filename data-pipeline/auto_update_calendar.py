"""Automated pipeline script to discover and ingest new OpenF1 race sessions."""

from collections.abc import Mapping
import json
import os
import sys
from typing import Any, Final

import requests

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from fetch_openf1 import fetch_openf1_data  # noqa: E402
from generate_corner_speeds import calculate_corner_speeds  # noqa: E402
from generate_weekend_telemetry import generate_weekend_telemetry  # noqa: E402

_TARGET_YEAR: Final[int] = 2026
_OPENF1_SESSIONS_URL: Final[str] = (
    f"https://api.openf1.org/v1/sessions?year={_TARGET_YEAR}&session_name=Race"
)
_REQUEST_TIMEOUT_SECONDS: Final[int] = 15
_HTTP_OK: Final[int] = 200
_CATALUNYA_GP_NAME: Final[str] = "Barcelona-Catalunya Grand Prix"
_SPAIN_IDENTIFIERS: Final[tuple[str, ...]] = ("spain", "catalunya")


def _resolve_base_dir(base_dir: str | None) -> str:
    """Resolves the repository root directory path.

    Args:
        base_dir: Optional explicit base directory path. Defaults to the
            parent directory of this script's directory when None.

    Returns:
        The resolved base directory path.
    """
    if base_dir is not None:
        return base_dir
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _get_manifest_path(base_dir: str) -> str:
    """Constructs the path to the races manifest JSON file.

    Args:
        base_dir: The repository root directory path.

    Returns:
        The filesystem path to `races_manifest.json`.
    """
    return os.path.join(base_dir, "src", "assets", "data", "races_manifest.json")


def _load_manifest(manifest_path: str) -> dict[str, Any] | None:
    """Loads the race manifest JSON from disk if it exists.

    Args:
        manifest_path: Path to the `races_manifest.json` file.

    Returns:
        The parsed manifest dictionary, or None if the file does not exist.
    """
    if not os.path.exists(manifest_path):
        print(f"Error: Manifest not found at {manifest_path}")
        return None

    with open(manifest_path, "r", encoding="utf-8") as manifest_file:
        manifest: dict[str, Any] = json.load(manifest_file)
    return manifest


def _save_manifest(manifest_path: str, manifest: Mapping[str, Any]) -> None:
    """Writes the updated race manifest dictionary to disk as formatted JSON.

    Args:
        manifest_path: Path to the `races_manifest.json` file.
        manifest: The manifest data mapping to serialize.
    """
    with open(manifest_path, "w", encoding="utf-8") as manifest_file:
        json.dump(manifest, manifest_file, indent=2)
    print("\nManifest updated and saved successfully.")


def _fetch_race_sessions(
    api_url: str = _OPENF1_SESSIONS_URL,
) -> list[dict[str, Any]] | None:
    """Queries the OpenF1 sessions endpoint for completed race sessions.

    Args:
        api_url: The OpenF1 sessions API URL to query.

    Returns:
        A list of session dictionaries if successful, or None if the request
        fails, is restricted, or returns an unexpected payload.
    """
    print(f"Querying OpenF1 API: {api_url}")
    try:
        response = requests.get(api_url, timeout=_REQUEST_TIMEOUT_SECONDS)
    except Exception as error:
        print(f"Network error querying sessions API: {error}")
        return None

    if response.status_code != _HTTP_OK:
        print(f"API Error (HTTP {response.status_code}): {response.text}")
        return None

    sessions = response.json()
    if isinstance(sessions, dict) and "detail" in sessions:
        print(f"OpenF1 API restricted or locked: {sessions['detail']}")
        print(
            "This is normal during active live F1 session windows. Exiting gracefully."
        )
        return None

    if not isinstance(sessions, list):
        print(f"Unexpected response format from OpenF1: {sessions}")
        return None

    print(f"Retrieved {len(sessions)} sessions from OpenF1 API.")
    return sessions


def _format_gp_id(country_name: str) -> str:
    """Formats a country name into a standardized lowercase snake_case GP ID.

    Args:
        country_name: The country name from the OpenF1 session payload.

    Returns:
        Normalized identifier string (e.g., 'spain', 'great_britain').
    """
    return country_name.lower().replace(" ", "_")


def _format_gp_name(country_name: str, gp_id: str) -> str:
    """Determines the display Grand Prix name for a given country and GP ID.

    Args:
        country_name: The country name from the OpenF1 session payload.
        gp_id: The standardized GP identifier.

    Returns:
        The formatted Grand Prix display title.
    """
    if any(identifier in gp_id for identifier in _SPAIN_IDENTIFIERS):
        return _CATALUNYA_GP_NAME
    return f"{country_name} Grand Prix"


def _build_race_output_path(base_dir: str, year: int, out_filename: str) -> str:
    """Constructs the output filesystem path for a race data JSON file.

    Args:
        base_dir: The repository root directory path.
        year: The target championship season year.
        out_filename: The output JSON filename (e.g., 'italy.json').

    Returns:
        Full path where the race telemetry JSON should be written.
    """
    return os.path.join(
        base_dir, "src", "assets", "data", "races", str(year), out_filename
    )


def _ingest_new_race_session(
    session: Mapping[str, Any], base_dir: str
) -> dict[str, Any] | None:
    """Fetches telemetry, computes corner speeds, and builds a manifest entry.

    Args:
        session: A single session metadata dictionary from OpenF1.
        base_dir: The repository root directory path.

    Returns:
        A new manifest entry dictionary if ingestion succeeded, or None if
        fetching failed or produced no output file.
    """
    country_name = session.get("country_name")
    if not country_name or not isinstance(country_name, str):
        return None

    circuit_name = session.get("circuit_short_name")
    raw_session_key = session.get("session_key")
    session_key = raw_session_key if isinstance(raw_session_key, int) else None
    gp_id = _format_gp_id(country_name)
    gp_name = _format_gp_name(country_name, gp_id)
    out_filename = f"{gp_id}.json"
    out_path = _build_race_output_path(base_dir, _TARGET_YEAR, out_filename)

    print("\n--- NEW RACE DETECTED! ---")
    print(
        f"Country: {country_name} | Circuit: {circuit_name} | "
        f"Session Key: {session_key}"
    )

    print(f"Executing fetch_openf1_data for {gp_name} -> {out_path}...")
    try:
        fetch_openf1_data(
            _TARGET_YEAR, country_name, out_path, session_key=session_key
        )
    except Exception as error:
        print(f"Error fetching data for {gp_name}: {error}")
        return None

    if not os.path.exists(out_path):
        print(
            f"Error: Generated file {out_path} does not exist after fetch. "
            "Skipping manifest register."
        )
        return None

    print(f"Executing calculate_corner_speeds on {out_path}...")
    try:
        calculate_corner_speeds(out_path)
        generate_weekend_telemetry(out_path)
    except Exception as error:
        print(f"Error calculating corner speeds: {error}")

    print(f"Successfully registered {gp_name} in manifest!")
    return {
        "year": _TARGET_YEAR,
        "id": gp_id,
        "name": gp_name,
        "file": f"races/{_TARGET_YEAR}/{out_filename}",
    }


def main(base_dir: str | None = None) -> bool:
    """Checks OpenF1 for newly completed races and updates the race manifest.

    Args:
        base_dir: Optional repository root directory override for testing.

    Returns:
        True if at least one new race was ingested and saved to the manifest,
        False otherwise.
    """
    print("Starting automated calendar update check...")

    resolved_base_dir = _resolve_base_dir(base_dir)
    manifest_path = _get_manifest_path(resolved_base_dir)

    manifest = _load_manifest(manifest_path)
    if manifest is None:
        return False

    current_races: list[dict[str, Any]] = manifest.get("races", [])
    registered_ids: set[str] = {race["id"].lower() for race in current_races}

    print(
        f"Loaded manifest with {len(current_races)} registered races: "
        f"{list(registered_ids)}"
    )

    sessions = _fetch_race_sessions()
    if sessions is None:
        return False

    updated = False
    for session in sessions:
        country_name = session.get("country_name")
        if not country_name or not isinstance(country_name, str):
            continue

        gp_id = _format_gp_id(country_name)
        if gp_id in registered_ids:
            print(
                f"GP '{country_name}' ({gp_id}) is already registered in "
                "manifest. Skipping."
            )
            continue

        new_race_entry = _ingest_new_race_session(session, resolved_base_dir)
        if new_race_entry is not None:
            current_races.append(new_race_entry)
            registered_ids.add(gp_id)
            updated = True

    if updated:
        manifest["races"] = current_races
        _save_manifest(manifest_path, manifest)
        return True

    print("\nNo new races needed to be fetched. Everything is up to date!")
    return False


if __name__ == "__main__":
    main()
