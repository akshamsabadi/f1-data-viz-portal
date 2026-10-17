const _CHART_MARGIN = { top: 24, right: 28, bottom: 38, left: 62 };
const _SPEED_HEIGHT_PX = 145;
const _PEDAL_HEIGHT_PX = 95;
const _DELTA_HEIGHT_PX = 90;
const _SUBPLOT_GAP_PX = 26;
const _MIN_CHART_WIDTH_PX = 320;
const _SAME_TEAM_ACCENT_COLOR = '#facc15';
const _SAME_TEAM_ALT_COLOR = '#38bdf8';
const _SAME_TEAM_DASH_ARRAY = '6,3';
const _BRAKE_DASH_ARRAY = '2,3';
const _TOOLTIP_OFFSET_X_PX = 15;
const _TOOLTIP_OFFSET_Y_PX = -28;

let _externalFocusHandler = null;

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
 *   sameTeam: boolean
 * }} Visual stroke descriptors for Driver A and Driver B.
 */
function _resolvePairStrokeStyles(driverAEntry, driverBEntry, colorMap) {
    const colorA = colorMap.get(driverAEntry.driver) || driverAEntry.color || '#e10600';
    let colorB = colorMap.get(driverBEntry.driver) || driverBEntry.color || '#38bdf8';

    const sameTeam =
        driverAEntry.team === driverBEntry.team ||
        colorA.toLowerCase() === colorB.toLowerCase();

    if (sameTeam) {
        const normalizedA = colorA.toLowerCase();
        colorB =
            normalizedA === _SAME_TEAM_ACCENT_COLOR || normalizedA === '#eab308'
                ? _SAME_TEAM_ALT_COLOR
                : _SAME_TEAM_ACCENT_COLOR;
    }

    return {
        colorA,
        colorB,
        dashB: sameTeam ? _SAME_TEAM_DASH_ARRAY : 'none',
        sameTeam
    };
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
    selectEl.style.backgroundColor = '#111118';
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
    arrowEl.style.borderTop = '5px solid var(--accent)';

    selectWrap.appendChild(selectEl);
    selectWrap.appendChild(arrowEl);

    wrapper.appendChild(labelEl);
    wrapper.appendChild(swatchEl);
    wrapper.appendChild(selectWrap);

    return { wrapper, selectEl, swatchEl };
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

    const buildDriverRow = (entry, pt, color) => {
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
        right.textContent = `${pt.speed.toFixed(1)} km/h | Thr ${pt.throttle.toFixed(0)}% | Brk ${pt.brake.toFixed(0)}%`;

        row.appendChild(left);
        row.appendChild(right);
        return row;
    };

    const deltaRow = document.createElement('div');
    deltaRow.style.marginTop = '5px';
    deltaRow.style.paddingTop = '4px';
    deltaRow.style.borderTop = '1px solid rgba(255, 255, 255, 0.1)';
    deltaRow.style.fontSize = '0.8rem';
    deltaRow.style.fontWeight = '700';

    const absDelta = Math.abs(deltaS).toFixed(3);
    if (Math.abs(deltaS) < 0.0005) {
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
        buildDriverRow(driverA, pointA, colorA),
        buildDriverRow(driverB, pointB, colorB),
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
 * @param {boolean} showLabels - Whether to render `T1..TN` text labels along the top of the subplot.
 * @returns {void}
 */
function _renderTurnLines(group, turns, xScale, height, showLabels) {
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
        .attr('stroke', 'rgba(255, 255, 255, 0.12)')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '3,3');

    if (showLabels) {
        turnGroup
            .selectAll('text.turn-label')
            .data(turns)
            .enter()
            .append('text')
            .attr('class', 'turn-label')
            .attr('x', (d) => xScale(d.pct))
            .attr('y', -6)
            .attr('text-anchor', 'middle')
            .attr('fill', 'var(--text-muted)')
            .style('font-family', 'Montserrat, sans-serif')
            .style('font-size', '9.5px')
            .style('font-weight', '700')
            .text((d) => `T${d.turn}`);
    }
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

    if (
        results.length < 2 ||
        !traces ||
        !Array.isArray(traces.distance_pct) ||
        !traces.drivers
    ) {
        _externalFocusHandler = null;
        const emptyMsg = document.createElement('p');
        emptyMsg.style.color = 'var(--text-muted)';
        emptyMsg.style.textAlign = 'center';
        emptyMsg.style.paddingTop = '2rem';
        emptyMsg.style.fontFamily = 'Montserrat, sans-serif';
        emptyMsg.style.textTransform = 'uppercase';
        emptyMsg.textContent = 'No qualifying telemetry traces available.';
        container.replaceChildren(emptyMsg);
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
        container.replaceChildren();

        const driverAEntry = resultByDriver.get(driverACode) || results[0];
        const driverBEntry = resultByDriver.get(driverBCode) || results[1];
        const traceA = traces.drivers[driverAEntry.driver];
        const traceB = traces.drivers[driverBEntry.driver];
        if (!traceA || !traceB) return;

        const { colorA, colorB, dashB, sameTeam } = _resolvePairStrokeStyles(
            driverAEntry,
            driverBEntry,
            colorMap
        );

        if (controlA && controlB) {
            controlA.swatchEl.style.borderTopColor = colorA;
            controlA.swatchEl.style.borderTopStyle = 'solid';
            controlB.swatchEl.style.borderTopColor = colorB;
            controlB.swatchEl.style.borderTopStyle = sameTeam ? 'dashed' : 'solid';
        }

        const width = Math.max(
            _MIN_CHART_WIDTH_PX,
            container.clientWidth - _CHART_MARGIN.left - _CHART_MARGIN.right
        );
        const totalInnerHeight =
            _SPEED_HEIGHT_PX + _PEDAL_HEIGHT_PX + _DELTA_HEIGHT_PX + _SUBPLOT_GAP_PX * 2;
        const totalSvgHeight = totalInnerHeight + _CHART_MARGIN.top + _CHART_MARGIN.bottom;

        const distancePct = traces.distance_pct;
        const turns = traces.turns || [];

        const series = distancePct.map((pct, i) => {
            const speedA = traceA.speed[i] ?? 0;
            const speedB = traceB.speed[i] ?? 0;
            const throttleA = traceA.throttle[i] ?? 0;
            const throttleB = traceB.throttle[i] ?? 0;
            const brakeA = traceA.brake[i] ?? 0;
            const brakeB = traceB.brake[i] ?? 0;
            const cumTimeA = traceA.cum_time[i] ?? 0;
            const cumTimeB = traceB.cum_time[i] ?? 0;
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

        const svg = d3
            .select(container)
            .append('svg')
            .attr('width', width + _CHART_MARGIN.left + _CHART_MARGIN.right)
            .attr('height', totalSvgHeight);

        const defs = svg.append('defs');
        const clipAboveId = `quali-delta-above-${driverAEntry.driver}-${driverBEntry.driver}`;
        const clipBelowId = `quali-delta-below-${driverAEntry.driver}-${driverBEntry.driver}`;

        const mainGroup = svg
            .append('g')
            .attr('transform', `translate(${_CHART_MARGIN.left},${_CHART_MARGIN.top})`);

        const xScale = d3.scaleLinear().domain([0, 100]).range([0, width]);

        const speedYOffset = 0;
        const pedalYOffset = _SPEED_HEIGHT_PX + _SUBPLOT_GAP_PX;
        const deltaYOffset = _SPEED_HEIGHT_PX + _PEDAL_HEIGHT_PX + _SUBPLOT_GAP_PX * 2;

        // 1. Speed Subplot
        const speedGroup = mainGroup
            .append('g')
            .attr('transform', `translate(0,${speedYOffset})`);

        const allSpeeds = series.flatMap((d) => [d.speedA, d.speedB]);
        const minSpeed = Math.max(60, Math.floor((d3.min(allSpeeds) || 100) - 12));
        const maxSpeed = Math.ceil((d3.max(allSpeeds) || 340) + 10);
        const speedYScale = d3
            .scaleLinear()
            .domain([minSpeed, maxSpeed])
            .range([_SPEED_HEIGHT_PX, 0]);

        speedGroup
            .append('g')
            .attr('class', 'gridline')
            .call(d3.axisLeft(speedYScale).ticks(5).tickSize(-width).tickFormat(''));

        _renderTurnLines(speedGroup, turns, xScale, _SPEED_HEIGHT_PX, true);

        speedGroup
            .append('g')
            .call(d3.axisLeft(speedYScale).ticks(5).tickSize(0))
            .call((g) => g.select('.domain').remove())
            .append('text')
            .attr('transform', 'rotate(-90)')
            .attr('x', -_SPEED_HEIGHT_PX / 2)
            .attr('y', -44)
            .attr('fill', 'var(--text-muted)')
            .attr('text-anchor', 'middle')
            .style('font-family', 'Montserrat, sans-serif')
            .style('font-size', '10px')
            .style('font-weight', '700')
            .text('SPEED (KM/H)');

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
            .attr('stroke', colorA)
            .attr('stroke-width', 2.2)
            .attr('d', speedLineA);

        speedGroup
            .append('path')
            .datum(series)
            .attr('fill', 'none')
            .attr('stroke', colorB)
            .attr('stroke-width', 2.2)
            .attr('stroke-dasharray', dashB)
            .attr('d', speedLineB);

        // 2. Throttle & Brake Subplot
        const pedalGroup = mainGroup
            .append('g')
            .attr('transform', `translate(0,${pedalYOffset})`);

        const pedalYScale = d3.scaleLinear().domain([0, 100]).range([_PEDAL_HEIGHT_PX, 0]);

        pedalGroup
            .append('g')
            .attr('class', 'gridline')
            .call(d3.axisLeft(pedalYScale).ticks(3).tickSize(-width).tickFormat(''));

        _renderTurnLines(pedalGroup, turns, xScale, _PEDAL_HEIGHT_PX, false);

        pedalGroup
            .append('g')
            .call(
                d3
                    .axisLeft(pedalYScale)
                    .tickValues([0, 50, 100])
                    .tickFormat((d) => `${d}%`)
                    .tickSize(0)
            )
            .call((g) => g.select('.domain').remove())
            .append('text')
            .attr('transform', 'rotate(-90)')
            .attr('x', -_PEDAL_HEIGHT_PX / 2)
            .attr('y', -44)
            .attr('fill', 'var(--text-muted)')
            .attr('text-anchor', 'middle')
            .style('font-family', 'Montserrat, sans-serif')
            .style('font-size', '10px')
            .style('font-weight', '700')
            .text('THR / BRK (%)');

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
            .attr('fill', colorA)
            .attr('fill-opacity', 0.1)
            .attr('d', brakeAreaA);

        pedalGroup
            .append('path')
            .datum(series)
            .attr('fill', colorB)
            .attr('fill-opacity', 0.1)
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
            .attr('stroke', colorA)
            .attr('stroke-width', 1.9)
            .attr('d', throttleLineA);

        pedalGroup
            .append('path')
            .datum(series)
            .attr('fill', 'none')
            .attr('stroke', colorB)
            .attr('stroke-width', 1.9)
            .attr('stroke-dasharray', dashB)
            .attr('d', throttleLineB);

        pedalGroup
            .append('path')
            .datum(series)
            .attr('fill', 'none')
            .attr('stroke', colorA)
            .attr('stroke-width', 1.35)
            .attr('stroke-dasharray', _BRAKE_DASH_ARRAY)
            .attr('opacity', 0.85)
            .attr('d', brakeLineA);

        pedalGroup
            .append('path')
            .datum(series)
            .attr('fill', 'none')
            .attr('stroke', colorB)
            .attr('stroke-width', 1.35)
            .attr('stroke-dasharray', _BRAKE_DASH_ARRAY)
            .attr('opacity', 0.85)
            .attr('d', brakeLineB);

        // 3. Cumulative Time Delta Subplot (cum_time_B - cum_time_A)
        const deltaGroup = mainGroup
            .append('g')
            .attr('transform', `translate(0,${deltaYOffset})`);

        const maxAbsDelta = Math.max(
            0.15,
            d3.max(series, (d) => Math.abs(d.delta)) || 0.25
        );
        const paddedDeltaBound = maxAbsDelta * 1.18;

        const deltaYScale = d3
            .scaleLinear()
            .domain([-paddedDeltaBound, paddedDeltaBound])
            .range([_DELTA_HEIGHT_PX, 0]);

        const zeroY = deltaYScale(0);

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
            .call(d3.axisLeft(deltaYScale).ticks(3).tickSize(-width).tickFormat(''));

        _renderTurnLines(deltaGroup, turns, xScale, _DELTA_HEIGHT_PX, false);

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
            .attr('fill', colorA)
            .attr('fill-opacity', 0.24)
            .attr('d', deltaArea);

        deltaGroup
            .append('path')
            .datum(series)
            .attr('clip-path', `url(#${clipBelowId})`)
            .attr('fill', colorB)
            .attr('fill-opacity', 0.24)
            .attr('d', deltaArea);

        deltaGroup
            .append('line')
            .attr('x1', 0)
            .attr('x2', width)
            .attr('y1', zeroY)
            .attr('y2', zeroY)
            .attr('stroke', 'rgba(255, 255, 255, 0.4)')
            .attr('stroke-width', 1)
            .attr('stroke-dasharray', '4,3');

        const deltaLine = d3
            .line()
            .x((d) => xScale(d.pct))
            .y((d) => deltaYScale(d.delta))
            .curve(d3.curveMonotoneX);

        deltaGroup
            .append('path')
            .datum(series)
            .attr('fill', 'none')
            .attr('stroke', '#ffffff')
            .attr('stroke-width', 1.8)
            .attr('d', deltaLine);

        deltaGroup
            .append('text')
            .attr('x', 8)
            .attr('y', 12)
            .attr('fill', colorA)
            .style('font-family', 'Montserrat, sans-serif')
            .style('font-size', '9.5px')
            .style('font-weight', '700')
            .text(`▲ ${driverAEntry.driver} AHEAD (+Δt)`);

        deltaGroup
            .append('text')
            .attr('x', 8)
            .attr('y', _DELTA_HEIGHT_PX - 5)
            .attr('fill', colorB)
            .style('font-family', 'Montserrat, sans-serif')
            .style('font-size', '9.5px')
            .style('font-weight', '700')
            .text(`▼ ${driverBEntry.driver} AHEAD (-Δt)`);

        deltaGroup
            .append('g')
            .call(
                d3
                    .axisLeft(deltaYScale)
                    .ticks(3)
                    .tickFormat((d) => `${d > 0 ? '+' : ''}${d.toFixed(2)}s`)
                    .tickSize(0)
            )
            .call((g) => g.select('.domain').remove())
            .append('text')
            .attr('transform', 'rotate(-90)')
            .attr('x', -_DELTA_HEIGHT_PX / 2)
            .attr('y', -44)
            .attr('fill', 'var(--text-muted)')
            .attr('text-anchor', 'middle')
            .style('font-family', 'Montserrat, sans-serif')
            .style('font-size', '10px')
            .style('font-weight', '700')
            .text('Δt (SEC)');

        const bottomAxisGroup = deltaGroup
            .append('g')
            .attr('transform', `translate(0,${_DELTA_HEIGHT_PX})`)
            .call(
                d3
                    .axisBottom(xScale)
                    .ticks(10)
                    .tickFormat((d) => `${d}%`)
            );

        bottomAxisGroup
            .append('text')
            .attr('x', width)
            .attr('y', 32)
            .attr('fill', 'var(--text-muted)')
            .attr('text-anchor', 'end')
            .style('font-family', 'Montserrat, sans-serif')
            .style('font-size', '10.5px')
            .style('font-weight', '700')
            .text('LAP DISTANCE (%)');

        // Synchronized Interactive Crosshair Layer
        const crosshairGroup = mainGroup
            .append('g')
            .attr('class', 'trace-crosshair')
            .style('display', 'none')
            .style('pointer-events', 'none');

        const crosshairLine = crosshairGroup
            .append('line')
            .attr('y1', 0)
            .attr('y2', totalInnerHeight)
            .attr('stroke', 'rgba(255, 255, 255, 0.65)')
            .attr('stroke-width', 1)
            .attr('stroke-dasharray', '3,3');

        const dotSpeedA = crosshairGroup
            .append('circle')
            .attr('r', 4)
            .attr('fill', colorA)
            .attr('stroke', '#ffffff')
            .attr('stroke-width', 1.5);

        const dotSpeedB = crosshairGroup
            .append('circle')
            .attr('r', 4)
            .attr('fill', colorB)
            .attr('stroke', '#ffffff')
            .attr('stroke-width', 1.5);

        const dotPedalA = crosshairGroup
            .append('circle')
            .attr('r', 3.5)
            .attr('fill', colorA)
            .attr('stroke', '#ffffff')
            .attr('stroke-width', 1.2);

        const dotPedalB = crosshairGroup
            .append('circle')
            .attr('r', 3.5)
            .attr('fill', colorB)
            .attr('stroke', '#ffffff')
            .attr('stroke-width', 1.2);

        const dotDelta = crosshairGroup
            .append('circle')
            .attr('r', 4)
            .attr('fill', '#ffffff')
            .attr('stroke', 'var(--bg-dark)')
            .attr('stroke-width', 1.5);

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

                let nearestTurn = null;
                for (let i = 0; i < turns.length; i += 1) {
                    if (Math.abs(turns[i].pct - point.pct) <= 2.2) {
                        nearestTurn = turns[i].turn;
                        break;
                    }
                }

                const leadingColor = point.delta >= 0 ? colorA : colorB;
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
                    colorA,
                    colorB
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
            });
    };

    if (controlsContainer) {
        controlsContainer.style.display = 'flex';
        controlsContainer.style.alignItems = 'center';
        controlsContainer.style.gap = '0.85rem';
        controlsContainer.style.flexWrap = 'wrap';

        controlA = _createDriverSelectControl('DRIVER A', results, driverACode, (newDriverA) => {
            driverACode = newDriverA;
            drawComparison();
        });

        const vsBadge = document.createElement('span');
        vsBadge.style.fontFamily = 'Montserrat, sans-serif';
        vsBadge.style.fontSize = '0.7rem';
        vsBadge.style.fontWeight = '700';
        vsBadge.style.color = 'var(--accent)';
        vsBadge.style.padding = '0.15rem 0.4rem';
        vsBadge.style.borderRadius = '4px';
        vsBadge.style.background = 'rgba(225, 6, 0, 0.12)';
        vsBadge.style.border = '1px solid rgba(225, 6, 0, 0.3)';
        vsBadge.textContent = 'VS';

        controlB = _createDriverSelectControl('DRIVER B', results, driverBCode, (newDriverB) => {
            driverBCode = newDriverB;
            drawComparison();
        });

        controlsContainer.appendChild(controlA.wrapper);
        controlsContainer.appendChild(vsBadge);
        controlsContainer.appendChild(controlB.wrapper);
    }

    _externalFocusHandler = (focusedDriverCode) => {
        if (
            focusedDriverCode &&
            focusedDriverCode !== driverACode &&
            resultByDriver.has(focusedDriverCode) &&
            traces.drivers[focusedDriverCode]
        ) {
            driverBCode = focusedDriverCode;
            if (controlB) {
                controlB.selectEl.value = focusedDriverCode;
            }
            drawComparison();
        }
    };

    drawComparison();
}
