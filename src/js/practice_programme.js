const _CHART_MARGIN = { top: 20, right: 56, bottom: 48, left: 74 };
const _ROW_HEIGHT_PX = 23;
const _MIN_CHART_HEIGHT_PX = 420;
const _MIN_CHART_WIDTH_PX = 300;

const _MODE_COMPOUND = 'compound';
const _MODE_PROGRAMME = 'programme';

const _COMPOUND_SEGMENTS = [
    { key: 'SOFT', label: 'SOFT', color: '#FF3333', textColor: '#ffffff' },
    { key: 'MEDIUM', label: 'MEDIUM', color: '#FFE600', textColor: '#111118' },
    { key: 'HARD', label: 'HARD', color: '#F0F0F5', textColor: '#111118' }
];

const _PROGRAMME_SEGMENTS = [
    {
        key: 'short_run_laps',
        label: 'SHORT PUSH RUNS (<5L)',
        color: '#38bdf8',
        textColor: '#111118'
    },
    {
        key: 'long_run_laps',
        label: 'LONG RACE SIMS (>=5L)',
        color: '#10b981',
        textColor: '#111118'
    }
];

const _MIN_SEGMENT_LABEL_WIDTH_PX = 22;
const _ACTIVE_OPACITY = 1.0;
const _DIMMED_OPACITY = 0.18;

const _TOOLTIP_OFFSET_X_PX = 15;
const _TOOLTIP_OFFSET_Y_PX = -28;

let _externalProgrammeFocusHandler = null;

/**
 * Sets or clears an external driver focus filter on the Practice Programme & Compound Utilisation chart.
 *
 * @param {string|null} driverCode - Three-letter driver code to highlight, or null to restore.
 * @returns {void}
 */
export function setPracticeProgrammeExternalFocus(driverCode) {
    if (_externalProgrammeFocusHandler) {
        _externalProgrammeFocusHandler(driverCode);
    }
}

/**
 * Computes horizontal stacked bar segments for a single driver entry based on the active breakdown mode.
 *
 * @param {Object} entry - Practice classification entry for a driver.
 * @param {'compound'|'programme'} mode - Current breakdown mode.
 * @returns {Array<{key: string, label: string, count: number, start: number, end: number, color: string, textColor: string, driver: string}>} Stacked segment descriptors.
 */
function _computeDriverSegments(entry, mode) {
    const descriptors = mode === _MODE_COMPOUND ? _COMPOUND_SEGMENTS : _PROGRAMME_SEGMENTS;
    let cursor = 0;
    const segments = [];

    descriptors.forEach((desc) => {
        const rawCount =
            mode === _MODE_COMPOUND
                ? (entry.compound_laps && entry.compound_laps[desc.key]) || 0
                : entry[desc.key] || 0;
        const count = Math.max(0, Number(rawCount) || 0);
        if (count > 0) {
            segments.push({
                key: desc.key,
                label: desc.label,
                count,
                start: cursor,
                end: cursor + count,
                color: desc.color,
                textColor: desc.textColor,
                driver: entry.driver
            });
            cursor += count;
        }
    });

    return segments;
}

/**
 * Renders the mode toggle buttons and active segment color swatches inside `#practice-programme-legend`.
 *
 * @param {HTMLElement|null} legendContainer - DOM container for controls and legend.
 * @param {'compound'|'programme'} activeMode - Currently active breakdown mode.
 * @param {Function} onModeChange - Callback invoked when the user switches modes.
 * @returns {void}
 */
function _buildProgrammeLegendControls(legendContainer, activeMode, onModeChange) {
    if (!legendContainer) return;
    legendContainer.innerHTML = '';

    const modes = [
        { id: _MODE_COMPOUND, label: 'BY TYRE COMPOUND' },
        { id: _MODE_PROGRAMME, label: 'BY RUN PROGRAMME' }
    ];

    modes.forEach((m) => {
        const btn = document.createElement('div');
        btn.className = 'legend-item';
        const isSelected = activeMode === m.id;
        btn.style.borderColor = isSelected ? 'var(--accent)' : 'rgba(255, 255, 255, 0.12)';
        btn.style.background = isSelected ? 'rgba(225, 6, 0, 0.18)' : 'rgba(0, 0, 0, 0.25)';
        btn.style.color = isSelected ? '#ffffff' : 'var(--text-muted)';
        btn.style.fontWeight = '700';
        btn.textContent = m.label;

        btn.addEventListener('click', () => {
            if (activeMode !== m.id) {
                onModeChange(m.id);
            }
        });

        legendContainer.appendChild(btn);
    });

    const separator = document.createElement('span');
    separator.style.width = '1px';
    separator.style.height = '14px';
    separator.style.background = 'var(--border-color)';
    separator.style.margin = '0 4px';
    legendContainer.appendChild(separator);

    const activeSwatches =
        activeMode === _MODE_COMPOUND ? _COMPOUND_SEGMENTS : _PROGRAMME_SEGMENTS;

    activeSwatches.forEach((seg) => {
        const pill = document.createElement('div');
        pill.className = 'legend-item';
        pill.style.cursor = 'default';

        const swatch = document.createElement('div');
        swatch.className = 'legend-color';
        swatch.style.backgroundColor = seg.color;
        pill.appendChild(swatch);
        pill.appendChild(document.createTextNode(seg.label));

        legendContainer.appendChild(pill);
    });
}

/**
 * Renders the Practice Programme & Compound Utilisation horizontal stacked bar chart in `#practice-programme-chart`.
 *
 * @param {Object} data - Race telemetry payload containing `data.practice`.
 * @returns {void}
 */
export function renderPracticeProgramme(data) {
    const container = document.getElementById('practice-programme-chart');
    const legendContainer = document.getElementById('practice-programme-legend');
    if (!container) return;

    container.innerHTML = '';
    if (legendContainer) legendContainer.innerHTML = '';

    const practice = data && data.practice;
    const rawClassification = (practice && practice.classification) || [];

    const orderedEntries = rawClassification
        .slice()
        .sort((a, b) => (a.rank || 99) - (b.rank || 99));

    if (orderedEntries.length === 0) {
        _externalProgrammeFocusHandler = null;
        container.innerHTML =
            '<p style="color: var(--text-muted); text-align: center; padding-top: 2rem; font-family: Montserrat, sans-serif; text-transform: uppercase;">No practice programme data available.</p>';
        return;
    }

    const totalHeight = Math.max(
        _MIN_CHART_HEIGHT_PX,
        orderedEntries.length * _ROW_HEIGHT_PX + _CHART_MARGIN.top + _CHART_MARGIN.bottom
    );
    const rawWidth = container.clientWidth || 560;
    const width = Math.max(_MIN_CHART_WIDTH_PX, rawWidth - _CHART_MARGIN.left - _CHART_MARGIN.right);
    const height = totalHeight - _CHART_MARGIN.top - _CHART_MARGIN.bottom;

    const tooltip = d3.select('#tooltip');
    let activeMode = _MODE_COMPOUND;
    let hoveredDriver = null;
    let lockedDriver = null;
    let externalDriver = null;

    const maxTotalLaps = d3.max(orderedEntries, (d) => d.total_laps || 0) || 60;
    const xScale = d3
        .scaleLinear()
        .domain([0, Math.ceil(maxTotalLaps * 1.08)])
        .range([0, width]);

    const yScale = d3
        .scaleBand()
        .domain(orderedEntries.map((d) => d.driver))
        .range([0, height])
        .paddingInner(0.24)
        .paddingOuter(0.12);

    const rankByDriver = new Map(orderedEntries.map((d, idx) => [d.driver, d.rank || idx + 1]));
    const colorByDriver = new Map(orderedEntries.map((d) => [d.driver, d.color || '#ffffff']));

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

    const xAxisGroup = svg
        .append('g')
        .attr('transform', `translate(0,${height})`)
        .call(
            d3
                .axisBottom(xScale)
                .ticks(6)
                .tickFormat((d) => `${d}L`)
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
        .text('TOTAL PRACTICE LAPS COMPLETED');

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

    const barsLayer = svg.append('g').attr('class', 'programme-bars-layer');

    let currentRows = null;

    const refreshStyles = () => {
        const effectiveDriver =
            hoveredDriver !== null
                ? hoveredDriver
                : externalDriver !== null
                  ? externalDriver
                  : lockedDriver;

        if (currentRows) {
            currentRows.style('opacity', (d) => {
                if (effectiveDriver === null) return _ACTIVE_OPACITY;
                return d.driver === effectiveDriver ? _ACTIVE_OPACITY : _DIMMED_OPACITY;
            });
        }

        yTickLabels.style('opacity', (code) => {
            if (effectiveDriver === null) return _ACTIVE_OPACITY;
            return code === effectiveDriver ? _ACTIVE_OPACITY : _DIMMED_OPACITY;
        });
    };

    const drawBars = () => {
        barsLayer.selectAll('*').remove();

        _buildProgrammeLegendControls(legendContainer, activeMode, (nextMode) => {
            activeMode = nextMode;
            drawBars();
        });

        currentRows = barsLayer
            .selectAll('g.programme-driver-row')
            .data(orderedEntries, (d) => d.driver)
            .enter()
            .append('g')
            .attr('class', 'programme-driver-row')
            .style('cursor', 'pointer');

        currentRows
            .append('rect')
            .attr('class', 'programme-row-bg')
            .attr('x', 0)
            .attr('y', (d) => yScale(d.driver))
            .attr('width', width)
            .attr('height', yScale.bandwidth())
            .attr('rx', 3)
            .attr('fill', 'rgba(255, 255, 255, 0.025)');

        currentRows.each(function (driverEntry) {
            const rowGroup = d3.select(this);
            const segments = _computeDriverSegments(driverEntry, activeMode);
            const barY = yScale(driverEntry.driver);
            const barHeight = yScale.bandwidth();

            const segGroups = rowGroup
                .selectAll('g.programme-segment')
                .data(segments, (s) => s.key)
                .enter()
                .append('g')
                .attr('class', 'programme-segment');

            segGroups
                .append('rect')
                .attr('x', (s) => xScale(s.start) + 0.75)
                .attr('y', barY)
                .attr('width', (s) => Math.max(1, xScale(s.end) - xScale(s.start) - 1.5))
                .attr('height', barHeight)
                .attr('rx', 2.5)
                .attr('fill', (s) => s.color)
                .attr('opacity', 0.9);

            segGroups
                .filter((s) => xScale(s.end) - xScale(s.start) >= _MIN_SEGMENT_LABEL_WIDTH_PX)
                .append('text')
                .attr('x', (s) => (xScale(s.start) + xScale(s.end)) / 2)
                .attr('y', barY + barHeight / 2)
                .attr('dy', '0.35em')
                .attr('text-anchor', 'middle')
                .attr('fill', (s) => s.textColor)
                .style('font-family', 'Montserrat, sans-serif')
                .style('font-size', '9.5px')
                .style('font-weight', '800')
                .style('pointer-events', 'none')
                .text((s) => `${s.count}`);

            const totalLaps =
                segments.length > 0
                    ? segments[segments.length - 1].end
                    : driverEntry.total_laps || 0;

            rowGroup
                .append('text')
                .attr('class', 'programme-total-label')
                .attr('x', xScale(totalLaps) + 7)
                .attr('y', barY + barHeight / 2)
                .attr('dy', '0.35em')
                .attr('text-anchor', 'start')
                .attr('fill', 'var(--text-primary)')
                .style('font-family', 'Montserrat, sans-serif')
                .style('font-size', '10.5px')
                .style('font-weight', '700')
                .text(`${totalLaps}L`);
        });

        currentRows
            .on('mouseover', (event, d) => {
                hoveredDriver = d.driver;
                refreshStyles();

                const softCount = (d.compound_laps && d.compound_laps.SOFT) || 0;
                const medCount = (d.compound_laps && d.compound_laps.MEDIUM) || 0;
                const hardCount = (d.compound_laps && d.compound_laps.HARD) || 0;

                tooltip
                    .classed('hidden', false)
                    .style('border-left-color', d.color || 'var(--accent)')
                    .html(`
                        <div style="font-family: Montserrat, sans-serif; font-weight: 700; margin-bottom: 4px; text-transform: uppercase;">
                            P${d.rank} ${d.driver} <span style="color: var(--text-muted); font-weight: 600; font-size: 0.75rem;">${d.team} &bull; ${d.total_laps}L TOTAL</span>
                        </div>
                        <div style="font-size: 0.8rem; margin-bottom: 3px; display: flex; gap: 10px;">
                            <span><strong style="color: #FF3333;">S:</strong> ${softCount}L</span>
                            <span><strong style="color: #FFE600;">M:</strong> ${medCount}L</span>
                            <span><strong style="color: #F0F0F5;">H:</strong> ${hardCount}L</span>
                        </div>
                        <div style="font-size: 0.78rem; color: var(--text-muted);">
                            Short Push (&lt;5L): <strong style="color: #38bdf8;">${d.short_run_laps || 0}L</strong> &bull;
                            Long Sim (&ge;5L): <strong style="color: #10b981;">${d.long_run_laps || 0}L</strong>
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

        refreshStyles();
    };

    yTickLabels.on('click', (event, code) => {
        lockedDriver = lockedDriver === code ? null : code;
        refreshStyles();
    });

    _externalProgrammeFocusHandler = (driverCode) => {
        externalDriver = driverCode;
        refreshStyles();
    };

    drawBars();
}
