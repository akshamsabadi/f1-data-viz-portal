"""Generates multi-session weekend telemetry (Practice, Qualifying, Sprint, Race) for F1 datasets.

This module enriches Grand Prix JSON files with structured ``practice``,
``qualifying``, ``sprint_qualifying``, ``sprint``, and ``race_telemetry`` blocks,
pulling real session telemetry from the OpenF1 API when ``fetch_live=True`` and
falling back to circuit-and-grid-informed deterministic models when offline.
"""

from collections import defaultdict
from collections.abc import Mapping, Sequence
from datetime import datetime
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

_OPENF1_BASE_URL: Final[str] = "https://api.openf1.org/v1"
_API_DELAY_SECONDS: Final[float] = 0.38
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
_SPEED_DECIMALS: Final[int] = 1
_FUEL_BURN_EFFECT_SEC_PER_LAP: Final[float] = 0.055
_TRACE_POINTS_COUNT: Final[int] = 51
_Q3_CUTOFF_RANK: Final[int] = 10
_Q2_CUTOFF_RANK: Final[int] = 16

# Explicit mapping from filename stem to 2026 OpenF1 meeting_key
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


def _deterministic_hash(seed_text: str) -> int:
    """Computes a stable positive integer hash from a string seed."""
    total = 2166136261
    for char in seed_text:
        total = ((total ^ ord(char)) * 16777619) & 0xFFFFFFFF
    return total


def _seeded_unit_float(seed_text: str) -> float:
    """Maps a string seed deterministically to a float in ``[0.0, 1.0]``."""
    return (_deterministic_hash(seed_text) % 10000) / 10000.0


def _fetch_openf1_json(endpoint: str, params: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Queries an OpenF1 REST endpoint with retry and rate-limit backoff."""
    url = f"{_OPENF1_BASE_URL}/{endpoint}"
    for attempt in range(6):
        try:
            time.sleep(_API_DELAY_SECONDS)
            resp = requests.get(url, params=params, timeout=15)
            if resp.status_code == 200:
                payload = resp.json()
                if isinstance(payload, list):
                    return payload
                return []
            if resp.status_code in (429, 500, 502, 503, 504):
                time.sleep(1.5 * (attempt + 1))
                continue
        except Exception as err:
            print(f"  Warning: OpenF1 request failed ({endpoint} {params}): {err}")
            time.sleep(0.8 * (attempt + 1))
    return []


def _parse_int_position(raw_pos: Any) -> int | None:
    """Parses an integer position from an OpenF1 session_result record."""
    if isinstance(raw_pos, int):
        return raw_pos
    if isinstance(raw_pos, str) and raw_pos.strip().isdigit():
        return int(raw_pos.strip())
    return None


def _parse_iso_timestamp(iso_str: str | None) -> float | None:
    """Parses an ISO-8601 timestamp string into Unix epoch seconds."""
    if not iso_str:
        return None
    try:
        return datetime.fromisoformat(iso_str.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


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
    """
    max_raw_lap = max((int(l.get("lap", 0)) for l in laps), default=0)
    default_winner = "VER"
    for l_rec in laps:
        if int(l_rec.get("lap", 0)) == max_raw_lap and int(l_rec.get("position", 99)) == 1:
            default_winner = str(l_rec["driver"])
            break

    if not openf1_session_result or not num_to_code:
        return [dict(l) for l in laps], max_raw_lap, default_winner, []

    driver_meta = {str(d["code"]): d for d in drivers}
    code_to_num = {str(code): int(num) for num, code in num_to_code.items()}
    result_by_code: dict[str, Mapping[str, Any]] = {}
    for row in openf1_session_result:
        d_num = row.get("driver_number")
        code = num_to_code.get(int(d_num)) if d_num is not None else None
        if code and code in driver_meta:
            result_by_code[code] = row

    if not result_by_code:
        return [dict(l) for l in laps], max_raw_lap, default_winner, []

    official_max_lap = max(
        (
            int(r.get("number_of_laps") or 0)
            for r in result_by_code.values()
        ),
        default=max_raw_lap,
    )
    if official_max_lap <= 0:
        official_max_lap = max_raw_lap

    def _result_sort_key(code: str) -> tuple[int, int, int]:
        row = result_by_code.get(code)
        if not row:
            return (2, 999, 0)
        pos = _parse_int_position(row.get("position"))
        laps_done = int(row.get("number_of_laps") or 0)
        if pos is not None:
            return (0, pos, -laps_done)
        return (1, 999, -laps_done)

    ordered_codes = sorted(driver_meta.keys(), key=_result_sort_key)
    official_rank_by_code = {code: idx + 1 for idx, code in enumerate(ordered_codes)}
    official_winner = ordered_codes[0] if ordered_codes else default_winner

    laps_by_driver: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for l_rec in laps:
        laps_by_driver[str(l_rec["driver"])].append(dict(l_rec))

    # Compute field clean median lap time from Laps >= 2
    lap2plus_times = [
        float(l["time"])
        for l in laps
        if int(l.get("lap", 0)) >= 2 and 45.0 <= float(l.get("time", 0)) <= 165.0
    ]
    field_median = statistics.median(lap2plus_times) if lap2plus_times else 90.0
    min_valid_lap_time = round(field_median * 0.88, _TIME_DECIMALS)

    # Parse OpenF1 raw lap timestamps & FIA position timeline when available
    end_ts_by_code_lap: dict[tuple[str, int], float] = {}
    end_ts_by_lap: dict[int, list[float]] = defaultdict(list)
    if openf1_raw_laps:
        raw_by_code: dict[str, dict[int, Mapping[str, Any]]] = defaultdict(dict)
        for rl in openf1_raw_laps:
            d_num = rl.get("driver_number")
            l_num = rl.get("lap_number")
            code = num_to_code.get(int(d_num)) if d_num is not None else None
            if code and l_num is not None:
                raw_by_code[code][int(l_num)] = rl

        for code, lmap in raw_by_code.items():
            for l_no in range(1, official_max_lap + 1):
                rec = lmap.get(l_no)
                rec_next = lmap.get(l_no + 1)
                ts_next = _parse_iso_timestamp(rec_next.get("date_start")) if rec_next else None
                ts_curr = _parse_iso_timestamp(rec.get("date_start")) if rec else None
                dur_curr = rec.get("lap_duration") if rec else None
                if ts_next is not None:
                    end_ts_by_code_lap[(code, l_no)] = ts_next
                    end_ts_by_lap[l_no].append(ts_next)
                elif ts_curr is not None and dur_curr is not None:
                    t_val = ts_curr + float(dur_curr)
                    end_ts_by_code_lap[(code, l_no)] = t_val
                    end_ts_by_lap[l_no].append(t_val)
            # Back-fill missing internal crossing timestamps (e.g. Lap 1 when Lap 2 record was omitted)
            for l_no in range(official_max_lap, 0, -1):
                if (code, l_no) not in end_ts_by_code_lap and (code, l_no + 1) in end_ts_by_code_lap:
                    rec_p2 = lmap.get(l_no + 2)
                    dur_est = (
                        float(rec_p2["lap_duration"])
                        if (rec_p2 and rec_p2.get("lap_duration"))
                        else field_median
                    )
                    t_val = end_ts_by_code_lap[(code, l_no + 1)] - dur_est
                    end_ts_by_code_lap[(code, l_no)] = t_val
                    end_ts_by_lap[l_no].append(t_val)

    pos_timeline_by_code: dict[str, list[tuple[float, int]]] = defaultdict(list)
    if openf1_positions:
        for p_rec in openf1_positions:
            d_num = p_rec.get("driver_number")
            p_val = _parse_int_position(p_rec.get("position"))
            ts = _parse_iso_timestamp(p_rec.get("date"))
            code = num_to_code.get(int(d_num)) if d_num is not None else None
            if code and p_val is not None and ts is not None:
                pos_timeline_by_code[code].append((ts, p_val))
        for code in pos_timeline_by_code:
            pos_timeline_by_code[code].sort(key=lambda item: item[0])

    def _fia_pos_at(code: str, t_ref: float) -> int:
        plist = pos_timeline_by_code.get(code)
        if not plist:
            return official_rank_by_code.get(code, 99)
        cur_p = plist[0][1]
        for ts, p_val in plist:
            if ts <= t_ref:
                cur_p = p_val
            else:
                break
        return cur_p

    # Determine Lap 1 order and realistic standing-start Lap 1 times
    lap1_ts_list = sorted(end_ts_by_lap.get(1, []))
    t_ref_lap1 = lap1_ts_list[0] + 2.0 if lap1_ts_list else 0.0
    if pos_timeline_by_code and t_ref_lap1 > 0:
        lap1_ordered_codes = sorted(
            ordered_codes,
            key=lambda c: (
                _fia_pos_at(c, t_ref_lap1),
                end_ts_by_code_lap.get((c, 1), float("inf")),
                official_rank_by_code.get(c, 99),
            ),
        )
    elif lap1_ts_list:
        lap1_ordered_codes = sorted(
            ordered_codes,
            key=lambda c: (
                end_ts_by_code_lap.get((c, 1), float("inf")),
                official_rank_by_code.get(c, 99),
            ),
        )
    else:
        lap1_ordered_codes = list(ordered_codes)

    lap1_pos_by_code = {c: idx + 1 for idx, c in enumerate(lap1_ordered_codes)}
    leader_lap1_end_ts = min(lap1_ts_list) if lap1_ts_list else None
    leader_lap1_time = round(field_median + 3.5, _TIME_DECIMALS)

    lap1_time_by_code: dict[str, float] = {}
    prev_lap1_t = leader_lap1_time - 0.15
    for idx_c, c in enumerate(lap1_ordered_codes):
        if idx_c == 0:
            t1 = leader_lap1_time
        else:
            c_ts = end_ts_by_code_lap.get((c, 1))
            if c_ts is not None and leader_lap1_end_ts is not None:
                raw_gap1 = c_ts - leader_lap1_end_ts
                gap1 = max(idx_c * 0.28, min(16.5, raw_gap1))
            else:
                gap1 = idx_c * 0.42
            t1 = max(prev_lap1_t + 0.12, leader_lap1_time + gap1)
        t1 = round(t1, _TIME_DECIMALS)
        lap1_time_by_code[c] = t1
        prev_lap1_t = t1

    calibrated_by_driver: dict[str, list[dict[str, Any]]] = {}
    official_classification: list[dict[str, Any]] = []

    # First pass: build contiguous laps 1..target_laps with genuine lap times
    for code in ordered_codes:
        rank = official_rank_by_code[code]
        row = result_by_code.get(code, {})
        raw_target_laps = row.get("number_of_laps")
        drv_laps = sorted(
            laps_by_driver.get(code, []), key=lambda item: int(item["lap"])
        )

        if raw_target_laps is not None:
            target_laps = min(official_max_lap, max(0, int(raw_target_laps)))
        else:
            target_laps = min(
                official_max_lap,
                max((int(l["lap"]) for l in drv_laps), default=0),
            )

        is_dns = bool(row.get("dns")) or target_laps == 0
        if is_dns or target_laps == 0:
            calibrated_by_driver[code] = []
            continue

        # Strip any phantom cooldown laps beyond target_laps
        drv_laps = [l for l in drv_laps if int(l["lap"]) <= target_laps]
        existing_by_lap = {int(l["lap"]): l for l in drv_laps}
        clean_drv_times = [
            float(l["time"])
            for l in drv_laps
            if int(l.get("lap", 0)) >= 2 and float(l.get("time", 0)) >= min_valid_lap_time
        ]
        drv_median = statistics.median(clean_drv_times) if clean_drv_times else field_median
        last_comp = str(drv_laps[0].get("compound", "MEDIUM")) if drv_laps else "MEDIUM"
        last_life = int(drv_laps[0].get("tyre_life", 1)) if drv_laps else 1

        contiguous_laps: list[dict[str, Any]] = []
        for l_no in range(1, target_laps + 1):
            if l_no in existing_by_lap:
                rec = dict(existing_by_lap[l_no])
                last_comp = str(rec.get("compound", last_comp))
                last_life = int(rec.get("tyre_life", last_life))
            else:
                last_life += 1
                rec = {
                    "driver": code,
                    "lap": l_no,
                    "time": round(drv_median, _TIME_DECIMALS),
                    "compound": last_comp,
                    "tyre_life": last_life,
                    "position": rank,
                    "session_time": 0.0,
                    "interpolated": True,
                }

            # Ensure Lap 1 uses realistic standing-start time when openf1_raw_laps is present or if Lap 1 was glitched
            if l_no == 1:
                if openf1_raw_laps is not None or float(rec.get("time", 0)) < min_valid_lap_time:
                    rec["time"] = lap1_time_by_code.get(code, leader_lap1_time)
            else:
                # Guardrail: never allow an unrealistic/glitched lap duration < 88% of field median
                if float(rec.get("time", 0)) < min_valid_lap_time:
                    rec["time"] = round(drv_median, _TIME_DECIMALS)
                    rec["interpolated"] = True

            contiguous_laps.append(rec)

        # Accumulate genuine session_time from individual lap times
        cum_t = 0.0
        for rec in contiguous_laps:
            cum_t = round(cum_t + float(rec["time"]), _TIME_DECIMALS)
            rec["session_time"] = cum_t

        calibrated_by_driver[code] = contiguous_laps

    # Determine winner's final session_time / duration
    p1_row = result_by_code.get(official_winner, {})
    p1_raw_dur = p1_row.get("duration")
    p1_laps = calibrated_by_driver.get(official_winner, [])
    if isinstance(p1_raw_dur, (int, float)) and float(p1_raw_dur) > 0 and openf1_raw_laps is None:
        winner_duration = float(p1_raw_dur)
    elif p1_laps:
        winner_duration = float(p1_laps[-1]["session_time"])
    elif isinstance(p1_raw_dur, (int, float)) and float(p1_raw_dur) > 0:
        winner_duration = float(p1_raw_dur)
    else:
        winner_duration = float(official_max_lap * field_median)

    # Second pass: finalize classification and ensure final-lap session_time respects official rank without mutating l["time"]
    for code in ordered_codes:
        rank = official_rank_by_code[code]
        meta = driver_meta[code]
        row = result_by_code.get(code, {})
        contiguous_laps = calibrated_by_driver.get(code, [])
        target_laps = len(contiguous_laps)
        is_dns = bool(row.get("dns")) or target_laps == 0
        is_dsq = bool(row.get("dsq")) and not is_dns
        is_dnf = (bool(row.get("dnf")) or is_dsq) and not is_dns

        if is_dns or target_laps == 0:
            official_classification.append(
                {
                    "driver": code,
                    "name": str(meta.get("name", code)),
                    "team": str(meta.get("team", "")),
                    "color": str(meta.get("color", "#888888")),
                    "position": rank,
                    "rank": rank,
                    "laps_completed": 0,
                    "status": "DNS",
                    "duration": None,
                    "gap_to_leader": "DNS",
                    "is_dnf": False,
                    "is_dns": True,
                }
            )
            continue

        raw_dur = row.get("duration")
        raw_gap = row.get("gap_to_leader")
        final_session_time = float(contiguous_laps[-1]["session_time"])

        if target_laps == official_max_lap and not is_dnf:
            status_str = "FINISHER"
            if rank == 1:
                final_session_time = round(winner_duration, _TIME_DECIMALS)
            elif isinstance(raw_gap, (int, float)) and float(raw_gap) >= 0:
                final_session_time = round(winner_duration + float(raw_gap), _TIME_DECIMALS)
            elif isinstance(raw_dur, (int, float)) and isinstance(p1_raw_dur, (int, float)) and float(raw_dur) > float(p1_raw_dur):
                final_session_time = round(winner_duration + (float(raw_dur) - float(p1_raw_dur)), _TIME_DECIMALS)
        elif not is_dnf:
            status_str = "LAPPED"
            if final_session_time < winner_duration:
                final_session_time = round(winner_duration + rank * 0.45, _TIME_DECIMALS)
        else:
            status_str = "DNF"

        # Enforce monotonic final_session_time among drivers with identical target_laps
        for prev_item in official_classification:
            if int(prev_item["laps_completed"]) == target_laps and prev_item.get("duration") is not None:
                prev_dur = float(prev_item["duration"])
                if final_session_time <= prev_dur:
                    final_session_time = round(prev_dur + 0.045, _TIME_DECIMALS)

        contiguous_laps[-1]["session_time"] = final_session_time
        status_out = "DSQ" if is_dsq else status_str
        official_classification.append(
            {
                "driver": code,
                "name": str(meta.get("name", code)),
                "team": str(meta.get("team", "")),
                "color": str(meta.get("color", "#888888")),
                "position": rank,
                "rank": rank,
                "laps_completed": target_laps,
                "status": status_out,
                "duration": final_session_time,
                "gap_to_leader": (
                    0.0
                    if rank == 1
                    else round(final_session_time - winner_duration, _TIME_DECIMALS)
                    if status_out == "FINISHER"
                    else f"+{official_max_lap - target_laps} {'Lap' if official_max_lap - target_laps == 1 else 'Laps'}"
                    if status_out == "LAPPED"
                    else status_out
                ),
                "is_dnf": is_dnf,
                "is_dns": False,
            }
        )

    # Flatten and assign per-lap positions 1..N using FIA /v1/position timeline + crossing timestamps
    final_laps: list[dict[str, Any]] = []
    for lap_no in range(1, official_max_lap + 1):
        lap_group = [
            drv_laps[lap_no - 1]
            for drv_laps in calibrated_by_driver.values()
            if len(drv_laps) >= lap_no
        ]
        if lap_no == official_max_lap:
            lap_group.sort(
                key=lambda item: official_rank_by_code.get(str(item["driver"]), 99)
            )
        elif pos_timeline_by_code and end_ts_by_lap.get(lap_no):
            ts_list = sorted(end_ts_by_lap[lap_no])
            t_ref = ts_list[0] + 2.0
            lap_group.sort(
                key=lambda item: (
                    _fia_pos_at(str(item["driver"]), t_ref),
                    end_ts_by_code_lap.get((str(item["driver"]), lap_no), float("inf")),
                    official_rank_by_code.get(str(item["driver"]), 99),
                )
            )
        elif end_ts_by_lap.get(lap_no):
            lap_group.sort(
                key=lambda item: (
                    end_ts_by_code_lap.get((str(item["driver"]), lap_no), float("inf")),
                    official_rank_by_code.get(str(item["driver"]), 99),
                )
            )
        else:
            lap_group.sort(
                key=lambda item: (
                    float(item["session_time"]),
                    official_rank_by_code.get(str(item["driver"]), 99),
                )
            )
        for pos_idx, rec in enumerate(lap_group, start=1):
            rec["position"] = pos_idx
            final_laps.append(rec)

    return final_laps, official_max_lap, official_winner, official_classification


def _extract_sc_vsc_windows(
    race_control_events: Sequence[Mapping[str, Any]],
    laps: Sequence[Mapping[str, Any]],
    total_laps: int,
) -> list[dict[str, Any]]:
    """Extracts Safety Car (SC) and Virtual Safety Car (VSC) lap windows.

    Uses OpenF1 ``/race_control`` SafetyCar messages when available, or detects
    field-wide slow laps from ``laps`` when offline.
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

        if cat == "SafetyCar" or "SAFETY CAR" in msg or "VSC" in msg:
            if "VSC DEPLOYED" in msg or "VIRTUAL SAFETY CAR DEPLOYED" in msg:
                if active_type is None:
                    active_type = "VSC"
                    start_lap = lap_int
            elif "SC DEPLOYED" in msg or (
                "SAFETY CAR DEPLOYED" in msg and "VIRTUAL" not in msg
            ):
                if active_type == "VSC" and start_lap is not None:
                    windows.append(
                        {
                            "type": "VSC",
                            "start_lap": start_lap,
                            "end_lap": max(start_lap, lap_int - 1),
                            "label": f"VSC · L{start_lap}–L{max(start_lap, lap_int - 1)}",
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
                    label = (
                        f"{active_type} · L{start_lap}"
                        if start_lap == end_lap
                        else f"{active_type} · L{start_lap}–L{end_lap}"
                    )
                    windows.append(
                        {
                            "type": active_type,
                            "start_lap": start_lap,
                            "end_lap": end_lap,
                            "label": label,
                        }
                    )
                    active_type = None
                    start_lap = None

    if active_type is not None and start_lap is not None:
        end_lap = min(total_laps, start_lap + 2)
        windows.append(
            {
                "type": active_type,
                "start_lap": start_lap,
                "end_lap": end_lap,
                "label": f"{active_type} · L{start_lap}–L{end_lap}",
            }
        )

    if windows:
        # Merge overlapping or adjacent windows of same type
        merged: list[dict[str, Any]] = []
        for win in sorted(windows, key=lambda item: int(item["start_lap"])):
            if (
                merged
                and merged[-1]["type"] == win["type"]
                and int(win["start_lap"]) <= int(merged[-1]["end_lap"]) + 1
            ):
                merged[-1]["end_lap"] = max(
                    int(merged[-1]["end_lap"]), int(win["end_lap"])
                )
                s_lap = int(merged[-1]["start_lap"])
                e_lap = int(merged[-1]["end_lap"])
                w_type = merged[-1]["type"]
                merged[-1]["label"] = (
                    f"{w_type} · L{s_lap}"
                    if s_lap == e_lap
                    else f"{w_type} · L{s_lap}–L{e_lap}"
                )
            else:
                merged.append(win)
        return merged

    # Fallback: detect field-wide neutralizations from lap times (laps >= 2 where median lap time > global median * 1.18)
    valid_times = [
        float(l["time"])
        for l in laps
        if int(l.get("lap", 0)) > 1 and float(l.get("time", 0)) > 0
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
        if lap_med > global_median * 1.28:
            neutralized_laps.append((lap_no, "SC"))
        elif lap_med > global_median * 1.15:
            neutralized_laps.append((lap_no, "VSC"))

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


def _compute_driver_baseline_pace(
    drivers: Sequence[Mapping[str, Any]],
    laps: Sequence[Mapping[str, Any]],
) -> dict[str, float]:
    """Computes each driver's clean baseline race pace from the fastest 25% of laps."""
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
    global_fallback = min(all_clean_times) if all_clean_times else 90.0

    driver_pace: dict[str, float] = {}
    for idx, driver in enumerate(drivers):
        code = str(driver["code"])
        times = sorted(laps_by_driver.get(code, []))
        if times:
            sample_count = max(1, min(5, len(times) // 3 or 1))
            driver_pace[code] = sum(times[:sample_count]) / sample_count
        else:
            driver_pace[code] = global_fallback + 1.8 + (idx * 0.12)

    return driver_pace


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
    """Generates the ``practice`` telemetry block using real OpenF1 practice data when available."""
    fastest_baseline = min(driver_pace.values()) if driver_pace else 90.0
    practice_pole_base = fastest_baseline * 0.978

    team_corner_means: dict[str, float] = defaultdict(float)
    team_corner_counts: dict[str, int] = defaultdict(int)
    for corner in corners:
        team_name = str(corner["team"])
        team_corner_means[team_name] += float(corner["speed"])
        team_corner_counts[team_name] += 1

    for team_name, count in team_corner_counts.items():
        if count > 0:
            team_corner_means[team_name] /= count

    base_speed = float(track_profile.get("base_speed", 160))
    variation = float(track_profile.get("variation", 60))
    circuit_top_speed_base = 292.0 + (base_speed * 0.22) + (variation * 0.12)

    # Extract real practice metrics per driver if OpenF1 practice laps/results are provided
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
            if dur is not None and 55.0 < float(dur) < 160.0:
                f_dur = float(dur)
                if code not in real_best_lap or f_dur < real_best_lap[code]:
                    real_best_lap[code] = f_dur
            for sp_key in ("st_speed", "i2_speed", "i1_speed"):
                sp_val = lap_rec.get(sp_key)
                if sp_val is not None and 220.0 < float(sp_val) < 375.0:
                    if code not in real_speed_trap or float(sp_val) > real_speed_trap[code]:
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
            if isinstance(dur, (int, float)) and 55.0 < float(dur) < 160.0:
                real_best_lap[code] = float(dur)

    if openf1_practice_stints and num_to_code:
        for stint_rec in openf1_practice_stints:
            d_num = stint_rec.get("driver_number")
            code = num_to_code.get(int(d_num)) if d_num is not None else None
            if not code:
                continue
            comp = str(stint_rec.get("compound") or "MEDIUM").upper()
            if comp not in ("SOFT", "MEDIUM", "HARD"):
                comp = "MEDIUM"
            l_start = int(stint_rec.get("lap_start") or 1)
            l_end = int(stint_rec.get("lap_end") or l_start)
            count = max(1, l_end - l_start + 1)
            real_comp_counts[code][comp] += count

    if real_best_lap:
        practice_pole_base = min(real_best_lap.values())

    raw_entries: list[dict[str, Any]] = []
    stint_laps: list[dict[str, Any]] = []

    deg_rates = {
        "SOFT": round(0.078 + (variation / 2500.0), 3),
        "MEDIUM": round(0.049 + (variation / 3500.0), 3),
        "HARD": round(0.029 + (variation / 5000.0), 3),
    }
    compound_offsets = {"SOFT": 0.0, "MEDIUM": 0.65, "HARD": 1.32}

    for driver in drivers:
        code = str(driver["code"])
        team = str(driver["team"])
        color = str(driver["color"])
        seed_key = f"{gp_name}_{code}_practice"

        pace_ratio = driver_pace.get(code, fastest_baseline + 1.5) - fastest_baseline
        practice_jitter = (_seeded_unit_float(seed_key) - 0.45) * 0.42
        best_lap = round(
            real_best_lap.get(
                code,
                practice_pole_base + (pace_ratio * 0.88) + max(-0.18, practice_jitter),
            ),
            _TIME_DECIMALS,
        )

        u_comp = _seeded_unit_float(f"{seed_key}_comp")
        best_compound = (
            "SOFT" if u_comp < 0.78 else ("MEDIUM" if u_comp < 0.93 else "HARD")
        )

        c_counts = real_comp_counts.get(code)
        if c_counts and sum(c_counts.values()) >= 12:
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

        team_mean_corner = team_corner_means.get(team, base_speed)
        driver_corner_offset = (_seeded_unit_float(f"{seed_key}_corner") - 0.5) * 1.8
        mean_corner_kmh = round(
            team_mean_corner + driver_corner_offset, _SPEED_DECIMALS
        )

        aero_trim = (_seeded_unit_float(f"{seed_key}_aero") - 0.5) * 6.5
        fallback_trap = (
            circuit_top_speed_base
            + (
                fastest_baseline
                / max(driver_pace.get(code, fastest_baseline), 60.0)
                - 1.0
            )
            * 35.0
            - (aero_trim * 0.55)
        )
        speed_trap_kmh = round(
            real_speed_trap.get(code, fallback_trap), _SPEED_DECIMALS
        )

        long_run_compound = (
            "MEDIUM" if _seeded_unit_float(f"{seed_key}_lrc") < 0.65 else "HARD"
        )
        stint_len = 10 + int(_seeded_unit_float(f"{seed_key}_lrlen") * 5)
        long_run_base = (
            practice_pole_base
            + 3.65
            + (pace_ratio * 0.82)
            + compound_offsets[long_run_compound]
        )

        driver_long_run_times: list[float] = []
        for tyre_age in range(1, stint_len + 1):
            lap_noise = (
                math.sin(tyre_age * 1.7 + _deterministic_hash(seed_key) % 13) * 0.16
            )
            lap_val = round(
                long_run_base
                + (tyre_age * deg_rates[long_run_compound])
                + lap_noise,
                _TIME_DECIMALS,
            )
            driver_long_run_times.append(lap_val)
            stint_laps.append(
                {
                    "driver": code,
                    "team": team,
                    "color": color,
                    "compound": long_run_compound,
                    "tyre_life": tyre_age,
                    "time": lap_val,
                }
            )

        soft_stint_base = practice_pole_base + 3.05 + (pace_ratio * 0.85)
        for tyre_age in range(1, 8):
            lap_noise = (
                math.cos(tyre_age * 1.3 + _deterministic_hash(seed_key) % 11) * 0.14
            )
            stint_laps.append(
                {
                    "driver": code,
                    "team": team,
                    "color": color,
                    "compound": "SOFT",
                    "tyre_life": tyre_age,
                    "time": round(
                        soft_stint_base
                        + (tyre_age * deg_rates["SOFT"])
                        + lap_noise,
                        _TIME_DECIMALS,
                    ),
                }
            )

        sorted_lr = sorted(driver_long_run_times)
        q25_idx = max(0, len(sorted_lr) // 4)
        q75_idx = min(len(sorted_lr) - 1, (len(sorted_lr) * 3) // 4)

        raw_entries.append(
            {
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
        )

    if official_prac_pos:
        raw_entries.sort(
            key=lambda item: (
                official_prac_pos.get(str(item["driver"]), 99),
                float(item["best_lap"]),
            )
        )
    else:
        raw_entries.sort(key=lambda item: float(item["best_lap"]))
    p1_best = float(raw_entries[0]["best_lap"]) if raw_entries else practice_pole_base

    for idx, entry in enumerate(raw_entries):
        entry["rank"] = idx + 1
        entry["gap_to_p1"] = round(
            max(0.0, float(entry["best_lap"]) - p1_best), _TIME_DECIMALS
        )

    degradation_slopes: list[dict[str, Any]] = []
    for comp in ("SOFT", "MEDIUM", "HARD"):
        comp_base = round(
            practice_pole_base + 3.25 + compound_offsets[comp], _TIME_DECIMALS
        )
        slope = deg_rates[comp]
        curve_points = [
            {
                "tyre_life": age,
                "predicted_time": round(comp_base + age * slope, _TIME_DECIMALS),
            }
            for age in range(1, 15)
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

    return {
        "classification": raw_entries,
        "stint_laps": stint_laps,
        "degradation_slopes": degradation_slopes,
    }


def _build_qualifying_traces(
    gp_name: str,
    results: Sequence[Mapping[str, Any]],
    track_profile: Mapping[str, int],
) -> dict[str, Any]:
    """Generates normalized 0-100% lap distance telemetry traces for Qualifying."""
    distance_pct = [i * 2 for i in range(_TRACE_POINTS_COUNT)]
    num_turns = int(track_profile.get("turns", 15))
    base_speed = float(track_profile.get("base_speed", 160))
    variation = float(track_profile.get("variation", 60))

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

    pole_time = float(results[0]["best_time"]) if results else 88.0
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
            inst_speed = round(max(75.0, min(352.0, inst_speed)), _SPEED_DECIMALS)

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
    """Generates Qualifying or Sprint Qualifying telemetry using official OpenF1 results and laps."""
    fastest_baseline = min(driver_pace.values()) if driver_pace else 90.0
    pole_target = round(fastest_baseline * 0.962, _TIME_DECIMALS)

    turns = int(track_profile.get("turns", 15))
    s1_ratio = 0.285 + ((turns % 5) - 2) * 0.008
    s2_ratio = 0.415 - ((turns % 4) - 1.5) * 0.006
    s3_ratio = 1.0 - s1_ratio - s2_ratio

    # Check if we have real OpenF1 Qualifying laps and/or official /session_result
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
                # Keep the earliest start timestamp for each phase
                if int(qp) not in phase_starts:
                    phase_starts[int(qp)] = str(event["date"])

        valid_durations = [
            float(l["lap_duration"])
            for l in openf1_quali_laps
            if l.get("lap_duration") is not None and 50.0 < float(l["lap_duration"]) < 150.0
        ]
        min_session_lap = min(valid_durations) if valid_durations else pole_target
        max_flying_lap = min_session_lap * 1.12

        for lap_rec in openf1_quali_laps:
            d_num = lap_rec.get("driver_number")
            code = num_to_code.get(int(d_num)) if d_num is not None else None
            if not code or code not in real_q_times:
                continue

            # Track personal best sectors across all laps
            for s_idx, s_field in enumerate(
                ("duration_sector_1", "duration_sector_2", "duration_sector_3"),
                start=1,
            ):
                s_val = lap_rec.get(s_field)
                if s_val is not None and 10.0 < float(s_val) < 65.0:
                    s_key = f"s{s_idx}"
                    if (
                        s_key not in real_best_sectors[code]
                        or float(s_val) < real_best_sectors[code][s_key]
                    ):
                        real_best_sectors[code][s_key] = float(s_val)

            dur = lap_rec.get("lap_duration")
            ds = str(lap_rec.get("date_start") or "")
            if dur is None or float(dur) <= 50.0 or float(dur) > max_flying_lap:
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
                if phase == 3 or (
                    phase == 2 and real_q_times[code][3] is None
                ) or (
                    phase == 1
                    and real_q_times[code][2] is None
                    and real_q_times[code][3] is None
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

    # Apply authoritative OpenF1 /session_result positions and [Q1, Q2, Q3] durations when available
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
                    if isinstance(stage_t, (int, float)) and 50.0 < float(stage_t) < 160.0:
                        real_q_times[code][phase_idx + 1] = round(
                            float(stage_t), _TIME_DECIMALS
                        )
                    elif stage_t is None:
                        real_q_times[code][phase_idx + 1] = None

    has_real_quali = bool(official_quali_pos) or any(
        qt[3] is not None or qt[2] is not None or qt[1] is not None
        for qt in real_q_times.values()
    )

    if official_quali_pos:
        def _official_quali_sort_key(drv: Mapping[str, Any]) -> tuple[int, int, float]:
            code = str(drv["code"])
            pos = official_quali_pos.get(code)
            if pos is not None:
                return (0, pos, 0.0)
            qt = real_q_times.get(code, {1: None, 2: None, 3: None})
            best_q = qt[3] or qt[2] or qt[1] or driver_pace.get(code, 999.0)
            return (1, 999, float(best_q))

        ordered_drivers = sorted(drivers, key=_official_quali_sort_key)
    elif has_real_quali:
        def _quali_sort_key(drv: Mapping[str, Any]) -> tuple[int, float]:
            code = str(drv["code"])
            qt = real_q_times.get(code, {1: None, 2: None, 3: None})
            if qt[3] is not None:
                return (0, float(qt[3]))
            if qt[2] is not None:
                return (1, float(qt[2]))
            if qt[1] is not None:
                return (2, float(qt[1]))
            return (3, driver_pace.get(code, 999.0))

        ordered_drivers = sorted(drivers, key=_quali_sort_key)
    else:
        # Fallback: Anchor qualifying order to Lap 1 starting grid positions when available
        lap1_pos: dict[str, int] = {}
        for l_rec in race_laps:
            if int(l_rec.get("lap", 0)) == 1 and l_rec.get("position") is not None:
                lap1_pos[str(l_rec["driver"])] = int(l_rec["position"])

        ordered_drivers = sorted(
            drivers,
            key=lambda d: (
                lap1_pos.get(str(d["code"]), 99),
                driver_pace.get(str(d["code"]), fastest_baseline + 2.0),
            ),
        )

    results: list[dict[str, Any]] = []
    for idx, driver in enumerate(ordered_drivers):
        grid_pos = idx + 1
        code = str(driver["code"])
        team = str(driver["team"])
        color = str(driver["color"])
        seed_base = f"{gp_name}_{code}_{stage_prefix}"

        qt = real_q_times.get(code, {1: None, 2: None, 3: None})
        if has_real_quali and (
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
        else:
            # Offline deterministic fallback with strict Q1 >= Q2 >= Q3 progression
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

        # Sector times (real OpenF1 sectors when complete, else proportional split)
        raw_s1, raw_s2, raw_s3 = real_lap_sectors.get(code, (None, None, None))
        if (
            raw_s1 is not None
            and raw_s2 is not None
            and raw_s3 is not None
            and abs((raw_s1 + raw_s2 + raw_s3) - best_time) < 0.25
        ):
            s1 = round(raw_s1, _TIME_DECIMALS)
            s2 = round(raw_s2, _TIME_DECIMALS)
            s3 = round(best_time - s1 - s2, _TIME_DECIMALS)
        else:
            s1_jitter = (_seeded_unit_float(f"{seed_base}_s1") - 0.5) * 0.08
            s2_jitter = (_seeded_unit_float(f"{seed_base}_s2") - 0.5) * 0.09
            s1 = round(best_time * s1_ratio + s1_jitter, _TIME_DECIMALS)
            s2 = round(best_time * s2_ratio + s2_jitter, _TIME_DECIMALS)
            s3 = round(best_time - s1 - s2, _TIME_DECIMALS)

        # Ideal sectors (personal best across all laps in session)
        pbs = real_best_sectors.get(code, {})
        ideal_s1 = round(min(s1, pbs.get("s1", s1)), _TIME_DECIMALS)
        ideal_s2 = round(min(s2, pbs.get("s2", s2)), _TIME_DECIMALS)
        ideal_s3 = round(min(s3, pbs.get("s3", s3)), _TIME_DECIMALS)

        if ideal_s1 == s1 and ideal_s2 == s2 and ideal_s3 == s3:
            # Add subtle personal-best sector variance if driver only set 1 clean lap or offline
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
                "s1_status": "yellow" if s1 > ideal_s1 + 0.002 else "green",
                "s2_status": "yellow" if s2 > ideal_s2 + 0.002 else "green",
                "s3_status": "yellow" if s3 > ideal_s3 + 0.002 else "green",
                "ideal_lap": ideal_lap,
                "time_left_on_table": time_left,
            }
        )

    if results:
        pole_time = float(results[0]["best_time"])
        min_s1 = min(float(r["s1"]) for r in results)
        min_s2 = min(float(r["s2"]) for r in results)
        min_s3 = min(float(r["s3"]) for r in results)

        for r in results:
            r["gap_to_pole"] = round(
                float(r["best_time"]) - pole_time, _TIME_DECIMALS
            )
            if abs(float(r["s1"]) - min_s1) < 1e-4:
                r["s1_status"] = "purple"
            if abs(float(r["s2"]) - min_s2) < 1e-4:
                r["s2_status"] = "purple"
            if abs(float(r["s3"]) - min_s3) < 1e-4:
                r["s3_status"] = "purple"
    else:
        pole_time = pole_target

    q2_runners = [
        r for r in results if r["q2_time"] is not None and r["grid_pos"] <= _Q3_CUTOFF_RANK
    ]
    q3_cutoff_time = (
        max(float(r["q2_time"]) for r in q2_runners)
        if q2_runners
        else pole_time + 0.85
    )
    q1_advancers = [
        r for r in results if r["q1_time"] is not None and r["grid_pos"] <= _Q2_CUTOFF_RANK
    ]
    q2_cutoff_time = (
        max(float(r["q1_time"]) for r in q1_advancers)
        if q1_advancers
        else pole_time + 1.45
    )

    # Build constructor teammate head-to-head deltas
    by_team: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for r in results:
        by_team[str(r["team"])].append(r)

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

    # Generate Qualifying-specific corner speeds from constructor qualifying best times
    teams_info = _group_drivers_by_team(drivers)
    quali_team_perf: dict[str, float] = {}
    for team_name, team_rows in by_team.items():
        quali_team_perf[team_name] = min(float(r["best_time"]) for r in team_rows)

    quali_corners = _generate_corners_data(
        track_profile, quali_team_perf, teams_info
    )
    traces = _build_qualifying_traces(gp_name, results, track_profile)

    return {
        "stage_prefix": stage_prefix,
        "results": results,
        "cutoffs": {
            "pole_time": pole_time,
            "q3_cutoff_time": round(q3_cutoff_time, _TIME_DECIMALS),
            "q2_cutoff_time": round(q2_cutoff_time, _TIME_DECIMALS),
        },
        "teammate_deltas": teammate_deltas,
        "corners": quali_corners,
        "traces": traces,
    }


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
    """Extracts race stints, fuel-corrected stint pace, pit stop metrics, and SC/VSC windows."""
    driver_meta = {str(d["code"]): d for d in drivers}
    laps_by_driver: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for lap in laps:
        laps_by_driver[str(lap["driver"])].append(lap)

    sc_vsc_windows = _extract_sc_vsc_windows(
        openf1_rc or [], laps, total_laps
    )
    sc_laps_set: set[int] = set()
    for win in sc_vsc_windows:
        for l_no in range(int(win["start_lap"]), int(win["end_lap"]) + 1):
            sc_laps_set.add(l_no)

    stints: list[dict[str, Any]] = []
    pit_stops: list[dict[str, Any]] = []

    # Map real OpenF1 pit durations by (driver_code, lap_number)
    real_pits_by_driver_lap: dict[tuple[str, int], Mapping[str, Any]] = {}
    valid_pit_lane_durations: list[float] = []
    if openf1_pits and num_to_code:
        for p_rec in openf1_pits:
            d_num = p_rec.get("driver_number")
            l_num = p_rec.get("lap_number")
            code = num_to_code.get(int(d_num)) if d_num is not None else None
            if code and l_num is not None:
                real_pits_by_driver_lap[(code, int(l_num))] = p_rec
            raw_pd = p_rec.get("pit_duration") or p_rec.get("lane_duration")
            if raw_pd is not None and 16.0 <= float(raw_pd) <= 35.0:
                valid_pit_lane_durations.append(float(raw_pd))

    circuit_pit_transit_s = (
        (min(valid_pit_lane_durations) - 2.0)
        if valid_pit_lane_durations
        else 19.5
    )

    for driver in drivers:
        code = str(driver["code"])
        team = str(driver["team"])
        color = str(driver["color"])
        driver_laps = sorted(
            laps_by_driver.get(code, []), key=lambda item: int(item["lap"])
        )
        if not driver_laps:
            continue

        times = [
            float(l["time"])
            for l in driver_laps
            if float(l.get("time", 0)) > 0 and int(l["lap"]) not in sc_laps_set
        ]
        if not times:
            times = [
                float(l["time"]) for l in driver_laps if float(l.get("time", 0)) > 0
            ]
        median_time = statistics.median(times) if times else 95.0

        # Group laps into stints strictly by compound change or tyre_life reset
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

        # Merge any 1-lap stint artifacts into adjacent stint when driver completed > 1 lap
        if len(raw_stint_groups) > 1:
            merged_groups: list[list[Mapping[str, Any]]] = []
            for grp in raw_stint_groups:
                if len(grp) <= 1 and merged_groups:
                    merged_groups[-1].extend(grp)
                else:
                    merged_groups.append(list(grp))
            if len(merged_groups) > 1 and len(merged_groups[0]) <= 1:
                merged_groups[1] = merged_groups[0] + merged_groups[1]
                merged_groups.pop(0)
            raw_stint_groups = merged_groups

        if len(raw_stint_groups) == 1 and len(driver_laps) >= 20 and not openf1_stints:
            pit_idx = int(
                len(driver_laps)
                * (0.42 + _seeded_unit_float(f"{gp_name}_{code}_pit") * 0.18)
            )
            pit_idx = max(6, min(len(driver_laps) - 6, pit_idx))
            raw_stint_groups = [driver_laps[:pit_idx], driver_laps[pit_idx:]]

        for s_idx, group in enumerate(raw_stint_groups):
            stint_num = s_idx + 1
            start_lap = int(group[0]["lap"])
            end_lap = int(group[-1]["lap"])
            comp = str(group[0].get("compound", "MEDIUM"))
            if comp == "UNKNOWN":
                comp = "MEDIUM" if stint_num == 1 else "HARD"

            clean_group_times = [
                float(l["time"])
                for l in group
                if 0 < float(l.get("time", 0)) <= median_time + 6.5
                and int(l["lap"]) not in sc_laps_set
            ]
            if not clean_group_times:
                clean_group_times = [
                    float(l["time"])
                    for l in group
                    if float(l.get("time", 0)) > 0
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
                    "name": str(driver_meta[code].get("name", code)),
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
                prev_stint = stints[-2]
                pit_lap = int(prev_stint["end_lap"])
                openf1_pit = (
                    real_pits_by_driver_lap.get((code, pit_lap))
                    or real_pits_by_driver_lap.get((code, pit_lap + 1))
                    or real_pits_by_driver_lap.get((code, pit_lap - 1))
                )

                seed_stop = f"{gp_name}_{code}_stop_{s_idx}"
                raw_lane_val = (
                    float(openf1_pit.get("pit_duration") or openf1_pit.get("lane_duration"))
                    if openf1_pit
                    and (
                        openf1_pit.get("pit_duration") is not None
                        or openf1_pit.get("lane_duration") is not None
                    )
                    else None
                )
                if openf1_pit and openf1_pit.get("stop_duration") is not None:
                    stationary_s = round(float(openf1_pit["stop_duration"]), 2)
                elif raw_lane_val is not None:
                    stationary_s = round(
                        max(1.85, min(12.0, raw_lane_val - circuit_pit_transit_s)),
                        2,
                    )
                else:
                    stationary_s = round(
                        2.15 + _seeded_unit_float(f"{seed_stop}_stat") * 1.55, 2
                    )

                if raw_lane_val is not None:
                    pit_loss_s = round(max(16.0, min(38.0, raw_lane_val)), 2)
                else:
                    boundary_times = [
                        float(group[0].get("time", median_time)),
                        float(
                            raw_stint_groups[s_idx - 1][-1].get(
                                "time", median_time
                            )
                        ),
                    ]
                    observed_spike = max(boundary_times) - median_time
                    if 17.5 <= observed_spike <= 32.0:
                        pit_loss_s = round(observed_spike, 2)
                    else:
                        pit_loss_s = round(
                            19.4
                            + stationary_s
                            + _seeded_unit_float(f"{seed_stop}_loss") * 2.8,
                            2,
                        )

                pit_stops.append(
                    {
                        "driver": code,
                        "name": str(driver_meta[code].get("name", code)),
                        "team": team,
                        "color": color,
                        "lap": pit_lap,
                        "stop_number": s_idx,
                        "from_compound": str(prev_stint["compound"]),
                        "to_compound": comp,
                        "stationary_s": stationary_s,
                        "pit_loss_s": pit_loss_s,
                    }
                )

    pit_stops.sort(
        key=lambda item: (float(item["stationary_s"]), float(item["pit_loss_s"]))
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
    """Resolves OpenF1 ``session_key`` values by session name for a Grand Prix."""
    stem = os.path.splitext(os.path.basename(json_path))[0].lower()
    target_meeting = _FILENAME_TO_MEETING_KEY.get(stem)

    matching_sessions = [
        s
        for s in all_sessions_cache
        if (target_meeting is not None and s.get("meeting_key") == target_meeting)
        or (
            target_meeting is None
            and gp_name.lower().replace(" grand prix", "")
            in str(s.get("country_name", "")).lower()
        )
    ]

    session_map: dict[str, int] = {}
    for s in matching_sessions:
        s_name = str(s.get("session_name", ""))
        s_key = s.get("session_key")
        if isinstance(s_key, int):
            session_map[s_name] = s_key
    return session_map


def generate_weekend_telemetry(
    json_path: str,
    profiles_path: str | None = None,
    fetch_live: bool = False,
    all_sessions_cache: Sequence[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Enriches a Grand Prix JSON file in place with Practice, Qualifying, Sprint, and Race telemetry."""
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
            max((int(l.get("lap", 1)) for l in laps), default=55),
        )
    )
    track_profile = _resolve_track_profile(gp_name, track_profiles)
    driver_pace = _compute_driver_baseline_pace(drivers, laps)

    session_map: dict[str, int] = {}
    if fetch_live:
        sessions_list = (
            list(all_sessions_cache)
            if all_sessions_cache is not None
            else _fetch_openf1_json("sessions", {"year": 2026})
        )
        session_map = _resolve_meeting_sessions(json_path, gp_name, sessions_list)

    # Build driver_number -> driver_code mapping from OpenF1 if fetching live
    num_to_code: dict[int, str] = {}
    drivers_dict_by_num: dict[int, dict[str, Any]] = {}
    if fetch_live and session_map:
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
                num_to_code[d_num] = str(acro)
                drivers_dict_by_num[d_num] = dict(
                    known_by_code.get(
                        str(acro),
                        {
                            "code": str(acro),
                            "name": str(d_item.get("full_name", acro)),
                            "team": str(d_item.get("team_name", "Unknown")),
                            "color": f"#{d_item.get('team_colour') or 'ffffff'}",
                        },
                    )
                )

    # 1. Qualifying (Real OpenF1 when fetch_live=True, Lap 1 grid fallback when False)
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

    # 2. Practice (Real OpenF1 Practice laps, stints & session_result when fetch_live=True)
    prac_laps_raw: list[dict[str, Any]] = []
    prac_stints_raw: list[dict[str, Any]] = []
    prac_results_raw: list[dict[str, Any]] | None = None
    if fetch_live:
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
                if len(prac_laps_raw) > 250:
                    break

    race_data["practice"] = _build_practice_telemetry(
        gp_name=gp_name,
        drivers=drivers,
        driver_pace=driver_pace,
        track_profile=track_profile,
        corners=race_data.get("corners", []),
        openf1_practice_laps=prac_laps_raw or None,
        openf1_practice_stints=prac_stints_raw or None,
        openf1_practice_results=prac_results_raw or None,
        num_to_code=num_to_code or None,
    )

    # 3. Race Telemetry & Official FIA Classification Calibration
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
        _fetch_openf1_json("session_result", {"session_key": session_map["Race"]})
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

    # 4. Sprint Qualifying & Sprint Race (where applicable!)
    is_sprint = "Sprint Qualifying" in session_map and "Sprint" in session_map
    if fetch_live:
        race_data["is_sprint_weekend"] = is_sprint
    elif "is_sprint_weekend" not in race_data:
        stem = os.path.splitext(os.path.basename(json_path))[0].lower()
        race_data["is_sprint_weekend"] = stem in {
            "china",
            "miami",
            "united_states",
            "canada",
            "united_kingdom",
            "netherlands",
            "singapore",
        }

    if is_sprint and fetch_live:
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
        sprint_winner = str(race_data["race_info"].get("winner", "VER"))
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
            for l_rec in sprint_processed_laps:
                if (
                    int(l_rec.get("lap", 0)) == sprint_max_lap
                    and int(l_rec.get("position", 99)) == 1
                ):
                    sprint_winner = str(l_rec["driver"])
                    break

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
    elif race_data.get("is_sprint_weekend") and "sprint_qualifying" not in race_data:
        # Offline Sprint weekend synthesis for unit tests
        sprint_laps_count = max(15, total_laps // 3)
        sprint_laps = [
            dict(l_rec)
            for l_rec in laps
            if int(l_rec.get("lap", 1)) <= sprint_laps_count
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
            "winner": str(race_data["race_info"].get("winner", "VER")),
            "laps": sprint_laps,
            "race_telemetry": _build_race_telemetry(
                gp_name=f"{gp_name} Sprint",
                drivers=drivers,
                laps=sprint_laps,
                total_laps=sprint_laps_count,
            ),
        }

    with open(json_path, "w", encoding="utf-8") as race_file:
        json.dump(race_data, race_file, indent=_JSON_INDENT_SPACES)

    print(
        f"Enriched weekend telemetry (sprint={race_data.get('is_sprint_weekend')}) "
        f"for {gp_name} -> {json_path}"
    )
    return race_data


def _main() -> None:
    """Enriches all 2026 Grand Prix JSON files using live OpenF1 session data."""
    target_directory = os.path.join(
        os.path.dirname(__file__), *_DEFAULT_RACES_RELATIVE_DIR
    )
    race_json_paths = sorted(glob.glob(os.path.join(target_directory, "*.json")))
    all_sessions = _fetch_openf1_json("sessions", {"year": 2026})
    print(f"Fetched {len(all_sessions)} total 2026 sessions from OpenF1.")
    for race_json_path in race_json_paths:
        generate_weekend_telemetry(
            race_json_path,
            fetch_live=True,
            all_sessions_cache=all_sessions,
        )


if __name__ == "__main__":
    _main()
