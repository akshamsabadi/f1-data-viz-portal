const _CHART_MARGIN = { top: 32, right: 96, bottom: 42, left: 78 };
const _ROW_HEIGHT_PX = 26;
const _MIN_CHART_WIDTH_PX = 520;
const _ACTIVE_OPACITY = 1;
const _DIMMED_OPACITY = 0.16;
const _TOOLTIP_OFFSET_X_PX = 15;
const _TOOLTIP_OFFSET_Y_PX = -28;

const _SECTOR_STATUS_COLORS = {
    purple: '#b138ff',
    green: '#00d27a',
    yellow: '#ffb800'
};

let _externalFocusHandler = null;

/**
 * Highlights or restores a driver's sector dominance and ideal lap row from an external trigger.
 *
 * @param {string|null} driverCode - Three-letter driver code to highlight, or null to restore.
 * @returns {void}
 */
export function setQualiSectorsExternalFocus(driverCode) {
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
 * Resolves the FIA sector status hex color (`purple`, `green`, or `yellow`).
 *
 * @param {string|undefined} status - Sector status string.
 * @returns {string} Hex color code.
 */
function _getSectorStatusColor(status) {
    const key = String(status || 'yellow').toLowerCase();
    return _SECTOR_STATUS_COLORS[key] || _SECTOR_STATUS_COLORS.yellow;
}

/**
 * Resolves driver team colors from `data.drivers` and `data.qualifying.results`.
 *
 * @param {Object} data - Race telemetry payload.
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
 * Renders the FIA Sector Dominance color legend inside `#quali-sectors-legend`.
 *
 * @param {HTMLElement|null} legendContainer - DOM container for the legend items.
 * @returns {void}
 */
function _buildSectorsLegend(legendContainer) {
    if (!legendContainer) return;

    const items = [
        { label: 'OVERALL FASTEST (PURPLE)', color: _SECTOR_STATUS_COLORS.purple },
        { label: 'PERSONAL BEST (GREEN)', color: _SECTOR_STATUS_COLORS.green },
        { label: 'OFF PERSONAL BEST (YELLOW)', color: _SECTOR_STATUS_COLORS.yellow }
    ];

    items.forEach(({ label, color }) => {
        const item = document.createElement('div');
        item.className = 'legend-item';
        item.style.cursor = 'default';

        const swatch = document.createElement('div');
        swatch.className = 'legend-color';
        swatch.style.backgroundColor = color;

        item.appendChild(swatch);
        item.appendChild(document.createTextNode(label));
        legendContainer.appendChild(item);
    });
}

/**
 * Populates the shared `#tooltip` element with a driver's sector-by-sector and ideal lap breakdown.
 *
 * @param {HTMLElement|null} tooltipNode - Shared `#tooltip` DOM node.
 * @param {Object} entry - Qualifying result record for a driver.
 * @param {string} teamColor - Driver's constructor hex color.
 * @returns {void}
 */
function _populateSectorsTooltip(tooltipNode, entry, teamColor) {
    if (!tooltipNode) return;

    const header = document.createElement('div');
    header.style.fontFamily = 'Montserrat, sans-serif';
    header.style.fontWeight = '700';
    header.style.marginBottom = '5px';
    header.style.textTransform = 'uppercase';
    header.appendChild(document.createTextNode(`P${entry.grid_pos} ${entry.driver} `));

    const teamSpan = document.createElement('span');
    teamSpan.style.color = 'var(--text-muted)';
    teamSpan.style.fontWeight = '600';
    teamSpan.style.fontSize = '0.75rem';
    teamSpan.textContent = entry.team;
    header.appendChild(teamSpan);

    const buildSectorLine = (num, actualS, idealS, status) => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.gap = '14px';
        row.style.fontSize = '0.8rem';
        row.style.marginBottom = '2px';

        const statusColor = _getSectorStatusColor(status);
        const loss = Math.max(0, (actualS || 0) - (idealS || 0));

        const left = document.createElement('span');
        left.style.fontWeight = '700';
        left.style.color = statusColor;
        left.textContent = `SECTOR ${num} (${String(status).toUpperCase()})`;

        const right = document.createElement('span');
        right.style.fontWeight = '600';
        right.textContent =
            loss > 0.0005
                ? `${actualS.toFixed(3)}s (Ideal ${idealS.toFixed(3)}s, +${loss.toFixed(3)}s)`
                : `${actualS.toFixed(3)}s (Optimal)`;

        row.appendChild(left);
        row.appendChild(right);
        return row;
    };

    const lapCompare = document.createElement('div');
    lapCompare.style.marginTop = '5px';
    lapCompare.style.paddingTop = '4px';
    lapCompare.style.borderTop = '1px solid rgba(255, 255, 255, 0.1)';
    lapCompare.style.fontSize = '0.8rem';
    lapCompare.style.fontWeight = '600';
    lapCompare.textContent = `Ideal: ${_formatLapTime(entry.ideal_lap)} → Actual: ${_formatLapTime(entry.best_time)}`;

    const potentialLine = document.createElement('div');
    potentialLine.style.fontSize = '0.8rem';
    potentialLine.style.fontWeight = '700';
    potentialLine.style.marginTop = '2px';
    const timeLeft = Math.max(0, entry.time_left_on_table ?? entry.best_time - entry.ideal_lap);
    potentialLine.style.color = timeLeft <= 0.015 ? '#00d27a' : '#ffb800';
    potentialLine.textContent = `Time Left on Table: +${timeLeft.toFixed(3)}s potential (${(timeLeft * 1000).toFixed(0)} ms)`;

    tooltipNode.replaceChildren(
        header,
        buildSectorLine(1, entry.s1, entry.ideal_s1, entry.s1_status),
        buildSectorLine(2, entry.s2, entry.ideal_s2, entry.s2_status),
        buildSectorLine(3, entry.s3, entry.ideal_s3, entry.s3_status),
        lapCompare,
        potentialLine
    );
}

/**
 * Renders the Sector Dominance (Purple/Green/Yellow) & Ideal vs. Actual Lap Breakdown chart.
 *
 * @param {Object} data - Race telemetry payload containing `qualifying.results`.
 * @returns {void}
 */
export function renderQualiSectors(data) {
    const container = document.getElementById('quali-sectors-chart');
    const legendContainer = document.getElementById('quali-sectors-legend');
    if (!container) return;

    container.replaceChildren();
    if (legendContainer) legendContainer.replaceChildren();

    const results = (data.qualifying?.results || [])
        .slice()
        .sort((a, b) => a.grid_pos - b.grid_pos);

    if (results.length === 0) {
        _externalFocusHandler = null;
        const emptyMsg = document.createElement('p');
        emptyMsg.style.color = 'var(--text-muted)';
        emptyMsg.style.textAlign = 'center';
        emptyMsg.style.paddingTop = '2rem';
        emptyMsg.style.fontFamily = 'Montserrat, sans-serif';
        emptyMsg.style.textTransform = 'uppercase';
        emptyMsg.textContent = 'No qualifying sector telemetry available.';
        container.replaceChildren(emptyMsg);
        return;
    }

    _buildSectorsLegend(legendContainer);

    const colorMap = _buildDriverColorMap(data);
    const tooltip = d3.select('#tooltip');

    const width = Math.max(
        _MIN_CHART_WIDTH_PX,
        container.clientWidth - _CHART_MARGIN.left - _CHART_MARGIN.right
    );
    const height = results.length * _ROW_HEIGHT_PX;

    // Partition inner width into:
    // 1. Left/Middle: 3 FIA Sector Pills (S1, S2, S3) + Ideal vs Actual Lap Readout
    // 2. Right: Horizontal Lollipop/Bar Chart of Time Left on the Table
    const showLapReadout = width >= 620;
    const sectorsZoneWidth = Math.min(315, Math.max(210, Math.floor(width * 0.44)));
    const lapReadoutWidth = showLapReadout ? 148 : 0;
    const lollipopStartX = sectorsZoneWidth + lapReadoutWidth + 18;
    const lollipopWidth = Math.max(120, width - lollipopStartX);

    const sectorGap = 6;
    const sectorPillWidth = (sectorsZoneWidth - sectorGap * 2) / 3;

    const maxTimeLeft = Math.max(
        0.05,
        d3.max(results, (d) =>
            Math.max(0, d.time_left_on_table ?? d.best_time - d.ideal_lap)
        ) || 0.1
    );

    const xScale = d3
        .scaleLinear()
        .domain([0, maxTimeLeft * 1.15])
        .range([0, lollipopWidth]);

    const yScale = d3
        .scaleBand()
        .domain(results.map((d) => d.driver))
        .range([0, height])
        .paddingInner(0.22)
        .paddingOuter(0.12);

    const svg = d3
        .select(container)
        .append('svg')
        .attr('width', width + _CHART_MARGIN.left + _CHART_MARGIN.right)
        .attr('height', height + _CHART_MARGIN.top + _CHART_MARGIN.bottom)
        .append('g')
        .attr('transform', `translate(${_CHART_MARGIN.left},${_CHART_MARGIN.top})`);

    // Column Headers
    const sectorHeaders = ['SECTOR 1', 'SECTOR 2', 'SECTOR 3'];
    sectorHeaders.forEach((title, idx) => {
        const pillCenterX = idx * (sectorPillWidth + sectorGap) + sectorPillWidth / 2;
        svg.append('text')
            .attr('x', pillCenterX)
            .attr('y', -11)
            .attr('text-anchor', 'middle')
            .attr('fill', 'var(--text-muted)')
            .style('font-family', 'Montserrat, sans-serif')
            .style('font-size', '9.5px')
            .style('font-weight', '700')
            .style('letter-spacing', '0.6px')
            .text(title);
    });

    if (showLapReadout) {
        svg.append('text')
            .attr('x', sectorsZoneWidth + lapReadoutWidth / 2)
            .attr('y', -11)
            .attr('text-anchor', 'middle')
            .attr('fill', 'var(--text-muted)')
            .style('font-family', 'Montserrat, sans-serif')
            .style('font-size', '9.5px')
            .style('font-weight', '700')
            .style('letter-spacing', '0.6px')
            .text('IDEAL → ACTUAL');
    }

    svg.append('text')
        .attr('x', lollipopStartX)
        .attr('y', -11)
        .attr('text-anchor', 'start')
        .attr('fill', 'var(--text-muted)')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '9.5px')
        .style('font-weight', '700')
        .style('letter-spacing', '0.6px')
        .text('TIME LEFT ON TABLE (BEST - IDEAL)');

    // Lollipop Chart Gridlines and X-axis
    const lollipopGroup = svg
        .append('g')
        .attr('transform', `translate(${lollipopStartX},0)`);

    lollipopGroup
        .append('g')
        .attr('class', 'gridline')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(xScale).ticks(4).tickSize(-height).tickFormat(''));

    const xAxisGroup = lollipopGroup
        .append('g')
        .attr('transform', `translate(0,${height})`)
        .call(
            d3
                .axisBottom(xScale)
                .ticks(4)
                .tickFormat((d) => `+${d.toFixed(3)}s`)
        );

    xAxisGroup
        .append('text')
        .attr('x', lollipopWidth)
        .attr('y', 34)
        .attr('fill', 'var(--text-muted)')
        .attr('text-anchor', 'end')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '10px')
        .style('font-weight', '700')
        .text('UNREALIZED PACE POTENTIAL (+S)');

    const rowHeight = yScale.bandwidth();

    const rowGroups = svg
        .selectAll('g.sector-driver-row')
        .data(results)
        .enter()
        .append('g')
        .attr('class', 'sector-driver-row')
        .attr('transform', (d) => `translate(0,${yScale(d.driver)})`)
        .style('cursor', 'pointer');

    // Left Driver Position & Code Label + Team Color Strip
    rowGroups
        .append('rect')
        .attr('x', -10)
        .attr('y', 2)
        .attr('width', 3)
        .attr('height', Math.max(8, rowHeight - 4))
        .attr('rx', 1.5)
        .attr('fill', (d) => colorMap.get(d.driver) || d.color || 'var(--accent)');

    rowGroups
        .append('text')
        .attr('x', -15)
        .attr('y', rowHeight / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'end')
        .attr('fill', (d) => colorMap.get(d.driver) || d.color || 'var(--text-primary)')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '11px')
        .style('font-weight', '700')
        .text((d) => `P${d.grid_pos} ${d.driver}`);

    // Render 3 FIA Sector Pills per row
    const sectorDefs = [
        { timeKey: 's1', statusKey: 's1_status' },
        { timeKey: 's2', statusKey: 's2_status' },
        { timeKey: 's3', statusKey: 's3_status' }
    ];

    sectorDefs.forEach(({ timeKey, statusKey }, idx) => {
        const pillX = idx * (sectorPillWidth + sectorGap);

        rowGroups
            .append('rect')
            .attr('x', pillX)
            .attr('y', 1)
            .attr('width', sectorPillWidth)
            .attr('height', Math.max(12, rowHeight - 2))
            .attr('rx', 3.5)
            .attr('fill', (d) => _getSectorStatusColor(d[statusKey]))
            .attr('fill-opacity', 0.22)
            .attr('stroke', (d) => _getSectorStatusColor(d[statusKey]))
            .attr('stroke-opacity', 0.85)
            .attr('stroke-width', 1.2);

        // Left status accent bar inside the sector pill
        rowGroups
            .append('rect')
            .attr('x', pillX)
            .attr('y', 1)
            .attr('width', 3.5)
            .attr('height', Math.max(12, rowHeight - 2))
            .attr('rx', 1.5)
            .attr('fill', (d) => _getSectorStatusColor(d[statusKey]));

        rowGroups
            .append('text')
            .attr('x', pillX + sectorPillWidth / 2 + 1)
            .attr('y', rowHeight / 2)
            .attr('dy', '0.35em')
            .attr('text-anchor', 'middle')
            .attr('fill', '#ffffff')
            .style('font-family', 'Titillium Web, sans-serif')
            .style('font-size', '11px')
            .style('font-weight', '700')
            .text((d) => (Number.isFinite(d[timeKey]) ? `${d[timeKey].toFixed(3)}s` : '—'));
    });

    // Middle Ideal -> Actual Lap Readout
    if (showLapReadout) {
        rowGroups
            .append('text')
            .attr('x', sectorsZoneWidth + lapReadoutWidth / 2)
            .attr('y', rowHeight / 2)
            .attr('dy', '0.35em')
            .attr('text-anchor', 'middle')
            .attr('fill', 'var(--text-muted)')
            .style('font-family', 'Titillium Web, sans-serif')
            .style('font-size', '10.5px')
            .style('font-weight', '600')
            .text(
                (d) => `${_formatLapTime(d.ideal_lap)} → ${_formatLapTime(d.best_time)}`
            );
    }

    // Right Column: Horizontal D3 Lollipop / Bar of Time Left on Table (best_time - ideal_lap)
    const getTimeLeft = (d) =>
        Math.max(0, d.time_left_on_table ?? d.best_time - d.ideal_lap);

    // Translucent background bar
    rowGroups
        .append('rect')
        .attr('x', lollipopStartX)
        .attr('y', rowHeight * 0.25)
        .attr('width', (d) => Math.max(2, xScale(getTimeLeft(d))))
        .attr('height', Math.max(6, rowHeight * 0.5))
        .attr('rx', 2)
        .attr('fill', (d) => colorMap.get(d.driver) || d.color || 'var(--accent)')
        .attr('fill-opacity', 0.25);

    // Lollipop stem line
    rowGroups
        .append('line')
        .attr('x1', lollipopStartX)
        .attr('x2', (d) => lollipopStartX + xScale(getTimeLeft(d)))
        .attr('y1', rowHeight / 2)
        .attr('y2', rowHeight / 2)
        .attr('stroke', (d) => colorMap.get(d.driver) || d.color || 'var(--accent)')
        .attr('stroke-width', 2.2);

    // Lollipop head circle
    rowGroups
        .append('circle')
        .attr('cx', (d) => lollipopStartX + xScale(getTimeLeft(d)))
        .attr('cy', rowHeight / 2)
        .attr('r', 4.5)
        .attr('fill', (d) => colorMap.get(d.driver) || d.color || 'var(--accent)')
        .attr('stroke', '#ffffff')
        .attr('stroke-width', 1.2);

    // Value label (`+0.031s potential`)
    rowGroups
        .append('text')
        .attr('x', (d) => lollipopStartX + xScale(getTimeLeft(d)) + 8)
        .attr('y', rowHeight / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'start')
        .attr('fill', (d) => (getTimeLeft(d) <= 0.015 ? '#00d27a' : 'var(--text-primary)'))
        .style('font-family', 'Titillium Web, sans-serif')
        .style('font-size', '11px')
        .style('font-weight', '700')
        .text((d) => `+${getTimeLeft(d).toFixed(3)}s (${(getTimeLeft(d) * 1000).toFixed(0)}ms)`);

    // Transparent hover hit area
    rowGroups
        .append('rect')
        .attr('x', -_CHART_MARGIN.left)
        .attr('y', 0)
        .attr('width', width + _CHART_MARGIN.left + _CHART_MARGIN.right)
        .attr('height', rowHeight)
        .attr('fill', 'transparent');

    let externalDriver = null;
    let hoveredDriver = null;

    const updateFocusStyles = () => {
        const activeDriver = hoveredDriver !== null ? hoveredDriver : externalDriver;
        rowGroups.style('opacity', (d) =>
            activeDriver === null || d.driver === activeDriver
                ? _ACTIVE_OPACITY
                : _DIMMED_OPACITY
        );
    };

    rowGroups
        .on('mouseover', (event, d) => {
            hoveredDriver = d.driver;
            updateFocusStyles();

            const teamColor = colorMap.get(d.driver) || d.color || 'var(--accent)';
            _populateSectorsTooltip(tooltip.node(), d, teamColor);

            tooltip
                .classed('hidden', false)
                .style('border-left-color', teamColor)
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
            updateFocusStyles();
            tooltip.classed('hidden', true);
        });

    _externalFocusHandler = (driverCode) => {
        externalDriver = driverCode;
        updateFocusStyles();
    };
}
