"""Generates multi-session weekend telemetry (Practice, Qualifying, Race) for F1 datasets.

This module enriches Grand Prix JSON files with structured ``practice``,
``qualifying``, and ``race_telemetry`` blocks derived from the circuit profile
in ``track_profiles.json`` and the actual race lap/driver telemetry.
"""

from collections import defaultdict
from collections.abc import Mapping, Sequence
import glob
import json
import math
import os
import statistics
from typing import Any, Final

from generate_corner_speeds import (
    _group_drivers_by_team,
    _load_track_profiles,
    _resolve_track_profile,
    calculate_corner_speeds,
)

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


def _deterministic_hash(seed_text: str) -> int:
    """Computes a stable positive integer hash from a string seed.

    Args:
        seed_text: Arbitrary string used to seed deterministic variations.

    Returns:
        Positive integer hash value.
    """
    total = 2166136261
    for char in seed_text:
        total = ((total ^ ord(char)) * 16777619) & 0xFFFFFFFF
    return total


def _seeded_unit_float(seed_text: str) -> float:
    """Maps a string seed deterministically to a float in ``[0.0, 1.0]``.

    Args:
        seed_text: Seed identifier string.

    Returns:
        Deterministic float between 0.0 and 1.0.
    """
    return (_deterministic_hash(seed_text) % 10000) / 10000.0


def _compute_driver_baseline_pace(
    drivers: Sequence[Mapping[str, Any]],
    laps: Sequence[Mapping[str, Any]],
) -> dict[str, float]:
    """Computes each driver's clean baseline race pace from the fastest 25% of laps.

    Args:
        drivers: Driver metadata records.
        laps: Race lap records.

    Returns:
        Mapping of driver code to representative clean lap time in seconds.
    """
    laps_by_driver: dict[str, list[float]] = defaultdict(list)
    for lap_record in laps:
        lap_time = float(lap_record.get("time", 0.0))
        if lap_time > 0 and not lap_record.get("interpolated", False):
            laps_by_driver[str(lap_record["driver"])].append(lap_time)

    # Fallback if all laps for a driver were flagged or missing
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
) -> dict[str, Any]:
    """Generates the ``practice`` telemetry block for a Grand Prix weekend.

    Args:
        gp_name: Grand Prix display name.
        drivers: Sequence of driver metadata dictionaries.
        driver_pace: Mapping of driver code to baseline clean lap time.
        track_profile: Circuit profile parameters (``turns``, ``base_speed``, ``variation``).
        corners: Constructor corner speed records.

    Returns:
        Dictionary containing ``classification``, ``stint_laps``, and
        ``degradation_slopes``.
    """
    fastest_baseline = min(driver_pace.values()) if driver_pace else 90.0
    practice_pole_base = fastest_baseline * 0.978

    team_corner_means: dict[str, float] = defaultdict( float)
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

    raw_entries: list[dict[str, Any]] = []
    stint_laps: list[dict[str, Any]] = []

    deg_rates = {
        "SOFT": round(0.078 + (variation / 2500.0), 3),
        "MEDIUM": round(0.049 + (variation / 3500.0), 3),
        "HARD": round(0.029 + (variation / 5000.0), 3),
    }
    compound_offsets = {"SOFT": 0.0, "MEDIUM": 0.58, "HARD": 1.15}

    for driver in drivers:
        code = str(driver["code"])
        team = str(driver["team"])
        color = str(driver["color"])
        seed_key = f"{gp_name}_{code}_practice"

        pace_ratio = driver_pace.get(code, fastest_baseline + 1.5) - fastest_baseline
        practice_jitter = (_seeded_unit_float(seed_key) - 0.45) * 0.42
        best_lap = round(
            practice_pole_base + (pace_ratio * 0.88) + max(-0.18, practice_jitter),
            _TIME_DECIMALS,
        )

        u_comp = _seeded_unit_float(f"{seed_key}_comp")
        best_compound = "SOFT" if u_comp < 0.78 else ("MEDIUM" if u_comp < 0.93 else "HARD")

        soft_laps = 12 + int(_seeded_unit_float(f"{seed_key}_s") * 10)
        medium_laps = 18 + int(_seeded_unit_float(f"{seed_key}_m") * 12)
        hard_laps = 10 + int(_seeded_unit_float(f"{seed_key}_h") * 12)
        total_laps = soft_laps + medium_laps + hard_laps
        short_run_laps = soft_laps + int(medium_laps * 0.25)
        long_run_laps = total_laps - short_run_laps

        team_mean_corner = team_corner_means.get(team, base_speed)
        driver_corner_offset = (_seeded_unit_float(f"{seed_key}_corner") - 0.5) * 1.8
        mean_corner_kmh = round(team_mean_corner + driver_corner_offset, _SPEED_DECIMALS)

        # Aero trade-off: slightly higher wing gives higher corner speed vs lower straight speed
        aero_trim = (_seeded_unit_float(f"{seed_key}_aero") - 0.5) * 6.5
        speed_trap_kmh = round(
            circuit_top_speed_base
            + (fastest_baseline / max(driver_pace.get(code, fastest_baseline), 60.0) - 1.0) * 35.0
            - (aero_trim * 0.55),
            _SPEED_DECIMALS,
        )

        # Long-run simulation stint (10 to 14 laps)
        long_run_compound = "MEDIUM" if _seeded_unit_float(f"{seed_key}_lrc") < 0.65 else "HARD"
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
                long_run_base + (tyre_age * deg_rates[long_run_compound]) + lap_noise,
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

        # Also add a short/medium SOFT run (7 laps) so SOFT degradation curve is populated
        soft_stint_base = practice_pole_base + 3.20 + (pace_ratio * 0.85)
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
                        soft_stint_base + (tyre_age * deg_rates["SOFT"]) + lap_noise,
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
                "long_run_avg": round(statistics.mean(driver_long_run_times), _TIME_DECIMALS),
                "long_run_q25": round(sorted_lr[q25_idx], _TIME_DECIMALS),
                "long_run_q75": round(sorted_lr[q75_idx], _TIME_DECIMALS),
            }
        )

    raw_entries.sort(key=lambda item: float(item["best_lap"]))
    p1_best = float(raw_entries[0]["best_lap"]) if raw_entries else practice_pole_base

    for idx, entry in enumerate(raw_entries):
        entry["rank"] = idx + 1
        entry["gap_to_p1"] = round(float(entry["best_lap"]) - p1_best, _TIME_DECIMALS)

    degradation_slopes: list[dict[str, Any]] = []
    for comp in ("SOFT", "MEDIUM", "HARD"):
        comp_base = round(
            practice_pole_base + 3.45 + compound_offsets[comp], _TIME_DECIMALS
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
    """Generates normalized 0-100% lap distance telemetry traces for Qualifying.

    Args:
        gp_name: Grand Prix display name.
        results: Ordered qualifying result records.
        track_profile: Circuit profile parameters.

    Returns:
        Dictionary with ``distance_pct``, ``turns``, and ``drivers`` telemetry arrays.
    """
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
            # Find proximity to nearest turn apex
            min_dist = 100.0
            nearest_apex_speed = base_speed
            for turn_info in turns_meta:
                dist = abs(pct - float(turn_info["pct"]))
                if dist < min_dist:
                    min_dist = dist
                    nearest_apex_speed = float(turn_info["apex_speed"])

            # Smooth Gaussian dip near turn apexes, accelerating on straights
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
                        100.0 - corner_factor * (78.0 - (nearest_apex_speed / 5.0))
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

            # Cumulative time from 0 to best_time with realistic sector inflection
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
    corners: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Generates the ``qualifying`` telemetry block (Q1/Q2/Q3, sectors, head-to-head, traces).

    Args:
        gp_name: Grand Prix display name.
        drivers: Sequence of driver metadata dictionaries.
        driver_pace: Mapping of driver code to clean baseline race pace.
        track_profile: Circuit profile parameters.
        corners: Constructor corner speed records.

    Returns:
        Dictionary containing ``results``, ``cutoffs``, ``teammate_deltas``,
        ``corners``, and ``traces``.
    """
    fastest_baseline = min(driver_pace.values()) if driver_pace else 90.0
    pole_target = round(fastest_baseline * 0.962, _TIME_DECIMALS)

    # Order drivers by qualifying score (baseline pace + slight deterministic one-lap skill modifier)
    scored_drivers: list[tuple[float, Mapping[str, Any]]] = []
    for driver in drivers:
        code = str(driver["code"])
        quali_mod = (_seeded_unit_float(f"{gp_name}_{code}_qskill") - 0.5) * 0.28
        score = driver_pace.get(code, fastest_baseline + 1.5) + quali_mod
        scored_drivers.append((score, driver))

    scored_drivers.sort(key=lambda pair: pair[0])
    min_score = scored_drivers[0][0] if scored_drivers else fastest_baseline

    # Sector split ratios tailored to circuit turn count
    turns = int(track_profile.get("turns", 15))
    s1_ratio = 0.285 + ((turns % 5) - 2) * 0.008
    s2_ratio = 0.415 - ((turns % 4) - 1.5) * 0.006
    s3_ratio = 1.0 - s1_ratio - s2_ratio

    results: list[dict[str, Any]] = []
    for idx, (score, driver) in enumerate(scored_drivers):
        grid_pos = idx + 1
        code = str(driver["code"])
        team = str(driver["team"])
        color = str(driver["color"])
        seed_base = f"{gp_name}_{code}_quali"

        gap_base = max(0.0, (score - min_score) * 0.86) + (idx * 0.055)

        if grid_pos <= _Q3_CUTOFF_RANK:
            eliminated_in = "Q3"
            q3_time = round(pole_target + gap_base, _TIME_DECIMALS)
            q2_time = round(
                pole_target
                + 0.32
                + (idx * 0.042)
                + _seeded_unit_float(f"{seed_base}_q2") * 0.12,
                _TIME_DECIMALS,
            )
            q1_time = round(
                pole_target
                + 0.68
                + (idx * 0.045)
                + _seeded_unit_float(f"{seed_base}_q1") * 0.15,
                _TIME_DECIMALS,
            )
            best_time = q3_time
        elif grid_pos <= _Q2_CUTOFF_RANK:
            eliminated_in = "Q2"
            q3_time = None
            q2_time = round(
                pole_target + 0.92 + ((grid_pos - _Q3_CUTOFF_RANK) * 0.095),
                _TIME_DECIMALS,
            )
            q1_time = round(
                pole_target
                + 0.72
                + (idx * 0.042)
                + _seeded_unit_float(f"{seed_base}_q1") * 0.14,
                _TIME_DECIMALS,
            )
            best_time = q2_time
        else:
            eliminated_in = "Q1"
            q3_time = None
            q2_time = None
            q1_time = round(
                pole_target + 1.58 + ((grid_pos - _Q2_CUTOFF_RANK) * 0.125),
                _TIME_DECIMALS,
            )
            best_time = q1_time

        # Sector split summing strictly to best_time
        s1_jitter = (_seeded_unit_float(f"{seed_base}_s1") - 0.5) * 0.09
        s2_jitter = (_seeded_unit_float(f"{seed_base}_s2") - 0.5) * 0.11
        s1 = round(best_time * s1_ratio + s1_jitter, _TIME_DECIMALS)
        s2 = round(best_time * s2_ratio + s2_jitter, _TIME_DECIMALS)
        s3 = round(best_time - s1 - s2, _TIME_DECIMALS)

        # Ideal sectors (personal best across all qualifying runs)
        s1_loss = (
            round(_seeded_unit_float(f"{seed_base}_loss1") * 0.055, _TIME_DECIMALS)
            if _seeded_unit_float(f"{seed_base}_ yellow1") > 0.62
            else 0.0
        )
        s2_loss = (
            round(_seeded_unit_float(f"{seed_base}_loss2") * 0.065, _TIME_DECIMALS)
            if _seeded_unit_float(f"{seed_base}_yellow2") > 0.58
            else 0.0
        )
        s3_loss = (
            round(_seeded_unit_float(f"{seed_base}_loss3") * 0.050, _TIME_DECIMALS)
            if _seeded_unit_float(f"{seed_base}_yellow3") > 0.65
            else 0.0
        )
        # Ensure every driver has at least a tiny ideal-vs-actual delta (0.012s..0.140s)
        if s1_loss + s2_loss + s3_loss == 0.0:
            s2_loss = round(
                0.015 + _seeded_unit_float(f"{seed_base}_minloss") * 0.045,
                _TIME_DECIMALS,
            )

        ideal_s1 = round(s1 - s1_loss, _TIME_DECIMALS)
        ideal_s2 = round(s2 - s2_loss, _TIME_DECIMALS)
        ideal_s3 = round(s3 - s3_loss, _TIME_DECIMALS)
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
                "s1_status": "yellow" if s1_loss > 0.0 else "green",
                "s2_status": "yellow" if s2_loss > 0.0 else "green",
                "s3_status": "yellow" if s3_loss > 0.0 else "green",
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
            r["gap_to_pole"] = round(float(r["best_time"]) - pole_time, _TIME_DECIMALS)
            if float(r["s1"]) == min_s1:
                r["s1_status"] = "purple"
            if float(r["s2"]) == min_s2:
                r["s2_status"] = "purple"
            if float(r["s3"]) == min_s3:
                r["s3_status"] = "purple"
    else:
        pole_time = pole_target

    q2_runners = [r for r in results if r["q2_time"] is not None]
    q3_cutoff_time = (
        float(q2_runners[min(_Q3_CUTOFF_RANK - 1, len(q2_runners) - 1)]["q2_time"])
        if q2_runners
        else pole_time + 0.85
    )
    q2_cutoff_time = (
        float(results[min(_Q2_CUTOFF_RANK - 1, len(results) - 1)]["q1_time"])
        if results
        else pole_time + 1.45
    )

    # Build constructor teammate head-to-head deltas
    by_team: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for r in results:
        by_team[str(r["team"])].append(r)

    teammate_deltas: list[dict[str, Any]] = []
    for team_name, team_drivers in by_team.items():
        sorted_pair = sorted(team_drivers, key=lambda item: float(item["best_time"]))
        faster = sorted_pair[0]
        slower = sorted_pair[-1]
        delta_s = round(
            float(slower["best_time"]) - float(faster["best_time"]), _TIME_DECIMALS
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

    teammate_deltas.sort(key=lambda item: float(item["faster_time"]))

    traces = _build_qualifying_traces(gp_name, results, track_profile)

    return {
        "results": results,
        "cutoffs": {
            "pole_time": pole_time,
            "q3_cutoff_time": round(q3_cutoff_time, _TIME_DECIMALS),
            "q2_cutoff_time": round(q2_cutoff_time, _TIME_DECIMALS),
        },
        "teammate_deltas": teammate_deltas,
        "corners": [dict(c) for c in corners],
        "traces": traces,
    }


def _build_race_telemetry(
    gp_name: str,
    drivers: Sequence[Mapping[str, Any]],
    laps: Sequence[Mapping[str, Any]],
    total_laps: int,
) -> dict[str, Any]:
    """Extracts race stints, fuel-corrected stint pace, and pit stop metrics from race laps.

    Args:
        gp_name: Grand Prix display name.
        drivers: Sequence of driver metadata dictionaries.
        laps: Sequence of race lap records.
        total_laps: Total scheduled/completed laps in the race.

    Returns:
        Dictionary containing ``stints`` and ``pit_stops``.
    """
    driver_meta = {str(d["code"]): d for d in drivers}
    laps_by_driver: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for lap in laps:
        laps_by_driver[str(lap["driver"])].append(lap)

    stints: list[dict[str, Any]] = []
    pit_stops: list[dict[str, Any]] = []

    for driver in drivers:
        code = str(driver["code"])
        team = str(driver["team"])
        color = str(driver["color"])
        driver_laps = sorted(
            laps_by_driver.get(code, []), key=lambda item: int(item["lap"])
        )
        if not driver_laps:
            continue

        times = [float(l["time"]) for l in driver_laps if float(l.get("time", 0)) > 0]
        median_time = statistics.median(times) if times else 95.0

        # Segment driver laps into stints based on compound change, tyre_life reset, or pit spike
        raw_stint_groups: list[list[Mapping[str, Any]]] = []
        current_group: list[Mapping[str, Any]] = []

        for idx, lap_rec in enumerate(driver_laps):
            if not current_group:
                current_group.append(lap_rec)
                continue

            prev_rec = current_group[-1]
            prev_comp = str(prev_rec.get("compound", "MEDIUM"))
            curr_comp = str(lap_rec.get("compound", "MEDIUM"))
            prev_life = int(prev_rec.get("tyre_life", 1))
            curr_life = int(lap_rec.get("tyre_life", 1))
            curr_time = float(lap_rec.get("time", median_time))

            compound_changed = (
                curr_comp != prev_comp
                and curr_comp != "UNKNOWN"
                and prev_comp != "UNKNOWN"
            )
            tyre_life_reset = curr_life < prev_life and len(current_group) >= 3
            pit_time_spike = (
                curr_time > median_time + 16.5
                and int(lap_rec["lap"]) > 2
                and len(current_group) >= 5
            )

            if compound_changed or tyre_life_reset or pit_time_spike:
                raw_stint_groups.append(current_group)
                current_group = [lap_rec]
            else:
                current_group.append(lap_rec)

        if current_group:
            raw_stint_groups.append(current_group)

        # If a driver ran >25 laps with only 1 detected stint (e.g. uniform compound data),
        # synthesize a realistic pit window split so strategy & pit charts are always populated
        if len(raw_stint_groups) == 1 and len(driver_laps) >= 20:
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
            # Ensure distinct compound if synthesized split
            if (
                s_idx > 0
                and comp == stints[-1]["compound"]
                and str(group[0].get("compound", "UNKNOWN")) == str(raw_stint_groups[s_idx - 1][-1].get("compound", "UNKNOWN"))
                and int(group[0].get("tyre_life", 1)) > 5
            ):
                comp = "HARD" if comp == "MEDIUM" else "MEDIUM"

            clean_group_times = [
                float(l["time"])
                for l in group
                if 0 < float(l.get("time", 0)) <= median_time + 8.0
            ]
            if not clean_group_times:
                clean_group_times = [
                    float(l["time"]) for l in group if float(l.get("time", 0)) > 0
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
                boundary_times = [
                    float(group[0].get("time", median_time)),
                    float(raw_stint_groups[s_idx - 1][-1].get("time", median_time)),
                ]
                observed_spike = max(boundary_times) - median_time
                seed_stop = f"{gp_name}_{code}_stop_{s_idx}"
                stationary_s = round(
                    2.15 + _seeded_unit_float(f"{seed_stop}_stat") * 1.65, 2
                )
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

    pit_stops.sort(key=lambda item: (float(item["stationary_s"]), float(item["pit_loss_s"])))
    return {
        "stints": stints,
        "pit_stops": pit_stops,
    }


def generate_weekend_telemetry(
    json_path: str,
    profiles_path: str | None = None,
) -> dict[str, Any]:
    """Enriches a Grand Prix JSON file in place with Practice, Qualifying, and Race telemetry.

    Args:
        json_path: Path to the target Grand Prix JSON file.
        profiles_path: Optional override path to ``track_profiles.json``.

    Returns:
        The enriched race payload dictionary written to ``json_path``.
    """
    with open(json_path, "r", encoding="utf-8") as race_file:
        race_data: dict[str, Any] = json.load(race_file)

    drivers = race_data.get("drivers", [])
    laps = race_data.get("laps", [])
    if not drivers or not laps:
        return race_data

    # Ensure corner speeds are present
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
    corners = race_data.get("corners", [])

    driver_pace = _compute_driver_baseline_pace(drivers, laps)

    race_data["practice"] = _build_practice_telemetry(
        gp_name=gp_name,
        drivers=drivers,
        driver_pace=driver_pace,
        track_profile=track_profile,
        corners=corners,
    )
    race_data["qualifying"] = _build_qualifying_telemetry(
        gp_name=gp_name,
        drivers=drivers,
        driver_pace=driver_pace,
        track_profile=track_profile,
        corners=corners,
    )
    race_data["race_telemetry"] = _build_race_telemetry(
        gp_name=gp_name,
        drivers=drivers,
        laps=laps,
        total_laps=total_laps,
    )

    with open(json_path, "w", encoding="utf-8") as race_file:
        json.dump(race_data, race_file, indent=_JSON_INDENT_SPACES)

    print(
        f"Enriched weekend telemetry (Practice, Qualifying, Race) for {gp_name} -> {json_path}"
    )
    return race_data


def _main() -> None:
    """Enriches all 2026 Grand Prix JSON files in the default assets directory."""
    target_directory = os.path.join(
        os.path.dirname(__file__), *_DEFAULT_RACES_RELATIVE_DIR
    )
    race_json_paths = sorted(glob.glob(os.path.join(target_directory, "*.json")))
    for race_json_path in race_json_paths:
        generate_weekend_telemetry(race_json_path)


if __name__ == "__main__":
    _main()
