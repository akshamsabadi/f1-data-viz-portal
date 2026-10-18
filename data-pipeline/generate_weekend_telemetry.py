"""Generates multi-session weekend telemetry (Practice, Qualifying, Sprint, Race) for F1 datasets.

This module enriches Grand Prix JSON files with structured ``practice``,
``qualifying``, ``sprint_qualifying``, ``sprint``, and ``race_telemetry`` blocks,
pulling real session telemetry from the OpenF1 API when ``fetch_live=True`` and
falling back to circuit-and-grid-informed deterministic models when offline.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
import glob
import json
import math
import os
import statistics
import time
from typing import Any, Final

import requests

from fetch_openf1 import process_laps_data
from generate_corner_speeds import (
    _generate_corners_data,
    _group_drivers_by_team,
    _load_track_profiles,
    _resolve_track_profile,
    calculate_corner_speeds,
)

# --- API & File System Constants ---
_OPENF1_BASE_URL: Final[str] = "https://api.openf1.org/v1"
_API_DELAY_SECONDS: Final[float] = 0.38
_API_TIMEOUT_SECONDS: Final[int] = 15
_API_MAX_ATTEMPTS: Final[int] = 6
_HTTP_OK: Final[int] = 200
_API_RETRY_STATUS_CODES: Final[frozenset[int]] = frozenset({429, 500, 502, 503, 504})
_API_RATE_LIMIT_BACKOFF_BASE_S: Final[float] = 1.5
_API_ERROR_BACKOFF_BASE_S: Final[float] = 0.8
_TARGET_SEASON_YEAR: Final[int] = 2026
_TRACK_PROFILES_FILENAME: Final[str] = "track_profiles.json"
_DEFAULT_RACES_RELATIVE_DIR: Final[tuple[str, ...]] = (
    "..",
    "src",
    "assets",
    "data",
    "races",
    "2026",
)
_JSON_INDENT_SPACES: Final[int] = 2
_TIME_DECIMALS: Final[int] = 3
_STOP_DECIMALS: Final[int] = 2
_SPEED_DECIMALS: Final[int] = 1

# --- Deterministic Hash Constants (FNV-1a 32-bit) ---
_FNV1A_OFFSET_BASIS: Final[int] = 2166136261
_FNV1A_PRIME: Final[int] = 16777619
_FNV1A_MASK_32BIT: Final[int] = 0xFFFFFFFF
_UNIT_FLOAT_MODULO: Final[int] = 10000

# --- Calibration & Lap Physics Constants ---
_DEFAULT_WINNER_CODE: Final[str] = "VER"
_DEFAULT_TEAM_COLOR: Final[str] = "#888888"
_DEFAULT_FALLBACK_HEX: Final[str] = "ffffff"
_DEFAULT_TOTAL_LAPS: Final[int] = 55
_DEFAULT_LAP_TIME_S: Final[float] = 90.0
_DEFAULT_POLE_TIME_S: Final[float] = 88.0
_DEFAULT_RACE_MEDIAN_TIME_S: Final[float] = 95.0
_UNRANKED_POSITION: Final[int] = 99
_UNCLASSIFIED_SORT_POSITION: Final[int] = 999
_MIN_VALID_LAP_RATIO: Final[float] = 0.88
_MAX_VALID_LAP_RATIO: Final[float] = 1.85
_SC_CLAMPED_LAP_RATIO: Final[float] = 1.38
_MIN_CLEAN_RACE_LAP_S: Final[float] = 45.0
_MAX_CLEAN_RACE_LAP_S: Final[float] = 165.0
_LAP1_STANDING_START_OVERHEAD_S: Final[float] = 3.5
_LAP1_DEFAULT_GRID_STEP_S: Final[float] = 0.42
_LAP1_MIN_GRID_GAP_STEP_S: Final[float] = 0.28
_LAP1_MAX_RAW_GAP_S: Final[float] = 16.5
_LAP1_MIN_MONOTONIC_STEP_S: Final[float] = 0.12
_LAP1_INITIAL_OFFSET_S: Final[float] = 0.15
_POSITION_LOOKUP_OFFSET_S: Final[float] = 2.0
_LAPPED_RANK_OFFSET_S: Final[float] = 0.45
_MONOTONIC_DURATION_STEP_S: Final[float] = 0.045

# --- Neutralization (SC / VSC) Constants ---
_SC_LAP_TIME_RATIO_THRESHOLD: Final[float] = 1.28
_VSC_LAP_TIME_RATIO_THRESHOLD: Final[float] = 1.15
_UNCLOSED_SC_WINDOW_EXTRA_LAPS: Final[int] = 2

# --- Baseline Pace & Session Pole Ratio Constants ---
_PACE_FALLBACK_BASE_OFFSET_S: Final[float] = 1.8
_PACE_FALLBACK_DRIVER_STEP_S: Final[float] = 0.12
_MAX_PACE_SAMPLE_LAPS: Final[int] = 5
_PRACTICE_POLE_RATIO: Final[float] = 0.978
_QUALI_POLE_RATIO: Final[float] = 0.962
_SPRINT_POLE_RATIO: Final[float] = 0.968
_FUEL_PENALTY_PER_LAP_S: Final[float] = 0.065
_FUEL_BURN_EFFECT_SEC_PER_LAP: Final[float] = 0.055

# --- Practice Synthesis & Telemetry Bounds ---
_MIN_PRACTICE_LAP_S: Final[float] = 55.0
_MAX_PRACTICE_LAP_S: Final[float] = 160.0
_MIN_SPEED_TRAP_KMH: Final[float] = 220.0
_MAX_SPEED_TRAP_KMH: Final[float] = 375.0
_MIN_REAL_COMPOUND_LAPS_SUM: Final[int] = 12
_PRACTICE_SAMPLE_LAP_LIMIT: Final[int] = 250
_DEGRADATION_CURVE_MAX_AGE: Final[int] = 14
_DEFAULT_BASE_SPEED_KMH: Final[float] = 160.0
_DEFAULT_SPEED_VARIATION_KMH: Final[float] = 60.0
_DEFAULT_TURNS_COUNT: Final[int] = 15
_DRY_COMPOUNDS: Final[tuple[str, str, str]] = ("SOFT", "MEDIUM", "HARD")
_COMPOUND_OFFSETS_S: Final[dict[str, float]] = {
    "SOFT": 0.0,
    "MEDIUM": 0.65,
    "HARD": 1.32,
}

# --- Qualifying & Trace Constants ---
_TRACE_POINTS_COUNT: Final[int] = 51
_Q3_CUTOFF_RANK: Final[int] = 10
_Q2_CUTOFF_RANK: Final[int] = 16
_MIN_QUALI_LAP_S: Final[float] = 50.0
_MAX_QUALI_LAP_S: Final[float] = 150.0
_MAX_QUALI_RESULT_LAP_S: Final[float] = 160.0
_QUALI_FLYING_LAP_RATIO: Final[float] = 1.12
_MIN_SECTOR_TIME_S: Final[float] = 10.0
_MAX_SECTOR_TIME_S: Final[float] = 65.0
_SECTOR_SUM_TOLERANCE_S: Final[float] = 0.25
_YELLOW_SECTOR_TOLERANCE_S: Final[float] = 0.002
_PURPLE_SECTOR_TOLERANCE_S: Final[float] = 1e-4
_Q3_DEFAULT_CUTOFF_OFFSET_S: Final[float] = 0.85
_Q2_DEFAULT_CUTOFF_OFFSET_S: Final[float] = 1.45

# --- Race Stint & Pit Stop Constants ---
_MIN_PIT_LANE_DURATION_S: Final[float] = 16.0
_MAX_PIT_LANE_DURATION_S: Final[float] = 35.0
_MAX_CLAMPED_PIT_LOSS_S: Final[float] = 38.0
_DEFAULT_PIT_TRANSIT_S: Final[float] = 19.5
_MIN_STATIONARY_STOP_S: Final[float] = 2.0
_MIN_DERIVED_STATIONARY_S: Final[float] = 1.85
_MAX_DERIVED_STATIONARY_S: Final[float] = 12.0
_CLEAN_STINT_LAP_BUFFER_S: Final[float] = 6.5
_MIN_LAPS_FOR_SYNTHETIC_PIT: Final[int] = 20
_MIN_STINT_BOUNDARY_LAPS: Final[int] = 6
_MIN_OBSERVED_PIT_SPIKE_S: Final[float] = 17.5
_MAX_OBSERVED_PIT_SPIKE_S: Final[float] = 32.0
_MIN_SPRINT_LAPS: Final[int] = 15

# --- Circuit Track Map Constants ---
_TRACK_MAP_POINTS_COUNT: Final[int] = 180
_TRACK_MAP_VIEWBOX_WIDTH: Final[float] = 1000.0
_TRACK_MAP_VIEWBOX_HEIGHT: Final[float] = 560.0
_TRACK_MAP_PADDING_X: Final[float] = 74.0
_TRACK_MAP_PADDING_Y: Final[float] = 62.0
_TRACK_MAP_LABEL_OFFSET_PX: Final[float] = 28.0
_TRACK_MAP_ARC_HALF_WINDOW: Final[int] = 3
_MIN_LOCATION_SAMPLE_POINTS: Final[int] = 80
_DEFAULT_S1_SPLIT_PCT: Final[float] = 32.5
_DEFAULT_S2_SPLIT_PCT: Final[float] = 66.5

_SPRINT_WEEKEND_STEMS: Final[frozenset[str]] = frozenset(
    {
        "china",
        "miami",
        "united_states",
        "canada",
        "united_kingdom",
        "netherlands",
        "singapore",
    }
)

_FILENAME_TO_MEETING_KEY: Final[dict[str, int]] = {
    "australia": 1279,
    "china": 1280,
    "japan": 1281,
    "miami": 1284,
    "canada": 1285,
    "monaco": 1286,
    "spain": 1287,
    "austria": 1288,
    "united_kingdom": 1289,
    "belgium": 1290,
    "hungary": 1291,
    "netherlands": 1292,
    "italy": 1293,
    "madring": 1294,
    "madrid": 1294,
    "azerbaijan": 1295,
    "bahrain": 1308,
    "singapore": 1296,
    "united_states": 1297,
    "mexico": 1298,
    "brazil": 1299,
    "sao_paulo": 1299,
    "las_vegas": 1300,
    "qatar": 1301,
    "abu_dhabi": 1302,
}


@dataclass(frozen=True)
class _RaceCalibrationContext:
    """Immutable context for calibrating race laps and official classification."""

    driver_meta: Mapping[str, Mapping[str, Any]]
    result_by_code: Mapping[str, Mapping[str, Any]]
    ordered_codes: tuple[str, ...]
    official_rank_by_code: Mapping[str, int]
    official_winner: str
    official_max_lap: int
    field_median: float
    min_valid_lap_time: float
    end_ts_by_code_lap: Mapping[tuple[str, int], float]
    end_ts_by_lap: Mapping[int, Sequence[float]]
    pos_timeline_by_code: Mapping[str, Sequence[tuple[float, int]]]
    lap1_time_by_code: Mapping[str, float]
    leader_lap1_time: float
    has_raw_laps: bool


@dataclass(frozen=True)
class _RealPracticeMetrics:
    """Extracted practice session metrics from OpenF1 laps, stints, and results."""

    best_lap_by_code: Mapping[str, float]
    official_pos_by_code: Mapping[str, int]
    speed_trap_by_code: Mapping[str, float]
    compound_counts_by_code: Mapping[str, Mapping[str, int]]


@dataclass(frozen=True)
class _PracticeCircuitContext:
    """Circuit and baseline pace parameters for practice telemetry synthesis."""

    gp_name: str
    fastest_baseline: float
    practice_pole_base: float
    base_speed: float
    circuit_top_speed_base: float
    team_corner_means: Mapping[str, float]
    deg_rates: Mapping[str, float]
    compound_offsets: Mapping[str, float]


@dataclass(frozen=True)
class _RealQualifyingMetrics:
    """Extracted qualifying session metrics from OpenF1 laps, race control, and results."""

    q_times_by_code: Mapping[str, Mapping[int, float | None]]
    official_pos_by_code: Mapping[str, int]
    best_sectors_by_code: Mapping[str, Mapping[str, float]]
    lap_sectors_by_code: Mapping[str, tuple[float | None, float | None, float | None]]
    has_real_quali: bool


@dataclass(frozen=True)
class _QualifyingSynthesisContext:
    """Parameters for building per-driver qualifying result rows."""

    gp_name: str
    stage_prefix: str
    pole_target: float
    s1_ratio: float
    s2_ratio: float
    metrics: _RealQualifyingMetrics


@dataclass(frozen=True)
class _IndexedPitAndStintContext:
    """Indexed OpenF1 pit stop records and circuit pit transit baseline."""

    real_pits_by_driver_lap: Mapping[tuple[str, int], Mapping[str, Any]]
    circuit_pit_transit_s: float
    has_openf1_stints: bool


def _deterministic_hash(seed_text: str) -> int:
    """Computes a stable positive 32-bit FNV-1a integer hash from a string seed.

    Args:
        seed_text: Arbitrary string seed.

    Returns:
        Unsigned 32-bit integer hash value.
    """
    total = _FNV1A_OFFSET_BASIS
    for char in seed_text:
        total = ((total ^ ord(char)) * _FNV1A_PRIME) & _FNV1A_MASK_32BIT
    return total


def _seeded_unit_float(seed_text: str) -> float:
    """Maps a string seed deterministically to a float in ``[0.0, 1.0)``.

    Args:
        seed_text: Arbitrary string seed.

    Returns:
        Deterministic float value between 0.0 and 1.0.
    """
    return (_deterministic_hash(seed_text) % _UNIT_FLOAT_MODULO) / float(
        _UNIT_FLOAT_MODULO
    )


def _fetch_openf1_json(
    endpoint: str, params: Mapping[str, Any]
) -> list[dict[str, Any]]:
    """Queries an OpenF1 REST endpoint with retry and rate-limit backoff.

    Args:
        endpoint: OpenF1 resource path (e.g., ``"laps"``, ``"sessions"``).
        params: Query parameter mapping.

    Returns:
        Parsed JSON list of records, or an empty list on failure.
    """
    url = f"{_OPENF1_BASE_URL}/{endpoint}"
    for attempt in range(_API_MAX_ATTEMPTS):
        try:
            time.sleep(_API_DELAY_SECONDS)
            resp = requests.get(url, params=params, timeout=_API_TIMEOUT_SECONDS)
            if resp.status_code == _HTTP_OK:
                payload = resp.json()
                return payload if isinstance(payload, list) else []
            if resp.status_code in _API_RETRY_STATUS_CODES:
                time.sleep(_API_RATE_LIMIT_BACKOFF_BASE_S * (attempt + 1))
                continue
        except Exception as err:
            print(f"  Warning: OpenF1 request failed ({endpoint} {params}): {err}")
            time.sleep(_API_ERROR_BACKOFF_BASE_S * (attempt + 1))
    return []


def _parse_int_position(raw_pos: Any) -> int | None:
    """Parses a positive integer finishing position from an OpenF1 record.

    Args:
        raw_pos: Raw position field value (int, str, or None).

    Returns:
        Parsed integer position, or None if not a valid integer.
    """
    if isinstance(raw_pos, int):
        return raw_pos
    if isinstance(raw_pos, str) and raw_pos.strip().isdigit():
        return int(raw_pos.strip())
    return None


def _parse_iso_timestamp(iso_str: str | None) -> float | None:
    """Parses an ISO-8601 timestamp string into Unix epoch seconds.

    Args:
        iso_str: ISO-8601 formatted timestamp string or None.

    Returns:
        Unix timestamp in seconds, or None if empty or malformed.
    """
    if not iso_str:
        return None
    try:
        return datetime.fromisoformat(iso_str.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def _find_default_winner(
    laps: Sequence[Mapping[str, Any]], max_raw_lap: int
) -> str:
    """Finds the leader on the highest recorded lap, or falls back to default.

    Args:
        laps: Sequence of lap records.
        max_raw_lap: Highest lap number present in ``laps``.

    Returns:
        Three-letter driver code of the leader on ``max_raw_lap``.
    """
    for lap_rec in laps:
        if (
            int(lap_rec.get("lap", 0)) == max_raw_lap
            and int(lap_rec.get("position", _UNRANKED_POSITION)) == 1
        ):
            return str(lap_rec["driver"])
    return _DEFAULT_WINNER_CODE


def _index_session_results_by_code(
    openf1_session_result: Sequence[Mapping[str, Any]],
    num_to_code: Mapping[int, str],
    driver_meta: Mapping[str, Mapping[str, Any]],
) -> dict[str, Mapping[str, Any]]:
    """Indexes OpenF1 session_result records by three-letter driver code.

    Args:
        openf1_session_result: Raw records from OpenF1 ``/session_result``.
        num_to_code: Mapping from driver racing number to three-letter code.
        driver_meta: Mapping from driver code to driver metadata.

    Returns:
        Dictionary mapping known driver codes to their session result record.
    """
    result_by_code: dict[str, Mapping[str, Any]] = {}
    for row in openf1_session_result:
        d_num = row.get("driver_number")
        code = num_to_code.get(int(d_num)) if d_num is not None else None
        if code and code in driver_meta:
            result_by_code[code] = row
    return result_by_code


def _order_drivers_by_official_result(
    driver_codes: Sequence[str],
    result_by_code: Mapping[str, Mapping[str, Any]],
) -> list[str]:
    """Orders driver codes according to official FIA session classification.

    Args:
        driver_codes: Sequence of driver codes participating in the session.
        result_by_code: Mapping from driver code to OpenF1 session_result row.

    Returns:
        Ordered list of driver codes from P1 to last.
    """

    def _result_sort_key(code: str) -> tuple[int, int, int]:
        row = result_by_code.get(code)
        if not row:
            return (2, _UNCLASSIFIED_SORT_POSITION, 0)
        pos = _parse_int_position(row.get("position"))
        laps_done = int(row.get("number_of_laps") or 0)
        if pos is not None:
            return (0, pos, -laps_done)
        return (1, _UNCLASSIFIED_SORT_POSITION, -laps_done)

    return sorted(driver_codes, key=_result_sort_key)


def _compute_field_median_lap_time(laps: Sequence[Mapping[str, Any]]) -> float:
    """Computes the clean field median lap duration from Laps 2 and beyond.

    Args:
        laps: Sequence of lap records.

    Returns:
        Median clean lap duration in seconds, or ``_DEFAULT_LAP_TIME_S``.
    """
    lap2plus_times = [
        float(lap_rec["time"])
        for lap_rec in laps
        if int(lap_rec.get("lap", 0)) >= 2
        and _MIN_CLEAN_RACE_LAP_S
        <= float(lap_rec.get("time", 0))
        <= _MAX_CLEAN_RACE_LAP_S
    ]
    return (
        statistics.median(lap2plus_times)
        if lap2plus_times
        else _DEFAULT_LAP_TIME_S
    )


def _parse_openf1_lap_timestamps(
    openf1_raw_laps: Sequence[Mapping[str, Any]] | None,
    num_to_code: Mapping[int, str],
    official_max_lap: int,
    field_median: float,
) -> tuple[dict[tuple[str, int], float], dict[int, list[float]]]:
    """Extracts and back-fills per-lap crossing timestamps from raw OpenF1 laps.

    Args:
        openf1_raw_laps: Raw lap records from OpenF1 ``/laps``, or None.
        num_to_code: Mapping from driver number to three-letter code.
        official_max_lap: Authoritative race lap count.
        field_median: Clean field median lap time for back-filling gaps.

    Returns:
        Tuple of ``(end_ts_by_code_lap, end_ts_by_lap)`` mapping ``(code, lap)``
        and ``lap`` to Unix epoch crossing timestamps.
    """
    end_ts_by_code_lap: dict[tuple[str, int], float] = {}
    end_ts_by_lap: dict[int, list[float]] = defaultdict(list)
    if not openf1_raw_laps:
        return end_ts_by_code_lap, end_ts_by_lap

    raw_by_code: dict[str, dict[int, Mapping[str, Any]]] = defaultdict(dict)
    for raw_lap in openf1_raw_laps:
        d_num = raw_lap.get("driver_number")
        l_num = raw_lap.get("lap_number")
        code = num_to_code.get(int(d_num)) if d_num is not None else None
        if code and l_num is not None:
            raw_by_code[code][int(l_num)] = raw_lap

    for code, lap_map in raw_by_code.items():
        for lap_no in range(1, official_max_lap + 1):
            rec = lap_map.get(lap_no)
            rec_next = lap_map.get(lap_no + 1)
            ts_next = (
                _parse_iso_timestamp(rec_next.get("date_start"))
                if rec_next
                else None
            )
            ts_curr = (
                _parse_iso_timestamp(rec.get("date_start")) if rec else None
            )
            dur_curr = rec.get("lap_duration") if rec else None
            if ts_next is not None:
                end_ts_by_code_lap[(code, lap_no)] = ts_next
                end_ts_by_lap[lap_no].append(ts_next)
            elif ts_curr is not None and dur_curr is not None:
                crossing_ts = ts_curr + float(dur_curr)
                end_ts_by_code_lap[(code, lap_no)] = crossing_ts
                end_ts_by_lap[lap_no].append(crossing_ts)

        for lap_no in range(official_max_lap, 0, -1):
            if (
                (code, lap_no) not in end_ts_by_code_lap
                and (code, lap_no + 1) in end_ts_by_code_lap
            ):
                rec_plus_two = lap_map.get(lap_no + 2)
                dur_est = (
                    float(rec_plus_two["lap_duration"])
                    if (rec_plus_two and rec_plus_two.get("lap_duration"))
                    else field_median
                )
                crossing_ts = end_ts_by_code_lap[(code, lap_no + 1)] - dur_est
                end_ts_by_code_lap[(code, lap_no)] = crossing_ts
                end_ts_by_lap[lap_no].append(crossing_ts)

    return end_ts_by_code_lap, end_ts_by_lap


def _build_fia_position_timeline(
    openf1_positions: Sequence[Mapping[str, Any]] | None,
    num_to_code: Mapping[int, str],
) -> dict[str, list[tuple[float, int]]]:
    """Builds a chronologically sorted FIA position timeline per driver code.

    Args:
        openf1_positions: Raw position records from OpenF1 ``/position``, or None.
        num_to_code: Mapping from driver number to three-letter code.

    Returns:
        Dictionary mapping driver code to sorted ``(timestamp, position)`` pairs.
    """
    pos_timeline_by_code: dict[str, list[tuple[float, int]]] = defaultdict(list)
    if not openf1_positions:
        return pos_timeline_by_code

    for pos_rec in openf1_positions:
        d_num = pos_rec.get("driver_number")
        p_val = _parse_int_position(pos_rec.get("position"))
        ts = _parse_iso_timestamp(pos_rec.get("date"))
        code = num_to_code.get(int(d_num)) if d_num is not None else None
        if code and p_val is not None and ts is not None:
            pos_timeline_by_code[code].append((ts, p_val))

    for code in pos_timeline_by_code:
        pos_timeline_by_code[code].sort(key=lambda item: item[0])
    return pos_timeline_by_code


def _lookup_fia_position_at_timestamp(
    code: str,
    timestamp_ref: float,
    pos_timeline_by_code: Mapping[str, Sequence[tuple[float, int]]],
    official_rank_by_code: Mapping[str, int],
) -> int:
    """Looks up a driver's FIA track position at a reference timestamp.

    Args:
        code: Three-letter driver code.
        timestamp_ref: Unix epoch timestamp to query.
        pos_timeline_by_code: Per-driver sorted ``(timestamp, position)`` timeline.
        official_rank_by_code: Fallback official classification rank by driver.

    Returns:
        Track position integer at ``timestamp_ref``.
    """
    plist = pos_timeline_by_code.get(code)
    if not plist:
        return official_rank_by_code.get(code, _UNRANKED_POSITION)
    current_pos = plist[0][1]
    for ts, pos_val in plist:
        if ts <= timestamp_ref:
            current_pos = pos_val
        else:
            break
    return current_pos


def _determine_lap1_crossing_order(
    ordered_codes: Sequence[str],
    end_ts_by_code_lap: Mapping[tuple[str, int], float],
    end_ts_by_lap: Mapping[int, Sequence[float]],
    pos_timeline_by_code: Mapping[str, Sequence[tuple[float, int]]],
    official_rank_by_code: Mapping[str, int],
    field_median: float,
) -> tuple[dict[str, float], float]:
    """Determines Lap 1 crossing order and synthesizes standing-start Lap 1 times.

    Args:
        ordered_codes: Driver codes ordered by official classification.
        end_ts_by_code_lap: Crossing timestamp by ``(driver_code, lap_number)``.
        end_ts_by_lap: Crossing timestamps grouped by lap number.
        pos_timeline_by_code: Sorted FIA position timeline by driver code.
        official_rank_by_code: Official finishing rank by driver code.
        field_median: Clean field median lap duration in seconds.

    Returns:
        Tuple of ``(lap1_time_by_code, leader_lap1_time)``.
    """
    lap1_ts_list = sorted(end_ts_by_lap.get(1, []))
    t_ref_lap1 = (
        lap1_ts_list[0] + _POSITION_LOOKUP_OFFSET_S if lap1_ts_list else 0.0
    )
    if pos_timeline_by_code and t_ref_lap1 > 0:
        lap1_ordered_codes = sorted(
            ordered_codes,
            key=lambda code: (
                _lookup_fia_position_at_timestamp(
                    code, t_ref_lap1, pos_timeline_by_code, official_rank_by_code
                ),
                end_ts_by_code_lap.get((code, 1), float("inf")),
                official_rank_by_code.get(code, _UNRANKED_POSITION),
            ),
        )
    elif lap1_ts_list:
        lap1_ordered_codes = sorted(
            ordered_codes,
            key=lambda code: (
                end_ts_by_code_lap.get((code, 1), float("inf")),
                official_rank_by_code.get(code, _UNRANKED_POSITION),
            ),
        )
    else:
        lap1_ordered_codes = list(ordered_codes)

    leader_lap1_end_ts = min(lap1_ts_list) if lap1_ts_list else None
    leader_lap1_time = round(
        field_median + _LAP1_STANDING_START_OVERHEAD_S, _TIME_DECIMALS
    )

    lap1_time_by_code: dict[str, float] = {}
    prev_lap1_t = leader_lap1_time - _LAP1_INITIAL_OFFSET_S
    for idx_c, code in enumerate(lap1_ordered_codes):
        if idx_c == 0:
            lap1_t = leader_lap1_time
        else:
            crossing_ts = end_ts_by_code_lap.get((code, 1))
            if crossing_ts is not None and leader_lap1_end_ts is not None:
                raw_gap1 = crossing_ts - leader_lap1_end_ts
                gap1 = max(
                    idx_c * _LAP1_MIN_GRID_GAP_STEP_S,
                    min(_LAP1_MAX_RAW_GAP_S, raw_gap1),
                )
            else:
                gap1 = idx_c * _LAP1_DEFAULT_GRID_STEP_S
            lap1_t = max(
                prev_lap1_t + _LAP1_MIN_MONOTONIC_STEP_S,
                leader_lap1_time + gap1,
            )
        lap1_t = round(lap1_t, _TIME_DECIMALS)
        lap1_time_by_code[code] = lap1_t
        prev_lap1_t = lap1_t

    return lap1_time_by_code, leader_lap1_time


def _reconstruct_driver_calibrated_laps(
    code: str,
    drv_laps: Sequence[Mapping[str, Any]],
    row: Mapping[str, Any],
    context: _RaceCalibrationContext,
) -> list[dict[str, Any]]:
    """Reconstructs contiguous, validated laps 1..target_laps for a single driver.

    Args:
        code: Three-letter driver code.
        drv_laps: Existing lap records for the driver.
        row: Official OpenF1 ``/session_result`` row for the driver.
        context: Race calibration context.

    Returns:
        Contiguous list of calibrated lap dictionaries for ``code``.
    """
    rank = context.official_rank_by_code[code]
    sorted_drv_laps = sorted(drv_laps, key=lambda item: int(item["lap"]))
    raw_target_laps = row.get("number_of_laps")

    if raw_target_laps is not None:
        target_laps = min(context.official_max_lap, max(0, int(raw_target_laps)))
    else:
        target_laps = min(
            context.official_max_lap,
            max((int(lap["lap"]) for lap in sorted_drv_laps), default=0),
        )

    if bool(row.get("dns")) or target_laps == 0:
        return []

    trimmed_laps = [
        lap for lap in sorted_drv_laps if int(lap["lap"]) <= target_laps
    ]
    existing_by_lap = {int(lap["lap"]): lap for lap in trimmed_laps}
    max_valid_lap_time = context.field_median * _MAX_VALID_LAP_RATIO
    clean_drv_times = [
        float(lap["time"])
        for lap in trimmed_laps
        if int(lap.get("lap", 0)) >= 2
        and context.min_valid_lap_time
        <= float(lap.get("time", 0))
        <= max_valid_lap_time
    ]
    drv_median = (
        statistics.median(clean_drv_times)
        if clean_drv_times
        else context.field_median
    )
    last_comp = (
        str(trimmed_laps[0].get("compound", "MEDIUM"))
        if trimmed_laps
        else "MEDIUM"
    )
    last_life = int(trimmed_laps[0].get("tyre_life", 1)) if trimmed_laps else 1

    contiguous_laps: list[dict[str, Any]] = []
    for lap_no in range(1, target_laps + 1):
        if lap_no in existing_by_lap:
            rec = dict(existing_by_lap[lap_no])
            last_comp = str(rec.get("compound", last_comp))
            last_life = int(rec.get("tyre_life", last_life))
        else:
            last_life += 1
            rec = {
                "driver": code,
                "lap": lap_no,
                "time": round(drv_median, _TIME_DECIMALS),
                "compound": last_comp,
                "tyre_life": last_life,
                "position": rank,
                "session_time": 0.0,
                "interpolated": True,
            }

        if lap_no == 1:
            if (
                context.has_raw_laps
                or float(rec.get("time", 0)) < context.min_valid_lap_time
                or float(rec.get("time", 0)) > max_valid_lap_time
            ):
                rec["time"] = context.lap1_time_by_code.get(
                    code, context.leader_lap1_time
                )
        elif float(rec.get("time", 0)) < context.min_valid_lap_time:
            rec["time"] = round(drv_median, _TIME_DECIMALS)
            rec["interpolated"] = True
        elif float(rec.get("time", 0)) > max_valid_lap_time:
            rec["time"] = round(
                context.field_median * _SC_CLAMPED_LAP_RATIO, _TIME_DECIMALS
            )
            rec["interpolated"] = True

        contiguous_laps.append(rec)

    cum_t = 0.0
    for rec in contiguous_laps:
        cum_t = round(cum_t + float(rec["time"]), _TIME_DECIMALS)
        rec["session_time"] = cum_t

    return contiguous_laps


def _resolve_winner_duration(
    context: _RaceCalibrationContext,
    calibrated_by_driver: Mapping[str, Sequence[Mapping[str, Any]]],
) -> tuple[float, float | None]:
    """Resolves the race winner's total session duration in seconds.

    Args:
        context: Race calibration context.
        calibrated_by_driver: Mapping of driver codes to their calibrated laps.

    Returns:
        Tuple of ``(winner_duration, p1_raw_duration)``.
    """
    p1_row = context.result_by_code.get(context.official_winner, {})
    p1_raw_dur_val = p1_row.get("duration")
    p1_raw_dur = (
        float(p1_raw_dur_val)
        if isinstance(p1_raw_dur_val, (int, float)) and float(p1_raw_dur_val) > 0
        else None
    )
    p1_laps = calibrated_by_driver.get(context.official_winner, [])

    if p1_raw_dur is not None and not context.has_raw_laps:
        winner_duration = p1_raw_dur
    elif p1_laps:
        winner_duration = float(p1_laps[-1]["session_time"])
    elif p1_raw_dur is not None:
        winner_duration = p1_raw_dur
    else:
        winner_duration = float(context.official_max_lap * context.field_median)

    return winner_duration, p1_raw_dur


def _build_official_classification_entry(
    code: str,
    contiguous_laps: list[dict[str, Any]],
    winner_duration: float,
    p1_raw_dur: float | None,
    prior_entries: Sequence[Mapping[str, Any]],
    context: _RaceCalibrationContext,
) -> dict[str, Any]:
    """Builds a single driver's official classification record and aligns final session_time.

    Args:
        code: Three-letter driver code.
        contiguous_laps: Mutable list of calibrated laps for the driver.
        winner_duration: Total race duration of the winning driver.
        p1_raw_dur: Raw duration field from P1's OpenF1 session_result row, if any.
        prior_entries: Classification entries already constructed for higher-ranked drivers.
        context: Race calibration context.

    Returns:
        Formatted classification dictionary for ``code``.
    """
    rank = context.official_rank_by_code[code]
    meta = context.driver_meta[code]
    row = context.result_by_code.get(code, {})
    target_laps = len(contiguous_laps)
    is_dns = bool(row.get("dns")) or target_laps == 0
    is_dsq = bool(row.get("dsq")) and not is_dns
    is_dnf = (bool(row.get("dnf")) or is_dsq) and not is_dns

    if is_dns or target_laps == 0:
        return {
            "driver": code,
            "name": str(meta.get("name", code)),
            "team": str(meta.get("team", "")),
            "color": str(meta.get("color", _DEFAULT_TEAM_COLOR)),
            "position": rank,
            "rank": rank,
            "laps_completed": 0,
            "status": "DNS",
            "duration": None,
            "gap_to_leader": "DNS",
            "is_dnf": False,
            "is_dns": True,
        }

    raw_dur = row.get("duration")
    raw_gap = row.get("gap_to_leader")
    final_session_time = float(contiguous_laps[-1]["session_time"])

    if target_laps == context.official_max_lap and not is_dnf:
        status_str = "FINISHER"
        if rank == 1:
            final_session_time = round(winner_duration, _TIME_DECIMALS)
        elif isinstance(raw_gap, (int, float)) and float(raw_gap) >= 0:
            final_session_time = round(
                winner_duration + float(raw_gap), _TIME_DECIMALS
            )
        elif (
            isinstance(raw_dur, (int, float))
            and p1_raw_dur is not None
            and float(raw_dur) > p1_raw_dur
        ):
            final_session_time = round(
                winner_duration + (float(raw_dur) - p1_raw_dur), _TIME_DECIMALS
            )
    elif not is_dnf:
        status_str = "LAPPED"
        if final_session_time < winner_duration:
            final_session_time = round(
                winner_duration + rank * _LAPPED_RANK_OFFSET_S, _TIME_DECIMALS
            )
    else:
        status_str = "DNF"

    for prev_item in prior_entries:
        if (
            int(prev_item["laps_completed"]) == target_laps
            and prev_item.get("duration") is not None
        ):
            prev_dur = float(prev_item["duration"])
            if final_session_time <= prev_dur:
                final_session_time = round(
                    prev_dur + _MONOTONIC_DURATION_STEP_S, _TIME_DECIMALS
                )

    if (
        target_laps == context.official_max_lap
        or abs(final_session_time - float(contiguous_laps[-1]["session_time"]))
        <= context.field_median * _MAX_VALID_LAP_RATIO
    ):
        contiguous_laps[-1]["session_time"] = final_session_time
    status_out = "DSQ" if is_dsq else status_str
    laps_behind = context.official_max_lap - target_laps
    gap_to_leader: float | str = (
        0.0
        if rank == 1
        else round(final_session_time - winner_duration, _TIME_DECIMALS)
        if status_out == "FINISHER"
        else f"+{laps_behind} {'Lap' if laps_behind == 1 else 'Laps'}"
        if status_out == "LAPPED"
        else status_out
    )

    return {
        "driver": code,
        "name": str(meta.get("name", code)),
        "team": str(meta.get("team", "")),
        "color": str(meta.get("color", _DEFAULT_TEAM_COLOR)),
        "position": rank,
        "rank": rank,
        "laps_completed": target_laps,
        "status": status_out,
        "duration": final_session_time,
        "gap_to_leader": gap_to_leader,
        "is_dnf": is_dnf,
        "is_dns": False,
    }


def _assign_per_lap_positions(
    calibrated_by_driver: Mapping[str, Sequence[dict[str, Any]]],
    context: _RaceCalibrationContext,
) -> list[dict[str, Any]]:
    """Assigns per-lap positions 1..N across all calibrated laps.

    Args:
        calibrated_by_driver: Mapping from driver code to calibrated lap dicts.
        context: Race calibration context with FIA position timeline and timestamps.

    Returns:
        Flattened list of calibrated lap dictionaries ordered by lap and position.
    """
    final_laps: list[dict[str, Any]] = []
    for lap_no in range(1, context.official_max_lap + 1):
        lap_group = [
            drv_laps[lap_no - 1]
            for drv_laps in calibrated_by_driver.values()
            if len(drv_laps) >= lap_no
        ]
        if lap_no == context.official_max_lap:
            lap_group.sort(
                key=lambda item: context.official_rank_by_code.get(
                    str(item["driver"]), _UNRANKED_POSITION
                )
            )
        elif context.pos_timeline_by_code and context.end_ts_by_lap.get(lap_no):
            ts_list = sorted(context.end_ts_by_lap[lap_no])
            t_ref = ts_list[0] + _POSITION_LOOKUP_OFFSET_S
            lap_group.sort(
                key=lambda item: (
                    _lookup_fia_position_at_timestamp(
                        str(item["driver"]),
                        t_ref,
                        context.pos_timeline_by_code,
                        context.official_rank_by_code,
                    ),
                    context.end_ts_by_code_lap.get(
                        (str(item["driver"]), lap_no), float("inf")
                    ),
                    context.official_rank_by_code.get(
                        str(item["driver"]), _UNRANKED_POSITION
                    ),
                )
            )
        elif context.end_ts_by_lap.get(lap_no):
            lap_group.sort(
                key=lambda item: (
                    context.end_ts_by_code_lap.get(
                        (str(item["driver"]), lap_no), float("inf")
                    ),
                    context.official_rank_by_code.get(
                        str(item["driver"]), _UNRANKED_POSITION
                    ),
                )
            )
        else:
            lap_group.sort(
                key=lambda item: (
                    float(item["session_time"]),
                    context.official_rank_by_code.get(
                        str(item["driver"]), _UNRANKED_POSITION
                    ),
                )
            )
        for pos_idx, rec in enumerate(lap_group, start=1):
            rec["position"] = pos_idx
            final_laps.append(rec)

    return final_laps


def _calibrate_race_laps_with_session_result(
    laps: Sequence[Mapping[str, Any]],
    drivers: Sequence[Mapping[str, Any]],
    openf1_session_result: Sequence[Mapping[str, Any]] | None,
    num_to_code: Mapping[int, str] | None,
    openf1_raw_laps: Sequence[Mapping[str, Any]] | None = None,
    openf1_positions: Sequence[Mapping[str, Any]] | None = None,
) -> tuple[list[dict[str, Any]], int, str, list[dict[str, Any]]]:
    """Calibrates race or sprint laps and classification against OpenF1 ``/session_result`` and ``/position``.

    Removes phantom post-checkered-flag cooldown laps, preserves genuine individual
    lap durations on Laps 2..N, reconstructs realistic standing-start Lap 1 times,
    and aligns lap-by-lap positions with official FIA ``/position`` and ``/session_result``.

    Args:
        laps: Processed lap dictionaries for the session.
        drivers: Driver metadata dictionaries.
        openf1_session_result: Official session result rows from OpenF1, or None.
        num_to_code: Mapping from driver number to three-letter code, or None.
        openf1_raw_laps: Optional raw OpenF1 lap records with ``date_start``.
        openf1_positions: Optional raw OpenF1 position records with ``date``.

    Returns:
        Tuple of ``(calibrated_laps, official_max_lap, official_winner, official_classification)``.
    """
    max_raw_lap = max((int(lap.get("lap", 0)) for lap in laps), default=0)
    default_winner = _find_default_winner(laps, max_raw_lap)

    if not openf1_session_result or not num_to_code:
        return [dict(lap) for lap in laps], max_raw_lap, default_winner, []

    driver_meta = {str(drv["code"]): drv for drv in drivers}
    result_by_code = _index_session_results_by_code(
        openf1_session_result, num_to_code, driver_meta
    )
    if not result_by_code:
        return [dict(lap) for lap in laps], max_raw_lap, default_winner, []

    official_max_lap = max(
        (int(row.get("number_of_laps") or 0) for row in result_by_code.values()),
        default=max_raw_lap,
    )
    if official_max_lap <= 0:
        official_max_lap = max_raw_lap

    ordered_codes = tuple(
        _order_drivers_by_official_result(
            list(driver_meta.keys()), result_by_code
        )
    )
    official_rank_by_code = {
        code: idx + 1 for idx, code in enumerate(ordered_codes)
    }
    official_winner = ordered_codes[0] if ordered_codes else default_winner

    field_median = _compute_field_median_lap_time(laps)
    min_valid_lap_time = round(
        field_median * _MIN_VALID_LAP_RATIO, _TIME_DECIMALS
    )

    end_ts_by_code_lap, end_ts_by_lap = _parse_openf1_lap_timestamps(
        openf1_raw_laps, num_to_code, official_max_lap, field_median
    )
    pos_timeline_by_code = _build_fia_position_timeline(
        openf1_positions, num_to_code
    )
    lap1_time_by_code, leader_lap1_time = _determine_lap1_crossing_order(
        ordered_codes=ordered_codes,
        end_ts_by_code_lap=end_ts_by_code_lap,
        end_ts_by_lap=end_ts_by_lap,
        pos_timeline_by_code=pos_timeline_by_code,
        official_rank_by_code=official_rank_by_code,
        field_median=field_median,
    )

    context = _RaceCalibrationContext(
        driver_meta=driver_meta,
        result_by_code=result_by_code,
        ordered_codes=ordered_codes,
        official_rank_by_code=official_rank_by_code,
        official_winner=official_winner,
        official_max_lap=official_max_lap,
        field_median=field_median,
        min_valid_lap_time=min_valid_lap_time,
        end_ts_by_code_lap=end_ts_by_code_lap,
        end_ts_by_lap=end_ts_by_lap,
        pos_timeline_by_code=pos_timeline_by_code,
        lap1_time_by_code=lap1_time_by_code,
        leader_lap1_time=leader_lap1_time,
        has_raw_laps=openf1_raw_laps is not None,
    )

    laps_by_driver: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for lap_rec in laps:
        laps_by_driver[str(lap_rec["driver"])].append(dict(lap_rec))

    calibrated_by_driver: dict[str, list[dict[str, Any]]] = {}
    for code in ordered_codes:
        calibrated_by_driver[code] = _reconstruct_driver_calibrated_laps(
            code=code,
            drv_laps=laps_by_driver.get(code, []),
            row=result_by_code.get(code, {}),
            context=context,
        )

    winner_duration, p1_raw_dur = _resolve_winner_duration(
        context, calibrated_by_driver
    )

    official_classification: list[dict[str, Any]] = []
    for code in ordered_codes:
        entry = _build_official_classification_entry(
            code=code,
            contiguous_laps=calibrated_by_driver.get(code, []),
            winner_duration=winner_duration,
            p1_raw_dur=p1_raw_dur,
            prior_entries=official_classification,
            context=context,
        )
        official_classification.append(entry)

    final_laps = _assign_per_lap_positions(calibrated_by_driver, context)
    return final_laps, official_max_lap, official_winner, official_classification


def _format_sc_window_label(
    window_type: str, start_lap: int, end_lap: int
) -> str:
    """Formats a human-readable label for a Safety Car or VSC window.

    Args:
        window_type: Either ``"SC"`` or ``"VSC"``.
        start_lap: Starting lap number of the neutralization.
        end_lap: Ending lap number of the neutralization.

    Returns:
        Formatted window label string (e.g., ``"SC · L4–L7"`` or ``"VSC · L12"``).
    """
    if start_lap == end_lap:
        return f"{window_type} · L{start_lap}"
    return f"{window_type} · L{start_lap}–L{end_lap}"


def _parse_race_control_sc_windows(
    race_control_events: Sequence[Mapping[str, Any]],
    total_laps: int,
) -> list[dict[str, Any]]:
    """Parses raw SC/VSC deployment windows from OpenF1 ``/race_control`` messages.

    Args:
        race_control_events: Sequence of race control message dicts.
        total_laps: Total laps in the race session.

    Returns:
        Unmerged list of SC/VSC window dicts parsed from race control events.
    """
    windows: list[dict[str, Any]] = []
    active_type: str | None = None
    start_lap: int | None = None

    for event in race_control_events:
        cat = str(event.get("category", ""))
        msg = str(event.get("message", "")).upper()
        lap_num = event.get("lap_number")
        if lap_num is None:
            continue
        lap_int = max(1, min(total_laps, int(lap_num)))

        if cat != "SafetyCar" and "SAFETY CAR" not in msg and "VSC" not in msg:
            continue

        if "VSC DEPLOYED" in msg or "VIRTUAL SAFETY CAR DEPLOYED" in msg:
            if active_type is None:
                active_type = "VSC"
                start_lap = lap_int
        elif "SC DEPLOYED" in msg or (
            "SAFETY CAR DEPLOYED" in msg and "VIRTUAL" not in msg
        ):
            if active_type == "VSC" and start_lap is not None:
                vsc_end = max(start_lap, lap_int - 1)
                windows.append(
                    {
                        "type": "VSC",
                        "start_lap": start_lap,
                        "end_lap": vsc_end,
                        "label": f"VSC · L{start_lap}–L{vsc_end}",
                    }
                )
            active_type = "SC"
            start_lap = lap_int
        elif (
            "ENDING" in msg
            or "IN THIS LAP" in msg
            or "CLEAR" in msg
            or "DEPLOYED" not in msg
        ):
            if active_type is not None and start_lap is not None:
                end_lap = max(start_lap, lap_int)
                windows.append(
                    {
                        "type": active_type,
                        "start_lap": start_lap,
                        "end_lap": end_lap,
                        "label": _format_sc_window_label(
                            active_type, start_lap, end_lap
                        ),
                    }
                )
                active_type = None
                start_lap = None

    if active_type is not None and start_lap is not None:
        end_lap = min(total_laps, start_lap + _UNCLOSED_SC_WINDOW_EXTRA_LAPS)
        windows.append(
            {
                "type": active_type,
                "start_lap": start_lap,
                "end_lap": end_lap,
                "label": f"{active_type} · L{start_lap}–L{end_lap}",
            }
        )
    return windows


def _merge_adjacent_sc_windows(
    windows: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Merges overlapping or adjacent SC/VSC windows of the same type.

    Args:
        windows: Sequence of raw SC/VSC window dictionaries.

    Returns:
        Sorted list of merged SC/VSC window dictionaries.
    """
    merged: list[dict[str, Any]] = []
    for win in sorted(windows, key=lambda item: int(item["start_lap"])):
        win_copy = dict(win)
        if (
            merged
            and merged[-1]["type"] == win_copy["type"]
            and int(win_copy["start_lap"]) <= int(merged[-1]["end_lap"]) + 1
        ):
            merged[-1]["end_lap"] = max(
                int(merged[-1]["end_lap"]), int(win_copy["end_lap"])
            )
            s_lap = int(merged[-1]["start_lap"])
            e_lap = int(merged[-1]["end_lap"])
            w_type = str(merged[-1]["type"])
            merged[-1]["label"] = _format_sc_window_label(w_type, s_lap, e_lap)
        else:
            merged.append(win_copy)
    return merged


def _detect_fallback_sc_windows_from_laps(
    laps: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Detects SC/VSC windows from field-wide slow lap medians when race control is absent.

    Args:
        laps: Sequence of lap dictionaries.

    Returns:
        List of inferred SC/VSC window dictionaries.
    """
    valid_times = [
        float(lap["time"])
        for lap in laps
        if int(lap.get("lap", 0)) > 1 and float(lap.get("time", 0)) > 0
    ]
    if not valid_times:
        return []

    global_median = statistics.median(valid_times)
    by_lap: dict[int, list[float]] = defaultdict(list)
    for lap_rec in laps:
        lap_no = int(lap_rec.get("lap", 0))
        t_val = float(lap_rec.get("time", 0.0))
        if lap_no > 1 and t_val > 0:
            by_lap[lap_no].append(t_val)

    neutralized_laps: list[tuple[int, str]] = []
    for lap_no in sorted(by_lap.keys()):
        lap_med = statistics.median(by_lap[lap_no])
        if lap_med > global_median * _SC_LAP_TIME_RATIO_THRESHOLD:
            neutralized_laps.append((lap_no, "SC"))
        elif lap_med > global_median * _VSC_LAP_TIME_RATIO_THRESHOLD:
            neutralized_laps.append((lap_no, "VSC"))

    windows: list[dict[str, Any]] = []
    for lap_no, w_type in neutralized_laps:
        if (
            windows
            and windows[-1]["type"] == w_type
            and lap_no <= int(windows[-1]["end_lap"]) + 1
        ):
            windows[-1]["end_lap"] = lap_no
            s_lap = int(windows[-1]["start_lap"])
            windows[-1]["label"] = f"{w_type} · L{s_lap}–L{lap_no}"
        else:
            windows.append(
                {
                    "type": w_type,
                    "start_lap": lap_no,
                    "end_lap": lap_no,
                    "label": f"{w_type} · L{lap_no}",
                }
            )
    return windows


def _extract_sc_vsc_windows(
    race_control_events: Sequence[Mapping[str, Any]],
    laps: Sequence[Mapping[str, Any]],
    total_laps: int,
) -> list[dict[str, Any]]:
    """Extracts Safety Car (SC) and Virtual Safety Car (VSC) lap windows.

    Uses OpenF1 ``/race_control`` SafetyCar messages when available, or detects
    field-wide slow laps from ``laps`` when offline.

    Args:
        race_control_events: OpenF1 race control event records.
        laps: Processed lap records for the session.
        total_laps: Total number of laps in the session.

    Returns:
        List of SC/VSC window dictionaries with ``type``, ``start_lap``,
        ``end_lap``, and ``label`` keys.
    """
    rc_windows = _parse_race_control_sc_windows(race_control_events, total_laps)
    if rc_windows:
        return _merge_adjacent_sc_windows(rc_windows)
    return _detect_fallback_sc_windows_from_laps(laps)


def _compute_driver_baseline_pace(
    drivers: Sequence[Mapping[str, Any]],
    laps: Sequence[Mapping[str, Any]],
) -> dict[str, float]:
    """Computes each driver's clean baseline race pace from their fastest laps.

    Args:
        drivers: Sequence of driver metadata dictionaries.
        laps: Sequence of lap dictionaries.

    Returns:
        Mapping from three-letter driver code to baseline pace in seconds.
    """
    laps_by_driver: dict[str, list[float]] = defaultdict(list)
    for lap_record in laps:
        lap_time = float(lap_record.get("time", 0.0))
        if lap_time > 0 and not lap_record.get("interpolated", False):
            laps_by_driver[str(lap_record["driver"])].append(lap_time)

    for lap_record in laps:
        driver_code = str(lap_record["driver"])
        lap_time = float(lap_record.get("time", 0.0))
        if not laps_by_driver[driver_code] and lap_time > 0:
            laps_by_driver[driver_code].append(lap_time)

    all_clean_times = [t for times in laps_by_driver.values() for t in times]
    global_fallback = (
        min(all_clean_times) if all_clean_times else _DEFAULT_LAP_TIME_S
    )

    driver_pace: dict[str, float] = {}
    for idx, driver in enumerate(drivers):
        code = str(driver["code"])
        times = sorted(laps_by_driver.get(code, []))
        if times:
            sample_count = max(
                1, min(_MAX_PACE_SAMPLE_LAPS, len(times) // 3 or 1)
            )
            driver_pace[code] = sum(times[:sample_count]) / sample_count
        else:
            driver_pace[code] = (
                global_fallback
                + _PACE_FALLBACK_BASE_OFFSET_S
                + (idx * _PACE_FALLBACK_DRIVER_STEP_S)
            )

    return driver_pace


def _compute_team_corner_means(
    corners: Sequence[Mapping[str, Any]],
) -> dict[str, float]:
    """Computes each constructor's mean apex speed across all turns.

    Args:
        corners: Sequence of corner speed dictionaries.

    Returns:
        Mapping from team name to mean corner speed in km/h.
    """
    team_corner_means: dict[str, float] = defaultdict(float)
    team_corner_counts: dict[str, int] = defaultdict(int)
    for corner in corners:
        team_name = str(corner["team"])
        team_corner_means[team_name] += float(corner["speed"])
        team_corner_counts[team_name] += 1

    for team_name, count in team_corner_counts.items():
        if count > 0:
            team_corner_means[team_name] /= count
    return team_corner_means


def _extract_real_practice_metrics(
    openf1_practice_laps: Sequence[Mapping[str, Any]] | None,
    openf1_practice_stints: Sequence[Mapping[str, Any]] | None,
    openf1_practice_results: Sequence[Mapping[str, Any]] | None,
    num_to_code: Mapping[int, str] | None,
) -> _RealPracticeMetrics:
    """Extracts per-driver best laps, speed traps, positions, and stint counts from OpenF1 practice data.

    Args:
        openf1_practice_laps: Raw OpenF1 practice lap records, or None.
        openf1_practice_stints: Raw OpenF1 practice stint records, or None.
        openf1_practice_results: Official OpenF1 practice result records, or None.
        num_to_code: Mapping from driver number to three-letter code, or None.

    Returns:
        Populated ``_RealPracticeMetrics`` instance.
    """
    real_best_lap: dict[str, float] = {}
    official_prac_pos: dict[str, int] = {}
    real_speed_trap: dict[str, float] = {}
    real_comp_counts: dict[str, dict[str, int]] = defaultdict(
        lambda: {"SOFT": 0, "MEDIUM": 0, "HARD": 0}
    )

    if openf1_practice_laps and num_to_code:
        for lap_rec in openf1_practice_laps:
            d_num = lap_rec.get("driver_number")
            code = num_to_code.get(int(d_num)) if d_num is not None else None
            if not code:
                continue
            dur = lap_rec.get("lap_duration")
            if (
                dur is not None
                and _MIN_PRACTICE_LAP_S < float(dur) < _MAX_PRACTICE_LAP_S
            ):
                f_dur = float(dur)
                if code not in real_best_lap or f_dur < real_best_lap[code]:
                    real_best_lap[code] = f_dur
            for sp_key in ("st_speed", "i2_speed", "i1_speed"):
                sp_val = lap_rec.get(sp_key)
                if (
                    sp_val is not None
                    and _MIN_SPEED_TRAP_KMH
                    < float(sp_val)
                    < _MAX_SPEED_TRAP_KMH
                ):
                    if (
                        code not in real_speed_trap
                        or float(sp_val) > real_speed_trap[code]
                    ):
                        real_speed_trap[code] = float(sp_val)

    if openf1_practice_results and num_to_code:
        for res_row in openf1_practice_results:
            d_num = res_row.get("driver_number")
            code = num_to_code.get(int(d_num)) if d_num is not None else None
            if not code:
                continue
            pos = _parse_int_position(res_row.get("position"))
            if pos is not None:
                official_prac_pos[code] = pos
            dur = res_row.get("duration")
            if (
                isinstance(dur, (int, float))
                and _MIN_PRACTICE_LAP_S < float(dur) < _MAX_PRACTICE_LAP_S
            ):
                real_best_lap[code] = float(dur)

    if openf1_practice_stints and num_to_code:
        for stint_rec in openf1_practice_stints:
            d_num = stint_rec.get("driver_number")
            code = num_to_code.get(int(d_num)) if d_num is not None else None
            if not code:
                continue
            comp = str(stint_rec.get("compound") or "MEDIUM").upper()
            if comp not in _DRY_COMPOUNDS:
                comp = "MEDIUM"
            l_start = int(stint_rec.get("lap_start") or 1)
            l_end = int(stint_rec.get("lap_end") or l_start)
            count = max(1, l_end - l_start + 1)
            real_comp_counts[code][comp] += count

    return _RealPracticeMetrics(
        best_lap_by_code=real_best_lap,
        official_pos_by_code=official_prac_pos,
        speed_trap_by_code=real_speed_trap,
        compound_counts_by_code=real_comp_counts,
    )


def _extract_real_practice_stint_laps(
    driver: Mapping[str, Any],
    pace_ratio: float,
    long_run_compound: str,
    stint_len: int,
    circuit_ctx: _PracticeCircuitContext,
) -> tuple[list[dict[str, Any]], list[float]]:
    """Generates representative long-run and short-run practice stint laps for a driver.

    Args:
        driver: Driver metadata mapping.
        pace_ratio: Driver pace delta relative to the fastest baseline driver.
        long_run_compound: Selected primary long-run tyre compound.
        stint_len: Number of laps in the long-run stint.
        circuit_ctx: Circuit and degradation context.

    Returns:
        Tuple of ``(driver_stint_laps, driver_long_run_times)``.
    """
    code = str(driver["code"])
    team = str(driver["team"])
    color = str(driver["color"])
    seed_key = f"{circuit_ctx.gp_name}_{code}_practice"

    long_run_base = (
        circuit_ctx.practice_pole_base
        + 3.65
        + (pace_ratio * 0.82)
        + circuit_ctx.compound_offsets[long_run_compound]
    )

    driver_stint_laps: list[dict[str, Any]] = []
    driver_long_run_times: list[float] = []
    for tyre_age in range(1, stint_len + 1):
        lap_noise = (
            math.sin(tyre_age * 1.7 + _deterministic_hash(seed_key) % 13) * 0.16
        )
        lap_val = round(
            long_run_base
            + (tyre_age * circuit_ctx.deg_rates[long_run_compound])
            + lap_noise,
            _TIME_DECIMALS,
        )
        driver_long_run_times.append(lap_val)
        driver_stint_laps.append(
            {
                "driver": code,
                "team": team,
                "color": color,
                "compound": long_run_compound,
                "tyre_life": tyre_age,
                "time": lap_val,
            }
        )

    soft_stint_base = circuit_ctx.practice_pole_base + 3.05 + (pace_ratio * 0.85)
    for tyre_age in range(1, 8):
        lap_noise = (
            math.cos(tyre_age * 1.3 + _deterministic_hash(seed_key) % 11) * 0.14
        )
        driver_stint_laps.append(
            {
                "driver": code,
                "team": team,
                "color": color,
                "compound": "SOFT",
                "tyre_life": tyre_age,
                "time": round(
                    soft_stint_base
                    + (tyre_age * circuit_ctx.deg_rates["SOFT"])
                    + lap_noise,
                    _TIME_DECIMALS,
                ),
            }
        )

    return driver_stint_laps, driver_long_run_times


def _build_practice_driver_entry(
    driver: Mapping[str, Any],
    driver_pace: Mapping[str, float],
    metrics: _RealPracticeMetrics,
    circuit_ctx: _PracticeCircuitContext,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Builds a single driver's practice classification entry and stint lap records.

    Args:
        driver: Driver metadata mapping.
        driver_pace: Baseline pace per driver code.
        metrics: Real practice metrics extracted from OpenF1.
        circuit_ctx: Practice circuit and tyre degradation parameters.

    Returns:
        Tuple of ``(classification_entry, driver_stint_laps)``.
    """
    code = str(driver["code"])
    team = str(driver["team"])
    color = str(driver["color"])
    seed_key = f"{circuit_ctx.gp_name}_{code}_practice"

    pace_ratio = (
        driver_pace.get(code, circuit_ctx.fastest_baseline + 1.5)
        - circuit_ctx.fastest_baseline
    )
    practice_jitter = (_seeded_unit_float(seed_key) - 0.45) * 0.42
    best_lap = round(
        metrics.best_lap_by_code.get(
            code,
            circuit_ctx.practice_pole_base
            + (pace_ratio * 0.88)
            + max(-0.18, practice_jitter),
        ),
        _TIME_DECIMALS,
    )

    u_comp = _seeded_unit_float(f"{seed_key}_comp")
    best_compound = (
        "SOFT" if u_comp < 0.78 else ("MEDIUM" if u_comp < 0.93 else "HARD")
    )

    c_counts = metrics.compound_counts_by_code.get(code)
    if c_counts and sum(c_counts.values()) >= _MIN_REAL_COMPOUND_LAPS_SUM:
        soft_laps = max(4, c_counts["SOFT"])
        medium_laps = max(6, c_counts["MEDIUM"])
        hard_laps = max(4, c_counts["HARD"])
    else:
        soft_laps = 12 + int(_seeded_unit_float(f"{seed_key}_s") * 10)
        medium_laps = 18 + int(_seeded_unit_float(f"{seed_key}_m") * 12)
        hard_laps = 10 + int(_seeded_unit_float(f"{seed_key}_h") * 12)

    total_laps = soft_laps + medium_laps + hard_laps
    short_run_laps = soft_laps + int(medium_laps * 0.25)
    long_run_laps = max(6, total_laps - short_run_laps)

    team_mean_corner = circuit_ctx.team_corner_means.get(
        team, circuit_ctx.base_speed
    )
    driver_corner_offset = (_seeded_unit_float(f"{seed_key}_corner") - 0.5) * 1.8
    mean_corner_kmh = round(
        team_mean_corner + driver_corner_offset, _SPEED_DECIMALS
    )

    aero_trim = (_seeded_unit_float(f"{seed_key}_aero") - 0.5) * 6.5
    fallback_trap = (
        _circuit_top_speed_from_pace(
            circuit_ctx.circuit_top_speed_base,
            circuit_ctx.fastest_baseline,
            driver_pace.get(code, circuit_ctx.fastest_baseline),
            aero_trim,
        )
    )
    speed_trap_kmh = round(
        metrics.speed_trap_by_code.get(code, fallback_trap), _SPEED_DECIMALS
    )

    long_run_compound = (
        "MEDIUM" if _seeded_unit_float(f"{seed_key}_lrc") < 0.65 else "HARD"
    )
    stint_len = 10 + int(_seeded_unit_float(f"{seed_key}_lrlen") * 5)

    driver_stint_laps, driver_long_run_times = _extract_real_practice_stint_laps(
        driver=driver,
        pace_ratio=pace_ratio,
        long_run_compound=long_run_compound,
        stint_len=stint_len,
        circuit_ctx=circuit_ctx,
    )

    sorted_lr = sorted(driver_long_run_times)
    q25_idx = max(0, len(sorted_lr) // 4)
    q75_idx = min(len(sorted_lr) - 1, (len(sorted_lr) * 3) // 4)

    entry = {
        "driver": code,
        "name": str(driver.get("name", code)),
        "team": team,
        "color": color,
        "best_lap": best_lap,
        "compound": best_compound,
        "total_laps": total_laps,
        "short_run_laps": short_run_laps,
        "long_run_laps": long_run_laps,
        "compound_laps": {
            "SOFT": soft_laps,
            "MEDIUM": medium_laps,
            "HARD": hard_laps,
        },
        "speed_trap_kmh": speed_trap_kmh,
        "mean_corner_kmh": mean_corner_kmh,
        "long_run_compound": long_run_compound,
        "long_run_avg": round(
            statistics.mean(driver_long_run_times), _TIME_DECIMALS
        ),
        "long_run_q25": round(sorted_lr[q25_idx], _TIME_DECIMALS),
        "long_run_q75": round(sorted_lr[q75_idx], _TIME_DECIMALS),
    }
    return entry, driver_stint_laps


def _circuit_top_speed_from_pace(
    circuit_top_speed_base: float,
    fastest_baseline: float,
    driver_baseline: float,
    aero_trim: float,
) -> float:
    """Computes a driver's fallback practice speed-trap reading in km/h.

    Args:
        circuit_top_speed_base: Baseline top speed for the circuit.
        fastest_baseline: Fastest driver baseline pace in the field.
        driver_baseline: Target driver's baseline pace.
        aero_trim: Seeded aerodynamic trim offset.

    Returns:
        Unrounded speed trap estimate in km/h.
    """
    return (
        circuit_top_speed_base
        + (fastest_baseline / max(driver_baseline, 60.0) - 1.0) * 35.0
        - (aero_trim * 0.55)
    )


def _build_degradation_slopes(
    practice_pole_base: float,
    deg_rates: Mapping[str, float],
    compound_offsets: Mapping[str, float],
) -> list[dict[str, Any]]:
    """Builds predicted tyre degradation slope curves for SOFT, MEDIUM, and HARD compounds.

    Args:
        practice_pole_base: Fastest practice lap time baseline.
        deg_rates: Per-compound degradation rate in seconds/lap.
        compound_offsets: Per-compound base lap time offset in seconds.

    Returns:
        List of degradation slope dictionaries with ``curve_points``.
    """
    degradation_slopes: list[dict[str, Any]] = []
    for comp in _DRY_COMPOUNDS:
        comp_base = round(
            practice_pole_base + 3.25 + compound_offsets[comp], _TIME_DECIMALS
        )
        slope = deg_rates[comp]
        curve_points = [
            {
                "tyre_life": age,
                "predicted_time": round(comp_base + age * slope, _TIME_DECIMALS),
            }
            for age in range(1, _DEGRADATION_CURVE_MAX_AGE + 1)
        ]
        degradation_slopes.append(
            {
                "compound": comp,
                "slope_sec_per_lap": slope,
                "base_time": comp_base,
                "r2": round(0.91 - (slope * 0.4), 2),
                "curve_points": curve_points,
            }
        )
    return degradation_slopes


def _build_practice_telemetry(
    gp_name: str,
    drivers: Sequence[Mapping[str, Any]],
    driver_pace: Mapping[str, float],
    track_profile: Mapping[str, int],
    corners: Sequence[Mapping[str, Any]],
    openf1_practice_laps: Sequence[Mapping[str, Any]] | None = None,
    openf1_practice_stints: Sequence[Mapping[str, Any]] | None = None,
    openf1_practice_results: Sequence[Mapping[str, Any]] | None = None,
    num_to_code: Mapping[int, str] | None = None,
) -> dict[str, Any]:
    """Generates the ``practice`` telemetry block using real OpenF1 practice data when available.

    Args:
        gp_name: Display name of the Grand Prix.
        drivers: Sequence of driver metadata dictionaries.
        driver_pace: Baseline pace per driver code.
        track_profile: Circuit profile with ``turns``, ``base_speed``, and ``variation``.
        corners: Corner speed records for the circuit.
        openf1_practice_laps: Optional OpenF1 practice lap records.
        openf1_practice_stints: Optional OpenF1 practice stint records.
        openf1_practice_results: Optional OpenF1 practice session_result records.
        num_to_code: Optional driver number to code mapping.

    Returns:
        Practice telemetry dictionary containing ``classification``,
        ``stint_laps``, and ``degradation_slopes``.
    """
    fastest_baseline = (
        min(driver_pace.values()) if driver_pace else _DEFAULT_LAP_TIME_S
    )
    practice_pole_base = fastest_baseline * _PRACTICE_POLE_RATIO
    team_corner_means = _compute_team_corner_means(corners)

    base_speed = float(track_profile.get("base_speed", _DEFAULT_BASE_SPEED_KMH))
    variation = float(
        track_profile.get("variation", _DEFAULT_SPEED_VARIATION_KMH)
    )
    circuit_top_speed_base = 292.0 + (base_speed * 0.22) + (variation * 0.12)

    metrics = _extract_real_practice_metrics(
        openf1_practice_laps=openf1_practice_laps,
        openf1_practice_stints=openf1_practice_stints,
        openf1_practice_results=openf1_practice_results,
        num_to_code=num_to_code,
    )
    if metrics.best_lap_by_code:
        practice_pole_base = min(metrics.best_lap_by_code.values())

    deg_rates = {
        "SOFT": round(0.078 + (variation / 2500.0), _TIME_DECIMALS),
        "MEDIUM": round(0.049 + (variation / 3500.0), _TIME_DECIMALS),
        "HARD": round(0.029 + (variation / 5000.0), _TIME_DECIMALS),
    }

    circuit_ctx = _PracticeCircuitContext(
        gp_name=gp_name,
        fastest_baseline=fastest_baseline,
        practice_pole_base=practice_pole_base,
        base_speed=base_speed,
        circuit_top_speed_base=circuit_top_speed_base,
        team_corner_means=team_corner_means,
        deg_rates=deg_rates,
        compound_offsets=_COMPOUND_OFFSETS_S,
    )

    raw_entries: list[dict[str, Any]] = []
    stint_laps: list[dict[str, Any]] = []
    for driver in drivers:
        entry, drv_stint_laps = _build_practice_driver_entry(
            driver=driver,
            driver_pace=driver_pace,
            metrics=metrics,
            circuit_ctx=circuit_ctx,
        )
        raw_entries.append(entry)
        stint_laps.extend(drv_stint_laps)

    if metrics.official_pos_by_code:
        raw_entries.sort(
            key=lambda item: (
                metrics.official_pos_by_code.get(
                    str(item["driver"]), _UNRANKED_POSITION
                ),
                float(item["best_lap"]),
            )
        )
    else:
        raw_entries.sort(key=lambda item: float(item["best_lap"]))

    p1_best = (
        float(raw_entries[0]["best_lap"]) if raw_entries else practice_pole_base
    )
    for idx, entry in enumerate(raw_entries):
        entry["rank"] = idx + 1
        entry["gap_to_p1"] = round(
            max(0.0, float(entry["best_lap"]) - p1_best), _TIME_DECIMALS
        )

    degradation_slopes = _build_degradation_slopes(
        practice_pole_base=practice_pole_base,
        deg_rates=deg_rates,
        compound_offsets=_COMPOUND_OFFSETS_S,
    )

    return {
        "classification": raw_entries,
        "stint_laps": stint_laps,
        "degradation_slopes": degradation_slopes,
    }


def _build_qualifying_telemetry_traces(
    gp_name: str,
    results: Sequence[Mapping[str, Any]],
    track_profile: Mapping[str, int],
) -> dict[str, Any]:
    """Generates normalized 0-100% lap distance telemetry traces for Qualifying.

    Args:
        gp_name: Display name of the Grand Prix.
        results: Ordered qualifying result records.
        track_profile: Circuit profile with ``turns``, ``base_speed``, and ``variation``.

    Returns:
        Dictionary containing ``distance_pct``, ``turns``, and per-driver trace arrays.
    """
    distance_pct = [i * 2 for i in range(_TRACE_POINTS_COUNT)]
    num_turns = int(track_profile.get("turns", _DEFAULT_TURNS_COUNT))
    base_speed = float(track_profile.get("base_speed", _DEFAULT_BASE_SPEED_KMH))
    variation = float(
        track_profile.get("variation", _DEFAULT_SPEED_VARIATION_KMH)
    )

    turns_meta: list[dict[str, Any]] = []
    for t_idx in range(1, num_turns + 1):
        pct = round((t_idx / (num_turns + 1)) * 92.0 + 4.0, 1)
        apex_speed = base_speed + math.sin(t_idx * 1.3) * (variation * 0.85)
        turns_meta.append(
            {
                "turn": t_idx,
                "pct": pct,
                "apex_speed": round(max(78.0, min(265.0, apex_speed)), 1),
            }
        )

    pole_time = (
        float(results[0]["best_time"]) if results else _DEFAULT_POLE_TIME_S
    )
    drivers_traces: dict[str, dict[str, list[float]]] = {}

    for res in results:
        code = str(res["driver"])
        best_time = float(res["best_time"])
        total_delta = best_time - pole_time
        seed_num = _deterministic_hash(f"{gp_name}_{code}_trace")

        speed_arr: list[float] = []
        throttle_arr: list[float] = []
        brake_arr: list[float] = []
        cum_time_arr: list[float] = []

        for idx, pct in enumerate(distance_pct):
            frac = pct / 100.0
            min_dist = 100.0
            nearest_apex_speed = base_speed
            for turn_info in turns_meta:
                dist = abs(pct - float(turn_info["pct"]))
                if dist < min_dist:
                    min_dist = dist
                    nearest_apex_speed = float(turn_info["apex_speed"])

            corner_factor = math.exp(-((min_dist / 3.8) ** 2))
            straight_top = 312.0 + (base_speed * 0.14) - (total_delta * 2.2)
            driver_wave = math.sin(frac * math.pi * 6.0 + (seed_num % 17)) * 2.4
            inst_speed = (
                straight_top * (1.0 - corner_factor)
                + (nearest_apex_speed - total_delta * 1.8) * corner_factor
                + driver_wave
            )
            inst_speed = round(
                max(75.0, min(352.0, inst_speed)), _SPEED_DECIMALS
            )

            throttle = round(
                max(
                    12.0,
                    min(
                        100.0,
                        100.0
                        - corner_factor * (78.0 - (nearest_apex_speed / 5.0))
                        + math.cos(idx + seed_num % 7) * 3.0,
                    ),
                ),
                1,
            )
            brake = round(
                max(
                    0.0,
                    min(
                        100.0,
                        corner_factor * (95.0 - (nearest_apex_speed / 4.2))
                        if corner_factor > 0.32
                        else 0.0,
                    ),
                ),
                1,
            )

            if idx == 0:
                cum_t = 0.0
            elif idx == _TRACE_POINTS_COUNT - 1:
                cum_t = round(best_time, _TIME_DECIMALS)
            else:
                local_variation = (
                    math.sin(frac * math.pi * 3.0 + (seed_num % 19))
                    * 0.045
                    * (1.0 + total_delta * 0.25)
                )
                cum_t = round(
                    (pole_time * frac) + (total_delta * frac) + local_variation,
                    _TIME_DECIMALS,
                )

            speed_arr.append(inst_speed)
            throttle_arr.append(throttle)
            brake_arr.append(brake)
            cum_time_arr.append(cum_t)

        drivers_traces[code] = {
            "speed": speed_arr,
            "throttle": throttle_arr,
            "brake": brake_arr,
            "cum_time": cum_time_arr,
        }

    return {
        "distance_pct": distance_pct,
        "turns": [{"turn": t["turn"], "pct": t["pct"]} for t in turns_meta],
        "drivers": drivers_traces,
    }


_build_qualifying_traces = _build_qualifying_telemetry_traces


def _extract_real_qualifying_metrics(
    drivers: Sequence[Mapping[str, Any]],
    pole_target: float,
    openf1_quali_laps: Sequence[Mapping[str, Any]] | None,
    openf1_quali_rc: Sequence[Mapping[str, Any]] | None,
    openf1_quali_results: Sequence[Mapping[str, Any]] | None,
    num_to_code: Mapping[int, str] | None,
) -> _RealQualifyingMetrics:
    """Extracts Q1/Q2/Q3 times, official positions, and sector splits from OpenF1 qualifying data.

    Args:
        drivers: Sequence of driver metadata dictionaries.
        pole_target: Fallback pole lap time target in seconds.
        openf1_quali_laps: Raw OpenF1 qualifying lap records, or None.
        openf1_quali_rc: Raw OpenF1 qualifying race_control records, or None.
        openf1_quali_results: Official OpenF1 qualifying session_result records, or None.
        num_to_code: Mapping from driver number to three-letter code, or None.

    Returns:
        Populated ``_RealQualifyingMetrics`` instance.
    """
    real_q_times: dict[str, dict[int, float | None]] = {
        str(d["code"]): {1: None, 2: None, 3: None} for d in drivers
    }
    official_quali_pos: dict[str, int] = {}
    real_best_sectors: dict[str, dict[str, float]] = {
        str(d["code"]): {} for d in drivers
    }
    real_lap_sectors: dict[str, tuple[float | None, float | None, float | None]] = {}

    if openf1_quali_laps and num_to_code:
        phase_starts: dict[int, str] = {}
        for event in openf1_quali_rc or []:
            qp = event.get("qualifying_phase")
            if qp in (1, 2, 3) and event.get("message") == "SESSION STARTED":
                if int(qp) not in phase_starts:
                    phase_starts[int(qp)] = str(event["date"])

        valid_durations = [
            float(lap["lap_duration"])
            for lap in openf1_quali_laps
            if lap.get("lap_duration") is not None
            and _MIN_QUALI_LAP_S < float(lap["lap_duration"]) < _MAX_QUALI_LAP_S
        ]
        min_session_lap = (
            min(valid_durations) if valid_durations else pole_target
        )
        max_flying_lap = min_session_lap * _QUALI_FLYING_LAP_RATIO

        for lap_rec in openf1_quali_laps:
            d_num = lap_rec.get("driver_number")
            code = num_to_code.get(int(d_num)) if d_num is not None else None
            if not code or code not in real_q_times:
                continue

            for s_idx, s_field in enumerate(
                ("duration_sector_1", "duration_sector_2", "duration_sector_3"),
                start=1,
            ):
                s_val = lap_rec.get(s_field)
                if (
                    s_val is not None
                    and _MIN_SECTOR_TIME_S < float(s_val) < _MAX_SECTOR_TIME_S
                ):
                    s_key = f"s{s_idx}"
                    if (
                        s_key not in real_best_sectors[code]
                        or float(s_val) < real_best_sectors[code][s_key]
                    ):
                        real_best_sectors[code][s_key] = float(s_val)

            dur = lap_rec.get("lap_duration")
            ds = str(lap_rec.get("date_start") or "")
            if (
                dur is None
                or float(dur) <= _MIN_QUALI_LAP_S
                or float(dur) > max_flying_lap
            ):
                continue
            f_dur = round(float(dur), _TIME_DECIMALS)

            if phase_starts.get(3) and ds >= phase_starts[3]:
                phase = 3
            elif phase_starts.get(2) and ds >= phase_starts[2]:
                phase = 2
            else:
                phase = 1

            prev_best = real_q_times[code][phase]
            if prev_best is None or f_dur < prev_best:
                real_q_times[code][phase] = f_dur
                if (
                    phase == 3
                    or (phase == 2 and real_q_times[code][3] is None)
                    or (
                        phase == 1
                        and real_q_times[code][2] is None
                        and real_q_times[code][3] is None
                    )
                ):
                    real_lap_sectors[code] = (
                        float(lap_rec["duration_sector_1"])
                        if lap_rec.get("duration_sector_1") is not None
                        else None,
                        float(lap_rec["duration_sector_2"])
                        if lap_rec.get("duration_sector_2") is not None
                        else None,
                        float(lap_rec["duration_sector_3"])
                        if lap_rec.get("duration_sector_3") is not None
                        else None,
                    )

    if openf1_quali_results and num_to_code:
        for res_row in openf1_quali_results:
            d_num = res_row.get("driver_number")
            code = num_to_code.get(int(d_num)) if d_num is not None else None
            if not code or code not in real_q_times:
                continue
            pos = _parse_int_position(res_row.get("position"))
            if pos is not None:
                official_quali_pos[code] = pos
            dur_val = res_row.get("duration")
            if isinstance(dur_val, list):
                for phase_idx in range(min(3, len(dur_val))):
                    stage_t = dur_val[phase_idx]
                    if (
                        isinstance(stage_t, (int, float))
                        and _MIN_QUALI_LAP_S
                        < float(stage_t)
                        < _MAX_QUALI_RESULT_LAP_S
                    ):
                        real_q_times[code][phase_idx + 1] = round(
                            float(stage_t), _TIME_DECIMALS
                        )
                    elif stage_t is None:
                        real_q_times[code][phase_idx + 1] = None

    has_real_quali = bool(official_quali_pos) or any(
        qt[3] is not None or qt[2] is not None or qt[1] is not None
        for qt in real_q_times.values()
    )

    return _RealQualifyingMetrics(
        q_times_by_code=real_q_times,
        official_pos_by_code=official_quali_pos,
        best_sectors_by_code=real_best_sectors,
        lap_sectors_by_code=real_lap_sectors,
        has_real_quali=has_real_quali,
    )


def _order_qualifying_drivers(
    drivers: Sequence[Mapping[str, Any]],
    driver_pace: Mapping[str, float],
    fastest_baseline: float,
    race_laps: Sequence[Mapping[str, Any]],
    metrics: _RealQualifyingMetrics,
) -> list[Mapping[str, Any]]:
    """Orders drivers for the qualifying classification from P1 to last.

    Args:
        drivers: Sequence of driver metadata dictionaries.
        driver_pace: Baseline pace per driver code.
        fastest_baseline: Fastest baseline pace across all drivers.
        race_laps: Race lap records used for Lap 1 grid fallback when offline.
        metrics: Extracted real qualifying metrics.

    Returns:
        Ordered list of driver metadata mappings.
    """
    if metrics.official_pos_by_code:

        def _official_quali_sort_key(
            drv: Mapping[str, Any],
        ) -> tuple[int, int, float]:
            code = str(drv["code"])
            pos = metrics.official_pos_by_code.get(code)
            if pos is not None:
                return (0, pos, 0.0)
            qt = metrics.q_times_by_code.get(code, {1: None, 2: None, 3: None})
            best_q = (
                qt[3]
                or qt[2]
                or qt[1]
                or driver_pace.get(code, float(_UNCLASSIFIED_SORT_POSITION))
            )
            return (1, _UNCLASSIFIED_SORT_POSITION, float(best_q))

        return sorted(drivers, key=_official_quali_sort_key)

    if metrics.has_real_quali:

        def _quali_sort_key(drv: Mapping[str, Any]) -> tuple[int, float]:
            code = str(drv["code"])
            qt = metrics.q_times_by_code.get(code, {1: None, 2: None, 3: None})
            if qt[3] is not None:
                return (0, float(qt[3]))
            if qt[2] is not None:
                return (1, float(qt[2]))
            if qt[1] is not None:
                return (2, float(qt[1]))
            return (
                3,
                driver_pace.get(code, float(_UNCLASSIFIED_SORT_POSITION)),
            )

        return sorted(drivers, key=_quali_sort_key)

    lap1_pos: dict[str, int] = {}
    for lap_rec in race_laps:
        if int(lap_rec.get("lap", 0)) == 1 and lap_rec.get("position") is not None:
            lap1_pos[str(lap_rec["driver"])] = int(lap_rec["position"])

    return sorted(
        drivers,
        key=lambda drv: (
            lap1_pos.get(str(drv["code"]), _UNRANKED_POSITION),
            driver_pace.get(str(drv["code"]), fastest_baseline + 2.0),
        ),
    )


def _resolve_driver_stage_times(
    code: str,
    idx: int,
    grid_pos: int,
    seed_base: str,
    synth_ctx: _QualifyingSynthesisContext,
) -> tuple[str, float | None, float | None, float | None, float]:
    """Resolves Q1, Q2, Q3, best_time, and elimination stage for a single driver.

    Args:
        code: Three-letter driver code.
        idx: 0-based grid index.
        grid_pos: 1-based grid position.
        seed_base: Deterministic hash seed prefix for the driver and session.
        synth_ctx: Qualifying synthesis context.

    Returns:
        Tuple of ``(eliminated_in, q1_time, q2_time, q3_time, best_time)``.
    """
    qt = synth_ctx.metrics.q_times_by_code.get(
        code, {1: None, 2: None, 3: None}
    )
    pole_target = synth_ctx.pole_target
    stage_prefix = synth_ctx.stage_prefix

    if synth_ctx.metrics.has_real_quali and (
        qt[1] is not None or qt[2] is not None or qt[3] is not None
    ):
        q1_time = qt[1]
        q2_time = qt[2] if grid_pos <= _Q2_CUTOFF_RANK else None
        q3_time = qt[3] if grid_pos <= _Q3_CUTOFF_RANK else None

        if grid_pos <= _Q3_CUTOFF_RANK:
            eliminated_in = f"{stage_prefix}3"
            best_time = float(q3_time or q2_time or q1_time or pole_target)
            if q3_time is None:
                q3_time = best_time
            if q2_time is None:
                q2_time = round(best_time + 0.25, _TIME_DECIMALS)
            if q1_time is None:
                q1_time = round(q2_time + 0.35, _TIME_DECIMALS)
        elif grid_pos <= _Q2_CUTOFF_RANK:
            eliminated_in = f"{stage_prefix}2"
            best_time = float(q2_time or q1_time or (pole_target + 1.2))
            q3_time = None
            if q2_time is None:
                q2_time = best_time
            if q1_time is None:
                q1_time = round(q2_time + 0.28, _TIME_DECIMALS)
        else:
            eliminated_in = f"{stage_prefix}1"
            q3_time = None
            q2_time = None
            best_time = float(
                q1_time
                or round(
                    pole_target + 1.85 + (grid_pos - _Q2_CUTOFF_RANK) * 0.14,
                    _TIME_DECIMALS,
                )
            )
            q1_time = best_time
        return eliminated_in, q1_time, q2_time, q3_time, best_time

    gap_base = idx * 0.082 + _seeded_unit_float(f"{seed_base}_gap") * 0.04
    if grid_pos <= _Q3_CUTOFF_RANK:
        eliminated_in = f"{stage_prefix}3"
        q3_time = round(pole_target + gap_base, _TIME_DECIMALS)
        q2_time = round(
            max(
                q3_time + 0.08,
                pole_target
                + 0.36
                + (idx * 0.048)
                + _seeded_unit_float(f"{seed_base}_q2") * 0.09,
            ),
            _TIME_DECIMALS,
        )
        q1_time = round(
            max(
                q2_time + 0.12,
                pole_target
                + 0.72
                + (idx * 0.052)
                + _seeded_unit_float(f"{seed_base}_q1") * 0.12,
            ),
            _TIME_DECIMALS,
        )
        best_time = q3_time
    elif grid_pos <= _Q2_CUTOFF_RANK:
        eliminated_in = f"{stage_prefix}2"
        q3_time = None
        q2_time = round(
            pole_target + 0.96 + ((grid_pos - _Q3_CUTOFF_RANK) * 0.095),
            _TIME_DECIMALS,
        )
        q1_time = round(
            max(
                q2_time + 0.11,
                pole_target
                + 1.12
                + ((grid_pos - _Q3_CUTOFF_RANK) * 0.085)
                + _seeded_unit_float(f"{seed_base}_q1") * 0.11,
            ),
            _TIME_DECIMALS,
        )
        best_time = q2_time
    else:
        eliminated_in = f"{stage_prefix}1"
        q3_time = None
        q2_time = None
        q1_time = round(
            pole_target + 1.65 + ((grid_pos - _Q2_CUTOFF_RANK) * 0.125),
            _TIME_DECIMALS,
        )
        best_time = q1_time

    return eliminated_in, q1_time, q2_time, q3_time, best_time


def _resolve_driver_sectors(
    code: str,
    best_time: float,
    seed_base: str,
    synth_ctx: _QualifyingSynthesisContext,
) -> tuple[float, float, float, float, float, float]:
    """Computes best-lap sectors and personal-best ideal sectors for a driver.

    Args:
        code: Three-letter driver code.
        best_time: Driver's best qualifying lap duration.
        seed_base: Deterministic hash seed prefix.
        synth_ctx: Qualifying synthesis context.

    Returns:
        Tuple of ``(s1, s2, s3, ideal_s1, ideal_s2, ideal_s3)``.
    """
    raw_s1, raw_s2, raw_s3 = synth_ctx.metrics.lap_sectors_by_code.get(
        code, (None, None, None)
    )
    if (
        raw_s1 is not None
        and raw_s2 is not None
        and raw_s3 is not None
        and abs((raw_s1 + raw_s2 + raw_s3) - best_time) < _SECTOR_SUM_TOLERANCE_S
    ):
        s1 = round(raw_s1, _TIME_DECIMALS)
        s2 = round(raw_s2, _TIME_DECIMALS)
        s3 = round(best_time - s1 - s2, _TIME_DECIMALS)
    else:
        s1_jitter = (_seeded_unit_float(f"{seed_base}_s1") - 0.5) * 0.08
        s2_jitter = (_seeded_unit_float(f"{seed_base}_s2") - 0.5) * 0.09
        s1 = round(best_time * synth_ctx.s1_ratio + s1_jitter, _TIME_DECIMALS)
        s2 = round(best_time * synth_ctx.s2_ratio + s2_jitter, _TIME_DECIMALS)
        s3 = round(best_time - s1 - s2, _TIME_DECIMALS)

    pbs = synth_ctx.metrics.best_sectors_by_code.get(code, {})
    ideal_s1 = round(min(s1, pbs.get("s1", s1)), _TIME_DECIMALS)
    ideal_s2 = round(min(s2, pbs.get("s2", s2)), _TIME_DECIMALS)
    ideal_s3 = round(min(s3, pbs.get("s3", s3)), _TIME_DECIMALS)

    if ideal_s1 == s1 and ideal_s2 == s2 and ideal_s3 == s3:
        if _seeded_unit_float(f"{seed_base}_yl1") > 0.62:
            ideal_s1 = round(
                s1 - (0.012 + _seeded_unit_float(f"{seed_base}_l1") * 0.042),
                _TIME_DECIMALS,
            )
        if _seeded_unit_float(f"{seed_base}_yl2") > 0.55:
            ideal_s2 = round(
                s2 - (0.015 + _seeded_unit_float(f"{seed_base}_l2") * 0.048),
                _TIME_DECIMALS,
            )
        if ideal_s1 == s1 and ideal_s2 == s2:
            ideal_s3 = round(
                s3 - (0.014 + _seeded_unit_float(f"{seed_base}_l3") * 0.038),
                _TIME_DECIMALS,
            )

    return s1, s2, s3, ideal_s1, ideal_s2, ideal_s3


def _build_qualifying_results_rows(
    ordered_drivers: Sequence[Mapping[str, Any]],
    synth_ctx: _QualifyingSynthesisContext,
) -> list[dict[str, Any]]:
    """Builds the ordered list of per-driver qualifying result rows.

    Args:
        ordered_drivers: Drivers sorted by qualifying classification order.
        synth_ctx: Qualifying synthesis context.

    Returns:
        List of qualifying result dictionaries.
    """
    results: list[dict[str, Any]] = []
    for idx, driver in enumerate(ordered_drivers):
        grid_pos = idx + 1
        code = str(driver["code"])
        team = str(driver["team"])
        color = str(driver["color"])
        seed_base = f"{synth_ctx.gp_name}_{code}_{synth_ctx.stage_prefix}"

        eliminated_in, q1_time, q2_time, q3_time, best_time = (
            _resolve_driver_stage_times(
                code=code,
                idx=idx,
                grid_pos=grid_pos,
                seed_base=seed_base,
                synth_ctx=synth_ctx,
            )
        )
        s1, s2, s3, ideal_s1, ideal_s2, ideal_s3 = _resolve_driver_sectors(
            code=code,
            best_time=best_time,
            seed_base=seed_base,
            synth_ctx=synth_ctx,
        )

        ideal_lap = round(ideal_s1 + ideal_s2 + ideal_s3, _TIME_DECIMALS)
        time_left = round(max(0.0, best_time - ideal_lap), _TIME_DECIMALS)

        results.append(
            {
                "driver": code,
                "name": str(driver.get("name", code)),
                "team": team,
                "color": color,
                "grid_pos": grid_pos,
                "eliminated_in": eliminated_in,
                "q1_time": q1_time,
                "q2_time": q2_time,
                "q3_time": q3_time,
                "best_time": best_time,
                "gap_to_pole": 0.0,
                "compound": "SOFT",
                "s1": s1,
                "s2": s2,
                "s3": s3,
                "ideal_s1": ideal_s1,
                "ideal_s2": ideal_s2,
                "ideal_s3": ideal_s3,
                "s1_status": (
                    "yellow"
                    if s1 > ideal_s1 + _YELLOW_SECTOR_TOLERANCE_S
                    else "green"
                ),
                "s2_status": (
                    "yellow"
                    if s2 > ideal_s2 + _YELLOW_SECTOR_TOLERANCE_S
                    else "green"
                ),
                "s3_status": (
                    "yellow"
                    if s3 > ideal_s3 + _YELLOW_SECTOR_TOLERANCE_S
                    else "green"
                ),
                "ideal_lap": ideal_lap,
                "time_left_on_table": time_left,
            }
        )
    return results


def _assign_fia_sector_statuses(
    results: list[dict[str, Any]],
    pole_target: float,
) -> float:
    """Computes pole gaps and marks session-best sectors as ``"purple"``.

    Args:
        results: Mutable list of qualifying result dictionaries.
        pole_target: Fallback pole time if ``results`` is empty.

    Returns:
        Resolved pole lap time in seconds.
    """
    if not results:
        return pole_target

    pole_time = float(results[0]["best_time"])
    min_s1 = min(float(r["s1"]) for r in results)
    min_s2 = min(float(r["s2"]) for r in results)
    min_s3 = min(float(r["s3"]) for r in results)

    for row in results:
        row["gap_to_pole"] = round(
            float(row["best_time"]) - pole_time, _TIME_DECIMALS
        )
        if abs(float(row["s1"]) - min_s1) < _PURPLE_SECTOR_TOLERANCE_S:
            row["s1_status"] = "purple"
        if abs(float(row["s2"]) - min_s2) < _PURPLE_SECTOR_TOLERANCE_S:
            row["s2_status"] = "purple"
        if abs(float(row["s3"]) - min_s3) < _PURPLE_SECTOR_TOLERANCE_S:
            row["s3_status"] = "purple"
    return pole_time


def _compute_qualifying_cutoffs(
    results: Sequence[Mapping[str, Any]],
    pole_time: float,
) -> dict[str, float]:
    """Computes Q3 and Q2 elimination cutoff lap times.

    Args:
        results: Qualifying result rows.
        pole_time: Fastest qualifying lap time.

    Returns:
        Dictionary with ``pole_time``, ``q3_cutoff_time``, and ``q2_cutoff_time``.
    """
    q2_runners = [
        r
        for r in results
        if r["q2_time"] is not None and int(r["grid_pos"]) <= _Q3_CUTOFF_RANK
    ]
    q3_cutoff_time = (
        max(float(r["q2_time"]) for r in q2_runners)
        if q2_runners
        else pole_time + _Q3_DEFAULT_CUTOFF_OFFSET_S
    )
    q1_advancers = [
        r
        for r in results
        if r["q1_time"] is not None and int(r["grid_pos"]) <= _Q2_CUTOFF_RANK
    ]
    q2_cutoff_time = (
        max(float(r["q1_time"]) for r in q1_advancers)
        if q1_advancers
        else pole_time + _Q2_DEFAULT_CUTOFF_OFFSET_S
    )
    return {
        "pole_time": pole_time,
        "q3_cutoff_time": round(q3_cutoff_time, _TIME_DECIMALS),
        "q2_cutoff_time": round(q2_cutoff_time, _TIME_DECIMALS),
    }


def _build_teammate_qualifying_deltas(
    results: Sequence[Mapping[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, list[Mapping[str, Any]]]]:
    """Builds constructor teammate head-to-head qualifying gap records.

    Args:
        results: Qualifying result rows.

    Returns:
        Tuple of ``(teammate_deltas, results_by_team)``.
    """
    by_team: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for row in results:
        by_team[str(row["team"])].append(row)

    teammate_deltas: list[dict[str, Any]] = []
    for team_name, team_drivers in by_team.items():
        sorted_pair = sorted(
            team_drivers, key=lambda item: int(item["grid_pos"])
        )
        faster = sorted_pair[0]
        slower = sorted_pair[-1]
        delta_s = round(
            max(0.0, float(slower["best_time"]) - float(faster["best_time"])),
            _TIME_DECIMALS,
        )
        teammate_deltas.append(
            {
                "team": team_name,
                "color": str(faster["color"]),
                "faster_driver": str(faster["driver"]),
                "slower_driver": str(slower["driver"]),
                "faster_grid": int(faster["grid_pos"]),
                "slower_grid": int(slower["grid_pos"]),
                "faster_time": float(faster["best_time"]),
                "slower_time": float(slower["best_time"]),
                "delta_s": delta_s,
            }
        )

    teammate_deltas.sort(key=lambda item: int(item["faster_grid"]))
    return teammate_deltas, by_team


def _build_qualifying_telemetry(
    gp_name: str,
    drivers: Sequence[Mapping[str, Any]],
    driver_pace: Mapping[str, float],
    track_profile: Mapping[str, int],
    race_laps: Sequence[Mapping[str, Any]],
    openf1_quali_laps: Sequence[Mapping[str, Any]] | None = None,
    openf1_quali_rc: Sequence[Mapping[str, Any]] | None = None,
    openf1_quali_results: Sequence[Mapping[str, Any]] | None = None,
    num_to_code: Mapping[int, str] | None = None,
    stage_prefix: str = "Q",
) -> dict[str, Any]:
    """Generates Qualifying or Sprint Qualifying telemetry using official OpenF1 results and laps.

    Args:
        gp_name: Display name of the Grand Prix.
        drivers: Sequence of driver metadata dictionaries.
        driver_pace: Baseline pace per driver code.
        track_profile: Circuit profile with ``turns``, ``base_speed``, and ``variation``.
        race_laps: Race lap records used for Lap 1 grid fallback when offline.
        openf1_quali_laps: Optional OpenF1 qualifying lap records.
        openf1_quali_rc: Optional OpenF1 qualifying race_control records.
        openf1_quali_results: Optional OpenF1 qualifying session_result records.
        num_to_code: Optional driver number to code mapping.
        stage_prefix: Stage label prefix (``"Q"`` for Qualifying, ``"SQ"`` for Sprint Qualifying).

    Returns:
        Qualifying telemetry block containing ``stage_prefix``, ``results``,
        ``cutoffs``, ``teammate_deltas``, ``corners``, and ``traces``.
    """
    fastest_baseline = (
        min(driver_pace.values()) if driver_pace else _DEFAULT_LAP_TIME_S
    )
    pole_target = round(fastest_baseline * _QUALI_POLE_RATIO, _TIME_DECIMALS)

    turns = int(track_profile.get("turns", _DEFAULT_TURNS_COUNT))
    s1_ratio = 0.285 + ((turns % 5) - 2) * 0.008
    s2_ratio = 0.415 - ((turns % 4) - 1.5) * 0.006

    metrics = _extract_real_qualifying_metrics(
        drivers=drivers,
        pole_target=pole_target,
        openf1_quali_laps=openf1_quali_laps,
        openf1_quali_rc=openf1_quali_rc,
        openf1_quali_results=openf1_quali_results,
        num_to_code=num_to_code,
    )
    ordered_drivers = _order_qualifying_drivers(
        drivers=drivers,
        driver_pace=driver_pace,
        fastest_baseline=fastest_baseline,
        race_laps=race_laps,
        metrics=metrics,
    )

    synth_ctx = _QualifyingSynthesisContext(
        gp_name=gp_name,
        stage_prefix=stage_prefix,
        pole_target=pole_target,
        s1_ratio=s1_ratio,
        s2_ratio=s2_ratio,
        metrics=metrics,
    )
    results = _build_qualifying_results_rows(ordered_drivers, synth_ctx)
    pole_time = _assign_fia_sector_statuses(results, pole_target)
    cutoffs = _compute_qualifying_cutoffs(results, pole_time)
    teammate_deltas, by_team = _build_teammate_qualifying_deltas(results)

    teams_info = _group_drivers_by_team(drivers)
    quali_team_perf = {
        team_name: min(float(r["best_time"]) for r in team_rows)
        for team_name, team_rows in by_team.items()
    }
    quali_corners = _generate_corners_data(
        track_profile, quali_team_perf, teams_info
    )
    traces = _build_qualifying_telemetry_traces(gp_name, results, track_profile)

    return {
        "stage_prefix": stage_prefix,
        "results": results,
        "cutoffs": cutoffs,
        "teammate_deltas": teammate_deltas,
        "corners": quali_corners,
        "traces": traces,
    }


def _index_openf1_stints_and_pits(
    openf1_stints: Sequence[Mapping[str, Any]] | None,
    openf1_pits: Sequence[Mapping[str, Any]] | None,
    num_to_code: Mapping[int, str] | None,
) -> _IndexedPitAndStintContext:
    """Indexes OpenF1 pit records by ``(driver_code, lap)`` and computes pit transit time.

    Args:
        openf1_stints: Raw OpenF1 stint records, or None.
        openf1_pits: Raw OpenF1 pit records, or None.
        num_to_code: Mapping from driver number to three-letter code, or None.

    Returns:
        Populated ``_IndexedPitAndStintContext`` instance.
    """
    real_pits_by_driver_lap: dict[tuple[str, int], Mapping[str, Any]] = {}
    valid_pit_lane_durations: list[float] = []
    if openf1_pits and num_to_code:
        for pit_rec in openf1_pits:
            d_num = pit_rec.get("driver_number")
            l_num = pit_rec.get("lap_number")
            code = num_to_code.get(int(d_num)) if d_num is not None else None
            if code and l_num is not None:
                real_pits_by_driver_lap[(code, int(l_num))] = pit_rec
            raw_pd = pit_rec.get("pit_duration") or pit_rec.get("lane_duration")
            if (
                raw_pd is not None
                and _MIN_PIT_LANE_DURATION_S
                <= float(raw_pd)
                <= _MAX_PIT_LANE_DURATION_S
            ):
                valid_pit_lane_durations.append(float(raw_pd))

    circuit_pit_transit_s = (
        (min(valid_pit_lane_durations) - _MIN_STATIONARY_STOP_S)
        if valid_pit_lane_durations
        else _DEFAULT_PIT_TRANSIT_S
    )
    return _IndexedPitAndStintContext(
        real_pits_by_driver_lap=real_pits_by_driver_lap,
        circuit_pit_transit_s=circuit_pit_transit_s,
        has_openf1_stints=bool(openf1_stints),
    )


def _group_driver_laps_into_stints(
    driver_laps: Sequence[Mapping[str, Any]],
) -> list[list[Mapping[str, Any]]]:
    """Splits a single driver's ordered laps into raw tyre stint groups.

    Args:
        driver_laps: Chronologically ordered lap records for a single driver.

    Returns:
        List of lap groups, each representing a contiguous stint.
    """
    raw_stint_groups: list[list[Mapping[str, Any]]] = []
    current_group: list[Mapping[str, Any]] = []

    for lap_rec in driver_laps:
        if not current_group:
            current_group.append(lap_rec)
            continue

        prev_rec = current_group[-1]
        prev_comp = str(prev_rec.get("compound", "MEDIUM"))
        curr_comp = str(lap_rec.get("compound", "MEDIUM"))
        prev_life = int(prev_rec.get("tyre_life", 1))
        curr_life = int(lap_rec.get("tyre_life", 1))

        compound_changed = (
            curr_comp != prev_comp
            and curr_comp != "UNKNOWN"
            and prev_comp != "UNKNOWN"
        )
        tyre_life_reset = curr_life < prev_life

        if compound_changed or tyre_life_reset:
            raw_stint_groups.append(current_group)
            current_group = [lap_rec]
        else:
            current_group.append(lap_rec)

    if current_group:
        raw_stint_groups.append(current_group)
    return raw_stint_groups


def _merge_single_lap_stint_artifacts(
    raw_stint_groups: list[list[Mapping[str, Any]]],
    driver_laps: Sequence[Mapping[str, Any]],
    gp_name: str,
    code: str,
    has_openf1_stints: bool,
) -> list[list[Mapping[str, Any]]]:
    """Merges 1-lap tyre stint artifacts into adjacent stints for multi-lap drivers.

    Args:
        raw_stint_groups: Initial stint groups from ``_group_driver_laps_into_stints``.
        driver_laps: All ordered laps completed by the driver.
        gp_name: Display name of the Grand Prix.
        code: Three-letter driver code.
        has_openf1_stints: Whether authoritative OpenF1 stint records were provided.

    Returns:
        Cleaned list of stint lap groups without 1-lap artifacts.
    """
    stint_groups = list(raw_stint_groups)
    if len(stint_groups) > 1:
        merged_groups: list[list[Mapping[str, Any]]] = []
        for grp in stint_groups:
            if len(grp) <= 1 and merged_groups:
                merged_groups[-1].extend(grp)
            else:
                merged_groups.append(list(grp))
        if len(merged_groups) > 1 and len(merged_groups[0]) <= 1:
            merged_groups[1] = merged_groups[0] + merged_groups[1]
            merged_groups.pop(0)
        stint_groups = merged_groups

    if (
        len(stint_groups) == 1
        and len(driver_laps) >= _MIN_LAPS_FOR_SYNTHETIC_PIT
        and not has_openf1_stints
    ):
        pit_idx = int(
            len(driver_laps)
            * (0.42 + _seeded_unit_float(f"{gp_name}_{code}_pit") * 0.18)
        )
        pit_idx = max(
            _MIN_STINT_BOUNDARY_LAPS,
            min(len(driver_laps) - _MIN_STINT_BOUNDARY_LAPS, pit_idx),
        )
        stint_groups = [
            list(driver_laps[:pit_idx]),
            list(driver_laps[pit_idx:]),
        ]

    return stint_groups


def _build_pit_stop_entry(
    gp_name: str,
    code: str,
    driver_name: str,
    team: str,
    color: str,
    s_idx: int,
    prev_stint: Mapping[str, Any],
    prev_group: Sequence[Mapping[str, Any]],
    current_group: Sequence[Mapping[str, Any]],
    current_comp: str,
    median_time: float,
    pit_ctx: _IndexedPitAndStintContext,
) -> dict[str, Any]:
    """Constructs a single pit stop telemetry record between two adjacent stints.

    Args:
        gp_name: Display name of the Grand Prix.
        code: Three-letter driver code.
        driver_name: Full display name of the driver.
        team: Constructor team name.
        color: Team hex color string.
        s_idx: 1-based pit stop number for this driver.
        prev_stint: Preceding stint summary dictionary.
        prev_group: Laps belonging to the preceding stint.
        current_group: Laps belonging to the new stint.
        current_comp: Tyre compound fitted during the stop.
        median_time: Clean median lap time for the driver.
        pit_ctx: Indexed OpenF1 pit stop context.

    Returns:
        Formatted pit stop dictionary.
    """
    pit_lap = int(prev_stint["end_lap"])
    openf1_pit = (
        pit_ctx.real_pits_by_driver_lap.get((code, pit_lap))
        or pit_ctx.real_pits_by_driver_lap.get((code, pit_lap + 1))
        or pit_ctx.real_pits_by_driver_lap.get((code, pit_lap - 1))
    )

    seed_stop = f"{gp_name}_{code}_stop_{s_idx}"
    raw_lane_val = (
        float(
            openf1_pit.get("pit_duration") or openf1_pit.get("lane_duration")
        )
        if openf1_pit
        and (
            openf1_pit.get("pit_duration") is not None
            or openf1_pit.get("lane_duration") is not None
        )
        else None
    )
    raw_stop_val = (
        float(openf1_pit["stop_duration"])
        if openf1_pit and openf1_pit.get("stop_duration") is not None
        else None
    )
    if (
        raw_stop_val is not None
        and _MIN_DERIVED_STATIONARY_S <= raw_stop_val <= _MAX_DERIVED_STATIONARY_S
    ):
        stationary_s = round(raw_stop_val, _STOP_DECIMALS)
    elif raw_lane_val is not None:
        stationary_s = round(
            max(
                _MIN_DERIVED_STATIONARY_S,
                min(
                    _MAX_DERIVED_STATIONARY_S,
                    raw_lane_val - pit_ctx.circuit_pit_transit_s,
                ),
            ),
            _STOP_DECIMALS,
        )
    else:
        stationary_s = round(
            2.15 + _seeded_unit_float(f"{seed_stop}_stat") * 1.55,
            _STOP_DECIMALS,
        )

    if raw_lane_val is not None:
        pit_loss_s = round(
            max(
                _MIN_PIT_LANE_DURATION_S,
                min(_MAX_CLAMPED_PIT_LOSS_S, raw_lane_val),
            ),
            _STOP_DECIMALS,
        )
    else:
        boundary_times = [
            float(current_group[0].get("time", median_time)),
            float(prev_group[-1].get("time", median_time)),
        ]
        observed_spike = max(boundary_times) - median_time
        if (
            _MIN_OBSERVED_PIT_SPIKE_S
            <= observed_spike
            <= _MAX_OBSERVED_PIT_SPIKE_S
        ):
            pit_loss_s = round(observed_spike, _STOP_DECIMALS)
        else:
            pit_loss_s = round(
                19.4
                + stationary_s
                + _seeded_unit_float(f"{seed_stop}_loss") * 2.8,
                _STOP_DECIMALS,
            )

    return {
        "driver": code,
        "name": driver_name,
        "team": team,
        "color": color,
        "lap": pit_lap,
        "stop_number": s_idx,
        "from_compound": str(prev_stint["compound"]),
        "to_compound": current_comp,
        "stationary_s": stationary_s,
        "pit_loss_s": pit_loss_s,
    }


def _build_stints_and_pit_stops(
    gp_name: str,
    drivers: Sequence[Mapping[str, Any]],
    laps_by_driver: Mapping[str, Sequence[Mapping[str, Any]]],
    total_laps: int,
    sc_laps_set: frozenset[int],
    pit_ctx: _IndexedPitAndStintContext,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Builds all race stints and pit stop records across all drivers.

    Args:
        gp_name: Display name of the Grand Prix.
        drivers: Sequence of driver metadata dictionaries.
        laps_by_driver: Laps grouped by three-letter driver code.
        total_laps: Total laps in the session.
        sc_laps_set: Set of lap numbers neutralized by SC or VSC.
        pit_ctx: Indexed OpenF1 pit stop and stint context.

    Returns:
        Tuple of ``(stints, pit_stops)``.
    """
    driver_meta = {str(d["code"]): d for d in drivers}
    stints: list[dict[str, Any]] = []
    pit_stops: list[dict[str, Any]] = []

    for driver in drivers:
        code = str(driver["code"])
        team = str(driver["team"])
        color = str(driver["color"])
        driver_name = str(driver_meta[code].get("name", code))
        driver_laps = sorted(
            laps_by_driver.get(code, []), key=lambda item: int(item["lap"])
        )
        if not driver_laps:
            continue

        times = [
            float(lap["time"])
            for lap in driver_laps
            if 0 < float(lap.get("time", 0)) < _MAX_CLEAN_RACE_LAP_S
            and int(lap["lap"]) not in sc_laps_set
        ]
        if not times:
            times = [
                float(lap["time"])
                for lap in driver_laps
                if 0 < float(lap.get("time", 0)) < _MAX_CLEAN_RACE_LAP_S
            ]
        median_time = (
            statistics.median(times) if times else _DEFAULT_RACE_MEDIAN_TIME_S
        )

        raw_groups = _group_driver_laps_into_stints(driver_laps)
        stint_groups = _merge_single_lap_stint_artifacts(
            raw_stint_groups=raw_groups,
            driver_laps=driver_laps,
            gp_name=gp_name,
            code=code,
            has_openf1_stints=pit_ctx.has_openf1_stints,
        )

        for s_idx, group in enumerate(stint_groups):
            stint_num = s_idx + 1
            start_lap = int(group[0]["lap"])
            end_lap = int(group[-1]["lap"])
            comp = str(group[0].get("compound", "MEDIUM"))
            if comp == "UNKNOWN":
                comp = "MEDIUM" if stint_num == 1 else "HARD"

            clean_group_times = [
                float(lap["time"])
                for lap in group
                if 0
                < float(lap.get("time", 0))
                <= median_time + _CLEAN_STINT_LAP_BUFFER_S
                and int(lap["lap"]) not in sc_laps_set
            ]
            if not clean_group_times:
                min_clean_t = median_time * _MIN_VALID_LAP_RATIO
                max_clean_t = median_time + _CLEAN_STINT_LAP_BUFFER_S
                clean_group_times = [
                    min(max_clean_t, max(min_clean_t, float(lap["time"])))
                    for lap in group
                    if float(lap.get("time", 0)) > 0
                ] or [median_time]

            avg_pace = round(statistics.mean(clean_group_times), _TIME_DECIMALS)
            mid_lap = (start_lap + end_lap) / 2.0
            remaining_laps = max(0.0, float(total_laps) - mid_lap)
            fuel_corrected = round(
                avg_pace - (remaining_laps * _FUEL_BURN_EFFECT_SEC_PER_LAP),
                _TIME_DECIMALS,
            )

            stints.append(
                {
                    "driver": code,
                    "name": driver_name,
                    "team": team,
                    "color": color,
                    "stint": stint_num,
                    "compound": comp,
                    "start_lap": start_lap,
                    "end_lap": end_lap,
                    "laps_count": end_lap - start_lap + 1,
                    "avg_pace": avg_pace,
                    "fuel_corrected_pace": fuel_corrected,
                }
            )

            if s_idx > 0:
                pit_stops.append(
                    _build_pit_stop_entry(
                        gp_name=gp_name,
                        code=code,
                        driver_name=driver_name,
                        team=team,
                        color=color,
                        s_idx=s_idx,
                        prev_stint=stints[-2],
                        prev_group=stint_groups[s_idx - 1],
                        current_group=group,
                        current_comp=comp,
                        median_time=median_time,
                        pit_ctx=pit_ctx,
                    )
                )

    pit_stops.sort(
        key=lambda item: (
            float(item["stationary_s"]),
            float(item["pit_loss_s"]),
        )
    )
    return stints, pit_stops


def _build_race_telemetry(
    gp_name: str,
    drivers: Sequence[Mapping[str, Any]],
    laps: Sequence[Mapping[str, Any]],
    total_laps: int,
    openf1_stints: Sequence[Mapping[str, Any]] | None = None,
    openf1_pits: Sequence[Mapping[str, Any]] | None = None,
    openf1_rc: Sequence[Mapping[str, Any]] | None = None,
    num_to_code: Mapping[int, str] | None = None,
) -> dict[str, Any]:
    """Extracts race stints, fuel-corrected stint pace, pit stop metrics, and SC/VSC windows.

    Args:
        gp_name: Display name of the Grand Prix.
        drivers: Sequence of driver metadata dictionaries.
        laps: Processed lap dictionaries for the race or sprint.
        total_laps: Total number of laps in the session.
        openf1_stints: Optional raw OpenF1 stint records.
        openf1_pits: Optional raw OpenF1 pit records.
        openf1_rc: Optional raw OpenF1 race_control records.
        num_to_code: Optional driver number to code mapping.

    Returns:
        Dictionary containing ``stints``, ``pit_stops``, and ``sc_vsc_windows``.
    """
    laps_by_driver: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for lap in laps:
        laps_by_driver[str(lap["driver"])].append(lap)

    sc_vsc_windows = _extract_sc_vsc_windows(
        openf1_rc or [], laps, total_laps
    )
    sc_laps_set = frozenset(
        lap_no
        for win in sc_vsc_windows
        for lap_no in range(int(win["start_lap"]), int(win["end_lap"]) + 1)
    )

    pit_ctx = _index_openf1_stints_and_pits(
        openf1_stints=openf1_stints,
        openf1_pits=openf1_pits,
        num_to_code=num_to_code,
    )
    stints, pit_stops = _build_stints_and_pit_stops(
        gp_name=gp_name,
        drivers=drivers,
        laps_by_driver=laps_by_driver,
        total_laps=total_laps,
        sc_laps_set=sc_laps_set,
        pit_ctx=pit_ctx,
    )
    return {
        "stints": stints,
        "pit_stops": pit_stops,
        "sc_vsc_windows": sc_vsc_windows,
    }


def _resolve_meeting_sessions(
    json_path: str,
    gp_name: str,
    all_sessions_cache: Sequence[Mapping[str, Any]],
) -> dict[str, int]:
    """Resolves OpenF1 ``session_key`` values by session name for a Grand Prix.

    Args:
        json_path: Path to the Grand Prix JSON file.
        gp_name: Display name of the Grand Prix.
        all_sessions_cache: Sequence of OpenF1 session metadata records.

    Returns:
        Mapping from session name (e.g., ``"Qualifying"``, ``"Race"``) to ``session_key``.
    """
    stem = os.path.splitext(os.path.basename(json_path))[0].lower()
    target_meeting = _FILENAME_TO_MEETING_KEY.get(stem)

    matching_sessions = [
        session
        for session in all_sessions_cache
        if (
            target_meeting is not None
            and session.get("meeting_key") == target_meeting
        )
        or (
            target_meeting is None
            and gp_name.lower().replace(" grand prix", "")
            in str(session.get("country_name", "")).lower()
        )
    ]

    session_map: dict[str, int] = {}
    for session in matching_sessions:
        s_name = str(session.get("session_name", ""))
        s_key = session.get("session_key")
        if isinstance(s_key, int):
            session_map[s_name] = s_key
    return session_map


def _fetch_session_driver_mapping(
    session_map: Mapping[str, int],
    drivers: Sequence[Mapping[str, Any]],
) -> tuple[dict[int, str], dict[int, dict[str, Any]]]:
    """Fetches OpenF1 driver numbers and maps them to three-letter codes and metadata.

    Args:
        session_map: Mapping from session name to OpenF1 ``session_key``.
        drivers: Existing driver metadata list from the race JSON file.

    Returns:
        Tuple of ``(num_to_code, drivers_dict_by_num)``.
    """
    num_to_code: dict[int, str] = {}
    drivers_dict_by_num: dict[int, dict[str, Any]] = {}
    if not session_map:
        return num_to_code, drivers_dict_by_num

    ref_key = (
        session_map.get("Qualifying")
        or session_map.get("Race")
        or next(iter(session_map.values()))
    )
    raw_drv = _fetch_openf1_json("drivers", {"session_key": ref_key})
    known_by_code = {str(d["code"]): d for d in drivers}
    for d_item in raw_drv:
        d_num = d_item.get("driver_number")
        acro = d_item.get("name_acronym")
        if isinstance(d_num, int) and acro:
            code_str = str(acro)
            num_to_code[d_num] = code_str
            drivers_dict_by_num[d_num] = dict(
                known_by_code.get(
                    code_str,
                    {
                        "code": code_str,
                        "name": str(d_item.get("full_name", code_str)),
                        "team": str(d_item.get("team_name", "Unknown")),
                        "color": (
                            f"#{d_item.get('team_colour') or _DEFAULT_FALLBACK_HEX}"
                        ),
                    },
                )
            )
    return num_to_code, drivers_dict_by_num


def _fetch_practice_session_inputs(
    session_map: Mapping[str, int],
) -> tuple[
    list[dict[str, Any]] | None,
    list[dict[str, Any]] | None,
    list[dict[str, Any]] | None,
]:
    """Fetches OpenF1 practice laps, stints, and results across FP2, FP1, and FP3.

    Args:
        session_map: Mapping from session name to OpenF1 ``session_key``.

    Returns:
        Tuple of ``(prac_laps_raw, prac_stints_raw, prac_results_raw)``.
    """
    prac_laps_raw: list[dict[str, Any]] = []
    prac_stints_raw: list[dict[str, Any]] = []
    prac_results_raw: list[dict[str, Any]] | None = None

    for p_name in ("Practice 2", "Practice 1", "Practice 3"):
        if p_name in session_map:
            p_sk = session_map[p_name]
            if not prac_results_raw:
                prac_results_raw = _fetch_openf1_json(
                    "session_result", {"session_key": p_sk}
                )
            prac_laps_raw.extend(
                _fetch_openf1_json("laps", {"session_key": p_sk})
            )
            prac_stints_raw.extend(
                _fetch_openf1_json("stints", {"session_key": p_sk})
            )
            if len(prac_laps_raw) > _PRACTICE_SAMPLE_LAP_LIMIT:
                break

    return (
        prac_laps_raw or None,
        prac_stints_raw or None,
        prac_results_raw or None,
    )


def _enrich_live_sprint_sessions(
    race_data: dict[str, Any],
    gp_name: str,
    drivers: Sequence[Mapping[str, Any]],
    driver_pace: Mapping[str, float],
    track_profile: Mapping[str, int],
    laps: Sequence[Mapping[str, Any]],
    session_map: Mapping[str, int],
    num_to_code: Mapping[int, str],
    drivers_dict_by_num: Mapping[int, Mapping[str, Any]],
) -> None:
    """Enriches ``race_data`` in place with live OpenF1 Sprint Qualifying and Sprint telemetry.

    Args:
        race_data: Mutable race data payload dictionary.
        gp_name: Display name of the Grand Prix.
        drivers: Sequence of driver metadata dictionaries.
        driver_pace: Baseline pace per driver code.
        track_profile: Circuit corner profile.
        laps: Main race laps fallback.
        session_map: OpenF1 session key mapping.
        num_to_code: Mapping from driver number to three-letter code.
        drivers_dict_by_num: Mapping from driver number to driver metadata.
    """
    sq_key = session_map["Sprint Qualifying"]
    sp_key = session_map["Sprint"]
    sq_laps_raw = _fetch_openf1_json("laps", {"session_key": sq_key})
    sq_rc_raw = _fetch_openf1_json("race_control", {"session_key": sq_key})
    sq_results_raw = _fetch_openf1_json(
        "session_result", {"session_key": sq_key}
    )

    sp_laps_raw = _fetch_openf1_json("laps", {"session_key": sp_key})
    sp_stints_raw = _fetch_openf1_json("stints", {"session_key": sp_key})
    sp_pos_raw = _fetch_openf1_json("position", {"session_key": sp_key})
    sp_pits_raw = _fetch_openf1_json("pit", {"session_key": sp_key})
    sp_rc_raw = _fetch_openf1_json("race_control", {"session_key": sp_key})
    sp_results_raw = _fetch_openf1_json(
        "session_result", {"session_key": sp_key}
    )

    sprint_processed_laps, sprint_max_lap = process_laps_data(
        laps_data=sp_laps_raw,
        drivers_dict=drivers_dict_by_num,
        stints_data=sp_stints_raw,
    )
    sprint_winner = str(
        race_data["race_info"].get("winner", _DEFAULT_WINNER_CODE)
    )
    sprint_classification: list[dict[str, Any]] = []
    if sp_results_raw and num_to_code:
        (
            sprint_processed_laps,
            sprint_max_lap,
            sprint_winner,
            sprint_classification,
        ) = _calibrate_race_laps_with_session_result(
            laps=sprint_processed_laps,
            drivers=drivers,
            openf1_session_result=sp_results_raw,
            num_to_code=num_to_code,
            openf1_raw_laps=sp_laps_raw,
            openf1_positions=sp_pos_raw,
        )
    else:
        sprint_winner = _find_default_winner(
            sprint_processed_laps, sprint_max_lap
        )

    race_data["sprint_qualifying"] = _build_qualifying_telemetry(
        gp_name=f"{gp_name} Sprint",
        drivers=drivers,
        driver_pace=driver_pace,
        track_profile=track_profile,
        race_laps=sprint_processed_laps or laps,
        openf1_quali_laps=sq_laps_raw,
        openf1_quali_rc=sq_rc_raw,
        openf1_quali_results=sq_results_raw,
        num_to_code=num_to_code,
        stage_prefix="SQ",
    )
    sprint_telemetry = _build_race_telemetry(
        gp_name=f"{gp_name} Sprint",
        drivers=drivers,
        laps=sprint_processed_laps,
        total_laps=sprint_max_lap,
        openf1_stints=sp_stints_raw,
        openf1_pits=sp_pits_raw,
        openf1_rc=sp_rc_raw,
        num_to_code=num_to_code,
    )
    if sprint_classification:
        sprint_telemetry["classification"] = sprint_classification
    race_data["sprint"] = {
        "total_laps": sprint_max_lap,
        "winner": sprint_winner,
        "laps": sprint_processed_laps,
        "race_telemetry": sprint_telemetry,
    }


def _synthesize_offline_sprint_sessions(
    race_data: dict[str, Any],
    gp_name: str,
    drivers: Sequence[Mapping[str, Any]],
    driver_pace: Mapping[str, float],
    track_profile: Mapping[str, int],
    laps: Sequence[Mapping[str, Any]],
    total_laps: int,
) -> None:
    """Synthesizes deterministic ``sprint_qualifying`` and ``sprint`` blocks when offline.

    Args:
        race_data: Mutable race data payload dictionary.
        gp_name: Display name of the Grand Prix.
        drivers: Sequence of driver metadata dictionaries.
        driver_pace: Baseline pace per driver code.
        track_profile: Circuit corner profile.
        laps: Main race lap records.
        total_laps: Total laps in the Grand Prix.
    """
    sprint_laps_count = max(_MIN_SPRINT_LAPS, total_laps // 3)
    sprint_laps = [
        dict(lap_rec)
        for lap_rec in laps
        if int(lap_rec.get("lap", 1)) <= sprint_laps_count
    ]
    race_data["sprint_qualifying"] = _build_qualifying_telemetry(
        gp_name=f"{gp_name} Sprint",
        drivers=drivers,
        driver_pace=driver_pace,
        track_profile=track_profile,
        race_laps=sprint_laps,
        stage_prefix="SQ",
    )
    race_data["sprint"] = {
        "total_laps": sprint_laps_count,
        "winner": str(
            race_data["race_info"].get("winner", _DEFAULT_WINNER_CODE)
        ),
        "laps": sprint_laps,
        "race_telemetry": _build_race_telemetry(
            gp_name=f"{gp_name} Sprint",
            drivers=drivers,
            laps=sprint_laps,
            total_laps=sprint_laps_count,
        ),
    }


def _fetch_openf1_location_window(
    session_key: int,
    driver_number: int,
    start_iso: str,
    end_iso: str,
) -> list[dict[str, Any]]:
    """Queries OpenF1 ``/v1/location`` for a driver's GPS points within a lap window.

    Args:
        session_key: OpenF1 session key.
        driver_number: Car number to query.
        start_iso: ISO-8601 lap start timestamp.
        end_iso: ISO-8601 lap end timestamp.

    Returns:
        List of OpenF1 location sample dicts containing ``x`` and ``y``.
    """
    url = (
        f"{_OPENF1_BASE_URL}/location?session_key={session_key}"
        f"&driver_number={driver_number}&date>={start_iso}&date<={end_iso}"
    )
    for attempt in range(_API_MAX_ATTEMPTS):
        try:
            time.sleep(_API_DELAY_SECONDS)
            response = requests.get(url, timeout=_API_TIMEOUT_SECONDS)
            if response.status_code == _HTTP_OK:
                payload = response.json()
                return payload if isinstance(payload, list) else []
            if response.status_code in _API_RETRY_STATUS_CODES:
                time.sleep(_API_RATE_LIMIT_BACKOFF_BASE_S * (attempt + 1))
                continue
        except Exception as err:
            print(f"  Warning: OpenF1 location request failed ({session_key}): {err}")
            time.sleep(_API_ERROR_BACKOFF_BASE_S * (attempt + 1))
    return []


def _extract_flying_lap_xy_points(
    session_key: int | None,
    openf1_laps: Sequence[Mapping[str, Any]] | None,
) -> tuple[list[tuple[float, float]], float, float]:
    """Extracts raw GPS ``(x, y)`` coordinates and sector split percentages from a flying lap.

    Args:
        session_key: OpenF1 session identifier.
        openf1_laps: Raw OpenF1 lap dicts for the session.

    Returns:
        Tuple ``(raw_xy, s1_pct, s2_pct)``.
    """
    if session_key is None or not openf1_laps:
        return [], _DEFAULT_S1_SPLIT_PCT, _DEFAULT_S2_SPLIT_PCT

    candidates = [
        lap
        for lap in openf1_laps
        if isinstance(lap, Mapping)
        and lap.get("date_start")
        and lap.get("lap_duration")
        and lap.get("driver_number") is not None
        and not lap.get("is_pit_out_lap")
        and _MIN_QUALI_LAP_S < float(lap["lap_duration"]) < _MAX_QUALI_LAP_S
    ]
    candidates.sort(key=lambda item: float(item["lap_duration"]))

    for best_lap in candidates[:4]:
        dur = float(best_lap["lap_duration"])
        s1_dur = float(best_lap.get("duration_sector_1") or (dur * 0.325))
        s2_dur = float(best_lap.get("duration_sector_2") or (dur * 0.340))
        s1_pct = round(max(18.0, min(45.0, (s1_dur / dur) * 100.0)), 1)
        s2_pct = round(
            max(s1_pct + 18.0, min(84.0, ((s1_dur + s2_dur) / dur) * 100.0)), 1
        )

        start_dt = datetime.fromisoformat(
            str(best_lap["date_start"]).replace("Z", "+00:00")
        )
        end_dt = start_dt + timedelta(seconds=dur + 0.35)
        start_str = start_dt.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3]
        end_str = end_dt.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3]

        samples = _fetch_openf1_location_window(
            session_key=session_key,
            driver_number=int(best_lap["driver_number"]),
            start_iso=start_str,
            end_iso=end_str,
        )
        raw_xy: list[tuple[float, float]] = []
        for pt in samples:
            rx = pt.get("x")
            ry = pt.get("y")
            if rx is None or ry is None:
                continue
            fx, fy = float(rx), float(ry)
            if abs(fx) < 1e-3 and abs(fy) < 1e-3:
                continue
            if not raw_xy or math.hypot(fx - raw_xy[-1][0], fy - raw_xy[-1][1]) > 1.5:
                raw_xy.append((fx, fy))

        if len(raw_xy) >= _MIN_LOCATION_SAMPLE_POINTS:
            return raw_xy, s1_pct, s2_pct

    return [], _DEFAULT_S1_SPLIT_PCT, _DEFAULT_S2_SPLIT_PCT


def _build_procedural_circuit_xy(
    gp_name: str,
    turns_count: int,
) -> list[tuple[float, float]]:
    """Generates a deterministic closed circuit loop when offline.

    Args:
        gp_name: Display name of the Grand Prix.
        turns_count: Number of corners on the circuit.

    Returns:
        Sequence of 2D ``(x, y)`` coordinates tracing a realistic closed circuit.
    """
    phase_1 = _seeded_unit_float(f"{gp_name}_map_p1") * math.tau
    phase_2 = _seeded_unit_float(f"{gp_name}_map_p2") * math.tau
    phase_3 = _seeded_unit_float(f"{gp_name}_map_p3") * math.tau
    points: list[tuple[float, float]] = []
    sample_count = _TRACK_MAP_POINTS_COUNT
    harm_k = max(3, min(7, turns_count // 3))

    for idx in range(sample_count):
        theta = (idx / sample_count) * math.tau
        radius = (
            1.0
            + 0.24 * math.cos(2.0 * theta + phase_1)
            + 0.14 * math.sin(3.0 * theta + phase_2)
            + 0.09 * math.cos(harm_k * theta + phase_3)
        )
        x_val = radius * 1.45 * math.cos(theta)
        y_val = radius * 0.92 * math.sin(theta)
        points.append((x_val, y_val))
    return points


def _normalize_and_resample_track_loop(
    raw_xy: Sequence[tuple[float, float]],
    num_points: int = _TRACK_MAP_POINTS_COUNT,
) -> list[tuple[float, float]]:
    """Normalizes a closed circuit loop into the target SVG viewBox and resamples equidistantly.

    Rotates the loop along its principal axis so the circuit's longer dimension aligns
    horizontally across the ``1000 x 560`` canvas while preserving true aspect ratio.

    Args:
        raw_xy: Input sequence of ``(x, y)`` coordinates.
        num_points: Number of evenly-spaced perimeter points to output.

    Returns:
        List of ``(x, y)`` tuples rounded to 1 decimal place inside ``1000 x 560``.
    """
    mean_x = sum(pt[0] for pt in raw_xy) / len(raw_xy)
    mean_y = sum(pt[1] for pt in raw_xy) / len(raw_xy)
    centered = [(pt[0] - mean_x, pt[1] - mean_y) for pt in raw_xy]

    cov_xx = sum(px * px for px, _ in centered) / len(centered)
    cov_yy = sum(py * py for _, py in centered) / len(centered)
    cov_xy = sum(px * py for px, py in centered) / len(centered)
    angle = 0.5 * math.atan2(2.0 * cov_xy, cov_xx - cov_yy)
    cos_a = math.cos(-angle)
    sin_a = math.sin(-angle)
    rotated = [
        (px * cos_a - py * sin_a, -(px * sin_a + py * cos_a))
        for px, py in centered
    ]

    closed = list(rotated) + [rotated[0]]
    cum_dist = [0.0]
    for idx in range(1, len(closed)):
        seg_len = math.hypot(
            closed[idx][0] - closed[idx - 1][0],
            closed[idx][1] - closed[idx - 1][1],
        )
        cum_dist.append(cum_dist[-1] + seg_len)

    total_length = max(cum_dist[-1], 1e-6)
    resampled: list[tuple[float, float]] = []
    seg_ptr = 0
    for idx in range(num_points):
        target_d = (idx / num_points) * total_length
        while seg_ptr < len(cum_dist) - 2 and cum_dist[seg_ptr + 1] < target_d:
            seg_ptr += 1
        d0 = cum_dist[seg_ptr]
        d1 = cum_dist[seg_ptr + 1]
        frac = (target_d - d0) / max(d1 - d0, 1e-6)
        x_interp = closed[seg_ptr][0] + frac * (
            closed[seg_ptr + 1][0] - closed[seg_ptr][0]
        )
        y_interp = closed[seg_ptr][1] + frac * (
            closed[seg_ptr + 1][1] - closed[seg_ptr][1]
        )
        resampled.append((x_interp, y_interp))

    smoothed: list[tuple[float, float]] = []
    for idx in range(num_points):
        p_prev = resampled[(idx - 1) % num_points]
        p_curr = resampled[idx]
        p_next = resampled[(idx + 1) % num_points]
        smoothed.append(
            (
                0.22 * p_prev[0] + 0.56 * p_curr[0] + 0.22 * p_next[0],
                0.22 * p_prev[1] + 0.56 * p_curr[1] + 0.22 * p_next[1],
            )
        )

    xs = [pt[0] for pt in smoothed]
    ys = [pt[1] for pt in smoothed]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    span_x = max(max_x - min_x, 1e-6)
    span_y = max(max_y - min_y, 1e-6)

    avail_w = _TRACK_MAP_VIEWBOX_WIDTH - 2.0 * _TRACK_MAP_PADDING_X
    avail_h = _TRACK_MAP_VIEWBOX_HEIGHT - 2.0 * _TRACK_MAP_PADDING_Y
    scale = min(avail_w / span_x, avail_h / span_y)
    offset_x = (_TRACK_MAP_VIEWBOX_WIDTH - span_x * scale) / 2.0
    offset_y = (_TRACK_MAP_VIEWBOX_HEIGHT - span_y * scale) / 2.0

    return [
        (
            round(offset_x + (px - min_x) * scale, 1),
            round(offset_y + (py - min_y) * scale, 1),
        )
        for px, py in smoothed
    ]


def _locate_turn_apexes_on_track(
    points: Sequence[tuple[float, float]],
    turns_count: int,
) -> list[dict[str, Any]]:
    """Identifies the ``1..turns_count`` corner apexes around the resampled track loop.

    Finds local curvature peaks around the closed loop so each turn ``T1..TN`` sits on
    a genuine bend of the circuit in ascending track-distance order, with an outward
    normal offset for its ``T{k}`` callout badge.

    Args:
        points: Normalized ``(x, y)`` loop points of length ``M``.
        turns_count: Total number of turns on the circuit.

    Returns:
        List of turn metadata dicts ``{turn, idx, pct, x, y, label_x, label_y, arc_start_idx, arc_end_idx}``.
    """
    num_pts = len(points)
    cx = sum(pt[0] for pt in points) / num_pts
    cy = sum(pt[1] for pt in points) / num_pts

    curvatures: list[float] = []
    step = 3
    for idx in range(num_pts):
        p_prev = points[(idx - step) % num_pts]
        p_curr = points[idx]
        p_next = points[(idx + step) % num_pts]
        v1x, v1y = p_curr[0] - p_prev[0], p_curr[1] - p_prev[1]
        v2x, v2y = p_next[0] - p_curr[0], p_next[1] - p_curr[1]
        ang1 = math.atan2(v1y, v1x)
        ang2 = math.atan2(v2y, v2x)
        diff = abs((ang2 - ang1 + math.pi) % math.tau - math.pi)
        curvatures.append(diff)

    min_sep = max(3, num_pts // (turns_count * 2 + 2))
    ranked_indices = sorted(
        range(4, num_pts - 3),
        key=lambda i: curvatures[i],
        reverse=True,
    )
    selected_indices: list[int] = []
    for candidate_idx in ranked_indices:
        if len(selected_indices) >= turns_count:
            break
        if all(
            min(
                abs(candidate_idx - existing),
                num_pts - abs(candidate_idx - existing),
            )
            >= min_sep
            for existing in selected_indices
        ):
            selected_indices.append(candidate_idx)

    while len(selected_indices) < turns_count:
        fallback_idx = int(
            round(((len(selected_indices) + 0.5) / turns_count) * (num_pts - 8))
        ) + 4
        if fallback_idx not in selected_indices:
            selected_indices.append(fallback_idx)
        else:
            selected_indices.append((fallback_idx + 2) % num_pts)

    selected_indices.sort()

    turns_meta: list[dict[str, Any]] = []
    placed_labels: list[tuple[float, float]] = []
    for turn_num, idx in enumerate(selected_indices, start=1):
        px, py = points[idx]
        p_prev = points[(idx - 2) % num_pts]
        p_next = points[(idx + 2) % num_pts]
        tx, ty = p_next[0] - p_prev[0], p_next[1] - p_prev[1]
        t_len = max(math.hypot(tx, ty), 1e-6)
        nx, ny = -ty / t_len, tx / t_len

        if (px - cx) * nx + (py - cy) * ny < 0:
            nx, ny = -nx, -ny

        lx = px + nx * _TRACK_MAP_LABEL_OFFSET_PX
        ly = py + ny * _TRACK_MAP_LABEL_OFFSET_PX

        for prev_lx, prev_ly in placed_labels:
            if math.hypot(lx - prev_lx, ly - prev_ly) < 22.0:
                lx = px - nx * (_TRACK_MAP_LABEL_OFFSET_PX + 4.0)
                ly = py - ny * (_TRACK_MAP_LABEL_OFFSET_PX + 4.0)
                break

        lx = max(24.0, min(_TRACK_MAP_VIEWBOX_WIDTH - 24.0, lx))
        ly = max(22.0, min(_TRACK_MAP_VIEWBOX_HEIGHT - 22.0, ly))
        placed_labels.append((lx, ly))

        turns_meta.append(
            {
                "turn": turn_num,
                "idx": idx,
                "pct": round((idx / num_pts) * 100.0, 1),
                "x": round(px, 1),
                "y": round(py, 1),
                "label_x": round(lx, 1),
                "label_y": round(ly, 1),
                "arc_start_idx": max(0, idx - _TRACK_MAP_ARC_HALF_WINDOW),
                "arc_end_idx": min(num_pts - 1, idx + _TRACK_MAP_ARC_HALF_WINDOW),
            }
        )

    return turns_meta


def _build_circuit_track_map(
    gp_name: str,
    turns_count: int,
    session_key: int | None = None,
    openf1_laps: Sequence[Mapping[str, Any]] | None = None,
    fetch_live: bool = False,
) -> dict[str, Any]:
    """Builds the ``track_map`` block with circuit loop geometry, sector splits, and turn apexes.

    Uses real OpenF1 ``/v1/location`` GPS coordinates when ``fetch_live=True`` and falls
    back to a deterministic procedural circuit loop when offline.

    Args:
        gp_name: Display name of the Grand Prix.
        turns_count: Number of corners on the circuit.
        session_key: Optional OpenF1 session key for querying ``/v1/location``.
        openf1_laps: Optional OpenF1 lap records for selecting a clean flying lap.
        fetch_live: Whether live OpenF1 queries are enabled.

    Returns:
        Dictionary containing ``viewBox``, ``points``, ``s1_end_idx``, ``s2_end_idx``, and ``turns``.
    """
    raw_xy: list[tuple[float, float]] = []
    s1_pct = _DEFAULT_S1_SPLIT_PCT
    s2_pct = _DEFAULT_S2_SPLIT_PCT

    if fetch_live and session_key is not None and openf1_laps:
        raw_xy, s1_pct, s2_pct = _extract_flying_lap_xy_points(
            session_key=session_key,
            openf1_laps=openf1_laps,
        )

    is_real_gps = len(raw_xy) >= _MIN_LOCATION_SAMPLE_POINTS
    if not is_real_gps:
        raw_xy = _build_procedural_circuit_xy(gp_name, turns_count)

    normalized_points = _normalize_and_resample_track_loop(
        raw_xy, num_points=_TRACK_MAP_POINTS_COUNT
    )
    turns_meta = _locate_turn_apexes_on_track(normalized_points, turns_count)
    num_pts = len(normalized_points)
    s1_end_idx = max(10, min(num_pts - 20, int(round((s1_pct / 100.0) * num_pts))))
    s2_end_idx = max(
        s1_end_idx + 10,
        min(num_pts - 8, int(round((s2_pct / 100.0) * num_pts))),
    )

    return {
        "viewBox": [
            0,
            0,
            int(_TRACK_MAP_VIEWBOX_WIDTH),
            int(_TRACK_MAP_VIEWBOX_HEIGHT),
        ],
        "source": "openf1_gps" if is_real_gps else "procedural",
        "s1_end_idx": s1_end_idx,
        "s2_end_idx": s2_end_idx,
        "points": [[pt[0], pt[1]] for pt in normalized_points],
        "turns": turns_meta,
    }


def generate_weekend_telemetry(
    json_path: str,
    profiles_path: str | None = None,
    fetch_live: bool = False,
    all_sessions_cache: Sequence[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Enriches a Grand Prix JSON file in place with Practice, Qualifying, Sprint, and Race telemetry.

    Args:
        json_path: Filesystem path to the target Grand Prix JSON file.
        profiles_path: Optional override path to ``track_profiles.json``.
        fetch_live: When True, fetches live session telemetry from OpenF1 REST endpoints.
        all_sessions_cache: Optional pre-fetched list of OpenF1 session metadata dicts.

    Returns:
        Enriched Grand Prix payload dictionary written back to ``json_path``.

    Raises:
        FileNotFoundError: If ``json_path`` does not exist.
        json.JSONDecodeError: If ``json_path`` does not contain valid JSON.
    """
    with open(json_path, "r", encoding="utf-8") as race_file:
        race_data: dict[str, Any] = json.load(race_file)

    drivers = race_data.get("drivers", [])
    laps = race_data.get("laps", [])
    if not drivers or not laps:
        return race_data

    if not race_data.get("corners"):
        calculate_corner_speeds(json_path, profiles_path=profiles_path)
        with open(json_path, "r", encoding="utf-8") as race_file:
            race_data = json.load(race_file)

    resolved_profiles_path = (
        profiles_path
        if profiles_path is not None
        else os.path.join(os.path.dirname(__file__), _TRACK_PROFILES_FILENAME)
    )
    track_profiles = _load_track_profiles(resolved_profiles_path)
    gp_name = str(race_data.get("race_info", {}).get("gp", "Grand Prix"))
    total_laps = int(
        race_data.get("race_info", {}).get(
            "total_laps",
            max(
                (int(lap.get("lap", 1)) for lap in laps),
                default=_DEFAULT_TOTAL_LAPS,
            ),
        )
    )
    track_profile = _resolve_track_profile(gp_name, track_profiles)
    driver_pace = _compute_driver_baseline_pace(drivers, laps)

    session_map: dict[str, int] = {}
    if fetch_live:
        sessions_list = (
            list(all_sessions_cache)
            if all_sessions_cache is not None
            else _fetch_openf1_json("sessions", {"year": _TARGET_SEASON_YEAR})
        )
        session_map = _resolve_meeting_sessions(
            json_path, gp_name, sessions_list
        )

    num_to_code, drivers_dict_by_num = (
        _fetch_session_driver_mapping(session_map, drivers)
        if fetch_live and session_map
        else ({}, {})
    )

    quali_laps_raw = (
        _fetch_openf1_json("laps", {"session_key": session_map["Qualifying"]})
        if fetch_live and "Qualifying" in session_map
        else None
    )
    quali_rc_raw = (
        _fetch_openf1_json(
            "race_control", {"session_key": session_map["Qualifying"]}
        )
        if fetch_live and "Qualifying" in session_map
        else None
    )
    quali_results_raw = (
        _fetch_openf1_json(
            "session_result", {"session_key": session_map["Qualifying"]}
        )
        if fetch_live and "Qualifying" in session_map
        else None
    )
    qualifying_block = _build_qualifying_telemetry(
        gp_name=gp_name,
        drivers=drivers,
        driver_pace=driver_pace,
        track_profile=track_profile,
        race_laps=laps,
        openf1_quali_laps=quali_laps_raw,
        openf1_quali_rc=quali_rc_raw,
        openf1_quali_results=quali_results_raw,
        num_to_code=num_to_code,
        stage_prefix="Q",
    )
    race_data["qualifying"] = qualifying_block
    if qualifying_block.get("corners"):
        race_data["corners"] = qualifying_block["corners"]

    turns_count = max(
        1,
        len(
            {
                int(c.get("turn", 1))
                for c in (race_data.get("corners") or [])
                if isinstance(c, Mapping)
            }
        )
        or int(track_profile.get("turns", _DEFAULT_TURNS_COUNT)),
    )
    race_data["track_map"] = _build_circuit_track_map(
        gp_name=gp_name,
        turns_count=turns_count,
        session_key=session_map.get("Qualifying") or session_map.get("Race"),
        openf1_laps=quali_laps_raw,
        fetch_live=fetch_live,
    )

    prac_laps_raw, prac_stints_raw, prac_results_raw = (
        _fetch_practice_session_inputs(session_map)
        if fetch_live
        else (None, None, None)
    )
    race_data["practice"] = _build_practice_telemetry(
        gp_name=gp_name,
        drivers=drivers,
        driver_pace=driver_pace,
        track_profile=track_profile,
        corners=race_data.get("corners", []),
        openf1_practice_laps=prac_laps_raw,
        openf1_practice_stints=prac_stints_raw,
        openf1_practice_results=prac_results_raw,
        num_to_code=num_to_code or None,
    )

    race_laps_raw = (
        _fetch_openf1_json("laps", {"session_key": session_map["Race"]})
        if fetch_live and "Race" in session_map
        else None
    )
    race_stints_raw = (
        _fetch_openf1_json("stints", {"session_key": session_map["Race"]})
        if fetch_live and "Race" in session_map
        else None
    )
    race_pos_raw = (
        _fetch_openf1_json("position", {"session_key": session_map["Race"]})
        if fetch_live and "Race" in session_map
        else None
    )
    race_results_raw = (
        _fetch_openf1_json(
            "session_result", {"session_key": session_map["Race"]}
        )
        if fetch_live and "Race" in session_map
        else None
    )
    if race_laps_raw and drivers_dict_by_num:
        laps, total_laps = process_laps_data(
            laps_data=race_laps_raw,
            drivers_dict=drivers_dict_by_num,
            stints_data=race_stints_raw or [],
        )
    race_classification: list[dict[str, Any]] = []
    if race_results_raw and num_to_code:
        laps, total_laps, official_winner, race_classification = (
            _calibrate_race_laps_with_session_result(
                laps=laps,
                drivers=drivers,
                openf1_session_result=race_results_raw,
                num_to_code=num_to_code,
                openf1_raw_laps=race_laps_raw,
                openf1_positions=race_pos_raw,
            )
        )
        race_data["laps"] = laps
        race_data["race_info"]["total_laps"] = total_laps
        race_data["race_info"]["winner"] = official_winner

    race_pits_raw = (
        _fetch_openf1_json("pit", {"session_key": session_map["Race"]})
        if fetch_live and "Race" in session_map
        else None
    )
    race_rc_raw = (
        _fetch_openf1_json("race_control", {"session_key": session_map["Race"]})
        if fetch_live and "Race" in session_map
        else None
    )
    race_data["race_telemetry"] = _build_race_telemetry(
        gp_name=gp_name,
        drivers=drivers,
        laps=laps,
        total_laps=total_laps,
        openf1_stints=race_stints_raw,
        openf1_pits=race_pits_raw,
        openf1_rc=race_rc_raw,
        num_to_code=num_to_code,
    )
    if race_classification:
        race_data["race_telemetry"]["classification"] = race_classification
    race_data["session_events"] = race_data["race_telemetry"]["sc_vsc_windows"]

    is_sprint = "Sprint Qualifying" in session_map and "Sprint" in session_map
    if fetch_live:
        race_data["is_sprint_weekend"] = is_sprint
    elif "is_sprint_weekend" not in race_data:
        stem = os.path.splitext(os.path.basename(json_path))[0].lower()
        race_data["is_sprint_weekend"] = stem in _SPRINT_WEEKEND_STEMS

    if is_sprint and fetch_live:
        _enrich_live_sprint_sessions(
            race_data=race_data,
            gp_name=gp_name,
            drivers=drivers,
            driver_pace=driver_pace,
            track_profile=track_profile,
            laps=laps,
            session_map=session_map,
            num_to_code=num_to_code,
            drivers_dict_by_num=drivers_dict_by_num,
        )
    elif (
        race_data.get("is_sprint_weekend")
        and "sprint_qualifying" not in race_data
    ):
        _synthesize_offline_sprint_sessions(
            race_data=race_data,
            gp_name=gp_name,
            drivers=drivers,
            driver_pace=driver_pace,
            track_profile=track_profile,
            laps=laps,
            total_laps=total_laps,
        )

    with open(json_path, "w", encoding="utf-8") as race_file:
        json.dump(race_data, race_file, indent=_JSON_INDENT_SPACES)

    print(
        f"Enriched weekend telemetry (sprint={race_data.get('is_sprint_weekend')}) "
        f"for {gp_name} -> {json_path}"
    )
    return race_data


def enrich_all_races(
    races_dir: str | None = None,
    fetch_live: bool = True,
) -> list[dict[str, Any]]:
    """Enriches all Grand Prix JSON files in the target directory with weekend telemetry.

    Args:
        races_dir: Optional directory path containing Grand Prix JSON files.
            Defaults to ``../src/assets/data/races/2026`` relative to this module.
        fetch_live: Whether to fetch live OpenF1 session data.

    Returns:
        List of enriched race data dictionaries in sorted filename order.
    """
    target_directory = (
        races_dir
        if races_dir is not None
        else os.path.join(os.path.dirname(__file__), *_DEFAULT_RACES_RELATIVE_DIR)
    )
    race_json_paths = sorted(glob.glob(os.path.join(target_directory, "*.json")))
    all_sessions = (
        _fetch_openf1_json("sessions", {"year": _TARGET_SEASON_YEAR})
        if fetch_live
        else []
    )
    if fetch_live:
        print(
            f"Fetched {len(all_sessions)} total {_TARGET_SEASON_YEAR} sessions from OpenF1."
        )
    enriched_races: list[dict[str, Any]] = []
    for race_json_path in race_json_paths:
        enriched_races.append(
            generate_weekend_telemetry(
                race_json_path,
                fetch_live=fetch_live,
                all_sessions_cache=all_sessions,
            )
        )
    return enriched_races


def _main() -> None:
    """CLI entrypoint that enriches all 2026 Grand Prix JSON files using live OpenF1 data."""
    enrich_all_races(fetch_live=True)


if __name__ == "__main__":
    _main()
