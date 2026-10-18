const _CHART_MARGIN = { top: 20, right: 78, bottom: 48, left: 74 };
const _ROW_HEIGHT_PX = 23;
const _MIN_CHART_HEIGHT_PX = 420;
const _MIN_CHART_WIDTH_PX = 300;
const _DEFAULT_CONTAINER_WIDTH_PX = 560;

const _SECONDS_PER_MINUTE = 60;
const _DEFAULT_COMPOUND = 'MEDIUM';
const _COMPOUND_COLORS = {
    SOFT: '#FF3333',
    MEDIUM: '#FFE600',
    HARD: '#F0F0F5'
};

const _IQR_BAR_HEIGHT_PX = 8;
const _MIN_IQR_BAND_WIDTH_PX = 4;
const _IQR_BAR_CORNER_RADIUS_PX = 4;
const _IQR_BAR_OPACITY = 0.38;
const _FOCUSED_IQR_BAR_OPACITY = 0.65;

const _OUTER_RING_RADIUS_PX = 6.2;
const _OUTER_RING_STROKE_WIDTH_PX = 2.2;
const _INNER_DOT_RADIUS_PX = 3.2;

const _ACTIVE_OPACITY = 1.0;
const _DIMMED_OPACITY = 0.16;

const _MIN_TIME_SPAN_SECONDS = 0.4;
const _X_DOMAIN_PAD_RATIO = 0.08;
const _RIGHT_DOMAIN_PAD_MULTIPLIER = 1.35;
const _BAND_PADDING_INNER = 0.24;
const _BAND_PADDING_OUTER = 0.12;

const _X_AXIS_TICKS = 6;
const _AXIS_TICK_PADDING_PX = 10;
const _X_AXIS_TITLE_OFFSET_Y_PX = 38;

const _REFERENCE_LINE_COLOR = 'rgba(255, 255, 255, 0.28)';
const _REFERENCE_LINE_STROKE_WIDTH_PX = 1.25;
const _REFERENCE_LINE_DASH_ARRAY = '4,4';

const _GUIDE_LINE_COLOR = 'rgba(255, 255, 255, 0.05)';
const _ROW_HIT_RIGHT_INSET_PX = 8;
const _DELTA_LABEL_OFFSET_X_PX = 8;
const _LEADER_HIGHLIGHT_COLOR = '#4ade80';

const _TOOLTIP_OFFSET_X_PX = 15;
const _TOOLTIP_OFFSET_Y_PX = -28;

let _externalLongRunFocusHandler = null;

/**
 * Sets or clears an external driver focus filter on the Long-Run Race Simulation Pace Ranking chart.
 *
 * @param {string|null} driverCode - Three-letter driver code to highlight, or null to restore.
 * @returns {void}
 */
export function setPracticeLongRunExternalFocus(driverCode) {
    if (_externalLongRunFocusHandler) {
        _externalLongRunFocusHandler(driverCode);
    }
}

/**
 * Formats a lap time in seconds as `m:ss.s` for X-axis tick labels.
 *
 * @param {number} seconds - Lap time in seconds.
 * @returns {string} Formatted lap time string.
 */
function _formatLapTimeAxis(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '';
    const mins = Math.floor(seconds / _SECONDS_PER_MINUTE);
    const secs = (seconds % _SECONDS_PER_MINUTE).toFixed(1).padStart(4, '0');
    return `${mins}:${secs}`;
}

/**
 * Formats a lap time in seconds as `m:ss.sss` for detailed tooltip readouts.
 *
 * @param {number} seconds - Lap time in seconds.
 * @returns {string} Formatted lap time string.
 */
function _formatLapTimeFull(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return 'N/A';
    const mins = Math.floor(seconds / _SECONDS_PER_MINUTE);
    const secs = (seconds % _SECONDS_PER_MINUTE).toFixed(3).padStart(6, '0');
    return `${mins}:${secs}`;
}

/**
 * Filters, sorts, and assigns long-run pace ranks to classification entries.
 *
 * @param {Object} data - Race telemetry payload containing `data.practice`.
 * @returns {Array<Object>} Ranked long-run simulation entries ordered fastest to slowest.
 */
function _prepareLongRunEntries(data) {
    const rawClassification = data?.practice?.classification || [];
    return rawClassification
        .filter((d) => Number.isFinite(d.long_run_avg) && d.long_run_avg > 0)
        .slice()
        .sort((a, b) => a.long_run_avg - b.long_run_avg)
        .map((d, index) => ({
            ...d,
            longRunRank: index + 1
        }));
}

/**
 * Creates horizontal lap-time linear scale and vertical driver band scale for the long-run chart.
 *
 * @param {Array<Object>} sortedEntries - Ranked long-run driver entries.
 * @param {number} width - Inner chart width in pixels.
 * @param {number} height - Inner chart height in pixels.
 * @returns {{xScale: Function, yScale: Function}} D3 scales for X and Y axes.
 */
function _createLongRunScales(sortedEntries, width, height) {
    const minTime = d3.min(sortedEntries, (d) =>
        Number.isFinite(d.long_run_q25) ? Math.min(d.long_run_q25, d.long_run_avg) : d.long_run_avg
    );
    const maxTime = d3.max(sortedEntries, (d) =>
        Number.isFinite(d.long_run_q75) ? Math.max(d.long_run_q75, d.long_run_avg) : d.long_run_avg
    );
    const span = Math.max(_MIN_TIME_SPAN_SECONDS, maxTime - minTime);
    const pad = span * _X_DOMAIN_PAD_RATIO;

    const xScale = d3
        .scaleLinear()
        .domain([minTime - pad, maxTime + pad * _RIGHT_DOMAIN_PAD_MULTIPLIER])
        .range([0, width]);

    const yScale = d3
        .scaleBand()
        .domain(sortedEntries.map((d) => d.driver))
        .range([0, height])
        .paddingInner(_BAND_PADDING_INNER)
        .paddingOuter(_BAND_PADDING_OUTER);

    return { xScale, yScale };
}

/**
 * Renders background gridlines, P1 pace reference line, X-axis, and Y-axis driver labels.
 *
 * @param {Object} svg - D3 selection for the chart's main translated group.
 * @param {Function} xScale - D3 linear scale for long-run lap times.
 * @param {Function} yScale - D3 band scale for driver rows.
 * @param {Array<Object>} sortedEntries - Ranked long-run driver entries.
 * @param {number} fastestAvg - Fastest average long-run lap time in seconds.
 * @param {number} width - Inner chart width in pixels.
 * @param {number} height - Inner chart height in pixels.
 * @returns {Object} D3 selection of Y-axis driver tick labels.
 */
function _renderLongRunAxesAndGrid(svg, xScale, yScale, sortedEntries, fastestAvg, width, height) {
    const rankByDriver = new Map(sortedEntries.map((d) => [d.driver, d.longRunRank]));
    const colorByDriver = new Map(sortedEntries.map((d) => [d.driver, d.color || '#ffffff']));

    svg.append('g')
        .attr('class', 'gridline')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(xScale).tickSize(-height).tickFormat('').ticks(_X_AXIS_TICKS));

    svg.append('line')
        .attr('class', 'p1-reference-line')
        .attr('x1', xScale(fastestAvg))
        .attr('x2', xScale(fastestAvg))
        .attr('y1', 0)
        .attr('y2', height)
        .attr('stroke', _REFERENCE_LINE_COLOR)
        .attr('stroke-width', _REFERENCE_LINE_STROKE_WIDTH_PX)
        .attr('stroke-dasharray', _REFERENCE_LINE_DASH_ARRAY);

    const xAxisGroup = svg
        .append('g')
        .attr('transform', `translate(0,${height})`)
        .call(
            d3
                .axisBottom(xScale)
                .ticks(_X_AXIS_TICKS)
                .tickFormat(_formatLapTimeAxis)
                .tickSize(0)
                .tickPadding(_AXIS_TICK_PADDING_PX)
        )
        .call((g) => g.select('.domain').attr('stroke', 'var(--border-color)'));

    xAxisGroup
        .append('text')
        .attr('x', width)
        .attr('y', _X_AXIS_TITLE_OFFSET_Y_PX)
        .attr('fill', 'var(--text-muted)')
        .attr('text-anchor', 'end')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-weight', '600')
        .style('font-size', '11px')
        .style('letter-spacing', '0.8px')
        .text('HIGH-FUEL LONG RUN PACE (M:SS.S)');

    const yAxisGroup = svg
        .append('g')
        .call(
            d3
                .axisLeft(yScale)
                .tickFormat((code) => `P${rankByDriver.get(code)} ${code}`)
                .tickSize(0)
                .tickPadding(_AXIS_TICK_PADDING_PX)
        )
        .call((g) => g.select('.domain').remove());

    return yAxisGroup
        .selectAll('.tick text')
        .attr('class', 'driver-label')
        .style('fill', (code) => colorByDriver.get(code) || 'var(--text-primary)')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '11px')
        .style('font-weight', '700');
}

/**
 * Renders driver rows including hit targets, horizontal guide lines, IQR spread bars,
 * dual-ring mean pace markers, and right-aligned delta readouts.
 *
 * @param {Object} svg - D3 selection for the chart's main translated group.
 * @param {Array<Object>} sortedEntries - Ranked long-run driver entries.
 * @param {Function} xScale - D3 linear scale for lap times.
 * @param {Function} yScale - D3 band scale for driver rows.
 * @param {number} fastestAvg - Fastest average long-run lap time in seconds.
 * @param {number} width - Inner chart width in pixels.
 * @returns {{rowGroups: Object, iqrBands: Object}} D3 selections for interactive row styling.
 */
function _renderLongRunDriverRows(svg, sortedEntries, xScale, yScale, fastestAvg, width) {
    const rowsGroup = svg.append('g').attr('class', 'longrun-rows');

    const rowGroups = rowsGroup
        .selectAll('g.longrun-driver-row')
        .data(sortedEntries, (d) => d.driver)
        .enter()
        .append('g')
        .attr('class', 'longrun-driver-row')
        .style('cursor', 'pointer');

    rowGroups
        .append('rect')
        .attr('class', 'longrun-row-hit')
        .attr('x', 0)
        .attr('y', (d) => yScale(d.driver))
        .attr('width', width + _CHART_MARGIN.right - _ROW_HIT_RIGHT_INSET_PX)
        .attr('height', yScale.bandwidth())
        .attr('fill', 'transparent');

    rowGroups
        .append('line')
        .attr('class', 'longrun-guide-line')
        .attr('x1', 0)
        .attr('x2', (d) => xScale(d.long_run_q25 || d.long_run_avg))
        .attr('y1', (d) => yScale(d.driver) + yScale.bandwidth() / 2)
        .attr('y2', (d) => yScale(d.driver) + yScale.bandwidth() / 2)
        .attr('stroke', _GUIDE_LINE_COLOR)
        .attr('stroke-width', 1);

    const iqrBands = rowGroups
        .append('rect')
        .attr('class', 'longrun-iqr-band')
        .attr('x', (d) => xScale(d.long_run_q25 || d.long_run_avg))
        .attr('y', (d) => yScale(d.driver) + (yScale.bandwidth() - _IQR_BAR_HEIGHT_PX) / 2)
        .attr('width', (d) => {
            const x1 = xScale(d.long_run_q25 || d.long_run_avg);
            const x2 = xScale(d.long_run_q75 || d.long_run_avg);
            return Math.max(_MIN_IQR_BAND_WIDTH_PX, x2 - x1);
        })
        .attr('height', _IQR_BAR_HEIGHT_PX)
        .attr('rx', _IQR_BAR_CORNER_RADIUS_PX)
        .attr('fill', (d) => d.color || 'var(--accent)')
        .attr('opacity', _IQR_BAR_OPACITY);

    rowGroups
        .append('circle')
        .attr('class', 'longrun-mean-outer')
        .attr('cx', (d) => xScale(d.long_run_avg))
        .attr('cy', (d) => yScale(d.driver) + yScale.bandwidth() / 2)
        .attr('r', _OUTER_RING_RADIUS_PX)
        .attr('fill', 'var(--bg-dark)')
        .attr('stroke', (d) => d.color || '#ffffff')
        .attr('stroke-width', _OUTER_RING_STROKE_WIDTH_PX);

    rowGroups
        .append('circle')
        .attr('class', 'longrun-mean-inner')
        .attr('cx', (d) => xScale(d.long_run_avg))
        .attr('cy', (d) => yScale(d.driver) + yScale.bandwidth() / 2)
        .attr('r', _INNER_DOT_RADIUS_PX)
        .attr(
            'fill',
            (d) =>
                _COMPOUND_COLORS[(d.long_run_compound || _DEFAULT_COMPOUND).toUpperCase()] ||
                _COMPOUND_COLORS.MEDIUM
        );

    rowGroups
        .append('text')
        .attr('class', 'longrun-delta-label')
        .attr('x', width + _DELTA_LABEL_OFFSET_X_PX)
        .attr('y', (d) => yScale(d.driver) + yScale.bandwidth() / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'start')
        .attr('fill', (d, i) => (i === 0 ? _LEADER_HIGHLIGHT_COLOR : 'var(--text-muted)'))
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '10.5px')
        .style('font-weight', (d, i) => (i === 0 ? '700' : '600'))
        .text((d) => {
            const delta = d.long_run_avg - fastestAvg;
            return `+${delta.toFixed(3)}s`;
        });

    return { rowGroups, iqrBands };
}

/**
 * Updates row, IQR band, and Y-axis label opacities for the active driver focus state.
 *
 * @param {Object} rowGroups - D3 selection of driver row groups.
 * @param {Object} iqrBands - D3 selection of IQR spread rectangles.
 * @param {Object} yTickLabels - D3 selection of Y-axis driver labels.
 * @param {string|null} effectiveDriver - Focused driver code, or null.
 * @returns {void}
 */
function _applyLongRunFocusStyles(rowGroups, iqrBands, yTickLabels, effectiveDriver) {
    rowGroups.style('opacity', (d) => {
        if (effectiveDriver === null) return _ACTIVE_OPACITY;
        return d.driver === effectiveDriver ? _ACTIVE_OPACITY : _DIMMED_OPACITY;
    });

    iqrBands.attr('opacity', (d) =>
        d.driver === effectiveDriver ? _FOCUSED_IQR_BAR_OPACITY : _IQR_BAR_OPACITY
    );

    yTickLabels.style('opacity', (code) => {
        if (effectiveDriver === null) return _ACTIVE_OPACITY;
        return code === effectiveDriver ? _ACTIVE_OPACITY : _DIMMED_OPACITY;
    });
}

/**
 * Builds the HTML tooltip content for a hovered long-run driver entry.
 *
 * @param {Object} entry - Ranked long-run driver entry.
 * @param {number} fastestAvg - Fastest average long-run lap time in seconds.
 * @returns {string} Tooltip HTML string.
 */
function _buildLongRunTooltipHtml(entry, fastestAvg) {
    const comp = (entry.long_run_compound || _DEFAULT_COMPOUND).toUpperCase();
    const compColor = _COMPOUND_COLORS[comp] || _COMPOUND_COLORS.MEDIUM;
    const delta = entry.long_run_avg - fastestAvg;
    const iqrSpread = (entry.long_run_q75 || entry.long_run_avg) - (entry.long_run_q25 || entry.long_run_avg);
    const deltaColor = entry.longRunRank === 1 ? _LEADER_HIGHLIGHT_COLOR : 'var(--text-muted)';

    return `
        <div style="font-family: Montserrat, sans-serif; font-weight: 700; margin-bottom: 4px; text-transform: uppercase;">
            P${entry.longRunRank} ${entry.driver} <span style="color: var(--text-muted); font-weight: 600; font-size: 0.75rem;">${entry.team}</span>
        </div>
        <div style="font-size: 0.95rem; font-weight: 700; margin-bottom: 3px;">
            ${_formatLapTimeFull(entry.long_run_avg)} <span style="color: ${deltaColor}; font-size: 0.8rem;">(+${delta.toFixed(3)}s)</span>
        </div>
        <div style="font-size: 0.78rem; color: var(--text-muted); margin-bottom: 4px;">
            IQR Band: ${_formatLapTimeFull(entry.long_run_q25)} &ndash; ${_formatLapTimeFull(entry.long_run_q75)} (&Delta; ${iqrSpread.toFixed(3)}s)
        </div>
        <div style="display: flex; align-items: center; gap: 6px; font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted);">
            <div style="width: 9px; height: 9px; border-radius: 50%; background-color: ${compColor};"></div>
            ${comp} COMPOUND &bull; ${entry.long_run_laps || 0} LONG-RUN LAPS
        </div>
    `;
}

/**
 * Binds hover tooltip and click-lock listeners to long-run driver rows and Y-axis labels.
 *
 * @param {Object} rowGroups - D3 selection of driver row groups.
 * @param {Object} yTickLabels - D3 selection of Y-axis driver labels.
 * @param {Object} tooltip - D3 selection for the shared tooltip element.
 * @param {number} fastestAvg - Fastest average long-run lap time in seconds.
 * @param {{onHover: Function, onToggleLock: Function}} handlers - State update callbacks.
 * @returns {void}
 */
function _bindLongRunInteractions(rowGroups, yTickLabels, tooltip, fastestAvg, handlers) {
    yTickLabels.on('click', (event, code) => {
        handlers.onToggleLock(code);
    });

    rowGroups
        .on('mouseover', (event, d) => {
            handlers.onHover(d.driver);

            tooltip
                .classed('hidden', false)
                .style('border-left-color', d.color || 'var(--accent)')
                .html(_buildLongRunTooltipHtml(d, fastestAvg))
                .style('left', `${event.pageX + _TOOLTIP_OFFSET_X_PX}px`)
                .style('top', `${event.pageY + _TOOLTIP_OFFSET_Y_PX}px`);
        })
        .on('mousemove', (event) => {
            tooltip
                .style('left', `${event.pageX + _TOOLTIP_OFFSET_X_PX}px`)
                .style('top', `${event.pageY + _TOOLTIP_OFFSET_Y_PX}px`);
        })
        .on('mouseout', () => {
            handlers.onHover(null);
            tooltip.classed('hidden', true);
        })
        .on('click', (event, d) => {
            handlers.onToggleLock(d.driver);
        });
}

/**
 * Renders the Long-Run Race Simulation Pace Ranking chart inside `#practice-longrun-chart`.
 *
 * @param {Object} data - Race telemetry payload containing `data.practice`.
 * @returns {void}
 */
export function renderPracticeLongRun(data) {
    const container = document.getElementById('practice-longrun-chart');
    if (!container) return;

    container.innerHTML = '';

    const sortedEntries = _prepareLongRunEntries(data);
    if (sortedEntries.length === 0) {
        _externalLongRunFocusHandler = null;
        container.innerHTML =
            '<p style="color: var(--text-muted); text-align: center; padding-top: 2rem; font-family: Montserrat, sans-serif; text-transform: uppercase;">No long-run simulation data available.</p>';
        return;
    }

    const totalHeight = Math.max(
        _MIN_CHART_HEIGHT_PX,
        sortedEntries.length * _ROW_HEIGHT_PX + _CHART_MARGIN.top + _CHART_MARGIN.bottom
    );
    const rawWidth = container.clientWidth || _DEFAULT_CONTAINER_WIDTH_PX;
    const width = Math.max(_MIN_CHART_WIDTH_PX, rawWidth - _CHART_MARGIN.left - _CHART_MARGIN.right);
    const height = totalHeight - _CHART_MARGIN.top - _CHART_MARGIN.bottom;

    const tooltip = d3.select('#tooltip');
    const fastestAvg = sortedEntries[0].long_run_avg;
    const { xScale, yScale } = _createLongRunScales(sortedEntries, width, height);

    const svg = d3
        .select(container)
        .append('svg')
        .attr('width', width + _CHART_MARGIN.left + _CHART_MARGIN.right)
        .attr('height', height + _CHART_MARGIN.top + _CHART_MARGIN.bottom)
        .append('g')
        .attr('transform', `translate(${_CHART_MARGIN.left},${_CHART_MARGIN.top})`);

    const yTickLabels = _renderLongRunAxesAndGrid(
        svg,
        xScale,
        yScale,
        sortedEntries,
        fastestAvg,
        width,
        height
    );
    const { rowGroups, iqrBands } = _renderLongRunDriverRows(
        svg,
        sortedEntries,
        xScale,
        yScale,
        fastestAvg,
        width
    );

    let hoveredDriver = null;
    let lockedDriver = null;
    let externalDriver = null;

    const refreshStyles = () => {
        const effectiveDriver =
            hoveredDriver !== null
                ? hoveredDriver
                : externalDriver !== null
                  ? externalDriver
                  : lockedDriver;
        _applyLongRunFocusStyles(rowGroups, iqrBands, yTickLabels, effectiveDriver);
    };

    _bindLongRunInteractions(rowGroups, yTickLabels, tooltip, fastestAvg, {
        onHover: (driverCode) => {
            hoveredDriver = driverCode;
            refreshStyles();
        },
        onToggleLock: (driverCode) => {
            lockedDriver = lockedDriver === driverCode ? null : driverCode;
            refreshStyles();
        }
    });

    _externalLongRunFocusHandler = (driverCode) => {
        externalDriver = driverCode;
        refreshStyles();
    };

    refreshStyles();
}
