const _CHART_MARGIN = { top: 20, right: 78, bottom: 48, left: 74 };
const _ROW_HEIGHT_PX = 23;
const _MIN_CHART_HEIGHT_PX = 420;
const _MIN_CHART_WIDTH_PX = 300;

const _COMPOUND_COLORS = {
    SOFT: '#FF3333',
    MEDIUM: '#FFE600',
    HARD: '#F0F0F5'
};

const _IQR_BAR_HEIGHT_PX = 8;
const _IQR_BAR_OPACITY = 0.38;
const _FOCUSED_IQR_BAR_OPACITY = 0.65;

const _OUTER_RING_RADIUS_PX = 6.2;
const _INNER_DOT_RADIUS_PX = 3.2;

const _ACTIVE_OPACITY = 1.0;
const _DIMMED_OPACITY = 0.16;

const _X_DOMAIN_PAD_RATIO = 0.08;
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
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(1).padStart(4, '0');
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
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(3).padStart(6, '0');
    return `${mins}:${secs}`;
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

    const practice = data && data.practice;
    const rawClassification = (practice && practice.classification) || [];

    const sortedEntries = rawClassification
        .filter((d) => Number.isFinite(d.long_run_avg) && d.long_run_avg > 0)
        .slice()
        .sort((a, b) => a.long_run_avg - b.long_run_avg)
        .map((d, index) => ({
            ...d,
            longRunRank: index + 1
        }));

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
    const rawWidth = container.clientWidth || 560;
    const width = Math.max(_MIN_CHART_WIDTH_PX, rawWidth - _CHART_MARGIN.left - _CHART_MARGIN.right);
    const height = totalHeight - _CHART_MARGIN.top - _CHART_MARGIN.bottom;

    const tooltip = d3.select('#tooltip');
    const fastestAvg = sortedEntries[0].long_run_avg;

    const minTime = d3.min(sortedEntries, (d) =>
        Number.isFinite(d.long_run_q25) ? Math.min(d.long_run_q25, d.long_run_avg) : d.long_run_avg
    );
    const maxTime = d3.max(sortedEntries, (d) =>
        Number.isFinite(d.long_run_q75) ? Math.max(d.long_run_q75, d.long_run_avg) : d.long_run_avg
    );
    const span = Math.max(0.4, maxTime - minTime);
    const pad = span * _X_DOMAIN_PAD_RATIO;

    const xScale = d3
        .scaleLinear()
        .domain([minTime - pad, maxTime + pad * 1.35])
        .range([0, width]);

    const yScale = d3
        .scaleBand()
        .domain(sortedEntries.map((d) => d.driver))
        .range([0, height])
        .paddingInner(0.24)
        .paddingOuter(0.12);

    const rankByDriver = new Map(sortedEntries.map((d) => [d.driver, d.longRunRank]));
    const colorByDriver = new Map(sortedEntries.map((d) => [d.driver, d.color || '#ffffff']));

    const svgRoot = d3
        .select(container)
        .append('svg')
        .attr('width', width + _CHART_MARGIN.left + _CHART_MARGIN.right)
        .attr('height', height + _CHART_MARGIN.top + _CHART_MARGIN.bottom);

    const svg = svgRoot
        .append('g')
        .attr('transform', `translate(${_CHART_MARGIN.left},${_CHART_MARGIN.top})`);

    svg.append('g')
        .attr('class', 'gridline')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(xScale).tickSize(-height).tickFormat('').ticks(6));

    svg.append('line')
        .attr('class', 'p1-reference-line')
        .attr('x1', xScale(fastestAvg))
        .attr('x2', xScale(fastestAvg))
        .attr('y1', 0)
        .attr('y2', height)
        .attr('stroke', 'rgba(225, 6, 0, 0.45)')
        .attr('stroke-width', 1.25)
        .attr('stroke-dasharray', '4,4');

    const xAxisGroup = svg
        .append('g')
        .attr('transform', `translate(0,${height})`)
        .call(
            d3
                .axisBottom(xScale)
                .ticks(6)
                .tickFormat(_formatLapTimeAxis)
                .tickSize(0)
                .tickPadding(10)
        )
        .call((g) => g.select('.domain').attr('stroke', 'var(--border-color)'));

    xAxisGroup
        .append('text')
        .attr('x', width)
        .attr('y', 38)
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
                .tickPadding(10)
        )
        .call((g) => g.select('.domain').remove());

    const yTickLabels = yAxisGroup
        .selectAll('.tick text')
        .attr('class', 'driver-label')
        .style('fill', (code) => colorByDriver.get(code) || 'var(--text-primary)')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '11px')
        .style('font-weight', '700');

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
        .attr('width', width + _CHART_MARGIN.right - 8)
        .attr('height', yScale.bandwidth())
        .attr('fill', 'transparent');

    rowGroups
        .append('line')
        .attr('class', 'longrun-guide-line')
        .attr('x1', 0)
        .attr('x2', (d) => xScale(d.long_run_q25 || d.long_run_avg))
        .attr('y1', (d) => yScale(d.driver) + yScale.bandwidth() / 2)
        .attr('y2', (d) => yScale(d.driver) + yScale.bandwidth() / 2)
        .attr('stroke', 'rgba(255, 255, 255, 0.05)')
        .attr('stroke-width', 1);

    const iqrBands = rowGroups
        .append('rect')
        .attr('class', 'longrun-iqr-band')
        .attr('x', (d) => xScale(d.long_run_q25 || d.long_run_avg))
        .attr('y', (d) => yScale(d.driver) + (yScale.bandwidth() - _IQR_BAR_HEIGHT_PX) / 2)
        .attr('width', (d) => {
            const x1 = xScale(d.long_run_q25 || d.long_run_avg);
            const x2 = xScale(d.long_run_q75 || d.long_run_avg);
            return Math.max(4, x2 - x1);
        })
        .attr('height', _IQR_BAR_HEIGHT_PX)
        .attr('rx', 4)
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
        .attr('stroke-width', 2.2);

    rowGroups
        .append('circle')
        .attr('class', 'longrun-mean-inner')
        .attr('cx', (d) => xScale(d.long_run_avg))
        .attr('cy', (d) => yScale(d.driver) + yScale.bandwidth() / 2)
        .attr('r', _INNER_DOT_RADIUS_PX)
        .attr(
            'fill',
            (d) => _COMPOUND_COLORS[(d.long_run_compound || 'MEDIUM').toUpperCase()] || '#FFE600'
        );

    rowGroups
        .append('text')
        .attr('class', 'longrun-delta-label')
        .attr('x', width + 8)
        .attr('y', (d) => yScale(d.driver) + yScale.bandwidth() / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'start')
        .attr('fill', (d, i) => (i === 0 ? '#4ade80' : 'var(--text-muted)'))
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '10.5px')
        .style('font-weight', (d, i) => (i === 0 ? '700' : '600'))
        .text((d) => {
            const delta = d.long_run_avg - fastestAvg;
            return `+${delta.toFixed(3)}s`;
        });

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
    };

    yTickLabels.on('click', (event, code) => {
        lockedDriver = lockedDriver === code ? null : code;
        refreshStyles();
    });

    rowGroups
        .on('mouseover', (event, d) => {
            hoveredDriver = d.driver;
            refreshStyles();

            const comp = (d.long_run_compound || 'MEDIUM').toUpperCase();
            const compColor = _COMPOUND_COLORS[comp] || '#FFE600';
            const delta = d.long_run_avg - fastestAvg;
            const iqrSpread = (d.long_run_q75 || d.long_run_avg) - (d.long_run_q25 || d.long_run_avg);

            tooltip
                .classed('hidden', false)
                .style('border-left-color', d.color || 'var(--accent)')
                .html(`
                    <div style="font-family: Montserrat, sans-serif; font-weight: 700; margin-bottom: 4px; text-transform: uppercase;">
                        P${d.longRunRank} ${d.driver} <span style="color: var(--text-muted); font-weight: 600; font-size: 0.75rem;">${d.team}</span>
                    </div>
                    <div style="font-size: 0.95rem; font-weight: 700; margin-bottom: 3px;">
                        ${_formatLapTimeFull(d.long_run_avg)} <span style="color: ${d.longRunRank === 1 ? '#4ade80' : 'var(--text-muted)'}; font-size: 0.8rem;">(+${delta.toFixed(3)}s)</span>
                    </div>
                    <div style="font-size: 0.78rem; color: var(--text-muted); margin-bottom: 4px;">
                        IQR Band: ${_formatLapTimeFull(d.long_run_q25)} &ndash; ${_formatLapTimeFull(d.long_run_q75)} (&Delta; ${iqrSpread.toFixed(3)}s)
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px; font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted);">
                        <div style="width: 9px; height: 9px; border-radius: 50%; background-color: ${compColor};"></div>
                        ${comp} COMPOUND &bull; ${d.long_run_laps || 0} LONG-RUN LAPS
                    </div>
                `)
                .style('left', `${event.pageX + _TOOLTIP_OFFSET_X_PX}px`)
                .style('top', `${event.pageY + _TOOLTIP_OFFSET_Y_PX}px`);
        })
        .on('mousemove', (event) => {
            tooltip
                .style('left', `${event.pageX + _TOOLTIP_OFFSET_X_PX}px`)
                .style('top', `${event.pageY + _TOOLTIP_OFFSET_Y_PX}px`);
        })
        .on('mouseout', () => {
            hoveredDriver = null;
            refreshStyles();
            tooltip.classed('hidden', true);
        })
        .on('click', (event, d) => {
            lockedDriver = lockedDriver === d.driver ? null : d.driver;
            refreshStyles();
        });

    _externalLongRunFocusHandler = (driverCode) => {
        externalDriver = driverCode;
        refreshStyles();
    };

    refreshStyles();
}
