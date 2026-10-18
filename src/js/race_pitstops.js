import { analyzePitStopTactics } from './race_strategy.js';

const _CHART_MARGIN = { top: 24, right: 265, bottom: 42, left: 102 };
const _MIN_CONTAINER_WIDTH_PX = 360;
const _DEFAULT_CONTAINER_WIDTH_PX = 860;
const _ROW_HEIGHT_PX = 28;
const _MIN_CHART_HEIGHT_PX = 360;
const _BAR_CORNER_RADIUS_PX = 4;
const _MIN_BAR_WIDTH_PX = 4;
const _ROW_INNER_PADDING_RATIO = 0.24;
const _ROW_OUTER_PADDING_RATIO = 0.1;
const _X_DOMAIN_HEADROOM_MULTIPLIER = 1.08;
const _X_AXIS_TICKS = 8;
const _X_AXIS_TITLE_OFFSET_Y_PX = 36;
const _Y_AXIS_TICK_PADDING_PX = 8;
const _MEDIAN_LINE_TOP_OFFSET_PX = -6;
const _MEDIAN_LABEL_Y_OFFSET_PX = -10;
const _MEDIAN_LINE_STROKE_WIDTH_PX = 1.5;
const _MEDIAN_LINE_DASH_ARRAY = '4,4';
const _MEDIAN_LINE_STROKE_COLOR = 'rgba(255, 255, 255, 0.35)';
const _BAR_STROKE_COLOR = '#111118';
const _BAR_HOVER_STROKE_COLOR = '#ffffff';
const _BAR_STROKE_WIDTH_PX = 1;
const _BAR_HOVER_STROKE_WIDTH_PX = 1.8;
const _PILL_OFFSET_X_PX = 8;
const _PILL_OFFSET_Y_PX = -9;
const _PILL_WIDTH_PX = 58;
const _PILL_HEIGHT_PX = 18;
const _PILL_CORNER_RADIUS_PX = 4;
const _PILL_FROM_DOT_CX_PX = 10;
const _PILL_TEXT_X_PX = 29;
const _PILL_TO_DOT_CX_PX = 48;
const _PILL_DOT_RADIUS_PX = 4;
const _READOUT_BACKING_X_PX = 62;
const _READOUT_BACKING_WIDTH_PX = 112;
const _READOUT_BACKING_RADIUS_PX = 3;
const _READOUT_TEXT_X_PX = 66;
const _TACTIC_PILL_X_PX = 178;
const _TACTIC_PILL_WIDTH_PX = 76;
const _TACTIC_DEFAULT_COLOR = '#9ca3af';
const _FASTEST_DELTA_EPSILON_S = 0.001;
const _ACTIVE_OPACITY = 1;
const _RESTING_OPACITY = 0.9;
const _DIMMED_OPACITY = 0.2;
const _DEFAULT_DRIVER_COLOR = '#888888';
const _ROW_TRACK_FILL = 'rgba(255, 255, 255, 0.025)';
const _PILL_BG_FILL = 'rgba(17, 17, 24, 0.96)';
const _PILL_BORDER_STROKE = 'rgba(255, 255, 255, 0.16)';
const _READOUT_BACKING_FILL = 'rgba(21, 21, 30, 0.92)';
const _FASTEST_TEXT_COLOR = '#34d399';
const _DELTA_WARN_TEXT_COLOR = '#facc15';
const _TOOLTIP_OFFSET_X_PX = 15;
const _TOOLTIP_OFFSET_Y_PX = -28;

const _METRIC_STATIONARY = 'stationary_s';
const _METRIC_PIT_LOSS = 'pit_loss_s';

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

let _externalPitStopsFocusHandler = null;

/**
 * Highlights or restores a driver's pit stop bars from an external trigger.
 *
 * @param {string|null} driverCode - Three-letter driver code to highlight, or null to restore.
 * @returns {void}
 */
export function setRacePitStopsExternalFocus(driverCode) {
    if (_externalPitStopsFocusHandler) {
        _externalPitStopsFocusHandler(driverCode);
    }
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
 * Extracts and normalizes pit stop records from `data.race_telemetry.pit_stops`,
 * enriching each stop with its tactical classification from `analyzePitStopTactics`.
 *
 * @param {Object} data - Race telemetry payload.
 * @returns {Array<Object>} Normalized pit stop entries with unique row keys and tactical classifications.
 */
function _resolvePitStops(data) {
    const rawStops =
        data.race_telemetry && Array.isArray(data.race_telemetry.pit_stops)
            ? data.race_telemetry.pit_stops
            : [];

    const driverMetaByCode = new Map((data.drivers || []).map((d) => [d.code, d]));
    const { byKey: tacticsByKey } = analyzePitStopTactics(data);

    return rawStops
        .map((stop, idx) => {
            const meta = driverMetaByCode.get(stop.driver);
            const fromCompound = _normalizeCompound(stop.from_compound);
            const toCompound = _normalizeCompound(stop.to_compound);
            const stopNum = Number(stop.stop_number) || 1;
            const lapNum = Number(stop.lap) || 1;
            const stationary = Number.isFinite(Number(stop.stationary_s))
                ? Number(stop.stationary_s)
                : null;
            const pitLoss = Number.isFinite(Number(stop.pit_loss_s))
                ? Number(stop.pit_loss_s)
                : null;
            const tactic = tacticsByKey.get(`${stop.driver}-${lapNum}`) || {
                category: 'STANDARD',
                badgeLabel: 'HOLD',
                shortBadge: 'HOLD',
                color: _TACTIC_DEFAULT_COLOR,
                detailText: 'Routine tyre service',
                trafficRivals: []
            };

            return {
                id: `${stop.driver}-S${stopNum}-L${lapNum}-${idx}`,
                driver: stop.driver,
                name: stop.name || meta?.name || stop.driver,
                team: stop.team || meta?.team || '',
                color: meta?.color || stop.color || _DEFAULT_DRIVER_COLOR,
                lap: lapNum,
                stop_number: stopNum,
                from_compound: fromCompound,
                to_compound: toCompound,
                stationary_s: stationary,
                pit_loss_s: pitLoss,
                tactic
            };
        })
        .filter(
            (s) =>
                (Number.isFinite(s.stationary_s) && s.stationary_s > 0) ||
                (Number.isFinite(s.pit_loss_s) && s.pit_loss_s > 0)
        );
}

/**
 * Filters stops with a valid metric value, sorts ascending, and keeps each driver's fastest stop.
 *
 * @param {Array<Object>} allStops - Normalized pit stop records.
 * @param {string} activeMetric - Currently selected metric key (`'stationary_s'` or `'pit_loss_s'`).
 * @returns {Array<Object>} Sorted fastest pit stop per driver.
 */
function _selectFastestStopPerDriver(allStops, activeMetric) {
    const sortedAll = allStops
        .filter((s) => Number.isFinite(s[activeMetric]) && s[activeMetric] > 0)
        .slice()
        .sort((a, b) => a[activeMetric] - b[activeMetric]);

    const seenDrivers = new Set();
    return sortedAll.filter((s) => {
        if (seenDrivers.has(s.driver)) return false;
        seenDrivers.add(s.driver);
        return true;
    });
}

/**
 * Builds the metric toggle controls (`Stationary Stop Time` vs `Total Pit-Lane Loss`)
 * inside `#race-pitstops-controls`.
 *
 * @param {HTMLElement|null} controlsContainer - DOM container for the metric toggle buttons.
 * @param {string} activeMetric - Currently selected metric key (`'stationary_s'` or `'pit_loss_s'`).
 * @param {Function} onMetricChange - Callback invoked when the user switches metrics.
 * @returns {void}
 */
function _buildPitStopControls(controlsContainer, activeMetric, onMetricChange) {
    if (!controlsContainer) return;
    controlsContainer.replaceChildren();

    const options = [
        { key: _METRIC_STATIONARY, label: 'Stationary Stop (s)' },
        { key: _METRIC_PIT_LOSS, label: 'Total Pit Loss (s)' }
    ];

    const buttons = [];

    const updateButtonStyles = (currentMetric) => {
        buttons.forEach(({ btn, key }) => {
            const isSelected = key === currentMetric;
            btn.classList.toggle('inactive', !isSelected);
            btn.style.borderColor = isSelected
                ? 'var(--accent)'
                : 'rgba(255, 255, 255, 0.08)';
            btn.style.background = isSelected
                ? 'rgba(225, 6, 0, 0.18)'
                : 'rgba(0, 0, 0, 0.25)';
            btn.style.color = isSelected ? '#ffffff' : 'var(--text-muted)';
        });
    };

    options.forEach(({ key, label }) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'legend-item pitstop-metric-btn';
        btn.style.fontFamily = 'Montserrat, sans-serif';
        btn.style.fontWeight = '700';
        btn.style.cursor = 'pointer';
        btn.textContent = label;

        btn.addEventListener('click', () => {
            updateButtonStyles(key);
            onMetricChange(key);
        });

        buttons.push({ btn, key });
        controlsContainer.appendChild(btn);
    });

    updateButtonStyles(activeMetric);
}

/**
 * Populates the shared `#tooltip` element with pit stop telemetry details and tactical outcome.
 *
 * @param {HTMLElement|null} tooltipNode - DOM node of `#tooltip`.
 * @param {Object} stop - Hovered pit stop entry.
 * @param {number} rank - 1-based rank of this stop for the active metric.
 * @param {number} fastestVal - Fastest value for the active metric.
 * @param {string} activeMetric - Active metric key.
 * @returns {void}
 */
function _populatePitStopTooltip(tooltipNode, stop, rank, fastestVal, activeMetric) {
    if (!tooltipNode) return;

    const headerDiv = document.createElement('div');
    headerDiv.style.fontFamily = 'Montserrat, sans-serif';
    headerDiv.style.fontWeight = '700';
    headerDiv.style.marginBottom = '4px';
    headerDiv.style.textTransform = 'uppercase';
    headerDiv.appendChild(document.createTextNode(`#${rank} ${stop.driver} `));

    const teamSpan = document.createElement('span');
    teamSpan.style.color = 'var(--text-muted)';
    teamSpan.style.fontWeight = '600';
    teamSpan.style.fontSize = '0.75rem';
    teamSpan.textContent = `· ${stop.team}`;
    headerDiv.appendChild(teamSpan);

    const metaDiv = document.createElement('div');
    metaDiv.style.fontSize = '0.8rem';
    metaDiv.style.marginBottom = '4px';
    metaDiv.style.color = 'var(--text-primary)';
    metaDiv.textContent = `Stop #${stop.stop_number} · Lap ${stop.lap} (${stop.from_compound} → ${stop.to_compound})`;

    const stationaryText = Number.isFinite(stop.stationary_s)
        ? `${stop.stationary_s.toFixed(2)}s`
        : 'N/A';
    const pitLossText = Number.isFinite(stop.pit_loss_s)
        ? `${stop.pit_loss_s.toFixed(2)}s`
        : 'N/A';

    const isStationaryActive = activeMetric === _METRIC_STATIONARY;
    const stationaryDiv = document.createElement('div');
    stationaryDiv.style.fontSize = '0.82rem';
    stationaryDiv.style.fontWeight = isStationaryActive ? '700' : '600';
    stationaryDiv.style.color = isStationaryActive ? '#ffffff' : 'var(--text-muted)';
    stationaryDiv.textContent = `Stationary Time: ${stationaryText}`;

    const isPitLossActive = activeMetric === _METRIC_PIT_LOSS;
    const lossDiv = document.createElement('div');
    lossDiv.style.fontSize = '0.82rem';
    lossDiv.style.fontWeight = isPitLossActive ? '700' : '600';
    lossDiv.style.color = isPitLossActive ? '#ffffff' : 'var(--text-muted)';
    lossDiv.textContent = `Total Pit-Lane Loss: ${pitLossText}`;

    const currentVal = stop[activeMetric];
    const delta = Number.isFinite(currentVal) ? currentVal - fastestVal : 0;
    const isFastestStop = delta <= _FASTEST_DELTA_EPSILON_S;
    const deltaDiv = document.createElement('div');
    deltaDiv.style.fontSize = '0.76rem';
    deltaDiv.style.marginTop = '3px';
    deltaDiv.style.fontWeight = '600';
    deltaDiv.style.color = isFastestStop ? _FASTEST_TEXT_COLOR : _DELTA_WARN_TEXT_COLOR;
    deltaDiv.textContent = isFastestStop
        ? 'Fastest Pit Stop of Race'
        : `+${delta.toFixed(2)}s vs Fastest Stop`;

    const children = [headerDiv, metaDiv, stationaryDiv, lossDiv, deltaDiv];

    if (stop.tactic) {
        const tacticWrap = document.createElement('div');
        tacticWrap.style.marginTop = '6px';
        tacticWrap.style.paddingTop = '5px';
        tacticWrap.style.borderTop = '1px solid rgba(255, 255, 255, 0.12)';

        const tacticBadgeRow = document.createElement('div');
        tacticBadgeRow.style.display = 'flex';
        tacticBadgeRow.style.alignItems = 'center';
        tacticBadgeRow.style.gap = '6px';
        tacticBadgeRow.style.marginBottom = '2px';

        const pill = document.createElement('span');
        pill.style.display = 'inline-block';
        pill.style.padding = '1px 6px';
        pill.style.borderRadius = '3px';
        pill.style.fontFamily = 'Montserrat, sans-serif';
        pill.style.fontSize = '0.68rem';
        pill.style.fontWeight = '700';
        pill.style.color = stop.tactic.color || _TACTIC_DEFAULT_COLOR;
        pill.style.border = `1px solid ${stop.tactic.color || _TACTIC_DEFAULT_COLOR}`;
        pill.style.backgroundColor = 'rgba(17, 17, 24, 0.92)';
        pill.textContent = stop.tactic.badgeLabel || 'HOLD';

        const detailSpan = document.createElement('span');
        detailSpan.style.fontSize = '0.75rem';
        detailSpan.style.fontWeight = '600';
        detailSpan.style.color = 'var(--text-primary)';
        detailSpan.textContent = stop.tactic.detailText || '';

        tacticBadgeRow.append(pill, detailSpan);
        tacticWrap.appendChild(tacticBadgeRow);

        const trafficDiv = document.createElement('div');
        trafficDiv.style.fontSize = '0.73rem';
        trafficDiv.style.color = 'var(--text-muted)';
        const rivalsText =
            Array.isArray(stop.tactic.trafficRivals) && stop.tactic.trafficRivals.length > 0
                ? stop.tactic.trafficRivals.join(', ')
                : 'Clear track';
        trafficDiv.textContent = `Pit-Loss Traffic Window: ${rivalsText}`;
        tacticWrap.appendChild(trafficDiv);

        children.push(tacticWrap);
    }

    tooltipNode.replaceChildren(...children);
}

/**
 * Renders a centered status/empty message inside the target container.
 *
 * @param {HTMLElement} container - Chart container element.
 * @param {string} message - Status message text.
 * @returns {void}
 */
function _renderStatusMessage(container, message) {
    const msgEl = document.createElement('p');
    msgEl.style.color = 'var(--text-muted)';
    msgEl.style.textAlign = 'center';
    msgEl.style.paddingTop = '2rem';
    msgEl.style.fontFamily = 'Montserrat, sans-serif';
    msgEl.style.textTransform = 'uppercase';
    msgEl.textContent = message;
    container.replaceChildren(msgEl);
}

/**
 * Renders vertical gridlines, the horizontal duration X-axis, and the vertical driver+lap Y-axis.
 *
 * @param {Object} svg - D3 selection of the chart main `<g>`.
 * @param {Function} xScale - D3 linear scale for stop duration/loss seconds.
 * @param {Function} yScale - D3 band scale for stop IDs.
 * @param {Map<string, Object>} stopById - Lookup map of stop ID to stop descriptor.
 * @param {string} activeMetric - Active metric key.
 * @param {number} width - Inner chart width in pixels.
 * @param {number} height - Inner chart height in pixels.
 * @param {Function} onDriverClick - Callback invoked when a Y-axis driver label is clicked.
 * @returns {Object} D3 selection of Y-axis label `<text>` nodes.
 */
function _renderPitStopAxesAndGrid(
    svg,
    xScale,
    yScale,
    stopById,
    activeMetric,
    width,
    height,
    onDriverClick
) {
    svg.append('g')
        .attr('class', 'gridline')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(xScale).ticks(_X_AXIS_TICKS).tickSize(-height).tickFormat(''));

    const xAxisGroup = svg
        .append('g')
        .attr('transform', `translate(0,${height})`)
        .call(
            d3
                .axisBottom(xScale)
                .ticks(_X_AXIS_TICKS)
                .tickFormat((d) => `${d.toFixed(1)}s`)
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
        .text(
            activeMetric === _METRIC_STATIONARY
                ? 'STATIONARY PIT STOP TIME (SECONDS)'
                : 'TOTAL PIT-LANE LOSS (SECONDS)'
        );

    const yAxisGroup = svg
        .append('g')
        .call(
            d3
                .axisLeft(yScale)
                .tickSize(0)
                .tickPadding(_Y_AXIS_TICK_PADDING_PX)
                .tickFormat((id) => {
                    const s = stopById.get(id);
                    return s ? `${s.driver} · L${s.lap}` : id;
                })
        )
        .call((g) => g.select('.domain').remove());

    return yAxisGroup
        .selectAll('.tick text')
        .datum((id) => stopById.get(id))
        .attr('class', 'driver-label')
        .style('fill', (d) => d?.color || 'var(--text-primary)')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-weight', '700')
        .style('font-size', '11px')
        .style('cursor', 'pointer')
        .on('click', (_event, d) => {
            if (!d) return;
            onDriverClick(d.driver);
        });
}

/**
 * Renders the vertical dashed median reference line and its header readout.
 *
 * @param {Object} svg - D3 selection of the chart main `<g>`.
 * @param {Function} xScale - D3 linear scale for stop duration/loss seconds.
 * @param {number} medianValue - Median metric value in seconds.
 * @param {number} height - Inner chart height in pixels.
 * @returns {void}
 */
function _renderMedianReferenceLine(svg, xScale, medianValue, height) {
    const medianX = xScale(medianValue);

    svg.append('line')
        .attr('x1', medianX)
        .attr('x2', medianX)
        .attr('y1', _MEDIAN_LINE_TOP_OFFSET_PX)
        .attr('y2', height)
        .attr('stroke', _MEDIAN_LINE_STROKE_COLOR)
        .attr('stroke-width', _MEDIAN_LINE_STROKE_WIDTH_PX)
        .attr('stroke-dasharray', _MEDIAN_LINE_DASH_ARRAY);

    svg.append('text')
        .attr('x', medianX)
        .attr('y', _MEDIAN_LABEL_Y_OFFSET_PX)
        .attr('text-anchor', 'middle')
        .attr('fill', 'var(--text-muted)')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '9.5px')
        .style('font-weight', '700')
        .text(`MEDIAN ${medianValue.toFixed(2)}s`);
}

/**
 * Renders the compound transition pill (`from -> to`) and dark-backed duration readout to the right of each bar.
 *
 * @param {Object} rowGroups - D3 selection of `<g class="pitstop-row">` elements.
 * @param {Function} xScale - D3 linear scale for stop duration/loss seconds.
 * @param {Function} yScale - D3 band scale for stop IDs.
 * @param {string} activeMetric - Active metric key.
 * @param {number} fastestValue - Fastest stop duration/loss value in the dataset.
 * @returns {void}
 */
function _renderTransitionPill(rowGroups, xScale, yScale, activeMetric, fastestValue) {
    const pillGroup = rowGroups
        .append('g')
        .attr('class', 'pitstop-transition-pill')
        .attr(
            'transform',
            (d) =>
                `translate(${xScale(d[activeMetric]) + _PILL_OFFSET_X_PX},${
                    yScale(d.id) + yScale.bandwidth() / 2
                })`
        );

    pillGroup
        .append('rect')
        .attr('x', 0)
        .attr('y', _PILL_OFFSET_Y_PX)
        .attr('width', _PILL_WIDTH_PX)
        .attr('height', _PILL_HEIGHT_PX)
        .attr('rx', _PILL_CORNER_RADIUS_PX)
        .attr('fill', _PILL_BG_FILL)
        .attr('stroke', _PILL_BORDER_STROKE)
        .attr('stroke-width', 1);

    pillGroup
        .append('circle')
        .attr('cx', _PILL_FROM_DOT_CX_PX)
        .attr('cy', 0)
        .attr('r', _PILL_DOT_RADIUS_PX)
        .attr(
            'fill',
            (d) => _COMPOUND_COLORS[d.from_compound] || _COMPOUND_COLORS.UNKNOWN
        );

    pillGroup
        .append('text')
        .attr('x', _PILL_TEXT_X_PX)
        .attr('y', 0)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'middle')
        .attr('fill', '#ffffff')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '9px')
        .style('font-weight', '700')
        .text((d) => {
            const fromAbbr = _COMPOUND_ABBREVIATIONS[d.from_compound] || 'U';
            const toAbbr = _COMPOUND_ABBREVIATIONS[d.to_compound] || 'U';
            return `${fromAbbr}→${toAbbr}`;
        });

    pillGroup
        .append('circle')
        .attr('cx', _PILL_TO_DOT_CX_PX)
        .attr('cy', 0)
        .attr('r', _PILL_DOT_RADIUS_PX)
        .attr(
            'fill',
            (d) => _COMPOUND_COLORS[d.to_compound] || _COMPOUND_COLORS.UNKNOWN
        );

    pillGroup
        .append('rect')
        .attr('x', _READOUT_BACKING_X_PX)
        .attr('y', _PILL_OFFSET_Y_PX)
        .attr('width', _READOUT_BACKING_WIDTH_PX)
        .attr('height', _PILL_HEIGHT_PX)
        .attr('rx', _READOUT_BACKING_RADIUS_PX)
        .attr('fill', _READOUT_BACKING_FILL);

    pillGroup
        .append('text')
        .attr('x', _READOUT_TEXT_X_PX)
        .attr('y', 0)
        .attr('dy', '0.35em')
        .attr('fill', (_d, idx) => (idx === 0 ? _FASTEST_TEXT_COLOR : 'var(--text-primary)'))
        .style('font-family', 'Titillium Web, sans-serif')
        .style('font-size', '11.5px')
        .style('font-weight', '700')
        .text((d, idx) => {
            const val = d[activeMetric];
            const delta = val - fastestValue;
            return idx === 0
                ? `${val.toFixed(2)}s (BEST)`
                : `${val.toFixed(2)}s (+${delta.toFixed(2)}s)`;
        });

    pillGroup
        .append('rect')
        .attr('class', 'pitstop-tactic-pill-bg')
        .attr('x', _TACTIC_PILL_X_PX)
        .attr('y', _PILL_OFFSET_Y_PX)
        .attr('width', _TACTIC_PILL_WIDTH_PX)
        .attr('height', _PILL_HEIGHT_PX)
        .attr('rx', _PILL_CORNER_RADIUS_PX)
        .attr('fill', _PILL_BG_FILL)
        .attr('stroke', (d) => d.tactic?.color || _TACTIC_DEFAULT_COLOR)
        .attr('stroke-width', 1.1);

    pillGroup
        .append('text')
        .attr('class', 'pitstop-tactic-pill-text')
        .attr('x', _TACTIC_PILL_X_PX + _TACTIC_PILL_WIDTH_PX / 2)
        .attr('y', 0)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'middle')
        .attr('fill', (d) => d.tactic?.color || _TACTIC_DEFAULT_COLOR)
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '8.5px')
        .style('font-weight', '700')
        .text((d) => d.tactic?.badgeLabel || 'HOLD');
}

/**
 * Renders the horizontal pit stop duration bars and compound transition pills.
 *
 * @param {Object} svg - D3 selection of the chart main `<g>`.
 * @param {Array<Object>} validStops - Deduplicated sorted pit stops.
 * @param {Function} xScale - D3 linear scale for stop duration/loss seconds.
 * @param {Function} yScale - D3 band scale for stop IDs.
 * @param {string} activeMetric - Active metric key.
 * @param {number} fastestValue - Fastest stop duration/loss value.
 * @param {number} width - Inner chart width in pixels.
 * @returns {Object} D3 selection of `<g class="pitstop-row">` elements.
 */
function _renderPitStopBars(
    svg,
    validStops,
    xScale,
    yScale,
    activeMetric,
    fastestValue,
    width
) {
    const barsLayer = svg.append('g').attr('class', 'pitstops-bars-layer');

    const rowGroups = barsLayer
        .selectAll('g.pitstop-row')
        .data(validStops)
        .enter()
        .append('g')
        .attr('class', 'pitstop-row')
        .style('cursor', 'pointer');

    rowGroups
        .append('rect')
        .attr('x', 0)
        .attr('y', (d) => yScale(d.id))
        .attr('width', width)
        .attr('height', yScale.bandwidth())
        .attr('rx', _BAR_CORNER_RADIUS_PX)
        .attr('fill', _ROW_TRACK_FILL);

    rowGroups
        .append('rect')
        .attr('class', 'pitstop-bar')
        .attr('x', 0)
        .attr('y', (d) => yScale(d.id))
        .attr('width', (d) => Math.max(_MIN_BAR_WIDTH_PX, xScale(d[activeMetric])))
        .attr('height', yScale.bandwidth())
        .attr('rx', _BAR_CORNER_RADIUS_PX)
        .attr('fill', (d) => d.color)
        .attr('opacity', _RESTING_OPACITY)
        .attr('stroke', _BAR_STROKE_COLOR)
        .attr('stroke-width', _BAR_STROKE_WIDTH_PX);

    _renderTransitionPill(rowGroups, xScale, yScale, activeMetric, fastestValue);

    return rowGroups;
}

/**
 * Binds hover and tooltip listeners to each pit stop row group.
 *
 * @param {Object} rowGroups - D3 selection of `<g class="pitstop-row">` elements.
 * @param {Array<Object>} validStops - Deduplicated sorted pit stops.
 * @param {number} fastestValue - Fastest stop duration/loss value.
 * @param {string} activeMetric - Active metric key.
 * @param {Object} tooltip - D3 selection of `#tooltip`.
 * @param {Function} onHoverChange - Callback invoked with hovered driver code or null.
 * @returns {void}
 */
function _bindPitStopRowEvents(
    rowGroups,
    validStops,
    fastestValue,
    activeMetric,
    tooltip,
    onHoverChange
) {
    rowGroups
        .on('mouseover', (event, d) => {
            onHoverChange(d.driver);

            d3.select(event.currentTarget)
                .select('rect.pitstop-bar')
                .attr('stroke', _BAR_HOVER_STROKE_COLOR)
                .attr('stroke-width', _BAR_HOVER_STROKE_WIDTH_PX)
                .attr('opacity', _ACTIVE_OPACITY);

            const rank = validStops.indexOf(d) + 1;
            _populatePitStopTooltip(
                tooltip.node(),
                d,
                rank,
                fastestValue,
                activeMetric
            );

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
                .select('rect.pitstop-bar')
                .attr('stroke', _BAR_STROKE_COLOR)
                .attr('stroke-width', _BAR_STROKE_WIDTH_PX)
                .attr('opacity', _RESTING_OPACITY);

            tooltip.classed('hidden', true);
        });
}

/**
 * Applies opacity focus styling to pit stop rows and Y-axis driver labels.
 *
 * @param {Object|null} rowGroups - D3 selection of `<g class="pitstop-row">` elements.
 * @param {Object|null} yAxisLabels - D3 selection of Y-axis label nodes.
 * @param {string|null} effectiveDriver - Currently focused or hovered driver code, or null.
 * @returns {void}
 */
function _applyPitStopFocusStyles(rowGroups, yAxisLabels, effectiveDriver) {
    if (!rowGroups) return;

    rowGroups.style('opacity', (d) =>
        effectiveDriver === null || d.driver === effectiveDriver
            ? _ACTIVE_OPACITY
            : _DIMMED_OPACITY
    );

    if (yAxisLabels) {
        yAxisLabels.style('opacity', (d) =>
            effectiveDriver === null || d?.driver === effectiveDriver
                ? _ACTIVE_OPACITY
                : _DIMMED_OPACITY
        );
    }
}

/**
 * Renders the Pit Stop Duration & Time Loss Ranking horizontal bar chart inside `#race-pitstops-chart`.
 *
 * @param {Object} data - Race telemetry payload containing `drivers` and `race_telemetry.pit_stops`.
 * @returns {void}
 */
export function renderRacePitStops(data) {
    const container = document.getElementById('race-pitstops-chart');
    const controlsContainer = document.getElementById('race-pitstops-controls');
    if (!container) return;

    container.replaceChildren();
    if (controlsContainer) controlsContainer.replaceChildren();

    const allStops = _resolvePitStops(data);
    if (allStops.length === 0) {
        _externalPitStopsFocusHandler = null;
        _renderStatusMessage(container, 'No pit stop telemetry recorded for this race.');
        return;
    }

    const hasStationary = allStops.some(
        (s) => Number.isFinite(s.stationary_s) && s.stationary_s > 0
    );
    let activeMetric = hasStationary ? _METRIC_STATIONARY : _METRIC_PIT_LOSS;
    let externalFocusedDriver = null;
    let localFocusedDriver = null;
    let hoveredDriver = null;

    const tooltip = d3.select('#tooltip');
    let rowGroups = null;
    let yAxisLabels = null;

    const updateFocusStyles = () => {
        const effectiveDriver =
            hoveredDriver !== null
                ? hoveredDriver
                : externalFocusedDriver !== null
                  ? externalFocusedDriver
                  : localFocusedDriver;
        _applyPitStopFocusStyles(rowGroups, yAxisLabels, effectiveDriver);
    };

    const drawChart = () => {
        container.replaceChildren();

        const validStops = _selectFastestStopPerDriver(allStops, activeMetric);
        if (validStops.length === 0) {
            _renderStatusMessage(
                container,
                'Selected pit stop metric is unavailable for this session.'
            );
            return;
        }

        const fastestValue = validStops[0][activeMetric];
        const slowestValue = validStops[validStops.length - 1][activeMetric];
        const medianValue = d3.median(validStops, (d) => d[activeMetric]) || fastestValue;

        const containerWidth = Math.max(
            _MIN_CONTAINER_WIDTH_PX,
            container.clientWidth || _DEFAULT_CONTAINER_WIDTH_PX
        );
        const width = containerWidth - _CHART_MARGIN.left - _CHART_MARGIN.right;
        const height = Math.max(
            _MIN_CHART_HEIGHT_PX - _CHART_MARGIN.top - _CHART_MARGIN.bottom,
            validStops.length * _ROW_HEIGHT_PX
        );

        const xScale = d3
            .scaleLinear()
            .domain([0, slowestValue * _X_DOMAIN_HEADROOM_MULTIPLIER])
            .range([0, width]);

        const yScale = d3
            .scaleBand()
            .domain(validStops.map((d) => d.id))
            .range([0, height])
            .paddingInner(_ROW_INNER_PADDING_RATIO)
            .paddingOuter(_ROW_OUTER_PADDING_RATIO);

        const stopById = new Map(validStops.map((d) => [d.id, d]));

        const svg = d3
            .select(container)
            .append('svg')
            .attr('width', width + _CHART_MARGIN.left + _CHART_MARGIN.right)
            .attr('height', height + _CHART_MARGIN.top + _CHART_MARGIN.bottom)
            .append('g')
            .attr('transform', `translate(${_CHART_MARGIN.left},${_CHART_MARGIN.top})`);

        yAxisLabels = _renderPitStopAxesAndGrid(
            svg,
            xScale,
            yScale,
            stopById,
            activeMetric,
            width,
            height,
            (clickedDriverCode) => {
                localFocusedDriver =
                    localFocusedDriver === clickedDriverCode ? null : clickedDriverCode;
                updateFocusStyles();
            }
        );

        _renderMedianReferenceLine(svg, xScale, medianValue, height);

        rowGroups = _renderPitStopBars(
            svg,
            validStops,
            xScale,
            yScale,
            activeMetric,
            fastestValue,
            width
        );

        _bindPitStopRowEvents(
            rowGroups,
            validStops,
            fastestValue,
            activeMetric,
            tooltip,
            (nextHoveredDriver) => {
                hoveredDriver = nextHoveredDriver;
                updateFocusStyles();
            }
        );

        updateFocusStyles();
    };

    _externalPitStopsFocusHandler = (driverCode) => {
        externalFocusedDriver = driverCode;
        updateFocusStyles();
    };

    _buildPitStopControls(controlsContainer, activeMetric, (nextMetric) => {
        activeMetric = nextMetric;
        drawChart();
    });

    drawChart();
}
