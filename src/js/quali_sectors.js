const _CHART_MARGIN = { top: 32, right: 96, bottom: 42, left: 78 };
const _ROW_HEIGHT_PX = 26;
const _MIN_CHART_WIDTH_PX = 520;
const _LAP_READOUT_MIN_CHART_WIDTH_PX = 620;

const _SECTORS_ZONE_MIN_WIDTH_PX = 210;
const _SECTORS_ZONE_MAX_WIDTH_PX = 315;
const _SECTORS_ZONE_WIDTH_RATIO = 0.44;
const _LAP_READOUT_WIDTH_PX = 148;
const _LOLLIPOP_ZONE_GAP_PX = 18;
const _MIN_LOLLIPOP_WIDTH_PX = 120;
const _SECTOR_PILL_GAP_PX = 6;

const _ACTIVE_OPACITY = 1;
const _DIMMED_OPACITY = 0.16;
const _PILL_FILL_OPACITY = 0.22;
const _PILL_STROKE_OPACITY = 0.85;
const _LOLLIPOP_BAR_OPACITY = 0.25;

const _SECTOR_STATUS_COLORS = {
    purple: '#b138ff',
    green: '#00d27a',
    yellow: '#ffb800',
    none: 'rgba(255, 255, 255, 0.18)'
};
const _PILL_TEXT_COLOR = '#ffffff';
const _LOLLIPOP_HEAD_STROKE_COLOR = '#ffffff';

const _SECTOR_DEFINITIONS = [
    { number: 1, title: 'SECTOR 1', timeKey: 's1', idealKey: 'ideal_s1', statusKey: 's1_status' },
    { number: 2, title: 'SECTOR 2', timeKey: 's2', idealKey: 'ideal_s2', statusKey: 's2_status' },
    { number: 3, title: 'SECTOR 3', timeKey: 's3', idealKey: 'ideal_s3', statusKey: 's3_status' }
];

const _MIN_TIME_LEFT_FLOOR_S = 0.05;
const _DEFAULT_MAX_TIME_LEFT_S = 0.1;
const _TIME_LEFT_DOMAIN_PADDING_FACTOR = 1.15;
const _OPTIMAL_TIME_LEFT_THRESHOLD_S = 0.015;
const _SECTOR_LOSS_EPSILON_S = 0.0005;
const _MS_PER_SECOND = 1000;

const _Y_BAND_PADDING_INNER = 0.22;
const _Y_BAND_PADDING_OUTER = 0.12;
const _LOLLIPOP_AXIS_TICKS = 4;
const _COLUMN_HEADER_Y_OFFSET_PX = -11;
const _X_AXIS_LABEL_Y_OFFSET_PX = 34;

const _DRIVER_STRIP_X_OFFSET_PX = -10;
const _DRIVER_STRIP_Y_INSET_PX = 2;
const _DRIVER_STRIP_WIDTH_PX = 3;
const _DRIVER_STRIP_MIN_HEIGHT_PX = 8;
const _DRIVER_STRIP_CORNER_RADIUS_PX = 1.5;
const _DRIVER_LABEL_X_OFFSET_PX = -15;

const _PILL_VERTICAL_INSET_PX = 1;
const _PILL_MIN_HEIGHT_PX = 12;
const _PILL_CORNER_RADIUS_PX = 3.5;
const _PILL_STROKE_WIDTH_PX = 1.2;
const _PILL_ACCENT_BAR_WIDTH_PX = 3.5;
const _PILL_ACCENT_CORNER_RADIUS_PX = 1.5;
const _PILL_TEXT_X_NUDGE_PX = 1;

const _LOLLIPOP_BAR_MIN_WIDTH_PX = 2;
const _LOLLIPOP_BAR_MIN_HEIGHT_PX = 6;
const _LOLLIPOP_BAR_Y_RATIO = 0.25;
const _LOLLIPOP_BAR_HEIGHT_RATIO = 0.5;
const _LOLLIPOP_BAR_CORNER_RADIUS_PX = 2;
const _LOLLIPOP_STEM_STROKE_WIDTH_PX = 2.2;
const _LOLLIPOP_HEAD_RADIUS_PX = 4.5;
const _LOLLIPOP_HEAD_STROKE_WIDTH_PX = 1.2;
const _LOLLIPOP_LABEL_X_OFFSET_PX = 8;

const _TOOLTIP_OFFSET_X_PX = 15;
const _TOOLTIP_OFFSET_Y_PX = -28;

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
    if (!Number.isFinite(seconds) || seconds <= 0) return 'NO TIME';
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
    if (!status) return _SECTOR_STATUS_COLORS.none;
    const key = String(status).toLowerCase();
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
 * Computes the non-negative unrealized lap time ("time left on the table") in seconds for a driver.
 *
 * @param {Object} entry - Qualifying result record for a driver.
 * @returns {number} Time left on the table (`best_time - ideal_lap`) in seconds.
 */
function _computeTimeLeftOnTable(entry) {
    if (!Number.isFinite(entry.best_time) || !Number.isFinite(entry.ideal_lap)) {
        return 0;
    }
    return Math.max(0, entry.time_left_on_table ?? entry.best_time - entry.ideal_lap);
}

/**
 * Computes horizontal column widths and X offsets for the Sector Pills, Ideal-vs-Actual Readout,
 * and Time-Left Lollipop zones.
 *
 * @param {number} width - Total inner chart width in pixels.
 * @returns {{
 *   shouldShowLapReadout: boolean,
 *   sectorsZoneWidth: number,
 *   lapReadoutWidth: number,
 *   lollipopStartX: number,
 *   lollipopWidth: number,
 *   sectorPillWidth: number
 * }} Horizontal layout metrics.
 */
function _computeSectorsLayoutMetrics(width) {
    const shouldShowLapReadout = width >= _LAP_READOUT_MIN_CHART_WIDTH_PX;
    const sectorsZoneWidth = Math.min(
        _SECTORS_ZONE_MAX_WIDTH_PX,
        Math.max(_SECTORS_ZONE_MIN_WIDTH_PX, Math.floor(width * _SECTORS_ZONE_WIDTH_RATIO))
    );
    const lapReadoutWidth = shouldShowLapReadout ? _LAP_READOUT_WIDTH_PX : 0;
    const lollipopStartX = sectorsZoneWidth + lapReadoutWidth + _LOLLIPOP_ZONE_GAP_PX;
    const lollipopWidth = Math.max(_MIN_LOLLIPOP_WIDTH_PX, width - lollipopStartX);
    const sectorPillWidth =
        (sectorsZoneWidth - _SECTOR_PILL_GAP_PX * (_SECTOR_DEFINITIONS.length - 1)) /
        _SECTOR_DEFINITIONS.length;

    return {
        shouldShowLapReadout,
        sectorsZoneWidth,
        lapReadoutWidth,
        lollipopStartX,
        lollipopWidth,
        sectorPillWidth
    };
}

/**
 * Computes the padded upper bound in seconds for the Time Left on Table lollipop scale.
 *
 * @param {Array<Object>} results - Sorted qualifying results array.
 * @returns {number} Upper X-axis domain bound in seconds.
 */
function _computeMaxTimeLeftDomain(results) {
    const maxTimeLeft = Math.max(
        _MIN_TIME_LEFT_FLOOR_S,
        d3.max(results, _computeTimeLeftOnTable) || _DEFAULT_MAX_TIME_LEFT_S
    );
    return maxTimeLeft * _TIME_LEFT_DOMAIN_PADDING_FACTOR;
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
 * Builds a single sector status and time comparison line inside the hover tooltip.
 *
 * @param {number} sectorNum - Sector number (`1`, `2`, or `3`).
 * @param {number} actualSeconds - Driver's sector split on their best lap.
 * @param {number} idealSeconds - Driver's personal best split for that sector.
 * @param {string} status - FIA sector status (`purple`, `green`, or `yellow`).
 * @returns {HTMLDivElement} Constructed tooltip sector row element.
 */
function _buildTooltipSectorRow(sectorNum, actualSeconds, idealSeconds, status) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.gap = '14px';
    row.style.fontSize = '0.8rem';
    row.style.marginBottom = '2px';

    const hasSectorTime = Number.isFinite(actualSeconds) && Number.isFinite(idealSeconds);
    const statusColor = _getSectorStatusColor(status);
    const sectorLoss = hasSectorTime ? Math.max(0, actualSeconds - idealSeconds) : 0;
    const hasSectorLoss = sectorLoss > _SECTOR_LOSS_EPSILON_S;

    const left = document.createElement('span');
    left.style.fontWeight = '700';
    left.style.color = hasSectorTime ? statusColor : 'var(--text-muted)';
    left.textContent = hasSectorTime
        ? `SECTOR ${sectorNum} (${String(status).toUpperCase()})`
        : `SECTOR ${sectorNum} (NO TIME)`;

    const right = document.createElement('span');
    right.style.fontWeight = '600';
    if (!hasSectorTime) {
        right.style.color = 'var(--text-muted)';
        right.textContent = 'NO TIME';
    } else {
        right.textContent = hasSectorLoss
            ? `${actualSeconds.toFixed(3)}s (Ideal ${idealSeconds.toFixed(3)}s, +${sectorLoss.toFixed(3)}s)`
            : `${actualSeconds.toFixed(3)}s (Optimal)`;
    }

    row.appendChild(left);
    row.appendChild(right);
    return row;
}

/**
 * Populates the shared `#tooltip` element with a driver's sector-by-sector and ideal lap breakdown.
 *
 * @param {HTMLElement|null} tooltipNode - Shared `#tooltip` DOM node.
 * @param {Object} entry - Qualifying result record for a driver.
 * @returns {void}
 */
function _populateSectorsTooltip(tooltipNode, entry) {
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

    const hasValidLap = Number.isFinite(entry.best_time) && Number.isFinite(entry.ideal_lap);
    const lapCompare = document.createElement('div');
    lapCompare.style.marginTop = '5px';
    lapCompare.style.paddingTop = '4px';
    lapCompare.style.borderTop = '1px solid rgba(255, 255, 255, 0.1)';
    lapCompare.style.fontSize = '0.8rem';
    lapCompare.style.fontWeight = '600';
    lapCompare.textContent = hasValidLap
        ? `Ideal: ${_formatLapTime(entry.ideal_lap)} → Actual: ${_formatLapTime(entry.best_time)}`
        : 'Ideal: NO TIME → Actual: NO TIME';

    const potentialLine = document.createElement('div');
    potentialLine.style.fontSize = '0.8rem';
    potentialLine.style.fontWeight = '700';
    potentialLine.style.marginTop = '2px';

    if (hasValidLap) {
        const timeLeft = _computeTimeLeftOnTable(entry);
        const isNearOptimalLap = timeLeft <= _OPTIMAL_TIME_LEFT_THRESHOLD_S;
        potentialLine.style.color = isNearOptimalLap
            ? _SECTOR_STATUS_COLORS.green
            : _SECTOR_STATUS_COLORS.yellow;
        potentialLine.textContent = `Time Left on Table: +${timeLeft.toFixed(3)}s potential (${(timeLeft * _MS_PER_SECOND).toFixed(0)} ms)`;
    } else {
        potentialLine.style.color = 'var(--text-muted)';
        potentialLine.textContent = 'Time Left on Table: NO FLYING LAP RECORDED';
    }

    const sectorRows = _SECTOR_DEFINITIONS.map((def) =>
        _buildTooltipSectorRow(def.number, entry[def.timeKey], entry[def.idealKey], entry[def.statusKey])
    );

    tooltipNode.replaceChildren(header, ...sectorRows, lapCompare, potentialLine);
}

/**
 * Renders the top column headers for Sector 1..3, Ideal->Actual readout, and Time Left on Table.
 *
 * @param {Object} svg - Root translated D3 `<g>` selection.
 * @param {{
 *   shouldShowLapReadout: boolean,
 *   sectorsZoneWidth: number,
 *   lapReadoutWidth: number,
 *   lollipopStartX: number,
 *   sectorPillWidth: number
 * }} layoutMetrics - Horizontal layout metrics.
 * @returns {void}
 */
function _renderSectorColumnHeaders(svg, layoutMetrics) {
    const {
        shouldShowLapReadout,
        sectorsZoneWidth,
        lapReadoutWidth,
        lollipopStartX,
        sectorPillWidth
    } = layoutMetrics;

    _SECTOR_DEFINITIONS.forEach(({ title }, idx) => {
        const pillCenterX =
            idx * (sectorPillWidth + _SECTOR_PILL_GAP_PX) + sectorPillWidth / 2;
        svg.append('text')
            .attr('x', pillCenterX)
            .attr('y', _COLUMN_HEADER_Y_OFFSET_PX)
            .attr('text-anchor', 'middle')
            .attr('fill', 'var(--text-muted)')
            .style('font-family', 'Montserrat, sans-serif')
            .style('font-size', '9.5px')
            .style('font-weight', '700')
            .style('letter-spacing', '0.6px')
            .text(title);
    });

    if (shouldShowLapReadout) {
        svg.append('text')
            .attr('x', sectorsZoneWidth + lapReadoutWidth / 2)
            .attr('y', _COLUMN_HEADER_Y_OFFSET_PX)
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
        .attr('y', _COLUMN_HEADER_Y_OFFSET_PX)
        .attr('text-anchor', 'start')
        .attr('fill', 'var(--text-muted)')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '9.5px')
        .style('font-weight', '700')
        .style('letter-spacing', '0.6px')
        .text('TIME LEFT ON TABLE (BEST - IDEAL)');
}

/**
 * Renders the vertical gridlines and bottom X-axis for the Time Left on Table lollipop zone.
 *
 * @param {Object} svg - Root translated D3 `<g>` selection.
 * @param {Function} xScale - D3 linear scale for time left on table.
 * @param {{lollipopStartX: number, lollipopWidth: number}} layoutMetrics - Horizontal layout metrics.
 * @param {number} height - Inner chart height in pixels.
 * @returns {void}
 */
function _renderLollipopAxisAndGrid(svg, xScale, layoutMetrics, height) {
    const { lollipopStartX, lollipopWidth } = layoutMetrics;

    const lollipopGroup = svg
        .append('g')
        .attr('transform', `translate(${lollipopStartX},0)`);

    lollipopGroup
        .append('g')
        .attr('class', 'gridline')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(xScale).ticks(_LOLLIPOP_AXIS_TICKS).tickSize(-height).tickFormat(''));

    const xAxisGroup = lollipopGroup
        .append('g')
        .attr('transform', `translate(0,${height})`)
        .call(
            d3
                .axisBottom(xScale)
                .ticks(_LOLLIPOP_AXIS_TICKS)
                .tickFormat((d) => `+${d.toFixed(3)}s`)
        );

    xAxisGroup
        .append('text')
        .attr('x', lollipopWidth)
        .attr('y', _X_AXIS_LABEL_Y_OFFSET_PX)
        .attr('fill', 'var(--text-muted)')
        .attr('text-anchor', 'end')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '10px')
        .style('font-weight', '700')
        .text('UNREALIZED PACE POTENTIAL (+S)');
}

/**
 * Renders the left-side team color strip and `P# DRIVER` label for each driver row.
 *
 * @param {Object} rowGroups - D3 selection of `.sector-driver-row` groups.
 * @param {number} rowHeight - Bandwidth height of each driver row.
 * @param {Map<string, string>} colorMap - Map of driver code to constructor hex color.
 * @returns {void}
 */
function _renderDriverIdentityColumn(rowGroups, rowHeight, colorMap) {
    rowGroups
        .append('rect')
        .attr('x', _DRIVER_STRIP_X_OFFSET_PX)
        .attr('y', _DRIVER_STRIP_Y_INSET_PX)
        .attr('width', _DRIVER_STRIP_WIDTH_PX)
        .attr('height', Math.max(_DRIVER_STRIP_MIN_HEIGHT_PX, rowHeight - _DRIVER_STRIP_Y_INSET_PX * 2))
        .attr('rx', _DRIVER_STRIP_CORNER_RADIUS_PX)
        .attr('fill', (d) => colorMap.get(d.driver) || d.color || 'var(--accent)');

    rowGroups
        .append('text')
        .attr('x', _DRIVER_LABEL_X_OFFSET_PX)
        .attr('y', rowHeight / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'end')
        .attr('fill', (d) => colorMap.get(d.driver) || d.color || 'var(--text-primary)')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '11px')
        .style('font-weight', '700')
        .text((d) => `P${d.grid_pos} ${d.driver}`);
}

/**
 * Renders the 3 FIA Sector status pills (Purple, Green, Yellow) and sector split times per row.
 *
 * @param {Object} rowGroups - D3 selection of `.sector-driver-row` groups.
 * @param {number} rowHeight - Bandwidth height of each driver row.
 * @param {{sectorPillWidth: number}} layoutMetrics - Horizontal layout metrics.
 * @returns {void}
 */
function _renderSectorStatusPills(rowGroups, rowHeight, layoutMetrics) {
    const { sectorPillWidth } = layoutMetrics;
    const pillHeight = Math.max(_PILL_MIN_HEIGHT_PX, rowHeight - _PILL_VERTICAL_INSET_PX * 2);

    _SECTOR_DEFINITIONS.forEach(({ timeKey, statusKey }, idx) => {
        const pillX = idx * (sectorPillWidth + _SECTOR_PILL_GAP_PX);

        rowGroups
            .append('rect')
            .attr('x', pillX)
            .attr('y', _PILL_VERTICAL_INSET_PX)
            .attr('width', sectorPillWidth)
            .attr('height', pillHeight)
            .attr('rx', _PILL_CORNER_RADIUS_PX)
            .attr('fill', (d) => _getSectorStatusColor(d[statusKey]))
            .attr('fill-opacity', _PILL_FILL_OPACITY)
            .attr('stroke', (d) => _getSectorStatusColor(d[statusKey]))
            .attr('stroke-opacity', _PILL_STROKE_OPACITY)
            .attr('stroke-width', _PILL_STROKE_WIDTH_PX);

        rowGroups
            .append('rect')
            .attr('x', pillX)
            .attr('y', _PILL_VERTICAL_INSET_PX)
            .attr('width', _PILL_ACCENT_BAR_WIDTH_PX)
            .attr('height', pillHeight)
            .attr('rx', _PILL_ACCENT_CORNER_RADIUS_PX)
            .attr('fill', (d) => _getSectorStatusColor(d[statusKey]));

        rowGroups
            .append('text')
            .attr('x', pillX + sectorPillWidth / 2 + _PILL_TEXT_X_NUDGE_PX)
            .attr('y', rowHeight / 2)
            .attr('dy', '0.35em')
            .attr('text-anchor', 'middle')
            .attr('fill', _PILL_TEXT_COLOR)
            .style('font-family', 'Titillium Web, sans-serif')
            .style('font-size', '11px')
            .style('font-weight', '700')
            .text((d) => (Number.isFinite(d[timeKey]) ? `${d[timeKey].toFixed(3)}s` : '—'));
    });
}

/**
 * Renders the middle `Ideal -> Actual` lap time text column when sufficient horizontal width is available.
 *
 * @param {Object} rowGroups - D3 selection of `.sector-driver-row` groups.
 * @param {number} rowHeight - Bandwidth height of each driver row.
 * @param {{
 *   shouldShowLapReadout: boolean,
 *   sectorsZoneWidth: number,
 *   lapReadoutWidth: number
 * }} layoutMetrics - Horizontal layout metrics.
 * @returns {void}
 */
function _renderIdealVsActualReadout(rowGroups, rowHeight, layoutMetrics) {
    const { shouldShowLapReadout, sectorsZoneWidth, lapReadoutWidth } = layoutMetrics;
    if (!shouldShowLapReadout) return;

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
        .text((d) =>
            Number.isFinite(d.best_time) && Number.isFinite(d.ideal_lap)
                ? `${_formatLapTime(d.ideal_lap)} → ${_formatLapTime(d.best_time)}`
                : 'NO TIME'
        );
}

/**
 * Renders the right-side horizontal lollipop bar, stem, circle head, and millisecond potential label.
 *
 * @param {Object} rowGroups - D3 selection of `.sector-driver-row` groups.
 * @param {Function} xScale - D3 linear scale for time left on table.
 * @param {number} rowHeight - Bandwidth height of each driver row.
 * @param {{lollipopStartX: number}} layoutMetrics - Horizontal layout metrics.
 * @param {Map<string, string>} colorMap - Map of driver code to constructor hex color.
 * @returns {void}
 */
function _renderTimeLeftLollipops(rowGroups, xScale, rowHeight, layoutMetrics, colorMap) {
    const { lollipopStartX } = layoutMetrics;

    rowGroups
        .append('rect')
        .attr('x', lollipopStartX)
        .attr('y', rowHeight * _LOLLIPOP_BAR_Y_RATIO)
        .attr('width', (d) =>
            Number.isFinite(d.best_time)
                ? Math.max(_LOLLIPOP_BAR_MIN_WIDTH_PX, xScale(_computeTimeLeftOnTable(d)))
                : 0
        )
        .attr('height', Math.max(_LOLLIPOP_BAR_MIN_HEIGHT_PX, rowHeight * _LOLLIPOP_BAR_HEIGHT_RATIO))
        .attr('rx', _LOLLIPOP_BAR_CORNER_RADIUS_PX)
        .attr('fill', (d) => colorMap.get(d.driver) || d.color || 'var(--accent)')
        .attr('fill-opacity', _LOLLIPOP_BAR_OPACITY);

    rowGroups
        .append('line')
        .attr('x1', lollipopStartX)
        .attr('x2', (d) => lollipopStartX + xScale(_computeTimeLeftOnTable(d)))
        .attr('y1', rowHeight / 2)
        .attr('y2', rowHeight / 2)
        .attr('stroke', (d) => colorMap.get(d.driver) || d.color || 'var(--accent)')
        .attr('stroke-width', _LOLLIPOP_STEM_STROKE_WIDTH_PX)
        .style('display', (d) => (Number.isFinite(d.best_time) ? null : 'none'));

    rowGroups
        .append('circle')
        .attr('cx', (d) => lollipopStartX + xScale(_computeTimeLeftOnTable(d)))
        .attr('cy', rowHeight / 2)
        .attr('r', _LOLLIPOP_HEAD_RADIUS_PX)
        .attr('fill', (d) => colorMap.get(d.driver) || d.color || 'var(--accent)')
        .attr('stroke', _LOLLIPOP_HEAD_STROKE_COLOR)
        .attr('stroke-width', _LOLLIPOP_HEAD_STROKE_WIDTH_PX)
        .style('display', (d) => (Number.isFinite(d.best_time) ? null : 'none'));

    rowGroups
        .append('text')
        .attr('x', (d) =>
            Number.isFinite(d.best_time)
                ? lollipopStartX + xScale(_computeTimeLeftOnTable(d)) + _LOLLIPOP_LABEL_X_OFFSET_PX
                : lollipopStartX
        )
        .attr('y', rowHeight / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'start')
        .attr('fill', (d) => {
            if (!Number.isFinite(d.best_time)) return 'var(--text-muted)';
            const isNearOptimalLap =
                _computeTimeLeftOnTable(d) <= _OPTIMAL_TIME_LEFT_THRESHOLD_S;
            return isNearOptimalLap ? _SECTOR_STATUS_COLORS.green : 'var(--text-primary)';
        })
        .style('font-family', 'Titillium Web, sans-serif')
        .style('font-size', '11px')
        .style('font-weight', '700')
        .text((d) => {
            if (!Number.isFinite(d.best_time)) return 'NO TIME';
            const timeLeft = _computeTimeLeftOnTable(d);
            return `+${timeLeft.toFixed(3)}s (${(timeLeft * _MS_PER_SECOND).toFixed(0)}ms)`;
        });
}

/**
 * Updates driver row opacities based on hovered or externally focused driver code.
 *
 * @param {Object} rowGroups - D3 selection of `.sector-driver-row` groups.
 * @param {string|null} activeDriverCode - Currently focused driver code, or null.
 * @returns {void}
 */
function _updateSectorsFocusState(rowGroups, activeDriverCode) {
    rowGroups.style('opacity', (d) => {
        const isRowActive = activeDriverCode === null || d.driver === activeDriverCode;
        return isRowActive ? _ACTIVE_OPACITY : _DIMMED_OPACITY;
    });
}

/**
 * Appends transparent hit-area rectangles and binds hover listeners to sector driver rows.
 *
 * @param {Object} rowGroups - D3 selection of `.sector-driver-row` groups.
 * @param {Object} tooltip - D3 selection of `#tooltip`.
 * @param {Map<string, string>} colorMap - Map of driver code to constructor hex color.
 * @param {number} width - Inner chart width in pixels.
 * @param {number} rowHeight - Bandwidth height of each driver row.
 * @param {Function} onHoverChange - Callback invoked with hovered driver code (or null on mouseout).
 * @returns {void}
 */
function _bindSectorRowInteractions(rowGroups, tooltip, colorMap, width, rowHeight, onHoverChange) {
    rowGroups
        .append('rect')
        .attr('x', -_CHART_MARGIN.left)
        .attr('y', 0)
        .attr('width', width + _CHART_MARGIN.left + _CHART_MARGIN.right)
        .attr('height', rowHeight)
        .attr('fill', 'transparent');

    rowGroups
        .on('mouseover', (event, d) => {
            onHoverChange(d.driver);

            const teamColor = colorMap.get(d.driver) || d.color || 'var(--accent)';
            _populateSectorsTooltip(tooltip.node(), d);

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
            onHoverChange(null);
            tooltip.classed('hidden', true);
        });
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

    const hasSectorResults = results.length > 0;
    if (!hasSectorResults) {
        _externalFocusHandler = null;
        _renderEmptyState(container, 'No qualifying sector telemetry available.');
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

    const layoutMetrics = _computeSectorsLayoutMetrics(width);
    const maxTimeLeftDomain = _computeMaxTimeLeftDomain(results);

    const xScale = d3
        .scaleLinear()
        .domain([0, maxTimeLeftDomain])
        .range([0, layoutMetrics.lollipopWidth]);

    const yScale = d3
        .scaleBand()
        .domain(results.map((d) => d.driver))
        .range([0, height])
        .paddingInner(_Y_BAND_PADDING_INNER)
        .paddingOuter(_Y_BAND_PADDING_OUTER);

    const svg = d3
        .select(container)
        .append('svg')
        .attr('width', width + _CHART_MARGIN.left + _CHART_MARGIN.right)
        .attr('height', height + _CHART_MARGIN.top + _CHART_MARGIN.bottom)
        .append('g')
        .attr('transform', `translate(${_CHART_MARGIN.left},${_CHART_MARGIN.top})`);

    _renderSectorColumnHeaders(svg, layoutMetrics);
    _renderLollipopAxisAndGrid(svg, xScale, layoutMetrics, height);

    const rowHeight = yScale.bandwidth();
    const rowGroups = svg
        .selectAll('g.sector-driver-row')
        .data(results)
        .enter()
        .append('g')
        .attr('class', 'sector-driver-row')
        .attr('transform', (d) => `translate(0,${yScale(d.driver)})`)
        .style('cursor', 'pointer');

    _renderDriverIdentityColumn(rowGroups, rowHeight, colorMap);
    _renderSectorStatusPills(rowGroups, rowHeight, layoutMetrics);
    _renderIdealVsActualReadout(rowGroups, rowHeight, layoutMetrics);
    _renderTimeLeftLollipops(rowGroups, xScale, rowHeight, layoutMetrics, colorMap);

    let externalDriver = null;
    let hoveredDriver = null;

    const syncFocusStyles = () => {
        const activeDriverCode = hoveredDriver !== null ? hoveredDriver : externalDriver;
        _updateSectorsFocusState(rowGroups, activeDriverCode);
    };

    _bindSectorRowInteractions(
        rowGroups,
        tooltip,
        colorMap,
        width,
        rowHeight,
        (newHoveredDriver) => {
            hoveredDriver = newHoveredDriver;
            syncFocusStyles();
        }
    );

    _externalFocusHandler = (driverCode) => {
        externalDriver = driverCode;
        syncFocusStyles();
    };
}
