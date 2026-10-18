import { calculateDriverClassification } from './standings.js';

const _CHART_MARGIN = { top: 34, right: 32, bottom: 44, left: 82 };
const _MIN_CONTAINER_WIDTH_PX = 360;
const _DEFAULT_CONTAINER_WIDTH_PX = 860;
const _ROW_HEIGHT_PX = 26;
const _MIN_CHART_HEIGHT_PX = 420;
const _BAR_VERTICAL_PADDING_RATIO = 0.2;
const _BAR_OUTER_PADDING_RATIO = 0.1;
const _BAR_CORNER_RADIUS_PX = 4;
const _STINT_GAP_PX = 2;
const _MIN_BAR_WIDTH_PX = 4;
const _MIN_BAR_HEIGHT_PX = 4;
const _BAR_HEIGHT_INSET_PX = 2;
const _TEAM_ACCENT_HEIGHT_PX = 3;
const _TEAM_ACCENT_RADIUS_PX = 1.5;
const _BAR_STROKE_COLOR = '#111118';
const _BAR_HOVER_STROKE_COLOR = '#ffffff';
const _BAR_STROKE_WIDTH_PX = 1.5;
const _BAR_HOVER_STROKE_WIDTH_PX = 2;
const _LABEL_OUTLINE_WIDTH_PX = 4;
const _FULL_LABEL_MIN_WIDTH_PX = 46;
const _SHORT_LABEL_MIN_WIDTH_PX = 20;
const _PIT_TICK_VERTICAL_OVERHANG_PX = 2;
const _PIT_TICK_STROKE_WIDTH_PX = 2;
const _SC_BAND_VERTICAL_PAD_PX = 4;
const _SC_BAND_MIN_WIDTH_PX = 6;
const _SC_LINE_TOP_OFFSET_PX = -6;
const _SC_LINE_STROKE_WIDTH_PX = 1.5;
const _SC_LINE_DASH_ARRAY = '4,3';
const _SC_LINE_OPACITY = 0.72;
const _SC_BADGE_Y_OFFSET_PX = -15;
const _SC_BADGE_CHAR_WIDTH_PX = 6.6;
const _SC_BADGE_HORIZONTAL_PAD_PX = 16;
const _SC_BADGE_HEIGHT_PX = 17;
const _SC_BADGE_RADIUS_PX = 4;
const _SC_BADGE_MIN_GAP_PX = 6;
const _SC_BADGE_EDGE_MARGIN_PX = 2;
const _SC_BADGE_STROKE_WIDTH_PX = 1.2;
const _SC_COLOR = '#f59e0b';
const _VSC_COLOR = '#facc15';
const _SC_BAND_FILL = 'rgba(245, 158, 11, 0.14)';
const _VSC_BAND_FILL = 'rgba(250, 204, 21, 0.11)';
const _SC_LEGEND_FILL = 'rgba(245, 158, 11, 0.35)';
const _VSC_LEGEND_FILL = 'rgba(250, 204, 21, 0.3)';
const _SC_BADGE_BG_FILL = 'rgba(18, 18, 26, 0.95)';
const _MAX_X_AXIS_TICKS = 15;
const _X_AXIS_TITLE_OFFSET_Y_PX = 36;
const _Y_AXIS_TICK_PADDING_PX = 10;
const _ACTIVE_OPACITY = 1;
const _DIMMED_OPACITY = 0.2;
const _TOOLTIP_OFFSET_X_PX = 15;
const _TOOLTIP_OFFSET_Y_PX = -28;
const _SECONDS_PER_MINUTE = 60;
const _DEFAULT_FALLBACK_MAX_LAP = 60;
const _FUEL_BURN_CORRECTION_PER_LAP_S = 0.055;
const _DEFAULT_DRIVER_COLOR = '#888888';
const _ROW_GUIDE_FILL = 'rgba(255, 255, 255, 0.025)';
const _FUEL_CORRECTED_TEXT_COLOR = '#34d399';

const _TACTIC_CATEGORY_UNDERCUT = 'UNDERCUT';
const _TACTIC_CATEGORY_OVERCUT = 'OVERCUT';
const _TACTIC_CATEGORY_SC = 'SC_STOP';
const _TACTIC_CATEGORY_STANDARD = 'STANDARD';

const _TACTIC_COLOR_UNDERCUT = '#22c55e';
const _TACTIC_COLOR_OVERCUT = '#38bdf8';
const _TACTIC_COLOR_SC = '#f59e0b';
const _TACTIC_COLOR_STANDARD = '#9ca3af';

const _DEFAULT_PIT_LOSS_WINDOW_S = 21.5;
const _TRAFFIC_RIVALS_MAX_COUNT = 3;
const _PIT_WINDOW_RIVAL_LAP_RADIUS = 4;
const _PIT_CYCLE_BEFORE_LAPS = 2;
const _PIT_CYCLE_AFTER_LAPS = 3;
const _OVERCUT_CLOSE_GAP_S = 3.5;

const _PIT_MARKER_LINE_WIDTH_PX = 2.4;
const _PIT_MARKER_BADGE_RADIUS_PX = 4.2;
const _PIT_MARKER_BADGE_STROKE_WIDTH_PX = 1.4;
const _PIT_MARKER_HIT_WIDTH_PX = 12;

const _PLAYHEAD_COLOR = '#38bdf8';
const _PLAYHEAD_STROKE_WIDTH_PX = 2;
const _PLAYHEAD_DASH_ARRAY = '5,3';
const _PLAYHEAD_TOP_OFFSET_PX = -14;
const _PLAYHEAD_PILL_WIDTH_PX = 64;
const _PLAYHEAD_PILL_HEIGHT_PX = 16;
const _PLAYHEAD_PILL_Y_OFFSET_PX = -30;
const _PLAYHEAD_PILL_RADIUS_PX = 4;
const _PLAYHEAD_PILL_BG_FILL = 'rgba(15, 23, 42, 0.96)';

const _COMPOUND_ORDER = ['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET', 'UNKNOWN'];

const _COMPOUND_COLORS = {
    SOFT: '#FF3333',
    MEDIUM: '#FFE600',
    HARD: '#F0F0F5',
    INTERMEDIATE: '#39B54A',
    WET: '#00AEEF',
    UNKNOWN: '#888888'
};

const _COMPOUND_ABBREVIATIONS = {
    SOFT: 'S',
    MEDIUM: 'M',
    HARD: 'H',
    INTERMEDIATE: 'I',
    WET: 'W',
    UNKNOWN: 'U'
};

const _DARK_TEXT_COMPOUNDS = new Set(['MEDIUM', 'HARD', 'INTERMEDIATE']);

let _externalStrategyFocusHandler = null;
let _strategyPlayheadHandler = null;
let _currentStrategyPlayheadLap = null;

/**
 * Highlights or restores a driver's row in the Tyre Strategy Gantt chart from an external trigger.
 *
 * @param {string|null} driverCode - Three-letter driver code to highlight, or null to restore.
 * @returns {void}
 */
export function setRaceStrategyExternalFocus(driverCode) {
    if (_externalStrategyFocusHandler) {
        _externalStrategyFocusHandler(driverCode);
    }
}

/**
 * Updates or hides the synchronized vertical lap playhead line across `#race-strategy-chart`.
 *
 * @param {number|null} lapNumber - Lap number to highlight (`0..maxLap`), or `null` to hide.
 * @returns {void}
 */
export function setRaceStrategyPlayheadLap(lapNumber) {
    _currentStrategyPlayheadLap =
        lapNumber !== null && lapNumber !== undefined && Number.isFinite(Number(lapNumber))
            ? Number(lapNumber)
            : null;
    if (_strategyPlayheadHandler) {
        _strategyPlayheadHandler(_currentStrategyPlayheadLap);
    }
}

/**
 * Formats a lap pace value in seconds as `m:ss.sss (ss.sss s)` or `ss.sss s`.
 *
 * @param {number|null|undefined} paceSeconds - Lap pace in seconds.
 * @returns {string} Formatted pace string.
 */
function _formatPace(paceSeconds) {
    if (!Number.isFinite(paceSeconds) || paceSeconds <= 0) {
        return 'N/A';
    }
    const minutes = Math.floor(paceSeconds / _SECONDS_PER_MINUTE);
    const remainingSeconds = (paceSeconds % _SECONDS_PER_MINUTE).toFixed(3);
    if (minutes > 0) {
        return `${minutes}:${remainingSeconds.padStart(6, '0')} (${paceSeconds.toFixed(3)}s)`;
    }
    return `${paceSeconds.toFixed(3)}s`;
}

/**
 * Normalizes a raw tyre compound string to one of the supported uppercase keys.
 *
 * @param {string|null|undefined} compound - Raw compound name.
 * @returns {string} Normalized uppercase compound name.
 */
function _normalizeCompound(compound) {
    const upper = String(compound || 'UNKNOWN').toUpperCase();
    return _COMPOUND_COLORS[upper] ? upper : 'UNKNOWN';
}

/**
 * Derives stint descriptors from raw `data.laps` when `data.race_telemetry.stints` is absent.
 *
 * @param {Object} data - Race telemetry payload containing `laps` and `drivers`.
 * @param {Map<string, Object>} driverMetaByCode - Lookup map of driver code to metadata.
 * @param {number} maxLap - Maximum race lap count.
 * @returns {Array<Object>} Derived stint objects matching the `race_telemetry.stints` schema.
 */
function _deriveStintsFromLaps(data, driverMetaByCode, maxLap) {
    const lapsByDriver = d3.group(data.laps || [], (d) => d.driver);
    const derivedStints = [];

    lapsByDriver.forEach((driverLaps, driverCode) => {
        const sortedLaps = driverLaps.slice().sort((a, b) => a.lap - b.lap);
        if (sortedLaps.length === 0) return;

        const meta = driverMetaByCode.get(driverCode) || {
            code: driverCode,
            name: driverCode,
            team: '',
            color: _DEFAULT_DRIVER_COLOR
        };

        let stintNumber = 1;
        let currentCompound = _normalizeCompound(sortedLaps[0].compound);
        let startLap = sortedLaps[0].lap;
        let endLap = sortedLaps[0].lap;
        let stintLaps = [sortedLaps[0]];

        const flushStint = () => {
            const validTimes = stintLaps
                .filter((l) => !l.interpolated && Number.isFinite(l.time) && l.time > 0)
                .map((l) => l.time);
            const avgPace = validTimes.length > 0 ? d3.mean(validTimes) : null;
            const midLap = (startLap + endLap) / 2;
            const remainingFuelLaps = Math.max(0, maxLap - midLap);
            const fuelCorrectedPace =
                avgPace !== null
                    ? avgPace - remainingFuelLaps * _FUEL_BURN_CORRECTION_PER_LAP_S
                    : null;

            derivedStints.push({
                driver: driverCode,
                name: meta.name || driverCode,
                team: meta.team || '',
                color: meta.color || _DEFAULT_DRIVER_COLOR,
                stint: stintNumber,
                compound: currentCompound,
                start_lap: startLap,
                end_lap: endLap,
                laps_count: endLap - startLap + 1,
                avg_pace: avgPace,
                fuel_corrected_pace: fuelCorrectedPace
            });
        };

        for (let i = 1; i < sortedLaps.length; i++) {
            const lapObj = sortedLaps[i];
            const prevLapObj = sortedLaps[i - 1];
            const nextCompound = _normalizeCompound(lapObj.compound);
            const hasTyreLifeReset =
                Number.isFinite(lapObj.tyre_life) &&
                Number.isFinite(prevLapObj.tyre_life) &&
                lapObj.tyre_life < prevLapObj.tyre_life;

            if (nextCompound !== currentCompound || hasTyreLifeReset) {
                flushStint();
                stintNumber += 1;
                currentCompound = nextCompound;
                startLap = lapObj.lap;
                endLap = lapObj.lap;
                stintLaps = [lapObj];
            } else {
                endLap = lapObj.lap;
                stintLaps.push(lapObj);
            }
        }
        flushStint();
    });

    return derivedStints;
}

/**
 * Resolves the stint records for the race, enriching colors and team names from `data.drivers`.
 *
 * @param {Object} data - Race telemetry payload.
 * @param {Map<string, Object>} driverMetaByCode - Map of driver code to driver metadata.
 * @param {number} maxLap - Total laps in the race.
 * @returns {Array<Object>} Normalized stint records.
 */
function _resolveStints(data, driverMetaByCode, maxLap) {
    const hasPrecomputedStints =
        data.race_telemetry &&
        Array.isArray(data.race_telemetry.stints) &&
        data.race_telemetry.stints.length > 0;
    const rawStints = hasPrecomputedStints
        ? data.race_telemetry.stints
        : _deriveStintsFromLaps(data, driverMetaByCode, maxLap);

    return rawStints.map((stint) => {
        const meta = driverMetaByCode.get(stint.driver);
        const compound = _normalizeCompound(stint.compound);
        const startLap = Number(stint.start_lap) || 1;
        const endLap = Math.max(startLap, Number(stint.end_lap) || startLap);
        const lapsCount = Number(stint.laps_count) || endLap - startLap + 1;
        return {
            ...stint,
            name: stint.name || meta?.name || stint.driver,
            team: stint.team || meta?.team || '',
            color: meta?.color || stint.color || _DEFAULT_DRIVER_COLOR,
            compound,
            start_lap: startLap,
            end_lap: endLap,
            laps_count: lapsCount
        };
    });
}

/**
 * Extracts and normalizes Safety Car (SC) and Virtual Safety Car (VSC) lap windows.
 *
 * @param {Object} data - Race telemetry payload.
 * @param {number} maxLap - Maximum race lap count.
 * @returns {Array<{type: string, start_lap: number, end_lap: number, label: string}>} Normalized SC/VSC windows.
 */
function _extractScVscWindows(data, maxLap) {
    const rawScWindows =
        data.race_telemetry && Array.isArray(data.race_telemetry.sc_vsc_windows)
            ? data.race_telemetry.sc_vsc_windows
            : Array.isArray(data.session_events)
              ? data.session_events
              : [];

    return rawScWindows
        .filter(
            (w) =>
                (w.type === 'SC' || w.type === 'VSC') &&
                Number.isFinite(Number(w.start_lap)) &&
                Number(w.start_lap) <= maxLap
        )
        .map((w) => {
            const startLap = Math.max(1, Number(w.start_lap));
            const endLap = Math.min(maxLap, Math.max(startLap, Number(w.end_lap) || startLap));
            return {
                type: w.type,
                start_lap: startLap,
                end_lap: endLap,
                label:
                    startLap === endLap
                        ? `${w.type} · L${startLap}`
                        : `${w.type} · L${startLap}–${endLap}`
            };
        });
}

/**
 * Looks up a driver's lap record at `targetLap`, falling back to adjacent laps (±1) if missing.
 *
 * @param {Map<string, Map<number, Object>>} driverLapLookup - Nested map of driver -> lap -> record.
 * @param {string} driverCode - Three-letter driver code.
 * @param {number} targetLap - Desired lap number.
 * @returns {Object|null} Matching or adjacent lap record, or null.
 */
function _findDriverLapRecord(driverLapLookup, driverCode, targetLap) {
    const byLap = driverLapLookup.get(driverCode);
    if (!byLap) return null;
    return (
        byLap.get(targetLap) ||
        byLap.get(targetLap - 1) ||
        byLap.get(targetLap + 1) ||
        null
    );
}

/**
 * Computes up to 3 rival drivers whose `session_time` on `lap - 1` falls within the pit-loss window
 * `[driverSessionTime, driverSessionTime + pitLossS]`.
 *
 * @param {Map<number, Array<Object>>} lapsByNumber - Map of lap number to lap telemetry records.
 * @param {Map<string, Map<number, Object>>} driverLapLookup - Nested map of driver -> lap -> record.
 * @param {string} driverCode - Driver performing the pit stop.
 * @param {number} lap - Pit stop lap number.
 * @param {number|null|undefined} pitLossS - Total pit-lane time loss in seconds.
 * @returns {Array<string>} Up to 3 rival driver codes inside the pit-loss traffic window.
 */
function _computeTrafficRivals(lapsByNumber, driverLapLookup, driverCode, lap, pitLossS) {
    const refLap = Math.max(1, lap - 1);
    const driverRec = _findDriverLapRecord(driverLapLookup, driverCode, refLap);
    if (!driverRec || !Number.isFinite(driverRec.session_time)) {
        return [];
    }

    const driverSessionTime = driverRec.session_time;
    const lossWindow =
        Number.isFinite(Number(pitLossS)) && Number(pitLossS) > 0
            ? Number(pitLossS)
            : _DEFAULT_PIT_LOSS_WINDOW_S;
    const candidates = lapsByNumber.get(refLap) || [];

    return candidates
        .filter(
            (rec) =>
                rec.driver !== driverCode &&
                Number.isFinite(rec.session_time) &&
                rec.session_time >= driverSessionTime &&
                rec.session_time <= driverSessionTime + lossWindow
        )
        .slice()
        .sort((a, b) => a.session_time - b.session_time)
        .slice(0, _TRAFFIC_RIVALS_MAX_COUNT)
        .map((rec) => rec.driver);
}

/**
 * Collects unified pit stop candidates from both `data.race_telemetry.pit_stops` and stint transitions.
 *
 * @param {Object} data - Race telemetry payload.
 * @param {Array<Object>} stints - Normalized stint records.
 * @returns {Array<Object>} Deduplicated pit stop descriptors.
 */
function _collectUnifiedPitStopCandidates(data, stints) {
    const candidatesByKey = new Map();
    const rawStops =
        data.race_telemetry && Array.isArray(data.race_telemetry.pit_stops)
            ? data.race_telemetry.pit_stops
            : [];

    rawStops.forEach((stop) => {
        const lap = Number(stop.lap) || 1;
        const driver = stop.driver;
        if (!driver) return;
        const key = `${driver}-${lap}`;
        candidatesByKey.set(key, {
            driver,
            lap,
            stop_number: Number(stop.stop_number) || 1,
            from_compound: _normalizeCompound(stop.from_compound),
            to_compound: _normalizeCompound(stop.to_compound),
            stationary_s: Number.isFinite(Number(stop.stationary_s))
                ? Number(stop.stationary_s)
                : null,
            pit_loss_s: Number.isFinite(Number(stop.pit_loss_s))
                ? Number(stop.pit_loss_s)
                : null
        });
    });

    const stintsByDriver = d3.group(stints, (s) => s.driver);
    stintsByDriver.forEach((driverStints, driverCode) => {
        const sorted = driverStints.slice().sort((a, b) => a.stint - b.stint);
        for (let i = 0; i < sorted.length - 1; i++) {
            const lap = sorted[i].end_lap;
            const key = `${driverCode}-${lap}`;
            if (!candidatesByKey.has(key)) {
                candidatesByKey.set(key, {
                    driver: driverCode,
                    lap,
                    stop_number: i + 1,
                    from_compound: sorted[i].compound,
                    to_compound: sorted[i + 1].compound,
                    stationary_s: null,
                    pit_loss_s: null
                });
            }
        }
    });

    return Array.from(candidatesByKey.values()).sort((a, b) => a.lap - b.lap);
}

/**
 * Classifies a single pit stop into `SC_STOP`, `UNDERCUT`, `OVERCUT`, or `STANDARD`.
 *
 * @param {Object} stop - Unified pit stop candidate.
 * @param {Array<Object>} allStops - All unified pit stop candidates in the race.
 * @param {Array<Object>} scWindows - Normalized SC/VSC lap windows.
 * @param {Map<string, Map<number, Object>>} driverLapLookup - Nested map of driver -> lap -> record.
 * @param {Map<number, Array<Object>>} lapsByNumber - Map of lap number to lap telemetry records.
 * @param {number} maxLap - Maximum race lap count.
 * @returns {Object} Enriched tactical pit stop descriptor.
 */
function _classifySinglePitStopTactic(
    stop,
    allStops,
    scWindows,
    driverLapLookup,
    lapsByNumber,
    maxLap
) {
    const { driver, lap } = stop;
    const key = `${driver}-${lap}`;
    const trafficRivals = _computeTrafficRivals(
        lapsByNumber,
        driverLapLookup,
        driver,
        lap,
        stop.pit_loss_s
    );

    const matchingScWindow = scWindows.find(
        (w) => lap >= w.start_lap - 1 && lap <= w.end_lap
    );
    if (matchingScWindow) {
        const isSc = matchingScWindow.type === 'SC';
        return {
            ...stop,
            key,
            category: _TACTIC_CATEGORY_SC,
            badgeLabel: isSc ? 'SC FREE STOP' : 'VSC STOP',
            shortBadge: isSc ? 'SC STOP' : 'VSC STOP',
            color: _TACTIC_COLOR_SC,
            detailText: isSc
                ? 'Pitted under Safety Car (~9.5s saved)'
                : 'Pitted under VSC (~6.0s saved)',
            trafficRivals
        };
    }

    const lapBefore = Math.max(1, lap - _PIT_CYCLE_BEFORE_LAPS);
    const lapAfter = Math.min(maxLap, lap + _PIT_CYCLE_AFTER_LAPS);
    const beforeRec = _findDriverLapRecord(driverLapLookup, driver, lapBefore);
    const afterRec = _findDriverLapRecord(driverLapLookup, driver, lapAfter);
    const posBefore = Number.isFinite(beforeRec?.position) ? beforeRec.position : null;
    const posAfter = Number.isFinite(afterRec?.position) ? afterRec.position : null;
    const netGain =
        posBefore !== null && posAfter !== null ? Math.max(0, posBefore - posAfter) : 0;

    const nearbyRivalStops = allStops.filter(
        (other) =>
            other.driver !== driver &&
            Math.abs(other.lap - lap) <= _PIT_WINDOW_RIVAL_LAP_RADIUS
    );

    let undercutRivalCode = null;
    for (const rivalStop of nearbyRivalStops) {
        if (rivalStop.lap <= lap) continue;
        const rivalBefore = _findDriverLapRecord(
            driverLapLookup,
            rivalStop.driver,
            lapBefore
        );
        const evalLap = Math.min(maxLap, rivalStop.lap + 1);
        const driverEval = _findDriverLapRecord(driverLapLookup, driver, evalLap);
        const rivalEval = _findDriverLapRecord(
            driverLapLookup,
            rivalStop.driver,
            evalLap
        );

        const wasRivalAhead =
            posBefore !== null &&
            Number.isFinite(rivalBefore?.position) &&
            rivalBefore.position < posBefore;
        const isDriverAheadAfter =
            Number.isFinite(driverEval?.position) &&
            Number.isFinite(rivalEval?.position) &&
            driverEval.position < rivalEval.position;

        if (wasRivalAhead && isDriverAheadAfter) {
            undercutRivalCode = rivalStop.driver;
            break;
        }
    }

    const hasLaterWindowRivals = nearbyRivalStops.some((r) => r.lap > lap);
    if (undercutRivalCode || (netGain > 0 && hasLaterWindowRivals)) {
        const effectiveGain = Math.max(1, netGain);
        return {
            ...stop,
            key,
            category: _TACTIC_CATEGORY_UNDERCUT,
            badgeLabel: `UNDERCUT +${effectiveGain}`,
            shortBadge: 'UNDERCUT',
            color: _TACTIC_COLOR_UNDERCUT,
            detailText: undercutRivalCode
                ? `Undercut ${undercutRivalCode} (P${posBefore ?? '?'} → P${posAfter ?? '?'})`
                : `Undercut gain (P${posBefore ?? '?'} → P${posAfter ?? '?'})`,
            trafficRivals
        };
    }

    let overcutRivalCode = null;
    for (const rivalStop of nearbyRivalStops) {
        if (lap <= rivalStop.lap) continue;
        const preRivalLap = Math.max(1, rivalStop.lap - 1);
        const driverPre = _findDriverLapRecord(driverLapLookup, driver, preRivalLap);
        const rivalPre = _findDriverLapRecord(
            driverLapLookup,
            rivalStop.driver,
            preRivalLap
        );
        const evalLap = Math.min(maxLap, lap + 1);
        const driverEval = _findDriverLapRecord(driverLapLookup, driver, evalLap);
        const rivalEval = _findDriverLapRecord(
            driverLapLookup,
            rivalStop.driver,
            evalLap
        );

        const wasRivalAheadOrClose =
            (Number.isFinite(rivalPre?.position) &&
                Number.isFinite(driverPre?.position) &&
                rivalPre.position < driverPre.position) ||
            (Number.isFinite(rivalPre?.session_time) &&
                Number.isFinite(driverPre?.session_time) &&
                Math.abs(driverPre.session_time - rivalPre.session_time) <=
                    _OVERCUT_CLOSE_GAP_S);

        const emergedAhead =
            Number.isFinite(driverEval?.position) &&
            Number.isFinite(rivalEval?.position) &&
            driverEval.position < rivalEval.position;

        if (wasRivalAheadOrClose && emergedAhead) {
            overcutRivalCode = rivalStop.driver;
            break;
        }
    }

    if (overcutRivalCode || netGain > 0) {
        const effectiveGain = Math.max(1, netGain);
        return {
            ...stop,
            key,
            category: _TACTIC_CATEGORY_OVERCUT,
            badgeLabel: `OVERCUT +${effectiveGain}`,
            shortBadge: 'OVERCUT',
            color: _TACTIC_COLOR_OVERCUT,
            detailText: overcutRivalCode
                ? `Overcut ${overcutRivalCode} (P${posBefore ?? '?'} → P${posAfter ?? '?'})`
                : `Extended stint overcut (P${posBefore ?? '?'} → P${posAfter ?? '?'})`,
            trafficRivals
        };
    }

    return {
        ...stop,
        key,
        category: _TACTIC_CATEGORY_STANDARD,
        badgeLabel: 'HOLD',
        shortBadge: 'HOLD',
        color: _TACTIC_COLOR_STANDARD,
        detailText:
            posBefore !== null && posAfter !== null
                ? `Track position P${posBefore} → P${posAfter}`
                : 'Routine tyre service',
        trafficRivals
    };
}

/**
 * Analyzes all pit stops in the race and classifies each stop into Undercut, Overcut,
 * SC/VSC Free Stop, or Standard Hold, including pit-loss traffic window rivals.
 *
 * @param {Object} data - Race telemetry payload containing `drivers`, `laps`, and `race_telemetry`.
 * @returns {{
 *   byKey: Map<string, Object>,
 *   list: Array<Object>,
 *   counts: { UNDERCUT: number, OVERCUT: number, SC_STOP: number, STANDARD: number }
 * }} Tactical pit stop classifications and summary counts.
 */
export function analyzePitStopTactics(data) {
    const counts = {
        UNDERCUT: 0,
        OVERCUT: 0,
        SC_STOP: 0,
        STANDARD: 0
    };
    const byKey = new Map();
    const list = [];

    if (!data) {
        return { byKey, list, counts };
    }

    const rawLaps = Array.isArray(data.laps) ? data.laps : [];
    const maxLap =
        d3.max(rawLaps, (d) => Number(d.lap) || 0) || _DEFAULT_FALLBACK_MAX_LAP;
    const driverMetaByCode = new Map(
        (data.drivers || []).map((d) => [d.code, d])
    );

    const stints = _resolveStints(data, driverMetaByCode, maxLap);
    const scWindows = _extractScVscWindows(data, maxLap);
    const allStops = _collectUnifiedPitStopCandidates(data, stints);

    const driverLapLookup = new Map();
    const lapsByNumber = new Map();

    rawLaps.forEach((lapRec) => {
        const lapNum = Number(lapRec.lap);
        if (!lapRec.driver || !Number.isFinite(lapNum)) return;

        if (!driverLapLookup.has(lapRec.driver)) {
            driverLapLookup.set(lapRec.driver, new Map());
        }
        driverLapLookup.get(lapRec.driver).set(lapNum, lapRec);

        if (!lapsByNumber.has(lapNum)) {
            lapsByNumber.set(lapNum, []);
        }
        lapsByNumber.get(lapNum).push(lapRec);
    });

    allStops.forEach((stop) => {
        const tactic = _classifySinglePitStopTactic(
            stop,
            allStops,
            scWindows,
            driverLapLookup,
            lapsByNumber,
            maxLap
        );
        byKey.set(tactic.key, tactic);
        list.push(tactic);
        if (counts[tactic.category] !== undefined) {
            counts[tactic.category] += 1;
        }
    });

    return { byKey, list, counts };
}

/**
 * Extracts pit window transition boundary descriptors between consecutive stints per driver,
 * enriched with tactical pit stop classifications.
 *
 * @param {Array<Object>} stints - Normalized stint records.
 * @param {Function} yScale - D3 band scale for driver rows.
 * @param {Map<string, Object>} tacticsByKey - Lookup map of `"${driver}-${lap}"` to tactical outcome.
 * @returns {Array<Object>} Pit transition markers with tactical metadata.
 */
function _extractPitTransitions(stints, yScale, tacticsByKey) {
    const stintsByDriver = d3.group(stints, (d) => d.driver);
    const pitTransitions = [];

    stintsByDriver.forEach((driverStints, driverCode) => {
        if (yScale(driverCode) === undefined) return;
        const sorted = driverStints.slice().sort((a, b) => a.stint - b.stint);
        for (let i = 0; i < sorted.length - 1; i++) {
            const lap = sorted[i].end_lap;
            const key = `${driverCode}-${lap}`;
            const tactic = tacticsByKey?.get(key) || {
                category: _TACTIC_CATEGORY_STANDARD,
                badgeLabel: 'HOLD',
                shortBadge: 'HOLD',
                color: _TACTIC_COLOR_STANDARD,
                detailText: 'Routine tyre service',
                trafficRivals: []
            };
            pitTransitions.push({
                driver: driverCode,
                name: sorted[i].name || driverCode,
                team: sorted[i].team || '',
                color: sorted[i].color || _DEFAULT_DRIVER_COLOR,
                lap,
                fromCompound: sorted[i].compound,
                toCompound: sorted[i + 1].compound,
                tactic
            });
        }
    });

    return pitTransitions;
}

/**
 * Computes de-collided horizontal center coordinates for SC/VSC top header badges.
 *
 * @param {Array<Object>} scWindows - Normalized SC/VSC lap windows.
 * @param {Function} xScale - D3 linear scale for lap numbers.
 * @param {number} width - Inner chart width in pixels.
 * @returns {Array<{cx: number, cy: number, badgeW: number}>} De-collided badge positions.
 */
function _decollideScBadgePositions(scWindows, xScale, width) {
    const badgePositions = [];

    scWindows.forEach((w) => {
        const x0 = xScale(Math.max(0, w.start_lap - 1));
        const x1 = xScale(w.end_lap);
        const badgeW = w.label.length * _SC_BADGE_CHAR_WIDTH_PX + _SC_BADGE_HORIZONTAL_PAD_PX;
        let cx = Math.max(
            badgeW / 2 + _SC_BADGE_EDGE_MARGIN_PX,
            Math.min(width - badgeW / 2 - _SC_BADGE_EDGE_MARGIN_PX, (x0 + x1) / 2)
        );
        const cy = _SC_BADGE_Y_OFFSET_PX;

        if (badgePositions.length > 0) {
            const prev = badgePositions[badgePositions.length - 1];
            const minGap = (prev.badgeW + badgeW) / 2 + _SC_BADGE_MIN_GAP_PX;
            if (cx - prev.cx < minGap) {
                cx = Math.min(
                    width - badgeW / 2 - _SC_BADGE_EDGE_MARGIN_PX,
                    prev.cx + minGap
                );
            }
        }
        badgePositions.push({ cx, cy, badgeW });
    });

    return badgePositions;
}

/**
 * Computes the horizontal start X coordinate in pixels for a stint bar.
 *
 * @param {Object} stint - Normalized stint record.
 * @param {Function} xScale - D3 linear scale for lap numbers.
 * @returns {number} Starting X coordinate in pixels.
 */
function _computeStintBarX(stint, xScale) {
    return xScale(Math.max(0, stint.start_lap - 1)) + _STINT_GAP_PX / 2;
}

/**
 * Computes the horizontal width in pixels for a stint bar.
 *
 * @param {Object} stint - Normalized stint record.
 * @param {Function} xScale - D3 linear scale for lap numbers.
 * @returns {number} Bar width in pixels.
 */
function _computeStintBarWidth(stint, xScale) {
    const rawWidth =
        xScale(stint.end_lap) - xScale(Math.max(0, stint.start_lap - 1)) - _STINT_GAP_PX;
    return Math.max(_MIN_BAR_WIDTH_PX, rawWidth);
}

/**
 * Formats the in-bar text label based on available pixel width.
 *
 * @param {Object} stint - Normalized stint record.
 * @param {number} barWidth - Computed pixel width of the stint bar.
 * @returns {string} Formatted bar label string (full, abbreviated, or empty).
 */
function _formatStintBarLabel(stint, barWidth) {
    const abbr = _COMPOUND_ABBREVIATIONS[stint.compound] || 'U';
    if (barWidth >= _FULL_LABEL_MIN_WIDTH_PX) {
        return `${abbr} · ${stint.laps_count}L`;
    }
    if (barWidth >= _SHORT_LABEL_MIN_WIDTH_PX) {
        return abbr;
    }
    return '';
}

/**
 * Appends a static tactical pit outcome badge item to `#race-strategy-legend`.
 *
 * @param {HTMLElement} legendContainer - Legend DOM container.
 * @param {string} label - Badge text label.
 * @param {string} accentColor - Tactical category accent color.
 * @returns {void}
 */
function _appendTacticalLegendBadge(legendContainer, label, accentColor) {
    const badgeItem = document.createElement('div');
    badgeItem.className = 'legend-item';
    badgeItem.style.cursor = 'default';
    badgeItem.style.borderColor = accentColor;

    const swatch = document.createElement('div');
    swatch.className = 'legend-color';
    swatch.style.backgroundColor = accentColor;
    swatch.style.borderRadius = '50%';
    badgeItem.appendChild(swatch);
    badgeItem.appendChild(document.createTextNode(label));

    legendContainer.appendChild(badgeItem);
}

/**
 * Builds the interactive compound and tactical outcome legend inside `#race-strategy-legend`.
 *
 * @param {HTMLElement|null} legendContainer - DOM element for the legend.
 * @param {Array<Object>} stints - Normalized stint records.
 * @param {Array<Object>} scWindows - Normalized Safety Car / VSC lap windows.
 * @param {Set<string>} activeCompounds - Set of currently active compound names.
 * @param {Function} onToggle - Callback invoked when a compound filter is toggled.
 * @returns {void}
 */
function _buildStrategyLegend(legendContainer, stints, scWindows, activeCompounds, onToggle) {
    if (!legendContainer) return;
    legendContainer.replaceChildren();

    const compoundsPresent = Array.from(new Set(stints.map((s) => s.compound))).sort(
        (a, b) => _COMPOUND_ORDER.indexOf(a) - _COMPOUND_ORDER.indexOf(b)
    );

    const updateLegendStyles = () => {
        Array.from(legendContainer.children).forEach((child) => {
            const compound = child.dataset.compound;
            if (compound) {
                child.classList.toggle('inactive', !activeCompounds.has(compound));
            }
        });
    };

    compoundsPresent.forEach((compound) => {
        const item = document.createElement('div');
        item.className = 'legend-item';
        item.dataset.compound = compound;

        const swatch = document.createElement('div');
        swatch.className = 'legend-color';
        swatch.style.backgroundColor = _COMPOUND_COLORS[compound] || _COMPOUND_COLORS.UNKNOWN;
        item.appendChild(swatch);
        item.appendChild(document.createTextNode(compound));

        item.addEventListener('click', () => {
            if (activeCompounds.has(compound)) {
                if (activeCompounds.size > 1) {
                    activeCompounds.delete(compound);
                }
            } else {
                activeCompounds.add(compound);
            }
            updateLegendStyles();
            onToggle();
        });

        legendContainer.appendChild(item);
    });

    const hasSC = scWindows.some((w) => w.type === 'SC');
    const hasVSC = scWindows.some((w) => w.type === 'VSC');

    if (hasSC) {
        const scItem = document.createElement('div');
        scItem.className = 'legend-item';
        scItem.style.cursor = 'default';
        const swatch = document.createElement('div');
        swatch.className = 'legend-color';
        swatch.style.backgroundColor = _SC_LEGEND_FILL;
        swatch.style.border = `1.5px dashed ${_SC_COLOR}`;
        scItem.appendChild(swatch);
        scItem.appendChild(document.createTextNode('SAFETY CAR (SC)'));
        legendContainer.appendChild(scItem);
    }

    if (hasVSC) {
        const vscItem = document.createElement('div');
        vscItem.className = 'legend-item';
        vscItem.style.cursor = 'default';
        const swatch = document.createElement('div');
        swatch.className = 'legend-color';
        swatch.style.backgroundColor = _VSC_LEGEND_FILL;
        swatch.style.border = `1.5px dashed ${_VSC_COLOR}`;
        vscItem.appendChild(swatch);
        vscItem.appendChild(document.createTextNode('VIRTUAL SC (VSC)'));
        legendContainer.appendChild(vscItem);
    }

    _appendTacticalLegendBadge(legendContainer, 'UNDERCUT', _TACTIC_COLOR_UNDERCUT);
    _appendTacticalLegendBadge(legendContainer, 'OVERCUT', _TACTIC_COLOR_OVERCUT);
    _appendTacticalLegendBadge(legendContainer, 'SC/VSC FREE STOP', _TACTIC_COLOR_SC);

    updateLegendStyles();
}

/**
 * Builds a DOM block displaying a pit stop's tactical outcome and traffic window for `#tooltip`.
 *
 * @param {Object|null} tactic - Tactical pit stop classification entry.
 * @returns {HTMLDivElement|null} Tactical outcome container element or null.
 */
function _createTacticTooltipBlock(tactic) {
    if (!tactic) return null;

    const wrap = document.createElement('div');
    wrap.style.marginTop = '6px';
    wrap.style.paddingTop = '5px';
    wrap.style.borderTop = '1px solid rgba(255, 255, 255, 0.12)';

    const badgeRow = document.createElement('div');
    badgeRow.style.display = 'flex';
    badgeRow.style.alignItems = 'center';
    badgeRow.style.gap = '6px';
    badgeRow.style.marginBottom = '2px';

    const pill = document.createElement('span');
    pill.style.display = 'inline-block';
    pill.style.padding = '1px 6px';
    pill.style.borderRadius = '3px';
    pill.style.fontFamily = 'Montserrat, sans-serif';
    pill.style.fontSize = '0.68rem';
    pill.style.fontWeight = '700';
    pill.style.color = tactic.color || _TACTIC_COLOR_STANDARD;
    pill.style.border = `1px solid ${tactic.color || _TACTIC_COLOR_STANDARD}`;
    pill.style.backgroundColor = 'rgba(17, 17, 24, 0.92)';
    pill.textContent = tactic.badgeLabel || 'HOLD';

    const detailSpan = document.createElement('span');
    detailSpan.style.fontSize = '0.75rem';
    detailSpan.style.fontWeight = '600';
    detailSpan.style.color = 'var(--text-primary)';
    detailSpan.textContent = tactic.detailText || '';

    badgeRow.append(pill, detailSpan);
    wrap.appendChild(badgeRow);

    const trafficDiv = document.createElement('div');
    trafficDiv.style.fontSize = '0.73rem';
    trafficDiv.style.color = 'var(--text-muted)';
    const rivalsText =
        Array.isArray(tactic.trafficRivals) && tactic.trafficRivals.length > 0
            ? tactic.trafficRivals.join(', ')
            : 'Clear track';
    trafficDiv.textContent = `Pit Window Traffic: ${rivalsText}`;
    wrap.appendChild(trafficDiv);

    return wrap;
}

/**
 * Populates the shared `#tooltip` DOM node with stint telemetry details and entry/exit pit tactics.
 *
 * @param {HTMLElement|null} tooltipNode - Underlying DOM node for `#tooltip`.
 * @param {Object} stint - Hovered stint object.
 * @param {Map<string, Object>} tacticsByKey - Lookup map of `"${driver}-${lap}"` to tactical outcome.
 * @returns {void}
 */
function _populateStintTooltip(tooltipNode, stint, tacticsByKey) {
    if (!tooltipNode) return;

    const compoundColor = _COMPOUND_COLORS[stint.compound] || _COMPOUND_COLORS.UNKNOWN;

    const headerDiv = document.createElement('div');
    headerDiv.style.fontFamily = 'Montserrat, sans-serif';
    headerDiv.style.fontWeight = '700';
    headerDiv.style.marginBottom = '4px';
    headerDiv.style.textTransform = 'uppercase';
    headerDiv.appendChild(document.createTextNode(`${stint.driver} `));

    const teamSpan = document.createElement('span');
    teamSpan.style.color = 'var(--text-muted)';
    teamSpan.style.fontWeight = '600';
    teamSpan.style.fontSize = '0.75rem';
    teamSpan.textContent = `· ${stint.team}`;
    headerDiv.appendChild(teamSpan);

    const compoundRow = document.createElement('div');
    compoundRow.style.display = 'flex';
    compoundRow.style.alignItems = 'center';
    compoundRow.style.gap = '6px';
    compoundRow.style.fontSize = '0.8rem';
    compoundRow.style.fontWeight = '700';
    compoundRow.style.marginBottom = '4px';
    compoundRow.style.textTransform = 'uppercase';

    const dot = document.createElement('span');
    dot.style.display = 'inline-block';
    dot.style.width = '10px';
    dot.style.height = '10px';
    dot.style.borderRadius = '50%';
    dot.style.backgroundColor = compoundColor;
    dot.style.border = '1px solid rgba(255, 255, 255, 0.35)';
    compoundRow.appendChild(dot);
    compoundRow.appendChild(
        document.createTextNode(`Stint ${stint.stint} · ${stint.compound}`)
    );

    const lapsDiv = document.createElement('div');
    lapsDiv.style.fontSize = '0.8rem';
    lapsDiv.style.color = 'var(--text-primary)';
    lapsDiv.style.marginBottom = '4px';
    lapsDiv.textContent = `Laps ${stint.start_lap}–${stint.end_lap} (${stint.laps_count} ${
        stint.laps_count === 1 ? 'lap' : 'laps'
    })`;

    const rawPaceDiv = document.createElement('div');
    rawPaceDiv.style.fontSize = '0.76rem';
    rawPaceDiv.style.color = 'var(--text-muted)';
    rawPaceDiv.textContent = `Avg Stint Pace: ${_formatPace(stint.avg_pace)}`;

    const fuelPaceDiv = document.createElement('div');
    fuelPaceDiv.style.fontSize = '0.76rem';
    fuelPaceDiv.style.color = _FUEL_CORRECTED_TEXT_COLOR;
    fuelPaceDiv.style.fontWeight = '600';
    fuelPaceDiv.textContent = `Fuel-Corrected Pace: ${_formatPace(stint.fuel_corrected_pace)}`;

    const children = [headerDiv, compoundRow, lapsDiv, rawPaceDiv, fuelPaceDiv];

    const entryPitLap = stint.start_lap - 1;
    const tactic =
        (entryPitLap >= 1 && tacticsByKey?.get(`${stint.driver}-${entryPitLap}`)) ||
        tacticsByKey?.get(`${stint.driver}-${stint.end_lap}`) ||
        null;
    const tacticBlock = _createTacticTooltipBlock(tactic);
    if (tacticBlock) {
        children.push(tacticBlock);
    }

    tooltipNode.replaceChildren(...children);
}

/**
 * Populates the shared `#tooltip` DOM node when hovering a pit transition marker.
 *
 * @param {HTMLElement|null} tooltipNode - Underlying DOM node for `#tooltip`.
 * @param {Object} marker - Pit transition marker descriptor (`driver`, `team`, `lap`, `fromCompound`, `toCompound`, `tactic`).
 * @returns {void}
 */
function _populatePitMarkerTooltip(tooltipNode, marker) {
    if (!tooltipNode || !marker) return;

    const headerDiv = document.createElement('div');
    headerDiv.style.fontFamily = 'Montserrat, sans-serif';
    headerDiv.style.fontWeight = '700';
    headerDiv.style.marginBottom = '4px';
    headerDiv.style.textTransform = 'uppercase';
    headerDiv.appendChild(document.createTextNode(`${marker.driver} · PIT STOP LAP ${marker.lap} `));

    if (marker.team) {
        const teamSpan = document.createElement('span');
        teamSpan.style.color = 'var(--text-muted)';
        teamSpan.style.fontWeight = '600';
        teamSpan.style.fontSize = '0.75rem';
        teamSpan.textContent = `(${marker.team})`;
        headerDiv.appendChild(teamSpan);
    }

    const transitionDiv = document.createElement('div');
    transitionDiv.style.fontSize = '0.8rem';
    transitionDiv.style.fontWeight = '600';
    transitionDiv.style.color = 'var(--text-primary)';
    transitionDiv.textContent = `Tyre Change: ${marker.fromCompound} → ${marker.toCompound}`;

    const children = [headerDiv, transitionDiv];
    const tacticBlock = _createTacticTooltipBlock(marker.tactic);
    if (tacticBlock) {
        children.push(tacticBlock);
    }

    tooltipNode.replaceChildren(...children);
}

/**
 * Populates the shared `#tooltip` DOM node with Safety Car / VSC window summary details.
 *
 * @param {HTMLElement|null} tooltipNode - Underlying DOM node for `#tooltip`.
 * @param {Object} scWindow - Hovered SC/VSC window descriptor.
 * @param {Array<Object>} pitTransitions - Pit transition events across the race.
 * @param {string} badgeColor - Accent color for the SC or VSC window.
 * @returns {void}
 */
function _populateScWindowTooltip(tooltipNode, scWindow, pitTransitions, badgeColor) {
    if (!tooltipNode) return;

    const fullTitle =
        scWindow.type === 'SC' ? 'SAFETY CAR DEPLOYED' : 'VIRTUAL SAFETY CAR';
    const pitsInWindow = pitTransitions.filter(
        (p) => p.lap >= scWindow.start_lap - 1 && p.lap <= scWindow.end_lap
    );
    const pittedDrivers = Array.from(new Set(pitsInWindow.map((p) => p.driver)));
    const pitSummary =
        pittedDrivers.length > 0
            ? `Drivers Pitting (${pittedDrivers.length}): ${pittedDrivers.join(', ')}`
            : 'No pit stops recorded in this window';

    const titleDiv = document.createElement('div');
    titleDiv.style.fontFamily = 'Montserrat, sans-serif';
    titleDiv.style.fontWeight = '700';
    titleDiv.style.marginBottom = '4px';
    titleDiv.style.color = badgeColor;
    titleDiv.textContent = fullTitle;

    const windowDiv = document.createElement('div');
    windowDiv.style.fontSize = '0.82rem';
    windowDiv.style.fontWeight = '600';
    windowDiv.style.marginBottom = '4px';
    windowDiv.textContent = `Active Window: Laps ${scWindow.start_lap}–${scWindow.end_lap}`;

    const summaryDiv = document.createElement('div');
    summaryDiv.style.fontSize = '0.76rem';
    summaryDiv.style.color = 'var(--text-muted)';
    summaryDiv.textContent = pitSummary;

    tooltipNode.replaceChildren(titleDiv, windowDiv, summaryDiv);
}

/**
 * Renders an empty-state notice inside the strategy chart container.
 *
 * @param {HTMLElement} container - Target chart container element.
 * @returns {void}
 */
function _renderEmptyStrategyState(container) {
    const emptyMsg = document.createElement('p');
    emptyMsg.style.color = 'var(--text-muted)';
    emptyMsg.style.textAlign = 'center';
    emptyMsg.style.paddingTop = '2rem';
    emptyMsg.style.fontFamily = 'Montserrat, sans-serif';
    emptyMsg.style.textTransform = 'uppercase';
    emptyMsg.textContent = 'No tyre strategy data available for this race.';
    container.replaceChildren(emptyMsg);
}

/**
 * Renders vertical lap gridlines and subtle horizontal row background bands.
 *
 * @param {Object} svg - D3 selection of the chart main `<g>`.
 * @param {Function} xScale - D3 linear scale for lap numbers.
 * @param {Function} yScale - D3 band scale for driver codes.
 * @param {Array<string>} orderedDrivers - Ordered list of driver codes.
 * @param {number} width - Inner chart width in pixels.
 * @param {number} height - Inner chart height in pixels.
 * @param {number} maxLap - Maximum race lap number.
 * @returns {void}
 */
function _renderStrategyGridAndRowGuides(
    svg,
    xScale,
    yScale,
    orderedDrivers,
    width,
    height,
    maxLap
) {
    svg.append('g')
        .attr('class', 'gridline')
        .attr('transform', `translate(0,${height})`)
        .call(
            d3
                .axisBottom(xScale)
                .ticks(Math.min(_MAX_X_AXIS_TICKS, maxLap))
                .tickSize(-height)
                .tickFormat('')
        );

    svg.append('g')
        .attr('class', 'strategy-row-guides')
        .selectAll('rect.row-bg')
        .data(orderedDrivers)
        .enter()
        .append('rect')
        .attr('class', 'row-bg')
        .attr('x', 0)
        .attr('y', (d) => yScale(d))
        .attr('width', width)
        .attr('height', yScale.bandwidth())
        .attr('rx', _BAR_CORNER_RADIUS_PX)
        .attr('fill', _ROW_GUIDE_FILL);
}

/**
 * Renders under-stint shaded vertical bands for Safety Car and Virtual Safety Car periods.
 *
 * @param {Object} svg - D3 selection of the chart main `<g>`.
 * @param {Array<Object>} scWindows - Normalized SC/VSC lap windows.
 * @param {Function} xScale - D3 linear scale for lap numbers.
 * @param {number} height - Inner chart height in pixels.
 * @returns {void}
 */
function _renderScVscBackdrops(svg, scWindows, xScale, height) {
    if (scWindows.length === 0) return;

    svg.append('g')
        .attr('class', 'sc-vsc-bg-layer')
        .selectAll('rect.sc-vsc-band')
        .data(scWindows)
        .enter()
        .append('rect')
        .attr('class', 'sc-vsc-band')
        .attr('x', (w) => xScale(Math.max(0, w.start_lap - 1)))
        .attr('y', -_SC_BAND_VERTICAL_PAD_PX)
        .attr('width', (w) =>
            Math.max(
                _SC_BAND_MIN_WIDTH_PX,
                xScale(w.end_lap) - xScale(Math.max(0, w.start_lap - 1))
            )
        )
        .attr('height', height + _SC_BAND_VERTICAL_PAD_PX * 2)
        .attr('fill', (w) => (w.type === 'SC' ? _SC_BAND_FILL : _VSC_BAND_FILL))
        .style('pointer-events', 'none');
}

/**
 * Renders the horizontal lap axis and vertical driver classification axis.
 *
 * @param {Object} svg - D3 selection of the chart main `<g>`.
 * @param {Function} xScale - D3 linear scale for lap numbers.
 * @param {Function} yScale - D3 band scale for driver codes.
 * @param {Map<string, number>} rankByDriver - Lookup map of driver code to classification rank.
 * @param {Map<string, Object>} driverMetaByCode - Lookup map of driver code to metadata.
 * @param {number} width - Inner chart width in pixels.
 * @param {number} height - Inner chart height in pixels.
 * @param {number} maxLap - Maximum race lap number.
 * @returns {Object} D3 selection of Y-axis driver label `<text>` elements.
 */
function _renderStrategyAxes(
    svg,
    xScale,
    yScale,
    rankByDriver,
    driverMetaByCode,
    width,
    height,
    maxLap
) {
    const xAxisGroup = svg
        .append('g')
        .attr('transform', `translate(0,${height})`)
        .call(
            d3
                .axisBottom(xScale)
                .ticks(Math.min(_MAX_X_AXIS_TICKS, maxLap))
                .tickFormat((d) => (d === 0 ? 'START' : `L${d}`))
        );

    xAxisGroup
        .append('text')
        .attr('x', width)
        .attr('y', _X_AXIS_TITLE_OFFSET_Y_PX)
        .attr('fill', 'var(--text-muted)')
        .attr('text-anchor', 'end')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-weight', '600')
        .style('font-size', '11px')
        .text('LAP NUMBER');

    const yAxisGroup = svg
        .append('g')
        .call(
            d3
                .axisLeft(yScale)
                .tickSize(0)
                .tickPadding(_Y_AXIS_TICK_PADDING_PX)
                .tickFormat((code) => {
                    const rank = rankByDriver.get(code);
                    return rank ? `P${rank}  ${code}` : code;
                })
        )
        .call((g) => g.select('.domain').remove());

    return yAxisGroup
        .selectAll('.tick text')
        .attr('class', 'driver-label')
        .style('fill', (code) => driverMetaByCode.get(code)?.color || 'var(--text-primary)')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-weight', '700')
        .style('font-size', '11px')
        .style('cursor', 'pointer');
}

/**
 * Renders the stint compound bars, constructor accent underlines, and compound labels.
 *
 * @param {Object} svg - D3 selection of the chart main `<g>`.
 * @param {Array<Object>} stints - Normalized stint records.
 * @param {Function} xScale - D3 linear scale for lap numbers.
 * @param {Function} yScale - D3 band scale for driver codes.
 * @returns {Object} D3 selection of `<g class="stint-bar-group">` elements.
 */
function _renderStintBars(svg, stints, xScale, yScale) {
    const stintsGroup = svg.append('g').attr('class', 'stints-layer');

    const stintGroups = stintsGroup
        .selectAll('g.stint-bar-group')
        .data(stints.filter((s) => yScale(s.driver) !== undefined))
        .enter()
        .append('g')
        .attr('class', 'stint-bar-group')
        .style('cursor', 'pointer');

    stintGroups
        .append('rect')
        .attr('class', 'stint-team-accent')
        .attr('x', (d) => _computeStintBarX(d, xScale))
        .attr('y', (d) => yScale(d.driver) + yScale.bandwidth() - _TEAM_ACCENT_HEIGHT_PX)
        .attr('width', (d) => _computeStintBarWidth(d, xScale))
        .attr('height', _TEAM_ACCENT_HEIGHT_PX)
        .attr('rx', _TEAM_ACCENT_RADIUS_PX)
        .attr('fill', (d) => d.color);

    stintGroups
        .append('rect')
        .attr('class', 'stint-compound-bar')
        .attr('x', (d) => _computeStintBarX(d, xScale))
        .attr('y', (d) => yScale(d.driver))
        .attr('width', (d) => _computeStintBarWidth(d, xScale))
        .attr('height', Math.max(_MIN_BAR_HEIGHT_PX, yScale.bandwidth() - _BAR_HEIGHT_INSET_PX))
        .attr('rx', _BAR_CORNER_RADIUS_PX)
        .attr('ry', _BAR_CORNER_RADIUS_PX)
        .attr('fill', (d) => _COMPOUND_COLORS[d.compound] || _COMPOUND_COLORS.UNKNOWN)
        .attr('stroke', _BAR_STROKE_COLOR)
        .attr('stroke-width', _BAR_STROKE_WIDTH_PX);

    stintGroups
        .append('text')
        .attr('class', 'stint-bar-label')
        .attr('x', (d) => _computeStintBarX(d, xScale) + _computeStintBarWidth(d, xScale) / 2)
        .attr('y', (d) => yScale(d.driver) + (yScale.bandwidth() - _BAR_HEIGHT_INSET_PX) / 2)
        .attr('dy', '0.36em')
        .attr('text-anchor', 'middle')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-weight', '700')
        .style('font-size', '10px')
        .style('pointer-events', 'none')
        .style('paint-order', 'stroke')
        .attr('stroke', (d) => _COMPOUND_COLORS[d.compound] || _COMPOUND_COLORS.UNKNOWN)
        .attr('stroke-width', _LABEL_OUTLINE_WIDTH_PX)
        .attr('stroke-linejoin', 'round')
        .attr('fill', (d) =>
            _DARK_TEXT_COMPOUNDS.has(d.compound) ? _BAR_STROKE_COLOR : '#ffffff'
        )
        .text((d) => _formatStintBarLabel(d, _computeStintBarWidth(d, xScale)));

    return stintGroups;
}

/**
 * Renders interactive pit transition markers (`<g class="pit-transition-marker">`) between consecutive stints.
 *
 * @param {Object} svg - D3 selection of the chart main `<g>`.
 * @param {Array<Object>} pitTransitions - Pit transition descriptors enriched with `tactic`.
 * @param {Function} xScale - D3 linear scale for lap numbers.
 * @param {Function} yScale - D3 band scale for driver codes.
 * @param {Object} tooltip - D3 selection of `#tooltip`.
 * @param {Function} onHoverChange - Callback invoked with hovered driver code or null.
 * @returns {Object} D3 selection of `<g class="pit-transition-marker">` elements.
 */
function _renderPitTransitionTicks(
    svg,
    pitTransitions,
    xScale,
    yScale,
    tooltip,
    onHoverChange
) {
    const markerLayer = svg.append('g').attr('class', 'pit-transition-ticks');

    const markers = markerLayer
        .selectAll('g.pit-transition-marker')
        .data(pitTransitions)
        .enter()
        .append('g')
        .attr('class', 'pit-transition-marker')
        .style('cursor', 'pointer');

    markers
        .append('line')
        .attr('class', 'pit-tick')
        .attr('x1', (d) => xScale(d.lap))
        .attr('x2', (d) => xScale(d.lap))
        .attr('y1', (d) => yScale(d.driver) - _PIT_TICK_VERTICAL_OVERHANG_PX)
        .attr('y2', (d) => yScale(d.driver) + yScale.bandwidth() + _PIT_TICK_VERTICAL_OVERHANG_PX)
        .attr('stroke', (d) => d.tactic?.color || _TACTIC_COLOR_STANDARD)
        .attr('stroke-width', _PIT_MARKER_LINE_WIDTH_PX)
        .style('pointer-events', 'none');

    markers
        .append('circle')
        .attr('class', 'pit-transition-badge')
        .attr('cx', (d) => xScale(d.lap))
        .attr('cy', (d) => yScale(d.driver) - 1)
        .attr('r', _PIT_MARKER_BADGE_RADIUS_PX)
        .attr('fill', (d) => d.tactic?.color || _TACTIC_COLOR_STANDARD)
        .attr('stroke', _BAR_STROKE_COLOR)
        .attr('stroke-width', _PIT_MARKER_BADGE_STROKE_WIDTH_PX)
        .style('pointer-events', 'none');

    markers
        .append('rect')
        .attr('class', 'pit-transition-hit')
        .attr('x', (d) => xScale(d.lap) - _PIT_MARKER_HIT_WIDTH_PX / 2)
        .attr('y', (d) => yScale(d.driver) - _PIT_MARKER_BADGE_RADIUS_PX)
        .attr('width', _PIT_MARKER_HIT_WIDTH_PX)
        .attr('height', yScale.bandwidth() + _PIT_MARKER_BADGE_RADIUS_PX * 2)
        .attr('fill', 'transparent');

    markers
        .on('mouseover', (event, d) => {
            if (onHoverChange) onHoverChange(d.driver);
            d3.select(event.currentTarget)
                .select('circle.pit-transition-badge')
                .attr('r', _PIT_MARKER_BADGE_RADIUS_PX + 1.4)
                .attr('stroke', '#ffffff');

            _populatePitMarkerTooltip(tooltip.node(), d);
            tooltip
                .classed('hidden', false)
                .style('border-left-color', d.tactic?.color || d.color || 'var(--accent)')
                .style('left', `${event.pageX + _TOOLTIP_OFFSET_X_PX}px`)
                .style('top', `${event.pageY + _TOOLTIP_OFFSET_Y_PX}px`);
        })
        .on('mousemove', (event) => {
            tooltip
                .style('left', `${event.pageX + _TOOLTIP_OFFSET_X_PX}px`)
                .style('top', `${event.pageY + _TOOLTIP_OFFSET_Y_PX}px`);
        })
        .on('mouseout', (event) => {
            if (onHoverChange) onHoverChange(null);
            d3.select(event.currentTarget)
                .select('circle.pit-transition-badge')
                .attr('r', _PIT_MARKER_BADGE_RADIUS_PX)
                .attr('stroke', _BAR_STROKE_COLOR);
            tooltip.classed('hidden', true);
        });

    return markers;
}

/**
 * Renders the vertical synchronized playhead line (`g.strategy-playhead-layer`) and returns its updater.
 *
 * @param {Object} svg - D3 selection of the chart main `<g>`.
 * @param {Function} xScale - D3 linear scale for lap numbers.
 * @param {number} height - Inner chart height in pixels.
 * @param {number} maxLap - Maximum race lap count.
 * @returns {Function} `updatePlayhead(lapNumber)` callback.
 */
function _createStrategyPlayheadLayer(svg, xScale, height, maxLap) {
    const playheadLayer = svg
        .append('g')
        .attr('class', 'strategy-playhead-layer')
        .style('display', 'none')
        .style('pointer-events', 'none');

    playheadLayer
        .append('line')
        .attr('class', 'strategy-playhead-line')
        .attr('x1', 0)
        .attr('x2', 0)
        .attr('y1', _PLAYHEAD_TOP_OFFSET_PX)
        .attr('y2', height)
        .attr('stroke', _PLAYHEAD_COLOR)
        .attr('stroke-width', _PLAYHEAD_STROKE_WIDTH_PX)
        .attr('stroke-dasharray', _PLAYHEAD_DASH_ARRAY);

    playheadLayer
        .append('rect')
        .attr('x', -_PLAYHEAD_PILL_WIDTH_PX / 2)
        .attr('y', _PLAYHEAD_PILL_Y_OFFSET_PX)
        .attr('width', _PLAYHEAD_PILL_WIDTH_PX)
        .attr('height', _PLAYHEAD_PILL_HEIGHT_PX)
        .attr('rx', _PLAYHEAD_PILL_RADIUS_PX)
        .attr('fill', _PLAYHEAD_PILL_BG_FILL)
        .attr('stroke', _PLAYHEAD_COLOR)
        .attr('stroke-width', 1.2);

    const labelText = playheadLayer
        .append('text')
        .attr('x', 0)
        .attr('y', _PLAYHEAD_PILL_Y_OFFSET_PX + _PLAYHEAD_PILL_HEIGHT_PX / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'middle')
        .attr('fill', _PLAYHEAD_COLOR)
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '9.5px')
        .style('font-weight', '700')
        .text('LAP 0');

    return (lapNumber) => {
        if (lapNumber === null || lapNumber === undefined || !Number.isFinite(lapNumber)) {
            playheadLayer.style('display', 'none');
            return;
        }
        const clampedLap = Math.max(0, Math.min(maxLap, lapNumber));
        const xPos = xScale(clampedLap);
        labelText.text(`LAP ${clampedLap}`);
        playheadLayer
            .style('display', null)
            .attr('transform', `translate(${xPos},0)`)
            .raise();
    };
}

/**
 * Renders over-stint SC/VSC dashed boundary lines and de-collided top header badges.
 *
 * @param {Object} svg - D3 selection of the chart main `<g>`.
 * @param {Array<Object>} scWindows - Normalized SC/VSC lap windows.
 * @param {Array<Object>} pitTransitions - Pit transition descriptors across the race.
 * @param {Function} xScale - D3 linear scale for lap numbers.
 * @param {number} width - Inner chart width in pixels.
 * @param {number} height - Inner chart height in pixels.
 * @param {Object} tooltip - D3 selection of `#tooltip`.
 * @returns {void}
 */
function _renderScVscOverlayBadges(
    svg,
    scWindows,
    pitTransitions,
    xScale,
    width,
    height,
    tooltip
) {
    if (scWindows.length === 0) return;

    const scOverlayGroup = svg.append('g').attr('class', 'sc-vsc-overlay-layer');

    const windowGroups = scOverlayGroup
        .selectAll('g.sc-vsc-window')
        .data(scWindows)
        .enter()
        .append('g')
        .attr('class', 'sc-vsc-window');

    const appendBoundaryLine = (getLapX) => {
        windowGroups
            .append('line')
            .attr('x1', getLapX)
            .attr('x2', getLapX)
            .attr('y1', _SC_LINE_TOP_OFFSET_PX)
            .attr('y2', height)
            .attr('stroke', (w) => (w.type === 'SC' ? _SC_COLOR : _VSC_COLOR))
            .attr('stroke-width', _SC_LINE_STROKE_WIDTH_PX)
            .attr('stroke-dasharray', _SC_LINE_DASH_ARRAY)
            .attr('opacity', _SC_LINE_OPACITY)
            .style('pointer-events', 'none');
    };

    appendBoundaryLine((w) => xScale(Math.max(0, w.start_lap - 1)));
    appendBoundaryLine((w) => xScale(w.end_lap));

    const badgePositions = _decollideScBadgePositions(scWindows, xScale, width);

    const badgeGroups = windowGroups
        .append('g')
        .attr('class', 'sc-vsc-badge')
        .attr('transform', (_w, idx) => {
            const pos = badgePositions[idx] || { cx: 40, cy: _SC_BADGE_Y_OFFSET_PX };
            return `translate(${pos.cx},${pos.cy})`;
        })
        .style('cursor', 'pointer');

    badgeGroups
        .append('rect')
        .attr(
            'x',
            (w) =>
                -(w.label.length * (_SC_BADGE_CHAR_WIDTH_PX / 2) + _SC_BADGE_HORIZONTAL_PAD_PX / 2)
        )
        .attr('y', -9)
        .attr('width', (w) => w.label.length * _SC_BADGE_CHAR_WIDTH_PX + _SC_BADGE_HORIZONTAL_PAD_PX)
        .attr('height', _SC_BADGE_HEIGHT_PX)
        .attr('rx', _SC_BADGE_RADIUS_PX)
        .attr('fill', _SC_BADGE_BG_FILL)
        .attr('stroke', (w) => (w.type === 'SC' ? _SC_COLOR : _VSC_COLOR))
        .attr('stroke-width', _SC_BADGE_STROKE_WIDTH_PX);

    badgeGroups
        .append('text')
        .attr('x', 0)
        .attr('y', 0)
        .attr('dy', '0.34em')
        .attr('text-anchor', 'middle')
        .attr('fill', (w) => (w.type === 'SC' ? _SC_COLOR : _VSC_COLOR))
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '9.5px')
        .style('font-weight', '700')
        .style('letter-spacing', '0.4px')
        .text((w) => w.label);

    badgeGroups
        .on('mouseover', (event, w) => {
            const badgeColor = w.type === 'SC' ? _SC_COLOR : _VSC_COLOR;
            _populateScWindowTooltip(tooltip.node(), w, pitTransitions, badgeColor);
            tooltip
                .classed('hidden', false)
                .style('border-left-color', badgeColor)
                .style('left', `${event.pageX + _TOOLTIP_OFFSET_X_PX}px`)
                .style('top', `${event.pageY + _TOOLTIP_OFFSET_Y_PX}px`);
        })
        .on('mousemove', (event) => {
            tooltip
                .style('left', `${event.pageX + _TOOLTIP_OFFSET_X_PX}px`)
                .style('top', `${event.pageY + _TOOLTIP_OFFSET_Y_PX}px`);
        })
        .on('mouseout', () => {
            tooltip.classed('hidden', true);
        });
}

/**
 * Binds click and hover interactions to driver labels and stint bar groups.
 *
 * @param {Object} stintGroups - D3 selection of stint bar groups.
 * @param {Object} driverLabels - D3 selection of Y-axis driver label nodes.
 * @param {Object} tooltip - D3 selection of `#tooltip`.
 * @param {Map<string, Object>} tacticsByKey - Lookup map of `"${driver}-${lap}"` to tactical outcome.
 * @param {Function} onHoverChange - Callback invoked with hovered driver code or null.
 * @param {Function} onDriverClick - Callback invoked when a driver label is clicked.
 * @returns {void}
 */
function _bindStrategyInteractions(
    stintGroups,
    driverLabels,
    tooltip,
    tacticsByKey,
    onHoverChange,
    onDriverClick
) {
    driverLabels.on('click', (_event, code) => {
        onDriverClick(code);
    });

    stintGroups
        .on('mouseover', (event, d) => {
            onHoverChange(d.driver);

            d3.select(event.currentTarget)
                .select('rect.stint-compound-bar')
                .attr('stroke', _BAR_HOVER_STROKE_COLOR)
                .attr('stroke-width', _BAR_HOVER_STROKE_WIDTH_PX);

            _populateStintTooltip(tooltip.node(), d, tacticsByKey);
            tooltip
                .classed('hidden', false)
                .style('border-left-color', d.color || 'var(--accent)')
                .style('left', `${event.pageX + _TOOLTIP_OFFSET_X_PX}px`)
                .style('top', `${event.pageY + _TOOLTIP_OFFSET_Y_PX}px`);
        })
        .on('mousemove', (event) => {
            tooltip
                .style('left', `${event.pageX + _TOOLTIP_OFFSET_X_PX}px`)
                .style('top', `${event.pageY + _TOOLTIP_OFFSET_Y_PX}px`);
        })
        .on('mouseout', (event) => {
            onHoverChange(null);

            d3.select(event.currentTarget)
                .select('rect.stint-compound-bar')
                .attr('stroke', _BAR_STROKE_COLOR)
                .attr('stroke-width', _BAR_STROKE_WIDTH_PX);

            tooltip.classed('hidden', true);
        });
}

/**
 * Renders the Tyre Strategy & Pit Window Gantt Chart inside `#race-strategy-chart`.
 *
 * @param {Object} data - Race telemetry payload containing `drivers`, `laps`, and `race_telemetry`.
 * @returns {void}
 */
export function renderRaceStrategy(data) {
    const container = document.getElementById('race-strategy-chart');
    const legendContainer = document.getElementById('race-strategy-legend');
    if (!container) return;

    container.replaceChildren();
    if (legendContainer) legendContainer.replaceChildren();

    const { classification, maxLap: classifiedMaxLap } = calculateDriverClassification(data);
    const driverMetaByCode = new Map(
        (data.drivers || []).map((d) => [d.code, d])
    );

    const stints = _resolveStints(
        data,
        driverMetaByCode,
        classifiedMaxLap || _DEFAULT_FALLBACK_MAX_LAP
    );
    if (stints.length === 0) {
        _externalStrategyFocusHandler = null;
        _strategyPlayheadHandler = null;
        _renderEmptyStrategyState(container);
        return;
    }

    const maxLap = Math.max(
        classifiedMaxLap || 1,
        d3.max(stints, (d) => d.end_lap) || 1
    );

    const orderedDrivers =
        classification.length > 0
            ? classification.map((c) => c.code)
            : Array.from(new Set(stints.map((s) => s.driver)));

    const rankByDriver = new Map(
        orderedDrivers.map((code, idx) => [code, idx + 1])
    );

    const containerWidth = Math.max(
        _MIN_CONTAINER_WIDTH_PX,
        container.clientWidth || _DEFAULT_CONTAINER_WIDTH_PX
    );
    const width = containerWidth - _CHART_MARGIN.left - _CHART_MARGIN.right;
    const height = Math.max(
        _MIN_CHART_HEIGHT_PX - _CHART_MARGIN.top - _CHART_MARGIN.bottom,
        orderedDrivers.length * _ROW_HEIGHT_PX
    );

    const xScale = d3.scaleLinear().domain([0, maxLap]).range([0, width]);
    const yScale = d3
        .scaleBand()
        .domain(orderedDrivers)
        .range([0, height])
        .paddingInner(_BAR_VERTICAL_PADDING_RATIO)
        .paddingOuter(_BAR_OUTER_PADDING_RATIO);

    const svg = d3
        .select(container)
        .append('svg')
        .attr('width', width + _CHART_MARGIN.left + _CHART_MARGIN.right)
        .attr('height', height + _CHART_MARGIN.top + _CHART_MARGIN.bottom)
        .append('g')
        .attr('transform', `translate(${_CHART_MARGIN.left},${_CHART_MARGIN.top})`);

    const scWindows = _extractScVscWindows(data, maxLap);
    const { byKey: tacticsByKey } = analyzePitStopTactics(data);
    const pitTransitions = _extractPitTransitions(stints, yScale, tacticsByKey);
    const tooltip = d3.select('#tooltip');

    _renderStrategyGridAndRowGuides(
        svg,
        xScale,
        yScale,
        orderedDrivers,
        width,
        height,
        maxLap
    );
    _renderScVscBackdrops(svg, scWindows, xScale, height);

    const driverLabels = _renderStrategyAxes(
        svg,
        xScale,
        yScale,
        rankByDriver,
        driverMetaByCode,
        width,
        height,
        maxLap
    );

    let localFocusedDriver = null;
    let externalFocusedDriver = null;
    let hoveredDriver = null;
    const activeCompounds = new Set(_COMPOUND_ORDER);

    const stintGroups = _renderStintBars(svg, stints, xScale, yScale);
    const pitTickGroups = _renderPitTransitionTicks(
        svg,
        pitTransitions,
        xScale,
        yScale,
        tooltip,
        (nextHoveredDriver) => {
            hoveredDriver = nextHoveredDriver;
            updateFocusStyles();
        }
    );
    _renderScVscOverlayBadges(svg, scWindows, pitTransitions, xScale, width, height, tooltip);
    _strategyPlayheadHandler = _createStrategyPlayheadLayer(svg, xScale, height, maxLap);
    if (_currentStrategyPlayheadLap !== null) {
        _strategyPlayheadHandler(_currentStrategyPlayheadLap);
    }

    function updateFocusStyles() {
        const effectiveDriver =
            hoveredDriver !== null
                ? hoveredDriver
                : externalFocusedDriver !== null
                  ? externalFocusedDriver
                  : localFocusedDriver;

        stintGroups.style('opacity', (d) => {
            const isCompoundActive = activeCompounds.has(d.compound);
            const isDriverSelected = effectiveDriver === null || d.driver === effectiveDriver;
            return isCompoundActive && isDriverSelected ? _ACTIVE_OPACITY : _DIMMED_OPACITY;
        });

        pitTickGroups.style('opacity', (d) =>
            effectiveDriver === null || d.driver === effectiveDriver
                ? _ACTIVE_OPACITY
                : _DIMMED_OPACITY
        );

        driverLabels.style('opacity', (code) =>
            effectiveDriver === null || code === effectiveDriver
                ? _ACTIVE_OPACITY
                : _DIMMED_OPACITY
        );
    }

    _bindStrategyInteractions(
        stintGroups,
        driverLabels,
        tooltip,
        tacticsByKey,
        (nextHoveredDriver) => {
            hoveredDriver = nextHoveredDriver;
            updateFocusStyles();
        },
        (clickedDriverCode) => {
            localFocusedDriver =
                localFocusedDriver === clickedDriverCode ? null : clickedDriverCode;
            updateFocusStyles();
        }
    );

    _externalStrategyFocusHandler = (driverCode) => {
        externalFocusedDriver = driverCode;
        updateFocusStyles();
    };

    _buildStrategyLegend(legendContainer, stints, scWindows, activeCompounds, updateFocusStyles);
    updateFocusStyles();
}
