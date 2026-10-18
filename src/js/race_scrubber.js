import { calculateDriverClassification } from './standings.js';
import { setRaceStrategyPlayheadLap } from './race_strategy.js';
import { setRaceWormPlayheadLap } from './race_worm.js';
import { setBumpPlayheadLap } from './bump.js';

const _TRACK_VIEWBOX_W = 1000;
const _TRACK_VIEWBOX_H = 560;
const _TRACK_OUTER_CASING_WIDTH_PX = 16;
const _TRACK_BED_WIDTH_PX = 11;
const _TRACK_SECTOR_LINE_WIDTH_PX = 3.8;
const _FALLBACK_LOOP_POINTS_COUNT = 180;
const _FALLBACK_REF_LAP_TIME_S = 90.0;
const _LEADER_START_FINISH_PCT = 0;
const _GRID_START_BASE_PCT = 99.2;
const _GRID_START_STEP_PCT = 1.15;
const _GRID_NORMAL_OFFSET_PX = 4;
const _DECOLLIDE_PCT_THRESHOLD = 0.85;
const _DECOLLIDE_NORMAL_OFFSET_PX = 4.5;
const _STEP_TRANSITION_DURATION_MS = 220;
const _CAR_MARKER_RADIUS_PX = 6.5;
const _CAR_MARKER_FOCUSED_RADIUS_PX = 9.0;
const _CAR_PIT_RING_RADIUS_PX = 11.0;
const _TURN_BADGE_RADIUS_PX = 9.5;
const _RETIRED_OPACITY = 0.22;
const _DIMMED_OPACITY = 0.28;
const _ACTIVE_OPACITY = 1.0;
const _DEFAULT_DRIVER_COLOR = '#888888';
const _GAIN_COLOR = '#22c55e';
const _LOSS_COLOR = '#ef4444';
const _TOOLTIP_OFFSET_X_PX = 15;
const _TOOLTIP_OFFSET_Y_PX = -28;

const _STATUS_GREEN = 'GREEN';
const _STATUS_SC = 'SC';
const _STATUS_VSC = 'VSC';

const _TRACK_STATUS_CONFIG = {
    GREEN: {
        label: 'GREEN FLAG',
        color: '#22c55e',
        bg: 'rgba(34, 197, 94, 0.14)',
        border: 'rgba(34, 197, 94, 0.45)'
    },
    SC: {
        label: 'SAFETY CAR DEPLOYED',
        color: '#f59e0b',
        bg: 'rgba(245, 158, 11, 0.18)',
        border: 'rgba(245, 158, 11, 0.6)'
    },
    VSC: {
        label: 'VIRTUAL SAFETY CAR',
        color: '#facc15',
        bg: 'rgba(250, 204, 21, 0.16)',
        border: 'rgba(250, 204, 21, 0.55)'
    }
};

const _SPEED_OPTIONS = [
    { key: '1x', label: '1x', intervalMs: 900 },
    { key: '2x', label: '2x', intervalMs: 480 },
    { key: '4x', label: '4x', intervalMs: 240 }
];

const _SECTOR_COLORS = {
    S1: '#ef4444',
    S2: '#38bdf8',
    S3: '#eab308'
};

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

let _playbackIntervalId = null;
let _pausePlaybackUiHandler = null;
let _externalScrubberFocusHandler = null;

/**
 * Stops any active Lap-by-Lap Race Replay playback interval and resets transport UI state.
 *
 * @returns {void}
 */
export function stopRaceScrubberPlayback() {
    if (_playbackIntervalId !== null) {
        clearInterval(_playbackIntervalId);
        _playbackIntervalId = null;
    }
    if (_pausePlaybackUiHandler) {
        _pausePlaybackUiHandler();
    }
}

/**
 * Highlights or restores a driver in the Race Replay Scrubber from an external dashboard trigger.
 *
 * @param {string|null} driverCode - Three-letter driver code to highlight, or null to restore.
 * @returns {void}
 */
export function setRaceScrubberExternalFocus(driverCode) {
    if (_externalScrubberFocusHandler) {
        _externalScrubberFocusHandler(driverCode);
    }
}

/**
 * Broadcasts the active scrubber lap number to synchronized charts (`race_strategy`, `race_worm`, `bump`).
 *
 * @param {number|null} lapNumber - Current scrubber lap (`0..maxLap`) or `null` to hide playheads.
 * @returns {void}
 */
function _broadcastPlayheadLap(lapNumber) {
    setRaceStrategyPlayheadLap(lapNumber);
    setRaceWormPlayheadLap(lapNumber !== null && lapNumber >= 1 ? lapNumber : null);
    setBumpPlayheadLap(lapNumber);
}

/**
 * Normalizes a raw tyre compound string to a supported uppercase key.
 *
 * @param {string|null|undefined} compound - Raw compound name.
 * @returns {string} Normalized uppercase compound name.
 */
function _normalizeCompound(compound) {
    const upper = String(compound || 'UNKNOWN').toUpperCase();
    return _COMPOUND_COLORS[upper] ? upper : 'UNKNOWN';
}

/**
 * Builds a lookup map from driver code to starting grid position (`Lap 0`).
 *
 * @param {Object} data - Race telemetry payload.
 * @param {Array<Object>} classification - Official driver classification list.
 * @returns {Map<string, number>} Map of driver code to 1-indexed starting grid position.
 */
function _buildStartingGridMap(data, classification) {
    const gridMap = new Map();
    const qualiResults = data?.qualifying?.results;

    if (Array.isArray(qualiResults) && qualiResults.length > 0) {
        qualiResults.forEach((entry) => {
            const pos = Number(entry.grid_pos ?? entry.position);
            if (entry.driver && Number.isFinite(pos) && pos > 0) {
                gridMap.set(entry.driver, pos);
            }
        });
    }

    const usedPositions = new Set(gridMap.values());
    let nextFallbackPos = 1;
    const findNextFreePos = () => {
        while (usedPositions.has(nextFallbackPos)) {
            nextFallbackPos += 1;
        }
        usedPositions.add(nextFallbackPos);
        return nextFallbackPos;
    };

    classification.forEach((entry) => {
        if (!gridMap.has(entry.code)) {
            const lap1Pos = entry.laps?.[0]?.position;
            if (Number.isFinite(lap1Pos) && !usedPositions.has(lap1Pos)) {
                usedPositions.add(lap1Pos);
                gridMap.set(entry.code, lap1Pos);
            } else {
                gridMap.set(entry.code, findNextFreePos());
            }
        }
    });

    return gridMap;
}

/**
 * Extracts Safety Car (`SC`) and Virtual Safety Car (`VSC`) lap windows from the race payload.
 *
 * @param {Object} data - Race telemetry payload.
 * @param {number} maxLap - Maximum race lap count.
 * @returns {Array<{type: string, start_lap: number, end_lap: number}>} Normalized SC/VSC windows.
 */
function _extractScWindows(data, maxLap) {
    const rawWindows =
        data.race_telemetry && Array.isArray(data.race_telemetry.sc_vsc_windows)
            ? data.race_telemetry.sc_vsc_windows
            : Array.isArray(data.session_events)
              ? data.session_events
              : [];

    return rawWindows
        .filter(
            (w) =>
                (w.type === _STATUS_SC || w.type === _STATUS_VSC) &&
                Number.isFinite(Number(w.start_lap)) &&
                Number(w.start_lap) <= maxLap
        )
        .map((w) => {
            const startLap = Math.max(1, Number(w.start_lap));
            const endLap = Math.min(maxLap, Math.max(startLap, Number(w.end_lap) || startLap));
            return {
                type: w.type,
                start_lap: startLap,
                end_lap: endLap
            };
        });
}

/**
 * Resolves the track status key (`'GREEN'`, `'SC'`, or `'VSC'`) on a given lap number.
 *
 * @param {number} lapNumber - Current lap number.
 * @param {Array<{type: string, start_lap: number, end_lap: number}>} scWindows - SC/VSC windows.
 * @returns {'GREEN'|'SC'|'VSC'} Active track status key.
 */
function _resolveTrackStatusOnLap(lapNumber, scWindows) {
    if (lapNumber <= 0) return _STATUS_GREEN;
    for (const win of scWindows) {
        if (lapNumber >= win.start_lap && lapNumber <= win.end_lap) {
            return win.type === _STATUS_SC ? _STATUS_SC : _STATUS_VSC;
        }
    }
    return _STATUS_GREEN;
}

/**
 * Resolves `data.track_map` geometry or generates a smooth closed-loop circuit fallback.
 *
 * @param {Object} data - Race telemetry payload.
 * @returns {{points: Array<[number, number]>, s1_end_idx: number, s2_end_idx: number, turns: Array<Object>}} Circuit loop geometry.
 */
function _resolveTrackGeometry(data) {
    if (
        data.track_map &&
        Array.isArray(data.track_map.points) &&
        data.track_map.points.length >= 20
    ) {
        return {
            points: data.track_map.points,
            s1_end_idx:
                Number(data.track_map.s1_end_idx) ||
                Math.round(data.track_map.points.length * 0.33),
            s2_end_idx:
                Number(data.track_map.s2_end_idx) ||
                Math.round(data.track_map.points.length * 0.67),
            turns: Array.isArray(data.track_map.turns) ? data.track_map.turns : []
        };
    }

    const numPoints = _FALLBACK_LOOP_POINTS_COUNT;
    const cx = _TRACK_VIEWBOX_W / 2;
    const cy = _TRACK_VIEWBOX_H / 2;
    const points = [];

    for (let i = 0; i < numPoints; i++) {
        const theta = (i / numPoints) * Math.PI * 2;
        const rScale = 1 + 0.18 * Math.cos(2 * theta) + 0.09 * Math.sin(3 * theta);
        const x = Number((cx + rScale * 345 * Math.cos(theta)).toFixed(1));
        const y = Number((cy + rScale * 195 * Math.sin(theta)).toFixed(1));
        points.push([x, y]);
    }

    return {
        points,
        s1_end_idx: Math.round(numPoints * 0.33),
        s2_end_idx: Math.round(numPoints * 0.67),
        turns: []
    };
}

/**
 * Precomputes cumulative segment lengths along the closed track polygon so any percentage `[0, 100)`
 * and normal offset can be mapped to `(x, y)` coordinates in O(log N) time.
 *
 * @param {Array<[number, number]>} points - Closed loop coordinate array.
 * @returns {Function} Sampler `(pct, normalOffsetPx) => { x: number, y: number }`.
 */
function _createTrackLoopSampler(points) {
    const n = points.length;
    if (n === 0) {
        return () => ({ x: _TRACK_VIEWBOX_W / 2, y: _TRACK_VIEWBOX_H / 2 });
    }

    const segments = [];
    let totalLength = 0;

    for (let i = 0; i < n; i++) {
        const [x0, y0] = points[i];
        const [x1, y1] = points[(i + 1) % n];
        const dx = x1 - x0;
        const dy = y1 - y0;
        const len = Math.hypot(dx, dy) || 0.001;
        segments.push({
            x0,
            y0,
            dx,
            dy,
            len,
            nx: -dy / len,
            ny: dx / len,
            startDist: totalLength
        });
        totalLength += len;
    }

    return (pct, normalOffsetPx = 0) => {
        const wrappedPct = ((pct % 100) + 100) % 100;
        const targetDist = (wrappedPct / 100) * totalLength;

        let chosen = segments[segments.length - 1];
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            if (targetDist <= seg.startDist + seg.len) {
                chosen = seg;
                break;
            }
        }

        const localT = Math.max(
            0,
            Math.min(1, (targetDist - chosen.startDist) / chosen.len)
        );
        const baseX = chosen.x0 + chosen.dx * localT;
        const baseY = chosen.y0 + chosen.dy * localT;

        return {
            x: baseX + chosen.nx * normalOffsetPx,
            y: baseY + chosen.ny * normalOffsetPx
        };
    };
}

/**
 * Builds a per-lap snapshot table (`0..maxLap`) containing ordered driver states, gaps, compounds,
 * pit stop flags, and circuit radar coordinates.
 *
 * @param {Object} data - Race telemetry payload.
 * @param {Array<Object>} classification - Official driver classification entries.
 * @param {Array<Object>} validLaps - Filtered valid lap records.
 * @param {number} maxLap - Maximum race lap count.
 * @param {Function} sampleTrackPoint - Coordinate sampler `(pct, normalOffsetPx) => {x, y}`.
 * @returns {Map<number, {leaderCode: string, pittingDrivers: Array<string>, drivers: Array<Object>}>} Per-lap state map.
 */
function _buildLapSnapshots(data, classification, validLaps, maxLap, sampleTrackPoint) {
    const gridMap = _buildStartingGridMap(data, classification);

    const pitsByLap = new Map();
    const rawPitStops = data.race_telemetry?.pit_stops || [];
    rawPitStops.forEach((stop) => {
        const lapNum = Number(stop.lap);
        if (!stop.driver || !Number.isFinite(lapNum) || lapNum < 1) return;
        if (!pitsByLap.has(lapNum)) {
            pitsByLap.set(lapNum, new Set());
        }
        pitsByLap.get(lapNum).add(stop.driver);
    });
    const stintsByDriver = d3.group(data.race_telemetry?.stints || [], (s) => s.driver);
    stintsByDriver.forEach((driverStints, driverCode) => {
        const sorted = driverStints.slice().sort((a, b) => Number(a.stint) - Number(b.stint));
        for (let i = 0; i < sorted.length - 1; i++) {
            const lapNum = Number(sorted[i].end_lap);
            if (!Number.isFinite(lapNum) || lapNum < 1) continue;
            if (!pitsByLap.has(lapNum)) {
                pitsByLap.set(lapNum, new Set());
            }
            pitsByLap.get(lapNum).add(driverCode);
        }
    });

    const positiveLapTimes = validLaps
        .map((l) => Number(l.time))
        .filter((t) => Number.isFinite(t) && t > 30);
    const refLapTime =
        positiveLapTimes.length > 0
            ? d3.median(positiveLapTimes) || _FALLBACK_REF_LAP_TIME_S
            : _FALLBACK_REF_LAP_TIME_S;

    const lapsByDriver = new Map();
    classification.forEach((entry) => {
        const byLap = new Map();
        (entry.laps || []).forEach((lapObj) => {
            byLap.set(lapObj.lap, lapObj);
        });
        lapsByDriver.set(entry.code, byLap);
    });

    const firstStintCompoundByDriver = new Map();
    const rawStints = data.race_telemetry?.stints || [];
    rawStints.forEach((s) => {
        if (Number(s.stint) === 1 && s.driver) {
            firstStintCompoundByDriver.set(s.driver, _normalizeCompound(s.compound));
        }
    });

    const snapshots = new Map();

    // Lap 0: Starting Grid Formation
    const lap0Drivers = classification
        .map((entry) => {
            const gridPos = gridMap.get(entry.code) ?? entry.rank;
            const lap1Rec = lapsByDriver.get(entry.code)?.get(1);
            const startCompound =
                firstStintCompoundByDriver.get(entry.code) ||
                _normalizeCompound(lap1Rec?.compound || 'MEDIUM');
            const pct =
                ((_GRID_START_BASE_PCT - (gridPos - 1) * _GRID_START_STEP_PCT) % 100 + 100) %
                100;
            const normalOffset =
                gridPos % 2 === 1 ? -_GRID_NORMAL_OFFSET_PX : _GRID_NORMAL_OFFSET_PX;
            const coords = sampleTrackPoint(pct, normalOffset);

            return {
                code: entry.code,
                name: entry.name || entry.code,
                team: entry.team || '',
                color: entry.color || _DEFAULT_DRIVER_COLOR,
                pos: gridPos,
                gridPos,
                gridDelta: 0,
                compound: startCompound,
                tyreAge: 0,
                gapSeconds: 0,
                gapLabel: gridPos === 1 ? 'POLE' : `GRID P${gridPos}`,
                isRetired: Boolean(entry.isDns),
                isPitting: false,
                pct,
                normalOffset,
                x: coords.x,
                y: coords.y
            };
        })
        .sort((a, b) => a.pos - b.pos);

    snapshots.set(0, {
        leaderCode: lap0Drivers[0]?.code || '—',
        pittingDrivers: [],
        drivers: lap0Drivers
    });

    const lastKnownStateByDriver = new Map(
        lap0Drivers.map((d) => [
            d.code,
            {
                pct: d.pct,
                normalOffset: d.normalOffset,
                compound: d.compound,
                tyreAge: 0,
                sessionTime: 0,
                pos: d.pos
            }
        ])
    );

    for (let lap = 1; lap <= maxLap; lap++) {
        const pitsOnLap = pitsByLap.get(lap) || new Set();
        const leaderPct = _LEADER_START_FINISH_PCT;

        let minSessionTime = Infinity;
        let leaderLapDuration = refLapTime;
        classification.forEach((entry) => {
            const rec = lapsByDriver.get(entry.code)?.get(lap);
            if (rec && Number.isFinite(rec.session_time) && rec.session_time > 0) {
                if (rec.session_time < minSessionTime) {
                    minSessionTime = rec.session_time;
                    if (Number.isFinite(rec.time) && rec.time > 35) {
                        leaderLapDuration = rec.time;
                    }
                }
            }
        });

        const rawLapDrivers = classification.map((entry) => {
            const code = entry.code;
            const gridPos = gridMap.get(code) ?? entry.rank;
            const prev = lastKnownStateByDriver.get(code);
            const rec = lapsByDriver.get(code)?.get(lap);
            const isPitting = pitsOnLap.has(code);

            const isRetiredDriver =
                Boolean(entry.isDns) ||
                Boolean(entry.isDnf) ||
                maxLap - entry.lapsCompleted > 4;

            const isRetiredOnLap =
                Boolean(entry.isDns) ||
                (isRetiredDriver && lap > entry.lapsCompleted);

            if (isRetiredOnLap) {
                const coords = sampleTrackPoint(prev.pct, 0);
                return {
                    code,
                    name: entry.name || code,
                    team: entry.team || '',
                    color: entry.color || _DEFAULT_DRIVER_COLOR,
                    pos: entry.rank || prev.pos,
                    gridPos,
                    gridDelta: gridPos - (entry.rank || prev.pos),
                    compound: prev.compound,
                    tyreAge: prev.tyreAge,
                    gapSeconds: Infinity,
                    gapLabel: entry.isDns ? 'DNS' : 'OUT',
                    isRetired: true,
                    isPitting: false,
                    pct: prev.pct,
                    normalOffset: 0,
                    x: coords.x,
                    y: coords.y
                };
            }

            if (rec) {
                const compound = _normalizeCompound(rec.compound || prev.compound);
                const tyreAge = Number.isFinite(rec.tyre_life)
                    ? rec.tyre_life
                    : prev.tyreAge + 1;
                const gapSeconds =
                    Number.isFinite(rec.session_time) && Number.isFinite(minSessionTime)
                        ? Math.max(0, rec.session_time - minSessionTime)
                        : 0;
                const pct =
                    ((leaderPct - (gapSeconds / leaderLapDuration) * 100) % 100 + 100) % 100;
                const pos = Number.isFinite(rec.position) ? rec.position : prev.pos;

                lastKnownStateByDriver.set(code, {
                    pct,
                    normalOffset: 0,
                    compound,
                    tyreAge,
                    sessionTime: rec.session_time || prev.sessionTime,
                    pos
                });

                return {
                    code,
                    name: entry.name || code,
                    team: entry.team || '',
                    color: entry.color || _DEFAULT_DRIVER_COLOR,
                    pos,
                    gridPos,
                    gridDelta: gridPos - pos,
                    compound,
                    tyreAge,
                    gapSeconds,
                    gapLabel: isPitting ? 'PIT' : `+${gapSeconds.toFixed(3)}s`,
                    isRetired: false,
                    isPitting,
                    pct,
                    normalOffset: 0,
                    x: 0,
                    y: 0
                };
            }

            // Lapped finisher after their final recorded lap
            const lappedPos = entry.rank || prev.pos;
            const lapsDown = Math.max(1, maxLap - entry.lapsCompleted);
            return {
                code,
                name: entry.name || code,
                team: entry.team || '',
                color: entry.color || _DEFAULT_DRIVER_COLOR,
                pos: lappedPos,
                gridPos,
                gridDelta: gridPos - lappedPos,
                compound: prev.compound,
                tyreAge: prev.tyreAge,
                gapSeconds: lapsDown * refLapTime,
                gapLabel: `+${lapsDown}L`,
                isRetired: false,
                isPitting: false,
                pct: prev.pct,
                normalOffset: 0,
                x: 0,
                y: 0
            };
        });

        rawLapDrivers.sort((a, b) => {
            if (a.isRetired !== b.isRetired) return a.isRetired ? 1 : -1;
            if (a.pos !== b.pos) return a.pos - b.pos;
            return a.gapSeconds - b.gapSeconds;
        });

        rawLapDrivers.forEach((d, idx) => {
            d.pos = idx + 1;
            d.gridDelta = d.gridPos - d.pos;
            if (d.pos === 1 && !d.isRetired) {
                d.pct = _LEADER_START_FINISH_PCT;
                d.gapSeconds = 0;
                d.gapLabel = d.isPitting ? 'LEADER · PIT' : 'LEADER';
            }
        });

        // Apply lateral normal offset if two active cars are within 0.85% track distance
        const activeCars = rawLapDrivers.filter((d) => !d.isRetired);
        for (let i = 0; i < activeCars.length; i++) {
            const car = activeCars[i];
            let normalOffset = 0;
            if (i > 0) {
                const prevCar = activeCars[i - 1];
                const rawDiff = Math.abs(car.pct - prevCar.pct);
                const circularDiff = Math.min(rawDiff, 100 - rawDiff);
                if (circularDiff < _DECOLLIDE_PCT_THRESHOLD) {
                    normalOffset =
                        i % 2 === 1
                            ? _DECOLLIDE_NORMAL_OFFSET_PX
                            : -_DECOLLIDE_NORMAL_OFFSET_PX;
                }
            }
            car.normalOffset = normalOffset;
            const coords = sampleTrackPoint(car.pct, normalOffset);
            car.x = coords.x;
            car.y = coords.y;
        }

        snapshots.set(lap, {
            leaderCode: rawLapDrivers[0]?.code || '—',
            pittingDrivers: Array.from(pitsOnLap),
            drivers: rawLapDrivers
        });
    }

    return snapshots;
}

/**
 * Builds the header transport controls (`Play/Pause`, `-1L`, `+1L`, `1x/2x/4x`, and Track Status Pill)
 * inside `#race-replay-controls`.
 *
 * @param {HTMLElement|null} controlsContainer - `#race-replay-controls` DOM node.
 * @param {Object} handlers - Transport action callbacks (`onTogglePlay`, `onStepLap`, `onSpeedChange`).
 * @returns {{
 *   updatePlayButton: (isPlaying: boolean) => void,
 *   updateStatusPill: (statusKey: 'GREEN'|'SC'|'VSC') => void
 * }} UI state updaters for the header controls.
 */
function _buildHeaderControls(controlsContainer, handlers) {
    if (!controlsContainer) {
        return {
            updatePlayButton: () => {},
            updateStatusPill: () => {}
        };
    }
    controlsContainer.replaceChildren();

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'legend-item replay-transport-btn replay-play-btn';
    playBtn.style.fontFamily = 'Montserrat, sans-serif';
    playBtn.style.fontWeight = '700';
    playBtn.style.cursor = 'pointer';
    playBtn.textContent = '▶ PLAY';
    playBtn.addEventListener('click', () => handlers.onTogglePlay());

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'legend-item replay-transport-btn';
    prevBtn.style.fontFamily = 'Montserrat, sans-serif';
    prevBtn.style.fontWeight = '700';
    prevBtn.style.cursor = 'pointer';
    prevBtn.textContent = '◀ -1L';
    prevBtn.addEventListener('click', () => handlers.onStepLap(-1));

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'legend-item replay-transport-btn';
    nextBtn.style.fontFamily = 'Montserrat, sans-serif';
    nextBtn.style.fontWeight = '700';
    nextBtn.style.cursor = 'pointer';
    nextBtn.textContent = '+1L ▶';
    nextBtn.addEventListener('click', () => handlers.onStepLap(1));

    const speedButtons = [];
    const updateSpeedButtonsUI = (selectedKey) => {
        speedButtons.forEach(({ btn, key }) => {
            const isSelected = key === selectedKey;
            btn.classList.toggle('active', isSelected);
            btn.style.borderColor = isSelected
                ? 'rgba(255, 255, 255, 0.35)'
                : 'rgba(255, 255, 255, 0.1)';
            btn.style.background = isSelected
                ? 'rgba(255, 255, 255, 0.12)'
                : 'rgba(0, 0, 0, 0.25)';
            btn.style.color = isSelected ? '#ffffff' : 'var(--text-muted)';
        });
    };

    _SPEED_OPTIONS.forEach(({ key, label, intervalMs }) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'legend-item replay-speed-pill';
        btn.style.fontFamily = 'Montserrat, sans-serif';
        btn.style.fontWeight = '700';
        btn.style.cursor = 'pointer';
        btn.textContent = label;
        btn.addEventListener('click', () => {
            updateSpeedButtonsUI(key);
            handlers.onSpeedChange(intervalMs);
        });
        speedButtons.push({ btn, key });
    });
    updateSpeedButtonsUI('1x');

    const statusPill = document.createElement('div');
    statusPill.className = 'legend-item replay-status-pill';
    statusPill.style.fontFamily = 'Montserrat, sans-serif';
    statusPill.style.fontWeight = '700';
    statusPill.style.cursor = 'default';

    const statusDot = document.createElement('span');
    statusDot.className = 'legend-color';
    statusDot.style.borderRadius = '50%';
    const statusText = document.createElement('span');
    statusPill.append(statusDot, statusText);

    controlsContainer.append(playBtn, prevBtn, nextBtn);
    speedButtons.forEach(({ btn }) => controlsContainer.appendChild(btn));
    controlsContainer.appendChild(statusPill);

    const updatePlayButton = (isPlaying) => {
        playBtn.textContent = isPlaying ? '⏸ PAUSE' : '▶ PLAY';
        playBtn.classList.toggle('playing', isPlaying);
        playBtn.style.borderColor = isPlaying
            ? 'rgba(255, 255, 255, 0.45)'
            : 'rgba(255, 255, 255, 0.2)';
        playBtn.style.background = isPlaying
            ? 'rgba(255, 255, 255, 0.16)'
            : 'rgba(255, 255, 255, 0.08)';
    };

    const updateStatusPill = (statusKey) => {
        const cfg = _TRACK_STATUS_CONFIG[statusKey] || _TRACK_STATUS_CONFIG.GREEN;
        statusDot.style.backgroundColor = cfg.color;
        statusText.textContent = cfg.label;
        statusPill.style.color = cfg.color;
        statusPill.style.background = cfg.bg;
        statusPill.style.borderColor = cfg.border;
    };

    updatePlayButton(false);
    updateStatusPill(_STATUS_GREEN);

    return { updatePlayButton, updateStatusPill };
}

/**
 * Populates the shared `#tooltip` element when hovering a car marker on the 2D GPS Circuit Radar.
 *
 * @param {HTMLElement|null} tooltipNode - DOM node of `#tooltip`.
 * @param {Object} car - Driver snapshot entry on the current lap.
 * @param {number} currentLap - Active lap number.
 * @returns {void}
 */
function _populateRadarCarTooltip(tooltipNode, car, currentLap) {
    if (!tooltipNode || !car) return;

    const headerDiv = document.createElement('div');
    headerDiv.style.fontFamily = 'Montserrat, sans-serif';
    headerDiv.style.fontWeight = '700';
    headerDiv.style.marginBottom = '4px';
    headerDiv.style.textTransform = 'uppercase';
    headerDiv.appendChild(document.createTextNode(`P${car.pos} ${car.code} `));

    const teamSpan = document.createElement('span');
    teamSpan.style.color = 'var(--text-muted)';
    teamSpan.style.fontWeight = '600';
    teamSpan.style.fontSize = '0.75rem';
    teamSpan.textContent = `· ${car.team}`;
    headerDiv.appendChild(teamSpan);

    const statusLine = document.createElement('div');
    statusLine.style.fontSize = '0.8rem';
    statusLine.style.fontWeight = '600';
    statusLine.style.color = 'var(--text-primary)';
    statusLine.textContent =
        currentLap === 0
            ? `Starting Grid: P${car.gridPos} · Tyre: ${car.compound}`
            : `Lap ${currentLap} · Gap: ${car.gapLabel} · Tyre: ${car.compound} (${car.tyreAge}L)`;

    const trackRefLine = document.createElement('div');
    trackRefLine.style.marginTop = '3px';
    trackRefLine.style.fontSize = '0.73rem';
    trackRefLine.style.color = 'var(--text-muted)';
    if (currentLap === 0) {
        trackRefLine.textContent = `Grid Formation behind Start/Finish Line`;
    } else if (car.pos === 1) {
        trackRefLine.textContent = `Track Position: Crossing Start/Finish Line (0.0% lap)`;
    } else {
        const behindPct = (((100 - (car.pct || 0)) % 100) + 100) % 100;
        trackRefLine.textContent = `Track Position: ${behindPct.toFixed(1)}% of lap behind leader at S/F`;
    }

    const children = [headerDiv, statusLine, trackRefLine];

    if (car.isPitting) {
        const pitLine = document.createElement('div');
        pitLine.style.marginTop = '4px';
        pitLine.style.fontSize = '0.75rem';
        pitLine.style.fontWeight = '700';
        pitLine.style.color = '#f59e0b';
        pitLine.textContent = `PIT STOP ON LAP ${currentLap}`;
        children.push(pitLine);
    }

    tooltipNode.replaceChildren(...children);
}

/**
 * Renders the 2D GPS Circuit Radar SVG inside its left-column container and returns an updater
 * for positioning the 22 driver markers on any lap.
 *
 * @param {HTMLElement} radarMount - Left-column DOM mount for the circuit radar SVG.
 * @param {Object} trackGeo - Circuit geometry (`points`, `s1_end_idx`, `s2_end_idx`, `turns`).
 * @param {Array<Object>} initialDrivers - Initial `Lap 0` driver snapshots.
 * @param {Function} onSelectDriver - Callback invoked when hovering/clicking a car node.
 * @returns {{
 *   updateCars: (drivers: Array<Object>, currentLap: number, statusKey: string) => void,
 *   applyFocus: (focusedCode: string|null) => void
 * }} Radar visual state updaters.
 */
function _createCircuitRadarSvg(radarMount, trackGeo, initialDrivers, onSelectDriver) {
    const { points, s1_end_idx: s1EndIdx, s2_end_idx: s2EndIdx, turns } = trackGeo;
    const tooltip = d3.select('#tooltip');

    const svg = d3
        .select(radarMount)
        .append('svg')
        .attr('class', 'replay-track-svg circuit-map-svg')
        .attr('viewBox', `0 0 ${_TRACK_VIEWBOX_W} ${_TRACK_VIEWBOX_H}`)
        .attr('preserveAspectRatio', 'xMidYMid meet');

    const closedLine = d3
        .line()
        .x((d) => d[0])
        .y((d) => d[1])
        .curve(d3.curveCatmullRomClosed.alpha(0.5));

    const openLine = d3
        .line()
        .x((d) => d[0])
        .y((d) => d[1])
        .curve(d3.curveCatmullRom.alpha(0.5));

    // Track status halo glow path
    const statusGlowPath = svg
        .append('path')
        .datum(points)
        .attr('class', 'replay-track-glow')
        .attr('fill', 'none')
        .attr('stroke', 'rgba(255, 255, 255, 0.14)')
        .attr('stroke-width', _TRACK_OUTER_CASING_WIDTH_PX)
        .attr('stroke-linejoin', 'round')
        .attr('d', closedLine);

    svg.append('path')
        .datum(points)
        .attr('fill', 'none')
        .attr('stroke', '#11111a')
        .attr('stroke-width', _TRACK_BED_WIDTH_PX)
        .attr('stroke-linejoin', 'round')
        .attr('d', closedLine);

    // Sector racing line segments
    const s1Points = points.slice(0, s1EndIdx + 1);
    const s2Points = points.slice(s1EndIdx, s2EndIdx + 1);
    const s3Points = [...points.slice(s2EndIdx), points[0]];

    [
        { pts: s1Points, color: _SECTOR_COLORS.S1 },
        { pts: s2Points, color: _SECTOR_COLORS.S2 },
        { pts: s3Points, color: _SECTOR_COLORS.S3 }
    ].forEach(({ pts, color }) => {
        if (pts.length >= 2) {
            svg.append('path')
                .datum(pts)
                .attr('fill', 'none')
                .attr('stroke', color)
                .attr('stroke-width', _TRACK_SECTOR_LINE_WIDTH_PX)
                .attr('stroke-linecap', 'round')
                .attr('opacity', 0.55)
                .attr('d', openLine);
        }
    });

    // Turn markers (T1..TN)
    if (Array.isArray(turns) && turns.length > 0) {
        const turnsLayer = svg.append('g').attr('class', 'replay-turns-layer');
        const turnGroups = turnsLayer
            .selectAll('g.replay-turn-badge')
            .data(turns)
            .enter()
            .append('g')
            .attr('class', 'replay-turn-badge')
            .style('pointer-events', 'none');

        turnGroups
            .append('circle')
            .attr('cx', (t) => t.label_x ?? t.x)
            .attr('cy', (t) => t.label_y ?? t.y)
            .attr('r', _TURN_BADGE_RADIUS_PX)
            .attr('fill', 'rgba(15, 15, 23, 0.88)')
            .attr('stroke', 'rgba(255, 255, 255, 0.22)')
            .attr('stroke-width', 1);

        turnGroups
            .append('text')
            .attr('x', (t) => t.label_x ?? t.x)
            .attr('y', (t) => t.label_y ?? t.y)
            .attr('dy', '0.35em')
            .attr('text-anchor', 'middle')
            .attr('fill', 'var(--text-muted)')
            .style('font-family', 'Montserrat, sans-serif')
            .style('font-size', '8px')
            .style('font-weight', '700')
            .text((t) => `T${t.turn}`);
    }

    // Start / Finish line marker
    if (points.length >= 3) {
        const [sx, sy] = points[0];
        const [nxPt, nyPt] = points[2];
        const angleDeg = (Math.atan2(nyPt - sy, nxPt - sx) * 180) / Math.PI;
        const sfGroup = svg
            .append('g')
            .attr('class', 'start-finish-marker')
            .attr('transform', `translate(${sx},${sy}) rotate(${angleDeg})`);

        sfGroup
            .append('line')
            .attr('x1', 0)
            .attr('y1', -12)
            .attr('x2', 0)
            .attr('y2', 12)
            .attr('stroke', '#ffffff')
            .attr('stroke-width', 3.5);

        sfGroup
            .append('polygon')
            .attr('points', '7,-5 16,0 7,5')
            .attr('fill', '#ffffff');

        const rad = (angleDeg * Math.PI) / 180;
        const sfLabelX = sx - Math.sin(rad) * 20;
        const sfLabelY = sy + Math.cos(rad) * 20;
        const sfBadge = svg
            .append('g')
            .attr('class', 'start-finish-label-badge')
            .attr('transform', `translate(${sfLabelX},${sfLabelY})`)
            .style('pointer-events', 'none');

        sfBadge
            .append('rect')
            .attr('x', -13)
            .attr('y', -7.5)
            .attr('width', 26)
            .attr('height', 15)
            .attr('rx', 3)
            .attr('fill', 'rgba(15, 15, 23, 0.94)')
            .attr('stroke', 'rgba(255, 255, 255, 0.65)')
            .attr('stroke-width', 1);

        sfBadge
            .append('text')
            .attr('x', 0)
            .attr('y', 0.5)
            .attr('dy', '0.32em')
            .attr('text-anchor', 'middle')
            .attr('fill', '#ffffff')
            .style('font-family', 'Montserrat, sans-serif')
            .style('font-size', '7.5px')
            .style('font-weight', '800')
            .text('S/F');
    }

    // Cars layer
    const carsLayer = svg.append('g').attr('class', 'replay-cars-layer');
    let activeLapNumber = 0;

    const carNodes = carsLayer
        .selectAll('g.replay-car-node')
        .data(initialDrivers, (d) => d.code)
        .enter()
        .append('g')
        .attr('class', 'replay-car-node')
        .attr('transform', (d) => `translate(${d.x},${d.y})`)
        .style('cursor', 'pointer')
        .on('mouseenter', (event, d) => {
            onSelectDriver(d.code, false);
            _populateRadarCarTooltip(tooltip.node(), d, activeLapNumber);
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
        .on('mouseleave', () => {
            onSelectDriver(null, false);
            tooltip.classed('hidden', true);
        })
        .on('click', (_event, d) => {
            onSelectDriver(d.code, true);
        });

    carNodes
        .append('circle')
        .attr('class', 'replay-car-pit-ring')
        .attr('r', _CAR_PIT_RING_RADIUS_PX)
        .attr('fill', 'none')
        .attr('stroke', '#f59e0b')
        .attr('stroke-width', 2.2)
        .style('display', 'none');

    carNodes
        .append('circle')
        .attr('class', 'replay-car-dot')
        .attr('r', _CAR_MARKER_RADIUS_PX)
        .attr('fill', (d) => d.color)
        .attr('stroke', '#0b0b12')
        .attr('stroke-width', 1.8);

    carNodes
        .append('text')
        .attr('class', 'replay-car-label')
        .attr('x', 0)
        .attr('y', -10)
        .attr('text-anchor', 'middle')
        .attr('fill', '#ffffff')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '9px')
        .style('font-weight', '700')
        .style('paint-order', 'stroke')
        .attr('stroke', '#0b0b12')
        .attr('stroke-width', 3)
        .attr('stroke-linejoin', 'round')
        .text((d) => d.code);

    let currentFocusedDriver = null;

    const applyCarVisualStyles = () => {
        carNodes
            .style('display', (d) => (d.isRetired ? 'none' : null))
            .style('pointer-events', (d) => (d.isRetired ? 'none' : 'auto'))
            .style('opacity', (d) => {
                if (d.isRetired) return 0;
                if (currentFocusedDriver && d.code !== currentFocusedDriver) {
                    return _DIMMED_OPACITY;
                }
                return _ACTIVE_OPACITY;
            })
            .select('circle.replay-car-dot')
            .attr('r', (d) =>
                currentFocusedDriver === d.code
                    ? _CAR_MARKER_FOCUSED_RADIUS_PX
                    : _CAR_MARKER_RADIUS_PX
            )
            .attr('stroke', (d) =>
                currentFocusedDriver === d.code || d.pos === 1 ? '#ffffff' : '#0b0b12'
            )
            .attr('stroke-width', (d) =>
                currentFocusedDriver === d.code || d.pos === 1 ? 2.4 : 1.8
            );

        carNodes
            .select('circle.replay-car-pit-ring')
            .style('display', (d) => (!d.isRetired && d.isPitting ? null : 'none'));

        carNodes
            .select('text.replay-car-label')
            .attr('fill', (d) => (d.isPitting ? '#f59e0b' : '#ffffff'))
            .text((d) => (d.isPitting ? `${d.code} · PIT` : d.code));

        // Keep P1 and focused driver on top
        carNodes.filter((d) => !d.isRetired && (d.pos <= 3 || d.isPitting)).raise();
        if (currentFocusedDriver) {
            carNodes.filter((d) => !d.isRetired && d.code === currentFocusedDriver).raise();
        }
    };

    const updateCars = (drivers, currentLap, statusKey) => {
        activeLapNumber = currentLap;
        const byCode = new Map(drivers.map((d) => [d.code, d]));

        statusGlowPath.attr(
            'stroke',
            statusKey === _STATUS_SC
                ? 'rgba(245, 158, 11, 0.45)'
                : statusKey === _STATUS_VSC
                  ? 'rgba(250, 204, 21, 0.38)'
                  : 'rgba(255, 255, 255, 0.14)'
        );

        carNodes.each(function (oldD) {
            const nextD = byCode.get(oldD.code);
            if (nextD) {
                Object.assign(oldD, nextD);
            }
        });

        carNodes.attr('transform', (d) => `translate(${d.x},${d.y})`);
        applyCarVisualStyles();
    };

    const applyFocus = (focusedCode) => {
        currentFocusedDriver = focusedCode;
        applyCarVisualStyles();
    };

    applyCarVisualStyles();

    return { updateCars, applyFocus };
}

/**
 * Formats a driver's net position change vs their starting grid slot (`▲+2`, `▼-1`, or `—`).
 *
 * @param {number} delta - `gridPos - currentPos`.
 * @returns {{text: string, color: string}} Formatted delta string and color.
 */
function _formatGridDelta(delta) {
    if (delta > 0) {
        return { text: `▲+${delta}`, color: _GAIN_COLOR };
    }
    if (delta < 0) {
        return { text: `▼${delta}`, color: _LOSS_COLOR };
    }
    return { text: '—', color: 'var(--text-muted)' };
}

/**
 * Renders the Live Lap Classification & Tyre Tower rows for the active lap.
 *
 * @param {HTMLElement} towerListEl - Scrollable tower list container.
 * @param {Array<Object>} drivers - Ordered driver snapshots for the current lap.
 * @param {string|null} focusedDriver - Currently focused driver code or null.
 * @param {Function} onSelectDriver - Callback invoked when hovering or clicking a tower row.
 * @returns {void}
 */
function _renderTowerRows(towerListEl, drivers, focusedDriver, onSelectDriver) {
    const fragment = document.createDocumentFragment();

    drivers.forEach((d) => {
        const row = document.createElement('div');
        row.className = 'replay-tower-row';
        row.dataset.driver = d.code;
        if (focusedDriver === d.code) {
            row.classList.add('focused');
        }
        row.style.display = 'grid';
        row.style.gridTemplateColumns = '32px 4px 44px 42px 54px 1fr';
        row.style.alignItems = 'center';
        row.style.gap = '6px';
        row.style.padding = '4px 8px';
        row.style.borderRadius = '4px';
        row.style.cursor = 'pointer';
        row.style.opacity = d.isRetired
            ? String(_RETIRED_OPACITY + 0.15)
            : focusedDriver && focusedDriver !== d.code
              ? '0.45'
              : '1';
        row.style.background =
            focusedDriver === d.code
                ? 'rgba(255, 255, 255, 0.09)'
                : d.isPitting
                  ? 'rgba(245, 158, 11, 0.12)'
                  : 'rgba(255, 255, 255, 0.02)';

        const posSpan = document.createElement('span');
        posSpan.className = 'replay-tower-pos';
        posSpan.style.fontFamily = 'Montserrat, sans-serif';
        posSpan.style.fontSize = '0.74rem';
        posSpan.style.fontWeight = '700';
        posSpan.style.color = d.pos === 1 ? '#ffffff' : 'var(--text-muted)';
        posSpan.textContent = `P${d.pos}`;

        const colorBar = document.createElement('span');
        colorBar.className = 'replay-tower-color';
        colorBar.style.display = 'inline-block';
        colorBar.style.width = '4px';
        colorBar.style.height = '16px';
        colorBar.style.borderRadius = '2px';
        colorBar.style.backgroundColor = d.color;

        const codeSpan = document.createElement('span');
        codeSpan.className = 'replay-tower-code';
        codeSpan.style.fontFamily = 'Montserrat, sans-serif';
        codeSpan.style.fontSize = '0.78rem';
        codeSpan.style.fontWeight = '700';
        codeSpan.style.color = '#ffffff';
        codeSpan.textContent = d.code;

        const deltaInfo = _formatGridDelta(d.gridDelta);
        const deltaSpan = document.createElement('span');
        deltaSpan.className = 'replay-tower-delta';
        deltaSpan.style.fontFamily = 'Titillium Web, sans-serif';
        deltaSpan.style.fontSize = '0.72rem';
        deltaSpan.style.fontWeight = '700';
        deltaSpan.style.color = deltaInfo.color;
        deltaSpan.textContent = deltaInfo.text;

        const tyreWrap = document.createElement('span');
        tyreWrap.className = 'replay-tower-tyre';
        tyreWrap.style.display = 'inline-flex';
        tyreWrap.style.alignItems = 'center';
        tyreWrap.style.gap = '4px';
        tyreWrap.style.fontSize = '0.72rem';
        tyreWrap.style.fontWeight = '700';

        const tyreDot = document.createElement('span');
        tyreDot.style.display = 'inline-block';
        tyreDot.style.width = '9px';
        tyreDot.style.height = '9px';
        tyreDot.style.borderRadius = '50%';
        tyreDot.style.backgroundColor =
            _COMPOUND_COLORS[d.compound] || _COMPOUND_COLORS.UNKNOWN;

        const tyreText = document.createElement('span');
        tyreText.style.color = 'var(--text-muted)';
        const abbr = _COMPOUND_ABBREVIATIONS[d.compound] || 'U';
        tyreText.textContent = `${abbr}·${d.tyreAge}L`;
        tyreWrap.append(tyreDot, tyreText);

        const gapSpan = document.createElement('span');
        gapSpan.className = 'replay-tower-gap';
        gapSpan.style.textAlign = 'right';
        gapSpan.style.fontFamily = 'Titillium Web, sans-serif';
        gapSpan.style.fontSize = '0.76rem';
        gapSpan.style.fontWeight = '700';
        gapSpan.style.color = d.isPitting
            ? '#f59e0b'
            : d.pos === 1
              ? '#ffffff'
              : 'var(--text-primary)';
        gapSpan.textContent = d.gapLabel;

        row.append(posSpan, colorBar, codeSpan, deltaSpan, tyreWrap, gapSpan);

        row.addEventListener('mouseenter', () => onSelectDriver(d.code, false));
        row.addEventListener('mouseleave', () => onSelectDriver(null, false));
        row.addEventListener('click', () => onSelectDriver(d.code, true));

        fragment.appendChild(row);
    });

    towerListEl.replaceChildren(fragment);
}

/**
 * Updates the summary event chips inside `.replay-slider-bar` for the active lap.
 *
 * @param {HTMLElement} chipsContainer - Summary chips container element.
 * @param {Object} snapshot - Active lap snapshot (`leaderCode`, `pittingDrivers`).
 * @param {string} statusKey - Active track status key (`'GREEN'`, `'SC'`, `'VSC'`).
 * @param {number} currentLap - Active lap number.
 * @returns {void}
 */
function _updateSliderSummaryChips(chipsContainer, snapshot, statusKey, currentLap) {
    const leaderChip = document.createElement('span');
    leaderChip.className = 'replay-summary-chip';
    leaderChip.style.fontFamily = 'Montserrat, sans-serif';
    leaderChip.style.fontSize = '0.72rem';
    leaderChip.style.fontWeight = '700';
    leaderChip.style.padding = '3px 8px';
    leaderChip.style.borderRadius = '4px';
    leaderChip.style.background = 'rgba(255, 255, 255, 0.06)';
    leaderChip.style.color = '#ffffff';
    leaderChip.textContent =
        currentLap === 0
            ? `Pole Position: ${snapshot.leaderCode}`
            : `Leader @ Start/Finish: ${snapshot.leaderCode}`;

    const pitChip = document.createElement('span');
    pitChip.className = 'replay-summary-chip';
    pitChip.style.fontFamily = 'Montserrat, sans-serif';
    pitChip.style.fontSize = '0.72rem';
    pitChip.style.fontWeight = '700';
    pitChip.style.padding = '3px 8px';
    pitChip.style.borderRadius = '4px';

    if (snapshot.pittingDrivers.length > 0) {
        pitChip.style.background = 'rgba(245, 158, 11, 0.18)';
        pitChip.style.color = '#f59e0b';
        pitChip.style.border = '1px solid rgba(245, 158, 11, 0.45)';
        pitChip.textContent = `Pitting on Lap: ${snapshot.pittingDrivers.join(', ')}`;
    } else {
        const totalCars = (snapshot.drivers || []).length;
        const retiredCount = (snapshot.drivers || []).filter((d) => d.isRetired).length;
        const activeCount = totalCars - retiredCount;
        pitChip.style.background = 'rgba(255, 255, 255, 0.04)';
        pitChip.style.color = 'var(--text-muted)';
        pitChip.textContent =
            statusKey === _STATUS_GREEN
                ? retiredCount > 0
                    ? `${activeCount} Cars Running · ${retiredCount} OUT`
                    : 'All Cars on Track'
                : _TRACK_STATUS_CONFIG[statusKey].label;
    }

    chipsContainer.replaceChildren(leaderChip, pitChip);
}

/**
 * Renders the Interactive Lap-by-Lap Race Replay Scrubber inside `#race-replay-scrubber`
 * and its transport header controls inside `#race-replay-controls`.
 *
 * @param {Object} data - Race telemetry payload containing `drivers`, `laps`, `track_map`, and `race_telemetry`.
 * @returns {void}
 */
export function renderRaceScrubber(data) {
    stopRaceScrubberPlayback();
    _broadcastPlayheadLap(null);

    const stageContainer = document.getElementById('race-replay-scrubber');
    const controlsContainer = document.getElementById('race-replay-controls');
    if (!stageContainer) return;

    stageContainer.replaceChildren();
    if (controlsContainer) controlsContainer.replaceChildren();

    const { validLaps, maxLap, classification } = calculateDriverClassification(data);
    if (validLaps.length === 0 || maxLap === 0 || classification.length === 0) {
        _externalScrubberFocusHandler = null;
        const emptyEl = document.createElement('p');
        emptyEl.style.color = 'var(--text-muted)';
        emptyEl.style.textAlign = 'center';
        emptyEl.style.paddingTop = '2rem';
        emptyEl.style.fontFamily = 'Montserrat, sans-serif';
        emptyEl.style.textTransform = 'uppercase';
        emptyEl.textContent = 'No lap-by-lap replay telemetry available for this session.';
        stageContainer.replaceChildren(emptyEl);
        return;
    }

    const scWindows = _extractScWindows(data, maxLap);
    const trackGeo = _resolveTrackGeometry(data);
    const sampleTrackPoint = _createTrackLoopSampler(trackGeo.points);
    const snapshots = _buildLapSnapshots(
        data,
        classification,
        validLaps,
        maxLap,
        sampleTrackPoint
    );

    let currentLap = 0;
    let playbackSpeedMs = _SPEED_OPTIONS[0].intervalMs;
    let lockedDriver = null;
    let hoveredDriver = null;
    let externalDriver = null;

    // 1. Top Scrubber Slider Bar (.replay-slider-bar)
    const sliderBar = document.createElement('div');
    sliderBar.className = 'replay-slider-bar';
    sliderBar.style.display = 'flex';
    sliderBar.style.flexWrap = 'wrap';
    sliderBar.style.alignItems = 'center';
    sliderBar.style.gap = '12px';
    sliderBar.style.marginBottom = '14px';
    sliderBar.style.padding = '10px 14px';
    sliderBar.style.borderRadius = '8px';
    sliderBar.style.background = 'rgba(255, 255, 255, 0.03)';
    sliderBar.style.border = '1px solid rgba(255, 255, 255, 0.08)';

    const lapBadge = document.createElement('div');
    lapBadge.className = 'replay-lap-badge';
    lapBadge.style.fontFamily = 'Montserrat, sans-serif';
    lapBadge.style.fontSize = '0.84rem';
    lapBadge.style.fontWeight = '800';
    lapBadge.style.minWidth = '210px';
    lapBadge.style.color = '#f3f4f6';

    const rangeSlider = document.createElement('input');
    rangeSlider.type = 'range';
    rangeSlider.className = 'replay-range-slider';
    rangeSlider.min = '0';
    rangeSlider.max = String(maxLap);
    rangeSlider.value = '0';
    rangeSlider.setAttribute('aria-label', 'Scrub Race Lap');
    rangeSlider.style.flex = '1';
    rangeSlider.style.minWidth = '180px';
    rangeSlider.style.cursor = 'pointer';
    rangeSlider.style.accentColor = '#d1d5db';

    const chipsContainer = document.createElement('div');
    chipsContainer.className = 'replay-summary-chips';
    chipsContainer.style.display = 'flex';
    chipsContainer.style.gap = '8px';
    chipsContainer.style.alignItems = 'center';

    sliderBar.append(lapBadge, rangeSlider, chipsContainer);

    // 2. Two-Column Telemetry Grid (.replay-stage-grid)
    const stageGrid = document.createElement('div');
    stageGrid.className = 'replay-stage-grid';
    stageGrid.style.display = 'grid';
    stageGrid.style.gridTemplateColumns = 'minmax(0, 1.55fr) minmax(290px, 1fr)';
    stageGrid.style.gap = '16px';
    stageGrid.style.alignItems = 'stretch';

    const radarCard = document.createElement('div');
    radarCard.className = 'replay-radar-card';
    radarCard.style.background = 'rgba(13, 13, 20, 0.78)';
    radarCard.style.border = '1px solid rgba(255, 255, 255, 0.08)';
    radarCard.style.borderRadius = '8px';
    radarCard.style.padding = '10px';
    radarCard.style.display = 'flex';
    radarCard.style.flexDirection = 'column';
    radarCard.style.justifyContent = 'center';

    const towerCard = document.createElement('div');
    towerCard.className = 'replay-tower';
    towerCard.style.background = 'rgba(13, 13, 20, 0.78)';
    towerCard.style.border = '1px solid rgba(255, 255, 255, 0.08)';
    towerCard.style.borderRadius = '8px';
    towerCard.style.padding = '10px';
    towerCard.style.display = 'flex';
    towerCard.style.flexDirection = 'column';

    const towerHeader = document.createElement('div');
    towerHeader.className = 'replay-tower-header';
    towerHeader.style.fontFamily = 'Montserrat, sans-serif';
    towerHeader.style.fontSize = '0.72rem';
    towerHeader.style.fontWeight = '700';
    towerHeader.style.color = 'var(--text-muted)';
    towerHeader.style.letterSpacing = '0.6px';
    towerHeader.style.marginBottom = '8px';
    towerHeader.style.paddingBottom = '6px';
    towerHeader.style.borderBottom = '1px solid rgba(255, 255, 255, 0.08)';
    towerHeader.textContent = '// LIVE CLASSIFICATION & TYRE AGE TOWER';

    const towerListEl = document.createElement('div');
    towerListEl.className = 'replay-tower-list';
    towerListEl.style.display = 'flex';
    towerListEl.style.flexDirection = 'column';
    towerListEl.style.gap = '2px';
    towerListEl.style.maxHeight = '420px';
    towerListEl.style.overflowY = 'auto';

    towerCard.append(towerHeader, towerListEl);
    stageGrid.append(radarCard, towerCard);
    stageContainer.append(sliderBar, stageGrid);

    const getEffectiveDriver = () =>
        hoveredDriver !== null
            ? hoveredDriver
            : lockedDriver !== null
              ? lockedDriver
              : externalDriver;

    let radarController = null;

    const handleDriverInteraction = (driverCode, isClickLock) => {
        if (isClickLock) {
            lockedDriver = lockedDriver === driverCode ? null : driverCode;
        } else {
            hoveredDriver = driverCode;
        }
        const effective = getEffectiveDriver();
        if (radarController) {
            radarController.applyFocus(effective);
        }
        const snap = snapshots.get(currentLap) || snapshots.get(0);
        _renderTowerRows(towerListEl, snap.drivers, effective, handleDriverInteraction);
    };

    radarController = _createCircuitRadarSvg(
        radarCard,
        trackGeo,
        snapshots.get(0).drivers,
        handleDriverInteraction
    );

    let headerControls = null;

    const applyLapState = (nextLap, broadcastPlayhead = true) => {
        currentLap = Math.max(0, Math.min(maxLap, Math.round(nextLap)));
        rangeSlider.value = String(currentLap);

        const snapshot = snapshots.get(currentLap) || snapshots.get(0);
        const statusKey = _resolveTrackStatusOnLap(currentLap, scWindows);

        lapBadge.textContent =
            currentLap === 0
                ? `LAP 0 / ${maxLap} · STARTING GRID`
                : `LAP ${currentLap} / ${maxLap} · LEADER @ S/F`;

        _updateSliderSummaryChips(chipsContainer, snapshot, statusKey, currentLap);
        if (headerControls) {
            headerControls.updateStatusPill(statusKey);
        }

        radarController.updateCars(snapshot.drivers, currentLap, statusKey);
        _renderTowerRows(
            towerListEl,
            snapshot.drivers,
            getEffectiveDriver(),
            handleDriverInteraction
        );

        if (broadcastPlayhead) {
            _broadcastPlayheadLap(currentLap);
        }
    };

    const startPlaybackInterval = () => {
        if (_playbackIntervalId !== null) {
            clearInterval(_playbackIntervalId);
        }
        _playbackIntervalId = setInterval(() => {
            if (currentLap >= maxLap) {
                stopRaceScrubberPlayback();
                return;
            }
            applyLapState(currentLap + 1, true);
        }, playbackSpeedMs);
    };

    headerControls = _buildHeaderControls(controlsContainer, {
        onTogglePlay: () => {
            if (_playbackIntervalId !== null) {
                stopRaceScrubberPlayback();
            } else {
                if (currentLap >= maxLap) {
                    applyLapState(0, true);
                }
                headerControls.updatePlayButton(true);
                startPlaybackInterval();
            }
        },
        onStepLap: (delta) => {
            stopRaceScrubberPlayback();
            applyLapState(currentLap + delta, true);
        },
        onSpeedChange: (nextIntervalMs) => {
            playbackSpeedMs = nextIntervalMs;
            if (_playbackIntervalId !== null) {
                startPlaybackInterval();
            }
        }
    });

    _pausePlaybackUiHandler = () => {
        if (headerControls) {
            headerControls.updatePlayButton(false);
        }
    };

    rangeSlider.addEventListener('input', () => {
        stopRaceScrubberPlayback();
        applyLapState(Number(rangeSlider.value), true);
    });

    _externalScrubberFocusHandler = (driverCode) => {
        externalDriver = driverCode;
        const effective = getEffectiveDriver();
        radarController.applyFocus(effective);
        const snap = snapshots.get(currentLap) || snapshots.get(0);
        _renderTowerRows(towerListEl, snap.drivers, effective, handleDriverInteraction);
    };

    // Initialize at Lap 0 without forcing playhead lines until the user scrubs or plays
    applyLapState(0, false);
}
