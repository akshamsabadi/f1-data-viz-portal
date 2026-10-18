import { setCircuitMapTraceState, setCornerSpeedHighlightedTurn } from './corner_speed.js';

const _CHART_MARGIN = { top: 24, right: 28, bottom: 38, left: 62 };
const _SPEED_HEIGHT_PX = 145;
const _PEDAL_HEIGHT_PX = 95;
const _DELTA_HEIGHT_PX = 90;
const _SUBPLOT_GAP_PX = 26;
const _MIN_CHART_WIDTH_PX = 320;

const _DEFAULT_DRIVER_A_COLOR = '#e10600';
const _DEFAULT_DRIVER_B_COLOR = '#38bdf8';
const _SAME_TEAM_ACCENT_COLOR = '#facc15';
const _SAME_TEAM_LEGACY_YELLOW_COLOR = '#eab308';
const _SAME_TEAM_ALT_COLOR = '#38bdf8';
const _DELTA_LINE_COLOR = '#ffffff';
const _CROSSHAIR_DOT_STROKE_COLOR = '#ffffff';
const _TURN_MARKER_STROKE_COLOR = 'rgba(255, 255, 255, 0.12)';
const _ZERO_DELTA_LINE_COLOR = 'rgba(255, 255, 255, 0.4)';
const _CROSSHAIR_LINE_COLOR = 'rgba(255, 255, 255, 0.65)';
const _SELECT_BG_COLOR = '#111118';

const _SAME_TEAM_DASH_ARRAY = '6,3';
const _BRAKE_DASH_ARRAY = '2,3';
const _TURN_MARKER_DASH_ARRAY = '3,3';
const _ZERO_DELTA_DASH_ARRAY = '4,3';
const _CROSSHAIR_DASH_ARRAY = '3,3';

const _SPEED_STROKE_WIDTH_PX = 2.2;
const _THROTTLE_STROKE_WIDTH_PX = 1.9;
const _BRAKE_STROKE_WIDTH_PX = 1.35;
const _DELTA_LINE_STROKE_WIDTH_PX = 1.8;
const _BRAKE_LINE_OPACITY = 0.85;
const _BRAKE_AREA_OPACITY = 0.1;
const _DELTA_AREA_OPACITY = 0.24;

const _CROSSHAIR_DOT_RADIUS_PX = 4;
const _CROSSHAIR_PEDAL_DOT_RADIUS_PX = 3.5;
const _CROSSHAIR_DOT_STROKE_WIDTH_PX = 1.5;
const _CROSSHAIR_PEDAL_DOT_STROKE_WIDTH_PX = 1.2;

const _AXIS_LABEL_Y_OFFSET_PX = -44;
const _BOTTOM_AXIS_LABEL_Y_OFFSET_PX = 32;
const _TURN_LABEL_Y_OFFSET_PX = -6;
const _DELTA_AHEAD_LABEL_X_PX = 8;
const _DELTA_UPPER_LABEL_Y_PX = 12;
const _DELTA_LOWER_LABEL_BOTTOM_PAD_PX = 5;

const _LAP_DISTANCE_DOMAIN = [0, 100];
const _PEDAL_PERCENT_DOMAIN = [0, 100];
const _PEDAL_TICK_VALUES = [0, 50, 100];
const _SPEED_AXIS_TICKS = 5;
const _PEDAL_AXIS_TICKS = 3;
const _DELTA_AXIS_TICKS = 3;
const _DISTANCE_AXIS_TICKS = 10;

const _MIN_SPEED_FLOOR_KMH = 60;
const _DEFAULT_MIN_SPEED_KMH = 100;
const _DEFAULT_MAX_SPEED_KMH = 340;
const _SPEED_DOMAIN_LOWER_PAD_KMH = 12;
const _SPEED_DOMAIN_UPPER_PAD_KMH = 10;

const _MIN_ABS_DELTA_FLOOR_S = 0.15;
const _DEFAULT_ABS_DELTA_S = 0.25;
const _DELTA_DOMAIN_PADDING_FACTOR = 1.18;
const _NEAREST_TURN_THRESHOLD_PCT = 2.2;
const _DEAD_EVEN_DELTA_THRESHOLD_S = 0.0005;
const _SEGMENT_TIME_EPSILON_S = 0.000001;

const _ACTIVE_TURN_MARKER_COLOR = '#ffffff';
const _ACTIVE_TURN_MARKER_WIDTH_PX = 2.2;
const _DEFAULT_TURN_MARKER_WIDTH_PX = 1;
const _ACTIVE_TURN_LABEL_COLOR = '#ffffff';
const _DEFAULT_TURN_LABEL_COLOR = 'var(--text-muted)';
const _ACTIVE_TURN_LABEL_FONT_SIZE = '11px';
const _DEFAULT_TURN_LABEL_FONT_SIZE = '9.5px';

const _TOOLTIP_OFFSET_X_PX = 15;
const _TOOLTIP_OFFSET_Y_PX = -28;

let _externalFocusHandler = null;
let _highlightedTurnHandler = null;

/**
 * Updates the telemetry trace comparison when an external driver focus is triggered
 * (e.g., from the Session Classification sidebar).
 *
 * @param {string|null} driverCode - Three-letter driver code to compare against Driver A, or null.
 * @returns {void}
 */
export function setQualiTraceExternalFocus(driverCode) {
    if (_externalFocusHandler) {
        _externalFocusHandler(driverCode);
    }
}

/**
 * Highlights or restores the vertical turn reference line and turn label across all 3 telemetry
 * trace subplots for a given turn number.
 *
 * @param {number|null} turnNumber - Turn number to highlight (`1..N`), or null to reset.
 * @returns {void}
 */
export function setQualiTraceHighlightedTurn(turnNumber) {
    if (_highlightedTurnHandler) {
        _highlightedTurnHandler(turnNumber);
    }
}

/**
 * Formats a lap time in seconds as `m:ss.sss`.
 *
 * @param {number|null|undefined} seconds - Lap time in seconds.
 * @returns {string} Formatted lap time string.
 */
function _formatLapTime(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return 'N/A';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = (seconds % 60).toFixed(3);
    if (minutes > 0) {
        return `${minutes}:${remainingSeconds.padStart(6, '0')}`;
    }
    return `${remainingSeconds}s`;
}

/**
 * Resolves the display color for each driver, preferring official team colors applied on `data.drivers`.
 *
 * @param {Object} data - Race dataset containing `drivers` and `qualifying.results`.
 * @returns {Map<string, string>} Map of driver code to hex color string.
 */
function _buildDriverColorMap(data) {
    const colorMap = new Map();
    if (Array.isArray(data.drivers)) {
        data.drivers.forEach((driver) => {
            if (driver.code && driver.color) {
                colorMap.set(driver.code, driver.color);
            }
        });
    }
    const results = data.qualifying?.results || [];
    results.forEach((entry) => {
        if (entry.driver && !colorMap.has(entry.driver) && entry.color) {
            colorMap.set(entry.driver, entry.color);
        }
    });
    return colorMap;
}

/**
 * Computes visual stroke styles for Driver A and Driver B, ensuring high contrast and dashed
 * differentiation when both drivers belong to the same constructor or share an identical color.
 *
 * @param {Object} driverAEntry - Qualifying result object for Driver A.
 * @param {Object} driverBEntry - Qualifying result object for Driver B.
 * @param {Map<string, string>} colorMap - Map of driver code to team color.
 * @returns {{
 *   colorA: string,
 *   colorB: string,
 *   dashB: string,
 *   isSameTeam: boolean
 * }} Visual stroke descriptors for Driver A and Driver B.
 */
function _resolvePairStrokeStyles(driverAEntry, driverBEntry, colorMap) {
    const colorA = colorMap.get(driverAEntry.driver) || driverAEntry.color || _DEFAULT_DRIVER_A_COLOR;
    let colorB = colorMap.get(driverBEntry.driver) || driverBEntry.color || _DEFAULT_DRIVER_B_COLOR;

    const isSameTeam =
        driverAEntry.team === driverBEntry.team ||
        colorA.toLowerCase() === colorB.toLowerCase();

    if (isSameTeam) {
        const normalizedA = colorA.toLowerCase();
        const isYellowPrimary =
            normalizedA === _SAME_TEAM_ACCENT_COLOR ||
            normalizedA === _SAME_TEAM_LEGACY_YELLOW_COLOR;
        colorB = isYellowPrimary ? _SAME_TEAM_ALT_COLOR : _SAME_TEAM_ACCENT_COLOR;
    }

    return {
        colorA,
        colorB,
        dashB: isSameTeam ? _SAME_TEAM_DASH_ARRAY : 'none',
        isSameTeam
    };
}

/**
 * Builds the synchronized telemetry comparison series across lap distance percentages.
 *
 * @param {Array<number>} distancePct - Array of normalized lap distance percentages (`0..100`).
 * @param {Object} traceA - Telemetry arrays (`speed`, `throttle`, `brake`, `cum_time`) for Driver A.
 * @param {Object} traceB - Telemetry arrays (`speed`, `throttle`, `brake`, `cum_time`) for Driver B.
 * @returns {Array<{
 *   pct: number,
 *   speedA: number,
 *   speedB: number,
 *   throttleA: number,
 *   throttleB: number,
 *   brakeA: number,
 *   brakeB: number,
 *   cumTimeA: number,
 *   cumTimeB: number,
 *   delta: number
 * }>} Synchronized telemetry samples for both drivers.
 */
function _buildTelemetrySeries(distancePct, traceA, traceB) {
    return distancePct.map((pct, index) => {
        const speedA = traceA.speed[index] ?? 0;
        const speedB = traceB.speed[index] ?? 0;
        const throttleA = traceA.throttle[index] ?? 0;
        const throttleB = traceB.throttle[index] ?? 0;
        const brakeA = traceA.brake[index] ?? 0;
        const brakeB = traceB.brake[index] ?? 0;
        const cumTimeA = traceA.cum_time[index] ?? 0;
        const cumTimeB = traceB.cum_time[index] ?? 0;
        return {
            pct,
            speedA,
            speedB,
            throttleA,
            throttleB,
            brakeA,
            brakeB,
            cumTimeA,
            cumTimeB,
            delta: cumTimeB - cumTimeA
        };
    });
}

/**
 * Computes the padded `[minSpeed, maxSpeed]` Y-axis domain for the Speed subplot.
 *
 * @param {Array<{speedA: number, speedB: number}>} series - Synchronized telemetry samples.
 * @returns {[number, number]} Lower and upper speed bounds in km/h.
 */
function _computeSpeedDomain(series) {
    const allSpeeds = series.flatMap((sample) => [sample.speedA, sample.speedB]);
    const minSpeed = Math.max(
        _MIN_SPEED_FLOOR_KMH,
        Math.floor((d3.min(allSpeeds) || _DEFAULT_MIN_SPEED_KMH) - _SPEED_DOMAIN_LOWER_PAD_KMH)
    );
    const maxSpeed = Math.ceil(
        (d3.max(allSpeeds) || _DEFAULT_MAX_SPEED_KMH) + _SPEED_DOMAIN_UPPER_PAD_KMH
    );
    return [minSpeed, maxSpeed];
}

/**
 * Computes the symmetric Y-axis bound for the cumulative time delta subplot.
 *
 * @param {Array<{delta: number}>} series - Synchronized telemetry samples.
 * @returns {number} Positive delta bound in seconds.
 */
function _computeDeltaDomainBound(series) {
    const maxAbsDelta = Math.max(
        _MIN_ABS_DELTA_FLOOR_S,
        d3.max(series, (sample) => Math.abs(sample.delta)) || _DEFAULT_ABS_DELTA_S
    );
    return maxAbsDelta * _DELTA_DOMAIN_PADDING_FACTOR;
}

/**
 * Finds the turn number nearest to a given lap distance percentage if within the proximity threshold.
 *
 * @param {Array<{turn: number, pct: number}>} turns - Track turn markers.
 * @param {number} pct - Hovered lap distance percentage.
 * @returns {number|null} Turn number if near a corner, or null.
 */
function _findNearestTurnNumber(turns, pct) {
    for (let i = 0; i < turns.length; i += 1) {
        if (Math.abs(turns[i].pct - pct) <= _NEAREST_TURN_THRESHOLD_PCT) {
            return turns[i].turn;
        }
    }
    return null;
}

/**
 * Computes contiguous track dominance segments and distance share percentages for Driver A and Driver B
 * across consecutive lap distance intervals.
 *
 * @param {Array<{pct: number, speedA: number, speedB: number, cumTimeA: number, cumTimeB: number}>} series - Synchronized telemetry samples.
 * @param {{colorA: string, colorB: string, isSameTeam: boolean}} strokeStyles - Active pair stroke styles.
 * @returns {{
 *   dominanceSegments: Array<{startPct: number, endPct: number, leader: 'A'|'B', color: string, isDashed: boolean}>,
 *   shareA: number,
 *   shareB: number
 * }} Merged track dominance segments and percentage split.
 */
function _computeTrackDominanceSummary(series, strokeStyles) {
    if (!Array.isArray(series) || series.length < 2) {
        return { dominanceSegments: [], shareA: 50, shareB: 50 };
    }

    const dominanceSegments = [];
    let distA = 0;
    let totalDist = 0;

    for (let i = 0; i < series.length - 1; i += 1) {
        const s0 = series[i];
        const s1 = series[i + 1];
        const segLen = Math.max(0, s1.pct - s0.pct);
        const segTimeGainA = (s1.cumTimeB - s0.cumTimeB) - (s1.cumTimeA - s0.cumTimeA);

        let leader;
        if (Math.abs(segTimeGainA) > _SEGMENT_TIME_EPSILON_S) {
            leader = segTimeGainA > 0 ? 'A' : 'B';
        } else {
            leader = s0.speedA + s1.speedA >= s0.speedB + s1.speedB ? 'A' : 'B';
        }

        if (leader === 'A') {
            distA += segLen;
        }
        totalDist += segLen;

        const color = leader === 'A' ? strokeStyles.colorA : strokeStyles.colorB;
        const isDashed = Boolean(strokeStyles.isSameTeam && leader === 'B');
        const prevSeg = dominanceSegments[dominanceSegments.length - 1];

        if (prevSeg && prevSeg.leader === leader) {
            prevSeg.endPct = s1.pct;
        } else {
            dominanceSegments.push({
                startPct: s0.pct,
                endPct: s1.pct,
                leader,
                color,
                isDashed
            });
        }
    }

    const shareA = totalDist > 0 ? Math.round((distA / totalDist) * 100) : 50;
    const shareB = 100 - shareA;

    return {
        dominanceSegments,
        shareA,
        shareB
    };
}

/**
 * Highlights or resets the vertical turn marker line and top turn label matching `turnNumber`
 * across all 3 stacked telemetry subplots.
 *
 * @param {Object} mainGroup - Root translated D3 `<g>` selection.
 * @param {number|null} turnNumber - Turn number to highlight, or null to restore default styling.
 * @returns {void}
 */
function _applyTurnMarkerHighlight(mainGroup, turnNumber) {
    if (!mainGroup) return;

    mainGroup
        .selectAll('line.turn-marker')
        .attr('stroke', (d) =>
            d.turn === turnNumber ? _ACTIVE_TURN_MARKER_COLOR : _TURN_MARKER_STROKE_COLOR
        )
        .attr('stroke-width', (d) =>
            d.turn === turnNumber ? _ACTIVE_TURN_MARKER_WIDTH_PX : _DEFAULT_TURN_MARKER_WIDTH_PX
        )
        .attr('stroke-dasharray', (d) =>
            d.turn === turnNumber ? 'none' : _TURN_MARKER_DASH_ARRAY
        );

    mainGroup
        .selectAll('text.turn-label')
        .attr('fill', (d) =>
            d.turn === turnNumber ? _ACTIVE_TURN_LABEL_COLOR : _DEFAULT_TURN_LABEL_COLOR
        )
        .style('font-size', (d) =>
            d.turn === turnNumber ? _ACTIVE_TURN_LABEL_FONT_SIZE : _DEFAULT_TURN_LABEL_FONT_SIZE
        );
}

/**
 * Renders an uppercase empty-state message inside a chart container.
 *
 * @param {HTMLElement} container - Target chart container element.
 * @param {string} message - Empty-state text message.
 * @returns {void}
 */
function _renderEmptyState(container, message) {
    const emptyMsg = document.createElement('p');
    emptyMsg.style.color = 'var(--text-muted)';
    emptyMsg.style.textAlign = 'center';
    emptyMsg.style.paddingTop = '2rem';
    emptyMsg.style.fontFamily = 'Montserrat, sans-serif';
    emptyMsg.style.textTransform = 'uppercase';
    emptyMsg.textContent = message;
    container.replaceChildren(emptyMsg);
}

/**
 * Creates a styled native `<select class="trace-driver-select">` wrapped with a team color indicator
 * and custom down-arrow compliant with GEMINI.md Rule #2 (`appearance: none`).
 *
 * @param {string} roleLabel - Short label prefix (`DRIVER A` or `DRIVER B`).
 * @param {Array<Object>} results - Sorted qualifying results array.
 * @param {string} selectedDriver - Initially selected driver code.
 * @param {Function} onChange - Callback invoked when the user changes the select option.
 * @returns {{
 *   wrapper: HTMLDivElement,
 *   selectEl: HTMLSelectElement,
 *   swatchEl: HTMLSpanElement
 * }} DOM elements for the selector control.
 */
function _createDriverSelectControl(roleLabel, results, selectedDriver, onChange) {
    const wrapper = document.createElement('div');
    wrapper.className = 'trace-select-group';
    wrapper.style.display = 'inline-flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.gap = '0.5rem';

    const labelEl = document.createElement('span');
    labelEl.style.fontFamily = 'Montserrat, sans-serif';
    labelEl.style.fontSize = '0.7rem';
    labelEl.style.fontWeight = '700';
    labelEl.style.color = 'var(--text-muted)';
    labelEl.style.letterSpacing = '0.8px';
    labelEl.style.textTransform = 'uppercase';
    labelEl.textContent = roleLabel;

    const swatchEl = document.createElement('span');
    swatchEl.className = 'trace-driver-swatch';
    swatchEl.style.display = 'inline-block';
    swatchEl.style.width = '18px';
    swatchEl.style.height = '0px';
    swatchEl.style.borderTopWidth = '3px';
    swatchEl.style.borderTopStyle = 'solid';
    swatchEl.style.borderRadius = '2px';

    const selectWrap = document.createElement('div');
    selectWrap.style.position = 'relative';
    selectWrap.style.display = 'inline-flex';
    selectWrap.style.alignItems = 'center';

    const selectEl = document.createElement('select');
    selectEl.className = 'trace-driver-select';
    selectEl.setAttribute('aria-label', roleLabel);
    selectEl.style.appearance = 'none';
    selectEl.style.webkitAppearance = 'none';
    selectEl.style.backgroundColor = _SELECT_BG_COLOR;
    selectEl.style.color = 'var(--text-primary)';
    selectEl.style.border = '1px solid var(--border-color)';
    selectEl.style.borderRadius = '4px';
    selectEl.style.padding = '0.38rem 2rem 0.38rem 0.7rem';
    selectEl.style.fontFamily = 'Montserrat, sans-serif';
    selectEl.style.fontSize = '0.75rem';
    selectEl.style.fontWeight = '700';
    selectEl.style.letterSpacing = '0.5px';
    selectEl.style.cursor = 'pointer';
    selectEl.style.outline = 'none';

    results.forEach((entry) => {
        const option = document.createElement('option');
        option.value = entry.driver;
        option.textContent = `P${entry.grid_pos} ${entry.driver} (${_formatLapTime(entry.best_time)})`;
        selectEl.appendChild(option);
    });

    selectEl.value = selectedDriver;
    selectEl.addEventListener('change', (event) => {
        onChange(event.target.value);
    });

    const arrowEl = document.createElement('span');
    arrowEl.style.position = 'absolute';
    arrowEl.style.right = '0.65rem';
    arrowEl.style.pointerEvents = 'none';
    arrowEl.style.width = '0';
    arrowEl.style.height = '0';
    arrowEl.style.borderLeft = '4px solid transparent';
    arrowEl.style.borderRight = '4px solid transparent';
    arrowEl.style.borderTop = '5px solid var(--text-muted)';

    selectWrap.appendChild(selectEl);
    selectWrap.appendChild(arrowEl);

    wrapper.appendChild(labelEl);
    wrapper.appendChild(swatchEl);
    wrapper.appendChild(selectWrap);

    return { wrapper, selectEl, swatchEl };
}

/**
 * Creates the styled `VS` badge element separating Driver A and Driver B selectors.
 *
 * @returns {HTMLSpanElement} Styled `VS` badge element.
 */
function _createVsBadgeElement() {
    const vsBadge = document.createElement('span');
    vsBadge.style.fontFamily = 'Montserrat, sans-serif';
    vsBadge.style.fontSize = '0.7rem';
    vsBadge.style.fontWeight = '700';
    vsBadge.style.color = 'var(--text-muted)';
    vsBadge.style.padding = '0.15rem 0.4rem';
    vsBadge.style.borderRadius = '4px';
    vsBadge.style.background = 'rgba(255, 255, 255, 0.05)';
    vsBadge.style.border = '1px solid rgba(255, 255, 255, 0.12)';
    vsBadge.textContent = 'VS';
    return vsBadge;
}

/**
 * Renders the Driver A and Driver B selector controls inside `#quali-trace-controls`.
 *
 * @param {HTMLElement|null} controlsContainer - Controls host element.
 * @param {Array<Object>} results - Sorted qualifying results.
 * @param {string} driverACode - Initial Driver A code.
 * @param {string} driverBCode - Initial Driver B code.
 * @param {Function} onSelectDriverA - Callback invoked when Driver A changes.
 * @param {Function} onSelectDriverB - Callback invoked when Driver B changes.
 * @returns {{
 *   controlA: {wrapper: HTMLDivElement, selectEl: HTMLSelectElement, swatchEl: HTMLSpanElement}|null,
 *   controlB: {wrapper: HTMLDivElement, selectEl: HTMLSelectElement, swatchEl: HTMLSpanElement}|null
 * }} Selector control references.
 */
function _renderTraceSelectorControls(
    controlsContainer,
    results,
    driverACode,
    driverBCode,
    onSelectDriverA,
    onSelectDriverB
) {
    if (!controlsContainer) {
        return { controlA: null, controlB: null };
    }

    controlsContainer.style.display = 'flex';
    controlsContainer.style.alignItems = 'center';
    controlsContainer.style.gap = '0.85rem';
    controlsContainer.style.flexWrap = 'wrap';

    const controlA = _createDriverSelectControl('DRIVER A', results, driverACode, onSelectDriverA);
    const vsBadge = _createVsBadgeElement();
    const controlB = _createDriverSelectControl('DRIVER B', results, driverBCode, onSelectDriverB);

    controlsContainer.appendChild(controlA.wrapper);
    controlsContainer.appendChild(vsBadge);
    controlsContainer.appendChild(controlB.wrapper);

    return { controlA, controlB };
}

/**
 * Synchronizes the Driver A and Driver B selector swatches with their active stroke styles.
 *
 * @param {{swatchEl: HTMLSpanElement}|null} controlA - Driver A control object.
 * @param {{swatchEl: HTMLSpanElement}|null} controlB - Driver B control object.
 * @param {{colorA: string, colorB: string, isSameTeam: boolean}} strokeStyles - Active pair stroke styles.
 * @returns {void}
 */
function _updateControlSwatches(controlA, controlB, strokeStyles) {
    if (!controlA || !controlB) return;
    controlA.swatchEl.style.borderTopColor = strokeStyles.colorA;
    controlA.swatchEl.style.borderTopStyle = 'solid';
    controlB.swatchEl.style.borderTopColor = strokeStyles.colorB;
    controlB.swatchEl.style.borderTopStyle = strokeStyles.isSameTeam ? 'dashed' : 'solid';
}

/**
 * Builds a single driver's telemetry row for the trace hover tooltip.
 *
 * @param {Object} entry - Qualifying result entry for the driver.
 * @param {{speed: number, throttle: number, brake: number}} point - Driver telemetry sample at hovered distance.
 * @param {string} color - Driver display hex color.
 * @returns {HTMLDivElement} Constructed tooltip driver row element.
 */
function _buildTooltipDriverRow(entry, point, color) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.alignItems = 'center';
    row.style.gap = '12px';
    row.style.fontSize = '0.8rem';
    row.style.marginBottom = '3px';

    const left = document.createElement('span');
    left.style.fontWeight = '700';
    left.style.color = color;
    left.textContent = `${entry.driver} (P${entry.grid_pos})`;

    const right = document.createElement('span');
    right.style.color = 'var(--text-primary)';
    right.style.fontWeight = '600';
    right.textContent = `${point.speed.toFixed(1)} km/h | Thr ${point.throttle.toFixed(0)}% | Brk ${point.brake.toFixed(0)}%`;

    row.appendChild(left);
    row.appendChild(right);
    return row;
}

/**
 * Updates the tooltip DOM node with synchronized telemetry values at the hovered track distance.
 *
 * @param {HTMLElement|null} tooltipNode - Shared `#tooltip` DOM node.
 * @param {{
 *   pct: number,
 *   nearestTurn: number|null,
 *   driverA: Object,
 *   driverB: Object,
 *   pointA: {speed: number, throttle: number, brake: number, cumTime: number},
 *   pointB: {speed: number, throttle: number, brake: number, cumTime: number},
 *   deltaS: number,
 *   colorA: string,
 *   colorB: string
 * }} payload - Telemetry snapshot at the hovered distance index.
 * @returns {void}
 */
function _populateTraceTooltip(tooltipNode, payload) {
    if (!tooltipNode) return;

    const { pct, nearestTurn, driverA, driverB, pointA, pointB, deltaS, colorA, colorB } = payload;

    const header = document.createElement('div');
    header.style.fontFamily = 'Montserrat, sans-serif';
    header.style.fontWeight = '700';
    header.style.fontSize = '0.78rem';
    header.style.marginBottom = '6px';
    header.style.textTransform = 'uppercase';
    header.style.color = 'var(--text-primary)';
    header.textContent = nearestTurn
        ? `LAP DISTANCE: ${pct}% (NEAR T${nearestTurn})`
        : `LAP DISTANCE: ${pct}%`;

    const deltaRow = document.createElement('div');
    deltaRow.style.marginTop = '5px';
    deltaRow.style.paddingTop = '4px';
    deltaRow.style.borderTop = '1px solid rgba(255, 255, 255, 0.1)';
    deltaRow.style.fontSize = '0.8rem';
    deltaRow.style.fontWeight = '700';

    const absDelta = Math.abs(deltaS).toFixed(3);
    const isDeadEven = Math.abs(deltaS) < _DEAD_EVEN_DELTA_THRESHOLD_S;
    if (isDeadEven) {
        deltaRow.style.color = 'var(--text-muted)';
        deltaRow.textContent = 'Δt: 0.000s (DEAD EVEN)';
    } else if (deltaS > 0) {
        deltaRow.style.color = colorA;
        deltaRow.textContent = `Δt: +${absDelta}s (${driverA.driver} AHEAD)`;
    } else {
        deltaRow.style.color = colorB;
        deltaRow.textContent = `Δt: -${absDelta}s (${driverB.driver} AHEAD)`;
    }

    tooltipNode.replaceChildren(
        header,
        _buildTooltipDriverRow(driverA, pointA, colorA),
        _buildTooltipDriverRow(driverB, pointB, colorB),
        deltaRow
    );
}

/**
 * Renders vertical dashed turn reference lines across a subplot.
 *
 * @param {Object} group - D3 selection for the subplot group.
 * @param {Array<{turn: number, pct: number}>} turns - Array of turn locations along the lap.
 * @param {Function} xScale - Shared D3 linear scale for lap distance percentage.
 * @param {number} height - Subplot height in pixels.
 * @param {boolean} shouldShowLabels - Whether to render `T1..TN` text labels along the top of the subplot.
 * @returns {void}
 */
function _renderTurnMarkers(group, turns, xScale, height, shouldShowLabels) {
    const turnGroup = group.append('g').attr('class', 'trace-turns');

    turnGroup
        .selectAll('line.turn-marker')
        .data(turns)
        .enter()
        .append('line')
        .attr('class', 'turn-marker')
        .attr('x1', (d) => xScale(d.pct))
        .attr('x2', (d) => xScale(d.pct))
        .attr('y1', 0)
        .attr('y2', height)
        .attr('stroke', _TURN_MARKER_STROKE_COLOR)
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', _TURN_MARKER_DASH_ARRAY);

    if (shouldShowLabels) {
        turnGroup
            .selectAll('text.turn-label')
            .data(turns)
            .enter()
            .append('text')
            .attr('class', 'turn-label')
            .attr('x', (d) => xScale(d.pct))
            .attr('y', _TURN_LABEL_Y_OFFSET_PX)
            .attr('text-anchor', 'middle')
            .attr('fill', 'var(--text-muted)')
            .style('font-family', 'Montserrat, sans-serif')
            .style('font-size', '9.5px')
            .style('font-weight', '700')
            .text((d) => `T${d.turn}`);
    }
}

/**
 * Appends a rotated vertical Y-axis title to a D3 axis group.
 *
 * @param {Object} axisGroup - D3 selection of the rendered left axis group.
 * @param {number} subplotHeight - Height of the subplot in pixels.
 * @param {string} labelText - Uppercase axis label text.
 * @returns {void}
 */
function _appendVerticalAxisLabel(axisGroup, subplotHeight, labelText) {
    axisGroup
        .append('text')
        .attr('transform', 'rotate(-90)')
        .attr('x', -subplotHeight / 2)
        .attr('y', _AXIS_LABEL_Y_OFFSET_PX)
        .attr('fill', 'var(--text-muted)')
        .attr('text-anchor', 'middle')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '10px')
        .style('font-weight', '700')
        .text(labelText);
}

/**
 * Renders the top Speed (km/h) subplot and returns its vertical scale and offset.
 *
 * @param {Object} mainGroup - Root translated D3 `<g>` selection.
 * @param {Array<Object>} series - Synchronized telemetry samples.
 * @param {Array<{turn: number, pct: number}>} turns - Track corner markers.
 * @param {Function} xScale - Shared lap distance D3 linear scale.
 * @param {number} width - Inner chart width in pixels.
 * @param {{colorA: string, colorB: string, dashB: string}} strokeStyles - Pair stroke styles.
 * @returns {{speedYScale: Function, speedYOffset: number}} Speed Y scale and vertical offset.
 */
function _renderSpeedSubplot(mainGroup, series, turns, xScale, width, strokeStyles) {
    const speedYOffset = 0;
    const speedGroup = mainGroup
        .append('g')
        .attr('transform', `translate(0,${speedYOffset})`);

    const speedDomain = _computeSpeedDomain(series);
    const speedYScale = d3
        .scaleLinear()
        .domain(speedDomain)
        .range([_SPEED_HEIGHT_PX, 0]);

    speedGroup
        .append('g')
        .attr('class', 'gridline')
        .call(d3.axisLeft(speedYScale).ticks(_SPEED_AXIS_TICKS).tickSize(-width).tickFormat(''));

    _renderTurnMarkers(speedGroup, turns, xScale, _SPEED_HEIGHT_PX, true);

    const speedAxisGroup = speedGroup
        .append('g')
        .call(d3.axisLeft(speedYScale).ticks(_SPEED_AXIS_TICKS).tickSize(0))
        .call((g) => g.select('.domain').remove());

    _appendVerticalAxisLabel(speedAxisGroup, _SPEED_HEIGHT_PX, 'SPEED (KM/H)');

    const speedLineA = d3
        .line()
        .x((d) => xScale(d.pct))
        .y((d) => speedYScale(d.speedA))
        .curve(d3.curveMonotoneX);

    const speedLineB = d3
        .line()
        .x((d) => xScale(d.pct))
        .y((d) => speedYScale(d.speedB))
        .curve(d3.curveMonotoneX);

    speedGroup
        .append('path')
        .datum(series)
        .attr('fill', 'none')
        .attr('stroke', strokeStyles.colorA)
        .attr('stroke-width', _SPEED_STROKE_WIDTH_PX)
        .attr('d', speedLineA);

    speedGroup
        .append('path')
        .datum(series)
        .attr('fill', 'none')
        .attr('stroke', strokeStyles.colorB)
        .attr('stroke-width', _SPEED_STROKE_WIDTH_PX)
        .attr('stroke-dasharray', strokeStyles.dashB)
        .attr('d', speedLineB);

    return { speedYScale, speedYOffset };
}

/**
 * Renders the middle Throttle & Brake (%) subplot and returns its vertical scale and offset.
 *
 * @param {Object} mainGroup - Root translated D3 `<g>` selection.
 * @param {Array<Object>} series - Synchronized telemetry samples.
 * @param {Array<{turn: number, pct: number}>} turns - Track corner markers.
 * @param {Function} xScale - Shared lap distance D3 linear scale.
 * @param {number} width - Inner chart width in pixels.
 * @param {{colorA: string, colorB: string, dashB: string}} strokeStyles - Pair stroke styles.
 * @returns {{pedalYScale: Function, pedalYOffset: number}} Pedal Y scale and vertical offset.
 */
function _renderThrottleBrakeSubplot(mainGroup, series, turns, xScale, width, strokeStyles) {
    const pedalYOffset = _SPEED_HEIGHT_PX + _SUBPLOT_GAP_PX;
    const pedalGroup = mainGroup
        .append('g')
        .attr('transform', `translate(0,${pedalYOffset})`);

    const pedalYScale = d3
        .scaleLinear()
        .domain(_PEDAL_PERCENT_DOMAIN)
        .range([_PEDAL_HEIGHT_PX, 0]);

    pedalGroup
        .append('g')
        .attr('class', 'gridline')
        .call(d3.axisLeft(pedalYScale).ticks(_PEDAL_AXIS_TICKS).tickSize(-width).tickFormat(''));

    _renderTurnMarkers(pedalGroup, turns, xScale, _PEDAL_HEIGHT_PX, false);

    const pedalAxisGroup = pedalGroup
        .append('g')
        .call(
            d3
                .axisLeft(pedalYScale)
                .tickValues(_PEDAL_TICK_VALUES)
                .tickFormat((d) => `${d}%`)
                .tickSize(0)
        )
        .call((g) => g.select('.domain').remove());

    _appendVerticalAxisLabel(pedalAxisGroup, _PEDAL_HEIGHT_PX, 'THR / BRK (%)');

    const brakeAreaA = d3
        .area()
        .x((d) => xScale(d.pct))
        .y0(_PEDAL_HEIGHT_PX)
        .y1((d) => pedalYScale(d.brakeA))
        .curve(d3.curveMonotoneX);

    const brakeAreaB = d3
        .area()
        .x((d) => xScale(d.pct))
        .y0(_PEDAL_HEIGHT_PX)
        .y1((d) => pedalYScale(d.brakeB))
        .curve(d3.curveMonotoneX);

    pedalGroup
        .append('path')
        .datum(series)
        .attr('fill', strokeStyles.colorA)
        .attr('fill-opacity', _BRAKE_AREA_OPACITY)
        .attr('d', brakeAreaA);

    pedalGroup
        .append('path')
        .datum(series)
        .attr('fill', strokeStyles.colorB)
        .attr('fill-opacity', _BRAKE_AREA_OPACITY)
        .attr('d', brakeAreaB);

    const throttleLineA = d3
        .line()
        .x((d) => xScale(d.pct))
        .y((d) => pedalYScale(d.throttleA))
        .curve(d3.curveMonotoneX);

    const throttleLineB = d3
        .line()
        .x((d) => xScale(d.pct))
        .y((d) => pedalYScale(d.throttleB))
        .curve(d3.curveMonotoneX);

    const brakeLineA = d3
        .line()
        .x((d) => xScale(d.pct))
        .y((d) => pedalYScale(d.brakeA))
        .curve(d3.curveMonotoneX);

    const brakeLineB = d3
        .line()
        .x((d) => xScale(d.pct))
        .y((d) => pedalYScale(d.brakeB))
        .curve(d3.curveMonotoneX);

    pedalGroup
        .append('path')
        .datum(series)
        .attr('fill', 'none')
        .attr('stroke', strokeStyles.colorA)
        .attr('stroke-width', _THROTTLE_STROKE_WIDTH_PX)
        .attr('d', throttleLineA);

    pedalGroup
        .append('path')
        .datum(series)
        .attr('fill', 'none')
        .attr('stroke', strokeStyles.colorB)
        .attr('stroke-width', _THROTTLE_STROKE_WIDTH_PX)
        .attr('stroke-dasharray', strokeStyles.dashB)
        .attr('d', throttleLineB);

    pedalGroup
        .append('path')
        .datum(series)
        .attr('fill', 'none')
        .attr('stroke', strokeStyles.colorA)
        .attr('stroke-width', _BRAKE_STROKE_WIDTH_PX)
        .attr('stroke-dasharray', _BRAKE_DASH_ARRAY)
        .attr('opacity', _BRAKE_LINE_OPACITY)
        .attr('d', brakeLineA);

    pedalGroup
        .append('path')
        .datum(series)
        .attr('fill', 'none')
        .attr('stroke', strokeStyles.colorB)
        .attr('stroke-width', _BRAKE_STROKE_WIDTH_PX)
        .attr('stroke-dasharray', _BRAKE_DASH_ARRAY)
        .attr('opacity', _BRAKE_LINE_OPACITY)
        .attr('d', brakeLineB);

    return { pedalYScale, pedalYOffset };
}

/**
 * Renders the bottom Cumulative Time Delta (`cum_time_B - cum_time_A`) subplot and returns its scale and offset.
 *
 * @param {Object} mainGroup - Root translated D3 `<g>` selection.
 * @param {Object} defs - SVG `<defs>` selection for clip paths.
 * @param {Array<Object>} series - Synchronized telemetry samples.
 * @param {Array<{turn: number, pct: number}>} turns - Track corner markers.
 * @param {Function} xScale - Shared lap distance D3 linear scale.
 * @param {number} width - Inner chart width in pixels.
 * @param {Object} driverAEntry - Qualifying result entry for Driver A.
 * @param {Object} driverBEntry - Qualifying result entry for Driver B.
 * @param {{colorA: string, colorB: string}} strokeStyles - Pair stroke styles.
 * @returns {{deltaYScale: Function, deltaYOffset: number}} Delta Y scale and vertical offset.
 */
function _renderDeltaSubplot(
    mainGroup,
    defs,
    series,
    turns,
    xScale,
    width,
    driverAEntry,
    driverBEntry,
    strokeStyles
) {
    const deltaYOffset = _SPEED_HEIGHT_PX + _PEDAL_HEIGHT_PX + _SUBPLOT_GAP_PX * 2;
    const deltaGroup = mainGroup
        .append('g')
        .attr('transform', `translate(0,${deltaYOffset})`);

    const paddedDeltaBound = _computeDeltaDomainBound(series);
    const deltaYScale = d3
        .scaleLinear()
        .domain([-paddedDeltaBound, paddedDeltaBound])
        .range([_DELTA_HEIGHT_PX, 0]);

    const zeroY = deltaYScale(0);
    const clipAboveId = `quali-delta-above-${driverAEntry.driver}-${driverBEntry.driver}`;
    const clipBelowId = `quali-delta-below-${driverAEntry.driver}-${driverBEntry.driver}`;

    defs.append('clipPath')
        .attr('id', clipAboveId)
        .append('rect')
        .attr('x', 0)
        .attr('y', 0)
        .attr('width', width)
        .attr('height', zeroY);

    defs.append('clipPath')
        .attr('id', clipBelowId)
        .append('rect')
        .attr('x', 0)
        .attr('y', zeroY)
        .attr('width', width)
        .attr('height', _DELTA_HEIGHT_PX - zeroY);

    deltaGroup
        .append('g')
        .attr('class', 'gridline')
        .call(d3.axisLeft(deltaYScale).ticks(_DELTA_AXIS_TICKS).tickSize(-width).tickFormat(''));

    _renderTurnMarkers(deltaGroup, turns, xScale, _DELTA_HEIGHT_PX, false);

    const deltaArea = d3
        .area()
        .x((d) => xScale(d.pct))
        .y0(zeroY)
        .y1((d) => deltaYScale(d.delta))
        .curve(d3.curveMonotoneX);

    deltaGroup
        .append('path')
        .datum(series)
        .attr('clip-path', `url(#${clipAboveId})`)
        .attr('fill', strokeStyles.colorA)
        .attr('fill-opacity', _DELTA_AREA_OPACITY)
        .attr('d', deltaArea);

    deltaGroup
        .append('path')
        .datum(series)
        .attr('clip-path', `url(#${clipBelowId})`)
        .attr('fill', strokeStyles.colorB)
        .attr('fill-opacity', _DELTA_AREA_OPACITY)
        .attr('d', deltaArea);

    deltaGroup
        .append('line')
        .attr('x1', 0)
        .attr('x2', width)
        .attr('y1', zeroY)
        .attr('y2', zeroY)
        .attr('stroke', _ZERO_DELTA_LINE_COLOR)
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', _ZERO_DELTA_DASH_ARRAY);

    const deltaLine = d3
        .line()
        .x((d) => xScale(d.pct))
        .y((d) => deltaYScale(d.delta))
        .curve(d3.curveMonotoneX);

    deltaGroup
        .append('path')
        .datum(series)
        .attr('fill', 'none')
        .attr('stroke', _DELTA_LINE_COLOR)
        .attr('stroke-width', _DELTA_LINE_STROKE_WIDTH_PX)
        .attr('d', deltaLine);

    deltaGroup
        .append('text')
        .attr('x', _DELTA_AHEAD_LABEL_X_PX)
        .attr('y', _DELTA_UPPER_LABEL_Y_PX)
        .attr('fill', strokeStyles.colorA)
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '9.5px')
        .style('font-weight', '700')
        .text(`▲ ${driverAEntry.driver} AHEAD (+Δt)`);

    deltaGroup
        .append('text')
        .attr('x', _DELTA_AHEAD_LABEL_X_PX)
        .attr('y', _DELTA_HEIGHT_PX - _DELTA_LOWER_LABEL_BOTTOM_PAD_PX)
        .attr('fill', strokeStyles.colorB)
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '9.5px')
        .style('font-weight', '700')
        .text(`▼ ${driverBEntry.driver} AHEAD (-Δt)`);

    const deltaAxisGroup = deltaGroup
        .append('g')
        .call(
            d3
                .axisLeft(deltaYScale)
                .ticks(_DELTA_AXIS_TICKS)
                .tickFormat((d) => `${d > 0 ? '+' : ''}${d.toFixed(2)}s`)
                .tickSize(0)
        )
        .call((g) => g.select('.domain').remove());

    _appendVerticalAxisLabel(deltaAxisGroup, _DELTA_HEIGHT_PX, 'Δt (SEC)');

    const bottomAxisGroup = deltaGroup
        .append('g')
        .attr('transform', `translate(0,${_DELTA_HEIGHT_PX})`)
        .call(
            d3
                .axisBottom(xScale)
                .ticks(_DISTANCE_AXIS_TICKS)
                .tickFormat((d) => `${d}%`)
        );

    bottomAxisGroup
        .append('text')
        .attr('x', width)
        .attr('y', _BOTTOM_AXIS_LABEL_Y_OFFSET_PX)
        .attr('fill', 'var(--text-muted)')
        .attr('text-anchor', 'end')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '10.5px')
        .style('font-weight', '700')
        .text('LAP DISTANCE (%)');

    return { deltaYScale, deltaYOffset };
}

/**
 * Creates the synchronized SVG crosshair line and indicator dots across all 3 subplots.
 *
 * @param {Object} mainGroup - Root translated D3 `<g>` selection.
 * @param {number} totalInnerHeight - Combined height of all 3 subplots plus gaps.
 * @param {{colorA: string, colorB: string}} strokeStyles - Pair stroke styles.
 * @returns {{
 *   crosshairGroup: Object,
 *   crosshairLine: Object,
 *   dotSpeedA: Object,
 *   dotSpeedB: Object,
 *   dotPedalA: Object,
 *   dotPedalB: Object,
 *   dotDelta: Object
 * }} D3 selections for the crosshair overlay elements.
 */
function _createCrosshairElements(mainGroup, totalInnerHeight, strokeStyles) {
    const crosshairGroup = mainGroup
        .append('g')
        .attr('class', 'trace-crosshair')
        .style('display', 'none')
        .style('pointer-events', 'none');

    const crosshairLine = crosshairGroup
        .append('line')
        .attr('y1', 0)
        .attr('y2', totalInnerHeight)
        .attr('stroke', _CROSSHAIR_LINE_COLOR)
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', _CROSSHAIR_DASH_ARRAY);

    const dotSpeedA = crosshairGroup
        .append('circle')
        .attr('r', _CROSSHAIR_DOT_RADIUS_PX)
        .attr('fill', strokeStyles.colorA)
        .attr('stroke', _CROSSHAIR_DOT_STROKE_COLOR)
        .attr('stroke-width', _CROSSHAIR_DOT_STROKE_WIDTH_PX);

    const dotSpeedB = crosshairGroup
        .append('circle')
        .attr('r', _CROSSHAIR_DOT_RADIUS_PX)
        .attr('fill', strokeStyles.colorB)
        .attr('stroke', _CROSSHAIR_DOT_STROKE_COLOR)
        .attr('stroke-width', _CROSSHAIR_DOT_STROKE_WIDTH_PX);

    const dotPedalA = crosshairGroup
        .append('circle')
        .attr('r', _CROSSHAIR_PEDAL_DOT_RADIUS_PX)
        .attr('fill', strokeStyles.colorA)
        .attr('stroke', _CROSSHAIR_DOT_STROKE_COLOR)
        .attr('stroke-width', _CROSSHAIR_PEDAL_DOT_STROKE_WIDTH_PX);

    const dotPedalB = crosshairGroup
        .append('circle')
        .attr('r', _CROSSHAIR_PEDAL_DOT_RADIUS_PX)
        .attr('fill', strokeStyles.colorB)
        .attr('stroke', _CROSSHAIR_DOT_STROKE_COLOR)
        .attr('stroke-width', _CROSSHAIR_PEDAL_DOT_STROKE_WIDTH_PX);

    const dotDelta = crosshairGroup
        .append('circle')
        .attr('r', _CROSSHAIR_DOT_RADIUS_PX)
        .attr('fill', _DELTA_LINE_COLOR)
        .attr('stroke', 'var(--bg-dark)')
        .attr('stroke-width', _CROSSHAIR_DOT_STROKE_WIDTH_PX);

    return {
        crosshairGroup,
        crosshairLine,
        dotSpeedA,
        dotSpeedB,
        dotPedalA,
        dotPedalB,
        dotDelta
    };
}

/**
 * Attaches the transparent interactive hover overlay that drives synchronized crosshair scrubbing
 * and tooltip updates across all 3 telemetry subplots.
 *
 * @param {Object} mainGroup - Root translated D3 `<g>` selection.
 * @param {{
 *   width: number,
 *   totalInnerHeight: number,
 *   series: Array<Object>,
 *   turns: Array<{turn: number, pct: number}>,
 *   xScale: Function,
 *   speedYScale: Function,
 *   speedYOffset: number,
 *   pedalYScale: Function,
 *   pedalYOffset: number,
 *   deltaYScale: Function,
 *   deltaYOffset: number,
 *   driverAEntry: Object,
 *   driverBEntry: Object,
 *   strokeStyles: {colorA: string, colorB: string},
 *   baseTraceState: Object,
 *   tooltip: Object
 * }} config - Crosshair interaction configuration and subplot scales.
 * @returns {void}
 */
function _bindTraceHoverCrosshair(mainGroup, config) {
    const {
        width,
        totalInnerHeight,
        series,
        turns,
        xScale,
        speedYScale,
        speedYOffset,
        pedalYScale,
        pedalYOffset,
        deltaYScale,
        deltaYOffset,
        driverAEntry,
        driverBEntry,
        strokeStyles,
        baseTraceState,
        tooltip
    } = config;

    const {
        crosshairGroup,
        crosshairLine,
        dotSpeedA,
        dotSpeedB,
        dotPedalA,
        dotPedalB,
        dotDelta
    } = _createCrosshairElements(mainGroup, totalInnerHeight, strokeStyles);

    const bisectPct = d3.bisector((d) => d.pct).center;

    mainGroup
        .append('rect')
        .attr('width', width)
        .attr('height', totalInnerHeight)
        .attr('fill', 'transparent')
        .style('cursor', 'crosshair')
        .on('mouseover', () => {
            crosshairGroup.style('display', null);
            tooltip.classed('hidden', false);
        })
        .on('mousemove', (event) => {
            const [mouseX] = d3.pointer(event);
            const hoveredPct = xScale.invert(mouseX);
            const index = Math.max(0, Math.min(series.length - 1, bisectPct(series, hoveredPct)));
            const point = series[index];
            const cx = xScale(point.pct);

            crosshairLine.attr('x1', cx).attr('x2', cx);
            dotSpeedA.attr('cx', cx).attr('cy', speedYOffset + speedYScale(point.speedA));
            dotSpeedB.attr('cx', cx).attr('cy', speedYOffset + speedYScale(point.speedB));
            dotPedalA.attr('cx', cx).attr('cy', pedalYOffset + pedalYScale(point.throttleA));
            dotPedalB.attr('cx', cx).attr('cy', pedalYOffset + pedalYScale(point.throttleB));
            dotDelta.attr('cx', cx).attr('cy', deltaYOffset + deltaYScale(point.delta));

            const nearestTurn = _findNearestTurnNumber(turns, point.pct);
            const isDriverAAhead = point.delta >= 0;
            const leadingColor = isDriverAAhead ? strokeStyles.colorA : strokeStyles.colorB;

            _applyTurnMarkerHighlight(mainGroup, nearestTurn);
            setCornerSpeedHighlightedTurn(nearestTurn);
            setCircuitMapTraceState({
                ...baseTraceState,
                hoverSample: {
                    pct: point.pct,
                    speedA: point.speedA,
                    speedB: point.speedB,
                    throttleA: point.throttleA,
                    throttleB: point.throttleB,
                    brakeA: point.brakeA,
                    brakeB: point.brakeB,
                    delta: point.delta,
                    nearestTurn
                }
            });

            _populateTraceTooltip(tooltip.node(), {
                pct: point.pct,
                nearestTurn,
                driverA: driverAEntry,
                driverB: driverBEntry,
                pointA: {
                    speed: point.speedA,
                    throttle: point.throttleA,
                    brake: point.brakeA,
                    cumTime: point.cumTimeA
                },
                pointB: {
                    speed: point.speedB,
                    throttle: point.throttleB,
                    brake: point.brakeB,
                    cumTime: point.cumTimeB
                },
                deltaS: point.delta,
                colorA: strokeStyles.colorA,
                colorB: strokeStyles.colorB
            });

            tooltip
                .classed('hidden', false)
                .style('border-left-color', leadingColor)
                .style('left', `${event.pageX + _TOOLTIP_OFFSET_X_PX}px`)
                .style('top', `${event.pageY + _TOOLTIP_OFFSET_Y_PX}px`);
        })
        .on('mouseout', () => {
            crosshairGroup.style('display', 'none');
            tooltip.classed('hidden', true);
            _applyTurnMarkerHighlight(mainGroup, null);
            setCornerSpeedHighlightedTurn(null);
            setCircuitMapTraceState({
                ...baseTraceState,
                hoverSample: null
            });
        });
}

/**
 * Renders the 3-subplot SVG telemetry comparison for the currently selected Driver A and Driver B.
 *
 * @param {HTMLElement} container - Target `#quali-trace-chart` DOM container.
 * @param {{
 *   driverACode: string,
 *   driverBCode: string,
 *   results: Array<Object>,
 *   resultByDriver: Map<string, Object>,
 *   traces: Object,
 *   colorMap: Map<string, string>,
 *   controlA: Object|null,
 *   controlB: Object|null,
 *   tooltip: Object
 * }} state - Active trace comparison state and lookup maps.
 * @returns {void}
 */
function _renderTraceComparisonChart(container, state) {
    const {
        driverACode,
        driverBCode,
        results,
        resultByDriver,
        traces,
        colorMap,
        controlA,
        controlB,
        tooltip
    } = state;

    container.replaceChildren();

    const driverAEntry = resultByDriver.get(driverACode) || results[0];
    const driverBEntry = resultByDriver.get(driverBCode) || results[1];
    const traceA = traces.drivers[driverAEntry.driver];
    const traceB = traces.drivers[driverBEntry.driver];
    if (!traceA || !traceB) return;

    const strokeStyles = _resolvePairStrokeStyles(driverAEntry, driverBEntry, colorMap);
    _updateControlSwatches(controlA, controlB, strokeStyles);

    const width = Math.max(
        _MIN_CHART_WIDTH_PX,
        container.clientWidth - _CHART_MARGIN.left - _CHART_MARGIN.right
    );
    const totalInnerHeight =
        _SPEED_HEIGHT_PX + _PEDAL_HEIGHT_PX + _DELTA_HEIGHT_PX + _SUBPLOT_GAP_PX * 2;
    const totalSvgHeight = totalInnerHeight + _CHART_MARGIN.top + _CHART_MARGIN.bottom;

    const turns = traces.turns || [];
    const series = _buildTelemetrySeries(traces.distance_pct, traceA, traceB);
    const { dominanceSegments, shareA, shareB } = _computeTrackDominanceSummary(
        series,
        strokeStyles
    );
    const baseTraceState = {
        driverA: driverAEntry.driver,
        driverB: driverBEntry.driver,
        colorA: strokeStyles.colorA,
        colorB: strokeStyles.colorB,
        isSameTeam: strokeStyles.isSameTeam,
        dominanceSegments,
        shareA,
        shareB,
        hoverSample: null
    };
    setCircuitMapTraceState(baseTraceState);

    const svg = d3
        .select(container)
        .append('svg')
        .attr('width', width + _CHART_MARGIN.left + _CHART_MARGIN.right)
        .attr('height', totalSvgHeight);

    const defs = svg.append('defs');
    const mainGroup = svg
        .append('g')
        .attr('transform', `translate(${_CHART_MARGIN.left},${_CHART_MARGIN.top})`);

    const xScale = d3.scaleLinear().domain(_LAP_DISTANCE_DOMAIN).range([0, width]);

    const { speedYScale, speedYOffset } = _renderSpeedSubplot(
        mainGroup,
        series,
        turns,
        xScale,
        width,
        strokeStyles
    );

    const { pedalYScale, pedalYOffset } = _renderThrottleBrakeSubplot(
        mainGroup,
        series,
        turns,
        xScale,
        width,
        strokeStyles
    );

    const { deltaYScale, deltaYOffset } = _renderDeltaSubplot(
        mainGroup,
        defs,
        series,
        turns,
        xScale,
        width,
        driverAEntry,
        driverBEntry,
        strokeStyles
    );

    _highlightedTurnHandler = (turnNumber) => {
        _applyTurnMarkerHighlight(mainGroup, turnNumber);
    };

    _bindTraceHoverCrosshair(mainGroup, {
        width,
        totalInnerHeight,
        series,
        turns,
        xScale,
        speedYScale,
        speedYOffset,
        pedalYScale,
        pedalYOffset,
        deltaYScale,
        deltaYOffset,
        driverAEntry,
        driverBEntry,
        strokeStyles,
        baseTraceState,
        tooltip
    });
}

/**
 * Renders the Fastest Lap Telemetry Trace Comparison chart with 3 synchronized stacked subplots
 * (Speed, Throttle/Brake, and Cumulative Time Delta) and interactive crosshair scrubbing.
 *
 * @param {Object} data - Race telemetry payload containing `qualifying.results` and `qualifying.traces`.
 * @returns {void}
 */
export function renderQualiTrace(data) {
    const container = document.getElementById('quali-trace-chart');
    const controlsContainer = document.getElementById('quali-trace-controls');
    if (!container) return;

    container.replaceChildren();
    if (controlsContainer) controlsContainer.replaceChildren();

    const results = (data.qualifying?.results || [])
        .slice()
        .sort((a, b) => a.grid_pos - b.grid_pos);
    const traces = data.qualifying?.traces;

    const hasValidTraceData =
        results.length >= 2 &&
        Boolean(traces) &&
        Array.isArray(traces.distance_pct) &&
        Boolean(traces.drivers);

    if (!hasValidTraceData) {
        _externalFocusHandler = null;
        _highlightedTurnHandler = null;
        setCircuitMapTraceState(null);
        _renderEmptyState(container, 'No qualifying telemetry traces available.');
        return;
    }

    const colorMap = _buildDriverColorMap(data);
    const resultByDriver = new Map(results.map((r) => [r.driver, r]));
    const tooltip = d3.select('#tooltip');

    let driverACode = results[0].driver;
    let driverBCode = results[1].driver;
    let controlA = null;
    let controlB = null;

    const drawComparison = () => {
        _renderTraceComparisonChart(container, {
            driverACode,
            driverBCode,
            results,
            resultByDriver,
            traces,
            colorMap,
            controlA,
            controlB,
            tooltip
        });
    };

    const controls = _renderTraceSelectorControls(
        controlsContainer,
        results,
        driverACode,
        driverBCode,
        (newDriverA) => {
            driverACode = newDriverA;
            drawComparison();
        },
        (newDriverB) => {
            driverBCode = newDriverB;
            drawComparison();
        }
    );
    controlA = controls.controlA;
    controlB = controls.controlB;

    _externalFocusHandler = (focusedDriverCode) => {
        const shouldSwitchDriverB =
            Boolean(focusedDriverCode) &&
            focusedDriverCode !== driverACode &&
            resultByDriver.has(focusedDriverCode) &&
            Boolean(traces.drivers[focusedDriverCode]);

        if (shouldSwitchDriverB) {
            driverBCode = focusedDriverCode;
            if (controlB) {
                controlB.selectEl.value = focusedDriverCode;
            }
            drawComparison();
        }
    };

    drawComparison();
}
