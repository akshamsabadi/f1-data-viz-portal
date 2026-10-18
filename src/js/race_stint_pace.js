import { calculateDriverClassification } from './standings.js';

const _CHART_MARGIN = { top: 24, right: 36, bottom: 44, left: 84 };
const _MIN_CONTAINER_WIDTH_PX = 360;
const _DEFAULT_CONTAINER_WIDTH_PX = 860;
const _ROW_HEIGHT_PX = 28;
const _MIN_CHART_HEIGHT_PX = 420;
const _ROW_INNER_PADDING_RATIO = 0.22;
const _ROW_OUTER_PADDING_RATIO = 0.1;
const _ROW_GUIDE_CORNER_RADIUS_PX = 4;
const _NODE_RADIUS_PX = 7.5;
const _NODE_HOVER_RADIUS_PX = 9.5;
const _NODE_STROKE_WIDTH_PX = 1.8;
const _NODE_HOVER_STROKE_WIDTH_PX = 2.2;
const _NODE_STROKE_COLOR = '#111118';
const _NODE_HOVER_STROKE_COLOR = '#ffffff';
const _MAX_VERTICAL_NODE_STEP_PX = 3.2;
const _VERTICAL_STEP_BANDWIDTH_INSET_PX = 10;
const _LINK_STROKE_WIDTH = 2.4;
const _LINK_HOVER_STROKE_WIDTH = 3.6;
const _ACTIVE_OPACITY = 1;
const _DIMMED_OPACITY = 0.18;
const _MIN_STINT_LAPS_FOR_FILTER = 2;
const _IQR_OUTLIER_MULTIPLIER = 2.5;
const _MIN_IQR_SPAN_S = 0.5;
const _MIN_PACE_SPAN_S = 0.8;
const _DEFAULT_MIN_PACE_S = 85;
const _DEFAULT_MAX_PACE_S = 90;
const _DOMAIN_PADDING_RATIO = 0.08;
const _MIN_DOMAIN_PADDING_S = 0.25;
const _X_AXIS_TICKS = 8;
const _X_AXIS_TITLE_OFFSET_Y_PX = 36;
const _Y_AXIS_TICK_PADDING_PX = 10;
const _TOOLTIP_OFFSET_X_PX = 15;
const _TOOLTIP_OFFSET_Y_PX = -28;
const _SECONDS_PER_MINUTE = 60;
const _DEFAULT_FALLBACK_MAX_LAP = 60;
const _FUEL_BURN_CORRECTION_PER_LAP_S = 0.055;
const _DEFAULT_DRIVER_COLOR = '#888888';
const _ROW_GUIDE_FILL = 'rgba(255, 255, 255, 0.025)';
const _FASTER_PACE_COLOR = '#34d399';
const _SLOWER_PACE_COLOR = '#f87171';

const _METRIC_FUEL_CORRECTED = 'fuel_corrected_pace';
const _METRIC_RAW_PACE = 'avg_pace';

const _COMPOUND_COLORS = {
    SOFT: '#FF3333',
    MEDIUM: '#FFE600',
    HARD: '#F0F0F5',
    INTERMEDIATE: '#39B54A',
    WET: '#00AEEF',
    UNKNOWN: '#888888'
};

const _DARK_TEXT_COMPOUNDS = new Set(['MEDIUM', 'HARD', 'INTERMEDIATE']);

let _externalStintPaceFocusHandler = null;

/**
 * Highlights or restores a driver's stint pace progression from an external trigger.
 *
 * @param {string|null} driverCode - Three-letter driver code to highlight, or null to restore.
 * @returns {void}
 */
export function setRaceStintPaceExternalFocus(driverCode) {
    if (_externalStintPaceFocusHandler) {
        _externalStintPaceFocusHandler(driverCode);
    }
}

/**
 * Formats a pace value in seconds as `m:ss.sss (ss.sss s)` or `ss.sss s`.
 *
 * @param {number|null|undefined} paceSeconds - Pace in seconds.
 * @returns {string} Formatted pace string.
 */
function _formatPace(paceSeconds) {
    if (!Number.isFinite(paceSeconds) || paceSeconds <= 0) {
        return 'N/A';
    }
    const minutes = Math.floor(paceSeconds / _SECONDS_PER_MINUTE);
    const rem = (paceSeconds % _SECONDS_PER_MINUTE).toFixed(3);
    if (minutes > 0) {
        return `${minutes}:${rem.padStart(6, '0')} (${paceSeconds.toFixed(3)}s)`;
    }
    return `${paceSeconds.toFixed(3)}s`;
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
 * Derives stint pace records from `data.laps` when `data.race_telemetry.stints` is absent.
 *
 * @param {Object} data - Race telemetry payload.
 * @param {Map<string, Object>} driverMetaByCode - Lookup map of driver code to metadata.
 * @param {number} maxLap - Maximum race lap count.
 * @returns {Array<Object>} Derived stint objects.
 */
function _deriveStintsFromLaps(data, driverMetaByCode, maxLap) {
    const lapsByDriver = d3.group(data.laps || [], (d) => d.driver);
    const derived = [];

    lapsByDriver.forEach((driverLaps, driverCode) => {
        const sorted = driverLaps.slice().sort((a, b) => a.lap - b.lap);
        if (sorted.length === 0) return;

        const meta = driverMetaByCode.get(driverCode) || {
            code: driverCode,
            name: driverCode,
            team: '',
            color: _DEFAULT_DRIVER_COLOR
        };

        let stintNumber = 1;
        let currentCompound = _normalizeCompound(sorted[0].compound);
        let startLap = sorted[0].lap;
        let endLap = sorted[0].lap;
        let bucket = [sorted[0]];

        const flush = () => {
            const validTimes = bucket
                .filter((l) => !l.interpolated && Number.isFinite(l.time) && l.time > 0)
                .map((l) => l.time);
            const avgPace = validTimes.length > 0 ? d3.mean(validTimes) : null;
            const midLap = (startLap + endLap) / 2;
            const remainingLaps = Math.max(0, maxLap - midLap);
            const fuelCorrectedPace =
                avgPace !== null
                    ? avgPace - remainingLaps * _FUEL_BURN_CORRECTION_PER_LAP_S
                    : null;

            derived.push({
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

        for (let i = 1; i < sorted.length; i++) {
            const lapObj = sorted[i];
            const prevObj = sorted[i - 1];
            const nextCompound = _normalizeCompound(lapObj.compound);
            const hasTyreLifeReset =
                Number.isFinite(lapObj.tyre_life) &&
                Number.isFinite(prevObj.tyre_life) &&
                lapObj.tyre_life < prevObj.tyre_life;

            if (nextCompound !== currentCompound || hasTyreLifeReset) {
                flush();
                stintNumber += 1;
                currentCompound = nextCompound;
                startLap = lapObj.lap;
                endLap = lapObj.lap;
                bucket = [lapObj];
            } else {
                endLap = lapObj.lap;
                bucket.push(lapObj);
            }
        }
        flush();
    });

    return derived;
}

/**
 * Resolves and normalizes stint records for pace progression visualization.
 *
 * @param {Object} data - Race telemetry payload.
 * @param {Map<string, Object>} driverMetaByCode - Map of driver code to metadata.
 * @param {number} maxLap - Maximum race lap count.
 * @returns {Array<Object>} Normalized stint entries.
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
        const avgPace = Number.isFinite(Number(stint.avg_pace))
            ? Number(stint.avg_pace)
            : null;
        const fuelPace = Number.isFinite(Number(stint.fuel_corrected_pace))
            ? Number(stint.fuel_corrected_pace)
            : avgPace;

        return {
            ...stint,
            name: stint.name || meta?.name || stint.driver,
            team: stint.team || meta?.team || '',
            color: meta?.color || stint.color || _DEFAULT_DRIVER_COLOR,
            stint: Number(stint.stint) || 1,
            compound: _normalizeCompound(stint.compound),
            start_lap: Number(stint.start_lap) || 1,
            end_lap: Number(stint.end_lap) || 1,
            laps_count: Number(stint.laps_count) || 1,
            avg_pace: avgPace,
            fuel_corrected_pace: fuelPace
        };
    });
}

/**
 * Filters stints with valid pace values for the active metric and removes extreme SC/outlier stints via IQR.
 *
 * @param {Array<Object>} allStints - Normalized stint records.
 * @param {string} activeMetric - Active pace metric key (`'fuel_corrected_pace'` or `'avg_pace'`).
 * @returns {Array<Object>} Filtered stint records suitable for plotting.
 */
function _filterOutlierStints(allStints, activeMetric) {
    const multiLapStints = allStints.filter(
        (s) =>
            Number.isFinite(s[activeMetric]) &&
            s[activeMetric] > 0 &&
            s.laps_count >= _MIN_STINT_LAPS_FOR_FILTER
    );

    const sourceStints =
        multiLapStints.length > 0
            ? multiLapStints
            : allStints.filter(
                  (s) => Number.isFinite(s[activeMetric]) && s[activeMetric] > 0
              );

    if (sourceStints.length === 0) {
        return [];
    }

    const sortedValues = sourceStints
        .map((s) => s[activeMetric])
        .sort(d3.ascending);
    const q1 = d3.quantile(sortedValues, 0.25) ?? sortedValues[0];
    const q3 =
        d3.quantile(sortedValues, 0.75) ?? sortedValues[sortedValues.length - 1];
    const iqr = Math.max(_MIN_IQR_SPAN_S, q3 - q1);
    const maxReasonablePace = q3 + _IQR_OUTLIER_MULTIPLIER * iqr;

    const filteredStints = sourceStints.filter(
        (s) => s[activeMetric] <= maxReasonablePace
    );
    return filteredStints.length > 0 ? filteredStints : sourceStints;
}

/**
 * Groups filtered stints by driver in classification order.
 *
 * @param {Array<Object>} stintsToPlot - Outlier-filtered stint entries.
 * @param {Array<string>} orderedDriverCodes - Driver codes ordered by official classification.
 * @param {Map<string, Object>} driverMetaByCode - Lookup map of driver code to metadata.
 * @returns {{activeDrivers: Array<string>, driverSeries: Array<{driver: string, color: string, stints: Array<Object>}>}} Ordered drivers and per-driver stint series.
 */
function _buildDriverStintSeries(stintsToPlot, orderedDriverCodes, driverMetaByCode) {
    const stintsByDriver = d3.group(stintsToPlot, (s) => s.driver);
    const activeDrivers = orderedDriverCodes.filter((code) =>
        stintsByDriver.has(code)
    );

    const driverSeries = activeDrivers.map((code) => {
        const stints = (stintsByDriver.get(code) || [])
            .slice()
            .sort((a, b) => a.stint - b.stint);
        const meta = driverMetaByCode.get(code);
        return {
            driver: code,
            color: meta?.color || stints[0]?.color || _DEFAULT_DRIVER_COLOR,
            stints
        };
    });

    return { activeDrivers, driverSeries };
}

/**
 * Computes the padded horizontal `[minPace, maxPace]` domain for the active pace metric.
 *
 * @param {Array<Object>} stintsToPlot - Outlier-filtered stint entries.
 * @param {string} activeMetric - Active pace metric key.
 * @returns {[number, number]} Lower and upper pace domain bounds in seconds.
 */
function _computePaceDomain(stintsToPlot, activeMetric) {
    const paceExtent = d3.extent(stintsToPlot, (d) => d[activeMetric]);
    const minPace = paceExtent[0] ?? _DEFAULT_MIN_PACE_S;
    const maxPace = paceExtent[1] ?? _DEFAULT_MAX_PACE_S;
    const paceSpan = Math.max(_MIN_PACE_SPAN_S, maxPace - minPace);
    const domainPad = Math.max(
        _MIN_DOMAIN_PADDING_S,
        paceSpan * _DOMAIN_PADDING_RATIO
    );
    return [minPace - domainPad, maxPace + domainPad];
}

/**
 * Computes the vertical Y coordinate for a stint node within a driver's horizontal band.
 *
 * @param {Function} yScale - D3 band scale for driver codes.
 * @param {string} driverCode - Three-letter driver code.
 * @param {number} stintIndex - 0-based index of the stint for that driver.
 * @param {number} totalStints - Total number of stints for that driver.
 * @returns {number} Vertical Y coordinate in pixels.
 */
function _computeStintNodeY(yScale, driverCode, stintIndex, totalStints) {
    const center = yScale(driverCode) + yScale.bandwidth() / 2;
    if (totalStints <= 1) return center;
    const offsetStep = Math.min(
        _MAX_VERTICAL_NODE_STEP_PX,
        (yScale.bandwidth() - _VERTICAL_STEP_BANDWIDTH_INSET_PX) / totalStints
    );
    return center + (stintIndex - (totalStints - 1) / 2) * offsetStep;
}

/**
 * Builds the pace metric toggle (`Fuel-Corrected Pace` vs `Raw Stint Pace`)
 * inside `#race-stint-pace-controls`.
 *
 * @param {HTMLElement|null} controlsContainer - DOM container for controls.
 * @param {string} activeMetric - Currently active metric key.
 * @param {Function} onMetricChange - Callback invoked when the user switches pace metrics.
 * @returns {void}
 */
function _buildStintPaceControls(controlsContainer, activeMetric, onMetricChange) {
    if (!controlsContainer) return;
    controlsContainer.replaceChildren();

    const options = [
        { key: _METRIC_FUEL_CORRECTED, label: 'Fuel-Corrected Pace' },
        { key: _METRIC_RAW_PACE, label: 'Raw Stint Pace' }
    ];

    const buttons = [];

    const updateButtonStyles = (currentMetric) => {
        buttons.forEach(({ btn, key }) => {
            const isSelected = key === currentMetric;
            btn.classList.toggle('inactive', !isSelected);
            btn.style.borderColor = isSelected
                ? 'rgba(255, 255, 255, 0.35)'
                : 'rgba(255, 255, 255, 0.08)';
            btn.style.background = isSelected
                ? 'rgba(255, 255, 255, 0.1)'
                : 'rgba(0, 0, 0, 0.25)';
            btn.style.color = isSelected ? '#ffffff' : 'var(--text-muted)';
        });
    };

    options.forEach(({ key, label }) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'legend-item stint-pace-metric-btn';
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
 * Populates the shared `#tooltip` element with stint pace progression details.
 *
 * @param {HTMLElement|null} tooltipNode - DOM node of `#tooltip`.
 * @param {Object} stint - Hovered stint entry.
 * @param {Object|null} prevStint - Previous stint for the same driver, if any.
 * @param {string} activeMetric - Currently selected metric key.
 * @returns {void}
 */
function _populateStintPaceTooltip(tooltipNode, stint, prevStint, activeMetric) {
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

    const badgeRow = document.createElement('div');
    badgeRow.style.display = 'flex';
    badgeRow.style.alignItems = 'center';
    badgeRow.style.gap = '6px';
    badgeRow.style.fontSize = '0.8rem';
    badgeRow.style.fontWeight = '700';
    badgeRow.style.marginBottom = '4px';
    badgeRow.style.textTransform = 'uppercase';

    const dot = document.createElement('span');
    dot.style.display = 'inline-block';
    dot.style.width = '10px';
    dot.style.height = '10px';
    dot.style.borderRadius = '50%';
    dot.style.backgroundColor = compoundColor;
    dot.style.border = '1px solid rgba(255, 255, 255, 0.35)';
    badgeRow.appendChild(dot);
    badgeRow.appendChild(
        document.createTextNode(
            `Stint ${stint.stint} · ${stint.compound} (L${stint.start_lap}–L${stint.end_lap}, ${stint.laps_count}L)`
        )
    );

    const isFuelCorrectedActive = activeMetric === _METRIC_FUEL_CORRECTED;
    const fuelDiv = document.createElement('div');
    fuelDiv.style.fontSize = '0.82rem';
    fuelDiv.style.fontWeight = isFuelCorrectedActive ? '700' : '600';
    fuelDiv.style.color = isFuelCorrectedActive
        ? _FASTER_PACE_COLOR
        : 'var(--text-muted)';
    fuelDiv.textContent = `Fuel-Corrected: ${_formatPace(stint.fuel_corrected_pace)}`;

    const isRawPaceActive = activeMetric === _METRIC_RAW_PACE;
    const rawDiv = document.createElement('div');
    rawDiv.style.fontSize = '0.82rem';
    rawDiv.style.fontWeight = isRawPaceActive ? '700' : '600';
    rawDiv.style.color = isRawPaceActive ? '#ffffff' : 'var(--text-muted)';
    rawDiv.textContent = `Raw Stint Pace: ${_formatPace(stint.avg_pace)}`;

    const children = [headerDiv, badgeRow, fuelDiv, rawDiv];

    const hasComparablePrevStint =
        Boolean(prevStint) &&
        Number.isFinite(stint[activeMetric]) &&
        Number.isFinite(prevStint[activeMetric]);

    if (hasComparablePrevStint) {
        const delta = stint[activeMetric] - prevStint[activeMetric];
        const isFasterOrEqual = delta <= 0;
        const deltaDiv = document.createElement('div');
        deltaDiv.style.fontSize = '0.76rem';
        deltaDiv.style.fontWeight = '600';
        deltaDiv.style.marginTop = '3px';
        deltaDiv.style.color = isFasterOrEqual
            ? _FASTER_PACE_COLOR
            : _SLOWER_PACE_COLOR;
        const sign = delta > 0 ? '+' : '';
        deltaDiv.textContent = `Δ vs Stint ${prevStint.stint}: ${sign}${delta.toFixed(3)}s (${
            isFasterOrEqual ? 'faster' : 'slower'
        })`;
        children.push(deltaDiv);
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
 * Renders vertical pace gridlines and horizontal driver row background guides.
 *
 * @param {Object} svg - D3 selection of the chart main `<g>`.
 * @param {Function} xScale - D3 linear scale for stint pace in seconds.
 * @param {Function} yScale - D3 band scale for driver codes.
 * @param {Array<string>} activeDrivers - Ordered list of active driver codes.
 * @param {number} width - Inner chart width in pixels.
 * @param {number} height - Inner chart height in pixels.
 * @returns {void}
 */
function _renderStintPaceGridAndRowGuides(
    svg,
    xScale,
    yScale,
    activeDrivers,
    width,
    height
) {
    svg.append('g')
        .attr('class', 'gridline')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(xScale).ticks(_X_AXIS_TICKS).tickSize(-height).tickFormat(''));

    svg.append('g')
        .attr('class', 'stint-pace-row-guides')
        .selectAll('rect.row-guide')
        .data(activeDrivers)
        .enter()
        .append('rect')
        .attr('class', 'row-guide')
        .attr('x', 0)
        .attr('y', (code) => yScale(code))
        .attr('width', width)
        .attr('height', yScale.bandwidth())
        .attr('rx', _ROW_GUIDE_CORNER_RADIUS_PX)
        .attr('fill', _ROW_GUIDE_FILL);
}

/**
 * Renders the horizontal pace X-axis and vertical driver classification Y-axis.
 *
 * @param {Object} svg - D3 selection of the chart main `<g>`.
 * @param {Function} xScale - D3 linear scale for stint pace in seconds.
 * @param {Function} yScale - D3 band scale for driver codes.
 * @param {Map<string, number>} rankByDriver - Lookup map of driver code to classification rank.
 * @param {Map<string, Object>} driverMetaByCode - Lookup map of driver code to metadata.
 * @param {string} activeMetric - Active pace metric key.
 * @param {number} width - Inner chart width in pixels.
 * @param {number} height - Inner chart height in pixels.
 * @param {Function} onDriverClick - Callback invoked when a driver label is clicked.
 * @returns {Object} D3 selection of Y-axis label `<text>` nodes.
 */
function _renderStintPaceAxes(
    svg,
    xScale,
    yScale,
    rankByDriver,
    driverMetaByCode,
    activeMetric,
    width,
    height,
    onDriverClick
) {
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
            activeMetric === _METRIC_FUEL_CORRECTED
                ? '◀ FASTER · FUEL-CORRECTED STINT PACE (S) · SLOWER ▶'
                : '◀ FASTER · RAW AVERAGE STINT PACE (S) · SLOWER ▶'
        );

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
        .style(
            'fill',
            (code) => driverMetaByCode.get(code)?.color || 'var(--text-primary)'
        )
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-weight', '700')
        .style('font-size', '11px')
        .style('cursor', 'pointer')
        .on('click', (_event, code) => {
            onDriverClick(code);
        });
}

/**
 * Renders the circular compound nodes and stint numbers for a single driver row.
 *
 * @param {Object} rowGroup - D3 selection for a single `<g class="driver-stint-row">`.
 * @param {Object} series - Driver stint series object.
 * @param {Function} xScale - D3 linear scale for stint pace in seconds.
 * @param {Function} yScale - D3 band scale for driver codes.
 * @param {string} activeMetric - Active pace metric key.
 * @param {Object} tooltip - D3 selection of `#tooltip`.
 * @param {Function} onHoverChange - Callback invoked with hovered driver code or null.
 * @returns {void}
 */
function _renderDriverStintNodes(
    rowGroup,
    series,
    xScale,
    yScale,
    activeMetric,
    tooltip,
    onHoverChange
) {
    const nodeData = series.stints.map((stintObj, idx) => ({
        stintObj,
        prevStintObj: idx > 0 ? series.stints[idx - 1] : null,
        x: xScale(stintObj[activeMetric]),
        y: _computeStintNodeY(yScale, series.driver, idx, series.stints.length)
    }));

    const nodes = rowGroup
        .selectAll('g.stint-pace-node')
        .data(nodeData)
        .enter()
        .append('g')
        .attr('class', 'stint-pace-node')
        .attr('transform', (d) => `translate(${d.x},${d.y})`)
        .style('cursor', 'pointer');

    nodes
        .append('circle')
        .attr('r', _NODE_RADIUS_PX)
        .attr(
            'fill',
            (d) =>
                _COMPOUND_COLORS[d.stintObj.compound] ||
                _COMPOUND_COLORS.UNKNOWN
        )
        .attr('stroke', _NODE_STROKE_COLOR)
        .attr('stroke-width', _NODE_STROKE_WIDTH_PX);

    nodes
        .append('text')
        .attr('dy', '0.35em')
        .attr('text-anchor', 'middle')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '9px')
        .style('font-weight', '800')
        .style('pointer-events', 'none')
        .attr('fill', (d) =>
            _DARK_TEXT_COMPOUNDS.has(d.stintObj.compound)
                ? _NODE_STROKE_COLOR
                : '#ffffff'
        )
        .text((d) => d.stintObj.stint);

    nodes
        .on('mouseover', (event, d) => {
            onHoverChange(series.driver);

            d3.select(event.currentTarget)
                .raise()
                .select('circle')
                .attr('r', _NODE_HOVER_RADIUS_PX)
                .attr('stroke', _NODE_HOVER_STROKE_COLOR)
                .attr('stroke-width', _NODE_HOVER_STROKE_WIDTH_PX);

            _populateStintPaceTooltip(
                tooltip.node(),
                d.stintObj,
                d.prevStintObj,
                activeMetric
            );

            tooltip
                .classed('hidden', false)
                .style('border-left-color', series.color || 'var(--accent)')
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
                .select('circle')
                .attr('r', _NODE_RADIUS_PX)
                .attr('stroke', _NODE_STROKE_COLOR)
                .attr('stroke-width', _NODE_STROKE_WIDTH_PX);

            tooltip.classed('hidden', true);
        });
}

/**
 * Renders all driver stint progression rows (connecting lines and compound nodes).
 *
 * @param {Object} svg - D3 selection of the chart main `<g>`.
 * @param {Array<Object>} driverSeries - Per-driver stint series array.
 * @param {Function} xScale - D3 linear scale for stint pace in seconds.
 * @param {Function} yScale - D3 band scale for driver codes.
 * @param {string} activeMetric - Active pace metric key.
 * @param {Object} tooltip - D3 selection of `#tooltip`.
 * @param {Function} onHoverChange - Callback invoked with hovered driver code or null.
 * @returns {Object} D3 selection of `<g class="driver-stint-row">` elements.
 */
function _renderDriverStintRows(
    svg,
    driverSeries,
    xScale,
    yScale,
    activeMetric,
    tooltip,
    onHoverChange
) {
    const rowsLayer = svg.append('g').attr('class', 'stint-pace-rows');

    const driverRowGroups = rowsLayer
        .selectAll('g.driver-stint-row')
        .data(driverSeries)
        .enter()
        .append('g')
        .attr('class', 'driver-stint-row');

    const lineGen = d3
        .line()
        .x((d) => xScale(d.stintObj[activeMetric]))
        .y((d) => d.y);

    driverRowGroups
        .append('path')
        .attr('class', 'stint-connector-line')
        .attr('fill', 'none')
        .attr('stroke', (d) => d.color)
        .attr('stroke-width', _LINK_STROKE_WIDTH)
        .attr('stroke-linecap', 'round')
        .attr('d', (d) => {
            if (d.stints.length < 2) return null;
            const pts = d.stints.map((stintObj, idx) => ({
                stintObj,
                y: _computeStintNodeY(yScale, d.driver, idx, d.stints.length)
            }));
            return lineGen(pts);
        });

    driverRowGroups.each(function (series) {
        _renderDriverStintNodes(
            d3.select(this),
            series,
            xScale,
            yScale,
            activeMetric,
            tooltip,
            onHoverChange
        );
    });

    return driverRowGroups;
}

/**
 * Applies opacity and connector line width focus styles for the active driver.
 *
 * @param {Object|null} driverRowGroups - D3 selection of `<g class="driver-stint-row">` elements.
 * @param {Object|null} yAxisLabels - D3 selection of Y-axis driver label nodes.
 * @param {string|null} effectiveDriver - Currently focused or hovered driver code, or null.
 * @returns {void}
 */
function _applyStintPaceFocusStyles(driverRowGroups, yAxisLabels, effectiveDriver) {
    if (!driverRowGroups) return;

    driverRowGroups.style('opacity', (d) =>
        effectiveDriver === null || d.driver === effectiveDriver
            ? _ACTIVE_OPACITY
            : _DIMMED_OPACITY
    );

    driverRowGroups
        .select('path.stint-connector-line')
        .attr('stroke-width', (d) =>
            effectiveDriver !== null && d.driver === effectiveDriver
                ? _LINK_HOVER_STROKE_WIDTH
                : _LINK_STROKE_WIDTH
        );

    if (yAxisLabels) {
        yAxisLabels.style('opacity', (code) =>
            effectiveDriver === null || code === effectiveDriver
                ? _ACTIVE_OPACITY
                : _DIMMED_OPACITY
        );
    }
}

/**
 * Renders the Fuel-Corrected Stint Pace Progression chart inside `#race-stint-pace-chart`.
 *
 * @param {Object} data - Race telemetry payload containing `drivers`, `laps`, and `race_telemetry`.
 * @returns {void}
 */
export function renderRaceStintPace(data) {
    const container = document.getElementById('race-stint-pace-chart');
    const controlsContainer = document.getElementById('race-stint-pace-controls');
    if (!container) return;

    container.replaceChildren();
    if (controlsContainer) controlsContainer.replaceChildren();

    const { classification, maxLap } = calculateDriverClassification(data);
    const driverMetaByCode = new Map((data.drivers || []).map((d) => [d.code, d]));
    const allStints = _resolveStints(
        data,
        driverMetaByCode,
        maxLap || _DEFAULT_FALLBACK_MAX_LAP
    );

    if (allStints.length === 0) {
        _externalStintPaceFocusHandler = null;
        _renderStatusMessage(
            container,
            'No stint pace telemetry available for this race.'
        );
        return;
    }

    const orderedDriverCodes =
        classification.length > 0
            ? classification.map((c) => c.code)
            : Array.from(new Set(allStints.map((s) => s.driver)));

    const rankByDriver = new Map(
        orderedDriverCodes.map((code, idx) => [code, idx + 1])
    );

    let activeMetric = _METRIC_FUEL_CORRECTED;
    let externalFocusedDriver = null;
    let localFocusedDriver = null;
    let hoveredDriver = null;

    const tooltip = d3.select('#tooltip');
    let driverRowGroups = null;
    let yAxisLabels = null;

    const updateFocusStyles = () => {
        const effectiveDriver =
            hoveredDriver !== null
                ? hoveredDriver
                : externalFocusedDriver !== null
                  ? externalFocusedDriver
                  : localFocusedDriver;
        _applyStintPaceFocusStyles(driverRowGroups, yAxisLabels, effectiveDriver);
    };

    const drawChart = () => {
        container.replaceChildren();

        const stintsToPlot = _filterOutlierStints(allStints, activeMetric);
        if (stintsToPlot.length === 0) {
            _renderStatusMessage(container, 'No valid stint pace values available.');
            return;
        }

        const { activeDrivers, driverSeries } = _buildDriverStintSeries(
            stintsToPlot,
            orderedDriverCodes,
            driverMetaByCode
        );

        const paceDomain = _computePaceDomain(stintsToPlot, activeMetric);

        const containerWidth = Math.max(
            _MIN_CONTAINER_WIDTH_PX,
            container.clientWidth || _DEFAULT_CONTAINER_WIDTH_PX
        );
        const width = containerWidth - _CHART_MARGIN.left - _CHART_MARGIN.right;
        const height = Math.max(
            _MIN_CHART_HEIGHT_PX - _CHART_MARGIN.top - _CHART_MARGIN.bottom,
            activeDrivers.length * _ROW_HEIGHT_PX
        );

        const xScale = d3.scaleLinear().domain(paceDomain).range([0, width]);
        const yScale = d3
            .scaleBand()
            .domain(activeDrivers)
            .range([0, height])
            .paddingInner(_ROW_INNER_PADDING_RATIO)
            .paddingOuter(_ROW_OUTER_PADDING_RATIO);

        const svg = d3
            .select(container)
            .append('svg')
            .attr('width', width + _CHART_MARGIN.left + _CHART_MARGIN.right)
            .attr('height', height + _CHART_MARGIN.top + _CHART_MARGIN.bottom)
            .append('g')
            .attr('transform', `translate(${_CHART_MARGIN.left},${_CHART_MARGIN.top})`);

        _renderStintPaceGridAndRowGuides(
            svg,
            xScale,
            yScale,
            activeDrivers,
            width,
            height
        );

        yAxisLabels = _renderStintPaceAxes(
            svg,
            xScale,
            yScale,
            rankByDriver,
            driverMetaByCode,
            activeMetric,
            width,
            height,
            (clickedDriverCode) => {
                localFocusedDriver =
                    localFocusedDriver === clickedDriverCode ? null : clickedDriverCode;
                updateFocusStyles();
            }
        );

        driverRowGroups = _renderDriverStintRows(
            svg,
            driverSeries,
            xScale,
            yScale,
            activeMetric,
            tooltip,
            (nextHoveredDriver) => {
                hoveredDriver = nextHoveredDriver;
                updateFocusStyles();
            }
        );

        updateFocusStyles();
    };

    _externalStintPaceFocusHandler = (driverCode) => {
        externalFocusedDriver = driverCode;
        updateFocusStyles();
    };

    _buildStintPaceControls(controlsContainer, activeMetric, (nextMetric) => {
        activeMetric = nextMetric;
        drawChart();
    });

    drawChart();
}
