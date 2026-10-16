"""Fetches and processes Formula 1 race telemetry and lap data from the OpenF1 API."""

import argparse
from collections import defaultdict
from collections.abc import Mapping, Sequence
import json
import os
import time
from typing import Any, Final
import requests

_OPENF1_BASE_URL: Final[str] = "https://api.openf1.org/v1"
_API_RATE_LIMIT_DELAY_SECONDS: Final[float] = 0.4
_RACE_SESSION_NAME: Final[str] = "Race"

_DEFAULT_LAP_DURATION_SECONDS: Final[float] = 90.0
_DEFAULT_STINT_START_LAP: Final[int] = 0
_DEFAULT_STINT_END_LAP: Final[int] = 1000
_DEFAULT_TYRE_AGE_AT_START: Final[int] = 0
_UNKNOWN_COMPOUND: Final[str] = "UNKNOWN"
_DEFAULT_TYRE_LIFE: Final[int] = 1

_DEFAULT_TEAM_COLOR_HEX: Final[str] = "ffffff"
_UNKNOWN_TEAM_NAME: Final[str] = "Unknown"

_TIME_ROUNDING_DECIMALS: Final[int] = 3
_JSON_INDENT_SPACES: Final[int] = 2


def _get_stint_info(
    driver_number: int,
    lap_number: int,
    stints_data: Sequence[Mapping[str, Any]],
) -> tuple[str, int]:
    """Resolves tyre compound and tyre life for a driver on a specific lap.

    Args:
        driver_number: The unique racing number of the driver.
        lap_number: The lap number being evaluated.
        stints_data: Stint records returned by the OpenF1 stints endpoint.

    Returns:
        A tuple of `(compound, tyre_life)`. Defaults to `("UNKNOWN", 1)` when
        no matching stint record covers the given lap.
    """
    for stint_record in stints_data:
        if stint_record["driver_number"] == driver_number:
            start_lap = stint_record.get("lap_start", _DEFAULT_STINT_START_LAP)
            end_lap = stint_record.get("lap_end", _DEFAULT_STINT_END_LAP)
            if start_lap <= lap_number <= end_lap:
                age_at_start = stint_record.get(
                    "tyre_age_at_start", _DEFAULT_TYRE_AGE_AT_START
                )
                tyre_life = (lap_number - start_lap) + age_at_start + 1
                compound = stint_record.get("compound", _UNKNOWN_COMPOUND)
                if compound is None:
                    compound = _UNKNOWN_COMPOUND
                return str(compound), int(tyre_life)
    return _UNKNOWN_COMPOUND, _DEFAULT_TYRE_LIFE


def _group_laps_by_driver(
    laps_data: Sequence[Mapping[str, Any]],
) -> dict[int, list[dict[str, Any]]]:
    """Groups raw lap records by driver number without mutating caller inputs.

    Args:
        laps_data: Sequence of raw lap dictionaries from OpenF1.

    Returns:
        A dictionary mapping each driver number to a list of lap records.
    """
    driver_raw_laps: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for lap_record in laps_data:
        driver_number = int(lap_record["driver_number"])
        driver_raw_laps[driver_number].append(dict(lap_record))
    return dict(driver_raw_laps)


def _calculate_driver_average_times(
    driver_raw_laps: Mapping[int, Sequence[Mapping[str, Any]]],
) -> dict[int, float]:
    """Calculates each driver's mean valid lap duration, with a default fallback.

    Args:
        driver_raw_laps: Mapping from driver number to that driver's raw laps.

    Returns:
        A dictionary mapping each driver number to their average lap duration in
        seconds, or `_DEFAULT_LAP_DURATION_SECONDS` if no valid laps exist.
    """
    driver_averages: dict[int, float] = {}
    for driver_number, laps in driver_raw_laps.items():
        valid_times = [
            float(lap_record["lap_duration"])
            for lap_record in laps
            if lap_record.get("lap_duration") is not None
        ]
        if valid_times:
            driver_averages[driver_number] = sum(valid_times) / len(valid_times)
        else:
            driver_averages[driver_number] = _DEFAULT_LAP_DURATION_SECONDS
    return driver_averages


def _calculate_lap_average_times(
    laps_data: Sequence[Mapping[str, Any]],
) -> dict[int, float]:
    """Calculates the average lap duration across all drivers for each lap number.

    Args:
        laps_data: Sequence of raw lap records across all drivers.

    Returns:
        A dictionary mapping each lap number to its mean duration in seconds.
    """
    lap_durations_by_number: dict[int, list[float]] = defaultdict(list)
    for lap_record in laps_data:
        lap_duration = lap_record.get("lap_duration")
        if lap_duration is not None:
            lap_number = int(lap_record["lap_number"])
            lap_durations_by_number[lap_number].append(float(lap_duration))

    return {
        lap_number: sum(durations) / len(durations)
        for lap_number, durations in lap_durations_by_number.items()
    }


def _interpolate_lap_duration(
    lap_number: int,
    valid_laps: Mapping[int, float],
    valid_lap_numbers: Sequence[int],
    fallback_duration: float,
) -> float:
    """Estimates a missing lap duration via linear interpolation or extrapolation.

    Args:
        lap_number: The lap number whose duration is missing.
        valid_laps: Mapping of known lap numbers to their durations for the driver.
        valid_lap_numbers: Sorted sequence of known lap numbers for the driver.
        fallback_duration: Duration to use when the driver has no valid laps at all.

    Returns:
        The interpolated, extrapolated, or fallback lap duration in seconds.
    """
    preceding_laps = [num for num in valid_lap_numbers if num < lap_number]
    succeeding_laps = [num for num in valid_lap_numbers if num > lap_number]

    if preceding_laps and succeeding_laps:
        prev_lap = preceding_laps[-1]
        next_lap = succeeding_laps[0]
        prev_time = valid_laps[prev_lap]
        next_time = valid_laps[next_lap]
        return prev_time + (next_time - prev_time) * (lap_number - prev_lap) / (
            next_lap - prev_lap
        )
    if preceding_laps:
        return valid_laps[preceding_laps[-1]]
    if succeeding_laps:
        return valid_laps[succeeding_laps[0]]
    return fallback_duration


def _build_driver_formatted_laps(
    driver_number: int,
    raw_laps: Sequence[Mapping[str, Any]],
    driver_info: Mapping[str, Any],
    stints_data: Sequence[Mapping[str, Any]],
    lap_average_times: Mapping[int, float],
    driver_average_time: float,
) -> list[dict[str, Any]]:
    """Constructs a complete, contiguous sequence of formatted laps for one driver.

    Args:
        driver_number: The driver's racing number.
        raw_laps: Raw lap records belonging to this driver.
        driver_info: Metadata dictionary for the driver (must contain `'code'`).
        stints_data: Stint records for resolving tyre compounds and life.
        lap_average_times: Per-lap average durations across all drivers.
        driver_average_time: Overall average lap duration for this driver.

    Returns:
        A list of formatted lap dictionaries from lap 1 through the driver's
        highest recorded lap number.
    """
    if not raw_laps:
        return []

    sorted_laps = sorted(raw_laps, key=lambda record: int(record["lap_number"]))
    max_driver_lap = int(sorted_laps[-1]["lap_number"])

    valid_laps: dict[int, float] = {
        int(record["lap_number"]): float(record["lap_duration"])
        for record in sorted_laps
        if record.get("lap_duration") is not None
    }
    valid_lap_numbers = sorted(valid_laps.keys())

    cumulative_time = 0.0
    driver_formatted_laps: list[dict[str, Any]] = []

    for lap_number in range(1, max_driver_lap + 1):
        compound, tyre_life = _get_stint_info(driver_number, lap_number, stints_data)

        if lap_number in valid_laps:
            lap_time = valid_laps[lap_number]
            is_interpolated = False
        else:
            is_interpolated = True
            fallback_duration = lap_average_times.get(lap_number, driver_average_time)
            lap_time = _interpolate_lap_duration(
                lap_number=lap_number,
                valid_laps=valid_laps,
                valid_lap_numbers=valid_lap_numbers,
                fallback_duration=fallback_duration,
            )

        cumulative_time += lap_time
        driver_formatted_laps.append(
            {
                "driver_num": driver_number,
                "driver": driver_info["code"],
                "lap": lap_number,
                "time": round(lap_time, _TIME_ROUNDING_DECIMALS),
                "compound": compound,
                "tyre_life": tyre_life,
                "session_time": round(cumulative_time, _TIME_ROUNDING_DECIMALS),
                "interpolated": is_interpolated,
            }
        )

    return driver_formatted_laps


def _assign_lap_positions(
    formatted_laps: Sequence[Mapping[str, Any]],
) -> tuple[list[dict[str, Any]], int]:
    """Orders drivers by cumulative session time on each lap to assign positions.

    Args:
        formatted_laps: Formatted lap entries across all drivers.

    Returns:
        A tuple `(final_laps, max_lap)` where `final_laps` contains lap records
        annotated with 1-based `'position'` (and `'driver_num'` removed) and
        `max_lap` is the highest lap number in the session.
    """
    max_lap = (
        max(int(lap_record["lap"]) for lap_record in formatted_laps)
        if formatted_laps
        else 0
    )
    final_laps: list[dict[str, Any]] = []

    for current_lap in range(1, max_lap + 1):
        lap_group = [
            dict(lap_record)
            for lap_record in formatted_laps
            if lap_record["lap"] == current_lap
        ]
        lap_group.sort(key=lambda record: float(record["session_time"]))

        for position, lap_record in enumerate(lap_group, start=1):
            lap_record["position"] = position
            lap_record.pop("driver_num", None)
            final_laps.append(lap_record)

    return final_laps, max_lap


def process_laps_data(
    laps_data: Sequence[Mapping[str, Any]],
    drivers_dict: Mapping[int, Mapping[str, Any]],
    stints_data: Sequence[Mapping[str, Any]],
) -> tuple[list[dict[str, Any]], int]:
    """Processes raw OpenF1 laps and stints into positioned, gap-interpolated laps.

    Args:
        laps_data: Raw lap records from OpenF1.
        drivers_dict: Mapping from driver number to driver metadata dictionary.
        stints_data: Raw stint records from OpenF1.

    Returns:
        A tuple `(final_laps, max_lap)` containing the ordered list of processed
        lap dictionaries and the maximum lap number completed in the race.
    """
    driver_raw_laps = _group_laps_by_driver(laps_data)
    driver_averages = _calculate_driver_average_times(driver_raw_laps)
    lap_average_times = _calculate_lap_average_times(laps_data)

    formatted_laps: list[dict[str, Any]] = []
    for driver_number, raw_laps in driver_raw_laps.items():
        driver_info = drivers_dict.get(driver_number)
        if not driver_info:
            continue

        driver_laps = _build_driver_formatted_laps(
            driver_number=driver_number,
            raw_laps=raw_laps,
            driver_info=driver_info,
            stints_data=stints_data,
            lap_average_times=lap_average_times,
            driver_average_time=driver_averages.get(
                driver_number, _DEFAULT_LAP_DURATION_SECONDS
            ),
        )
        formatted_laps.extend(driver_laps)

    return _assign_lap_positions(formatted_laps)


def _fetch_openf1_endpoint(
    endpoint: str,
    params: Mapping[str, Any],
) -> list[dict[str, Any]] | None:
    """Queries an OpenF1 REST endpoint and respects the API rate limit delay.

    Args:
        endpoint: The OpenF1 resource path (e.g., `'sessions'`, `'drivers'`).
        params: Query string parameters to include in the request URL.

    Returns:
        The parsed JSON list of records, or `None` if the API returned an error
        dictionary.
    """
    query_string = "&".join(f"{key}={value}" for key, value in params.items())
    url = f"{_OPENF1_BASE_URL}/{endpoint}?{query_string}"
    response = requests.get(url)
    time.sleep(_API_RATE_LIMIT_DELAY_SECONDS)
    payload = response.json()
    if isinstance(payload, dict):
        print(f"API Error for {endpoint}: {payload}")
        return None
    return list(payload)


def _is_matching_session(session: Mapping[str, Any], gp_name: str) -> bool:
    """Checks whether an OpenF1 session record matches the requested Grand Prix name.

    Args:
        session: A session metadata record from OpenF1.
        gp_name: User-supplied Grand Prix country or circuit name.

    Returns:
        `True` if the session's country or circuit matches `gp_name`.
    """
    normalized_gp = gp_name.lower()
    country_name = str(session.get("country_name", "")).lower()
    circuit_short_name = str(session.get("circuit_short_name", "")).lower()
    return (
        country_name in normalized_gp
        or circuit_short_name in normalized_gp
        or normalized_gp in country_name
    )


def _find_matching_session(
    sessions: Sequence[Mapping[str, Any]],
    gp_name: str,
) -> Mapping[str, Any] | None:
    """Finds the first session in `sessions` matching `gp_name`.

    Args:
        sessions: Sequence of session records returned by OpenF1.
        gp_name: Target Grand Prix name or location.

    Returns:
        The matching session dictionary, or `None` if no match is found.
    """
    for session in sessions:
        if _is_matching_session(session, gp_name):
            return session
    return None


def _extract_unique_drivers(
    drivers_data: Sequence[Mapping[str, Any]],
) -> tuple[dict[int, dict[str, str]], list[dict[str, str]]]:
    """Deduplicates OpenF1 driver records and formats driver metadata.

    Args:
        drivers_data: Raw driver records from the OpenF1 drivers endpoint.

    Returns:
        A tuple `(drivers_dict, drivers_list)` mapping driver numbers to
        formatted driver metadata and preserving discovery order in a list.
    """
    drivers_dict: dict[int, dict[str, str]] = {}
    drivers_list: list[dict[str, str]] = []

    for driver_record in drivers_data:
        driver_number = int(driver_record["driver_number"])
        if driver_number not in drivers_dict:
            color = driver_record.get("team_colour", _DEFAULT_TEAM_COLOR_HEX)
            if color is None:
                color = _DEFAULT_TEAM_COLOR_HEX

            fallback_identifier = str(driver_number)
            formatted_driver = {
                "code": str(driver_record.get("name_acronym") or fallback_identifier),
                "name": str(driver_record.get("full_name") or fallback_identifier),
                "team": str(driver_record.get("team_name") or _UNKNOWN_TEAM_NAME),
                "color": f"#{color}",
            }
            drivers_dict[driver_number] = formatted_driver
            drivers_list.append(formatted_driver)

    return drivers_dict, drivers_list


def _determine_race_winner(
    final_laps: Sequence[Mapping[str, Any]],
    max_lap: int,
) -> str | None:
    """Identifies the race winner from the final lap standings.

    Args:
        final_laps: Processed lap records containing `'lap'`, `'position'`, and `'driver'`.
        max_lap: The final lap number of the race.

    Returns:
        The winner's driver code, or `None` if no laps exist on `max_lap`.
    """
    if not final_laps:
        return None
    last_lap_records = [
        lap_record for lap_record in final_laps if lap_record["lap"] == max_lap
    ]
    if not last_lap_records:
        return None
    last_lap_records.sort(key=lambda record: int(record["position"]))
    return str(last_lap_records[0]["driver"])


def _save_race_payload(out_path: str, payload: Mapping[str, Any]) -> None:
    """Writes the processed race payload to disk as formatted JSON.

    Args:
        out_path: Destination file path for the JSON output.
        payload: Complete race data dictionary to serialize.
    """
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as out_file:
        json.dump(payload, out_file, indent=_JSON_INDENT_SPACES)
    print(f"Data saved to {out_path}")


def fetch_openf1_data(year: int, gp_name: str, out_path: str) -> None:
    """Fetches race session, driver, lap, and stint data from OpenF1 and saves JSON.

    Args:
        year: Championship season year (e.g., `2023`).
        gp_name: Country or circuit name identifying the Grand Prix.
        out_path: Output file path where the processed JSON payload will be written.
    """
    print(f"Fetching OpenF1 data for {year} {gp_name}...")

    sessions = _fetch_openf1_endpoint(
        "sessions", {"year": year, "session_name": _RACE_SESSION_NAME}
    )
    if sessions is None:
        return

    session = _find_matching_session(sessions, gp_name)
    if not session:
        print("Could not find session for", gp_name)
        return

    session_key = session["session_key"]
    print(f"Found session_key: {session_key}")

    drivers_data = _fetch_openf1_endpoint("drivers", {"session_key": session_key})
    if drivers_data is None:
        return
    drivers_dict, drivers_list = _extract_unique_drivers(drivers_data)

    laps_data = _fetch_openf1_endpoint("laps", {"session_key": session_key})
    if laps_data is None:
        return
    if not laps_data:
        print("No lap data available.")
        return

    stints_data = _fetch_openf1_endpoint("stints", {"session_key": session_key})
    if stints_data is None:
        stints_data = []

    final_laps, max_lap = process_laps_data(laps_data, drivers_dict, stints_data)
    winner = _determine_race_winner(final_laps, max_lap)

    race_info = {
        "year": year,
        "gp": f"{session['country_name']} Grand Prix",
        "total_laps": max_lap,
        "winner": winner,
    }

    payload = {
        "race_info": race_info,
        "drivers": drivers_list,
        "session_events": [],
        "laps": final_laps,
    }

    _save_race_payload(out_path, payload)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Fetch and process Formula 1 race data from the OpenF1 API."
    )
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--gp", type=str, required=True)
    parser.add_argument("--out", type=str, required=True)
    args = parser.parse_args()

    fetch_openf1_data(args.year, args.gp, args.out)
