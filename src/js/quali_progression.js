const _CHART_MARGIN = { top: 36, right: 118, bottom: 44, left: 82 };
const _ROW_HEIGHT_PX = 25;
const _MIN_CHART_WIDTH_PX = 340;

const _Q1_COLOR = '#9ca3af';
const _Q2_COLOR = '#facc15';
const _Q3_DEFAULT_COLOR = '#ef4444';
const _Q3_CUTOFF_COLOR = '#facc15';
const _Q2_CUTOFF_COLOR = '#ef4444';
const _POLE_HIGHLIGHT_COLOR = '#4ade80';
const _CONNECTOR_FALLBACK_COLOR = '#ffffff';
const _Q3_DOT_STROKE_COLOR = '#ffffff';
const _ROW_GUIDE_STROKE_COLOR = 'rgba(255, 255, 255, 0.05)';

const _ACTIVE_OPACITY = 1;
const _DIMMED_OPACITY = 0.16;
const _CONNECTOR_STROKE_OPACITY = 0.65;
const _HORIZONTAL_DIVIDER_OPACITY = 0.7;
const _VERTICAL_CUTOFF_OPACITY = 0.75;

const _HORIZONTAL_DIVIDER_STROKE_WIDTH_PX = 1.2;
const _HORIZONTAL_DIVIDER_DASH_ARRAY = '5,4';
const _HORIZONTAL_DIVIDER_INSET_PX = 8;
const _HORIZONTAL_DIVIDER_LABEL_X_INSET_PX = 4;
const _HORIZONTAL_DIVIDER_LABEL_Y_OFFSET_PX = -4;

const _VERTICAL_CUTOFF_STROKE_WIDTH_PX = 1.3;
const _VERTICAL_CUTOFF_DASH_ARRAY = '4,4';
const _VERTICAL_CUTOFF_LINE_TOP_OFFSET_PX = 4;
const _CUTOFF_LABEL_CLAMP_PADDING_PX = 68;
const _Q3_VERTICAL_CUTOFF_LABEL_Y_PX = -21;
const _Q2_VERTICAL_CUTOFF_LABEL_Y_PX = -7;

const _Q3_CUTOFF_GRID_POS = 10;
const _Q2_CUTOFF_GRID_POS = 16;

const _CONNECTOR_STROKE_WIDTH_PX = 2.2;
const _Q1_DOT_RADIUS_PX = 4.2;
const _Q1_DOT_STROKE_WIDTH_PX = 2;
const _Q2_DOT_RADIUS_PX = 4.8;
const _Q2_DOT_STROKE_WIDTH_PX = 1.2;
const _Q3_DOT_RADIUS_PX = 5.6;
const _Q3_DOT_STROKE_WIDTH_PX = 1.4;

const _DRIVER_LABEL_X_OFFSET_PX = -10;
const _GAP_BADGE_X_OFFSET_PX = 10;
const _X_AXIS_TICKS = 7;
const _X_AXIS_LABEL_Y_OFFSET_PX = 36;

const _DEFAULT_POLE_TIME_S = 75;
const _DEFAULT_TIME_SPAN_FALLBACK_S = 3;
const _MIN_TIME_SPAN_S = 0.5;
const _DOMAIN_PADDING_RATIO = 0.06;
const _Y_BAND_PADDING_INNER = 0.22;
const _Y_BAND_PADDING_OUTER = 0.15;
const _PROGRESSION_GAIN_THRESHOLD_S = 0.0005;

const _TOOLTIP_OFFSET_X_PX = 15;
const _TOOLTIP_OFFSET_Y_PX = -28;

let _externalFocusHandler = null;

/**
 * Highlights or restores a driver's knockout progression row from an external trigger.
 *
 * @param {string|null} driverCode - Three-letter driver code to highlight, or null to restore.
 * @returns {void}
 */
export function setQualiProgressionExternalFocus(driverCode) {
    if (_externalFocusHandler) {
        _externalFocusHandler(driverCode);
    }
}

/**
 * Formats a lap time in seconds as `m:ss.sss` (or `m:ss.s` when `decimals` is 1).
 *
 * @param {number|null|undefined} seconds - Lap time in seconds.
 * @param {number} [decimals=3] - Number of decimal places for seconds.
 * @returns {string} Formatted lap time string.
 */
function _formatLapTime(seconds, decimals = 3) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '—';
    const minutes = Math.floor(seconds / 60);
    const padWidth = decimals > 0 ? 3 + decimals : 2;
    const remainingSeconds = (seconds % 60).toFixed(decimals);
    if (minutes > 0) {
        return `${minutes}:${remainingSeconds.padStart(padWidth, '0')}`;
    }
    return `${remainingSeconds}s`;
}

/**
 * Resolves driver colors from `data.drivers` and `data.qualifying.results`.
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
 * Computes the padded `[minTime, maxTime]` X-axis domain across all valid Q1, Q2, and Q3 lap times.
 *
 * @param {Array<Object>} results - Sorted qualifying results array.
 * @param {Object} cutoffs - Qualifying cutoff times object.
 * @returns {[number, number]} Padded lower and upper lap time bounds in seconds.
 */
function _computeLapTimeDomain(results, cutoffs) {
    const allStageTimes = [];
    results.forEach((entry) => {
        if (Number.isFinite(entry.q1_time)) allStageTimes.push(entry.q1_time);
        if (Number.isFinite(entry.q2_time)) allStageTimes.push(entry.q2_time);
        if (Number.isFinite(entry.q3_time)) allStageTimes.push(entry.q3_time);
    });

    const minTime = d3.min(allStageTimes) || cutoffs.pole_time || _DEFAULT_POLE_TIME_S;
    const maxTime = d3.max(allStageTimes) || minTime + _DEFAULT_TIME_SPAN_FALLBACK_S;
    const timeSpan = Math.max(_MIN_TIME_SPAN_S, maxTime - minTime);

    return [
        minTime - timeSpan * _DOMAIN_PADDING_RATIO,
        maxTime + timeSpan * _DOMAIN_PADDING_RATIO
    ];
}

/**
 * Collects the finite stage lap times for a driver across the currently toggled stages.
 *
 * @param {Object} entry - Qualifying result entry for a driver.
 * @param {Set<string>} activeStages - Set of currently enabled stage keys (`Q1`, `Q2`, `Q3`).
 * @returns {Array<number>} Array of active stage lap times in seconds.
 */
function _collectActiveStageTimes(entry, activeStages) {
    const activeTimes = [];
    if (activeStages.has('Q1') && Number.isFinite(entry.q1_time)) {
        activeTimes.push(entry.q1_time);
    }
    if (activeStages.has('Q2') && Number.isFinite(entry.q2_time)) {
        activeTimes.push(entry.q2_time);
    }
    if (activeStages.has('Q3') && Number.isFinite(entry.q3_time)) {
        activeTimes.push(entry.q3_time);
    }
    return activeTimes;
}

/**
 * Resolves the text fill color for the right-side final gap / elimination badge.
 *
 * @param {Object} entry - Qualifying result entry for a driver.
 * @returns {string} CSS color string.
 */
function _resolveDriverGapBadgeColor(entry) {
    if (entry.grid_pos === 1) return _POLE_HIGHLIGHT_COLOR;
    const isTopTenFinisher = entry.eliminated_in === 'Q3' || entry.eliminated_in === 'SQ3';
    return isTopTenFinisher ? 'var(--text-primary)' : 'var(--text-muted)';
}

/**
 * Formats the text displayed in the right-side final gap / elimination badge.
 *
 * @param {Object} entry - Qualifying result entry for a driver.
 * @returns {string} Formatted badge string (e.g., `POLE (1:29.179)` or `+0.842s [Q2]`).
 */
function _formatDriverGapBadgeText(entry) {
    if (entry.grid_pos === 1) {
        return `POLE (${_formatLapTime(entry.best_time, 3)})`;
    }
    const isTopTenFinisher = entry.eliminated_in === 'Q3' || entry.eliminated_in === 'SQ3';
    const stageSuffix = !isTopTenFinisher ? ` [${entry.eliminated_in}]` : '';
    return `+${entry.gap_to_pole.toFixed(3)}s${stageSuffix}`;
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
 * Synchronizes the `.inactive` class on legend items based on `activeStages`.
 *
 * @param {HTMLElement} legendContainer - DOM container for the legend items.
 * @param {Set<string>} activeStages - Set of currently enabled stage keys (`Q1`, `Q2`, `Q3`).
 * @returns {void}
 */
function _updateProgressionLegendState(legendContainer, activeStages) {
    Array.from(legendContainer.children).forEach((child) => {
        const stageKey = child.dataset.stage;
        if (stageKey) {
            const isStageInactive = !activeStages.has(stageKey);
            child.classList.toggle('inactive', isStageInactive);
        }
    });
}

/**
 * Builds the interactive Q1 / Q2 / Q3 session stage legend inside `#quali-progression-legend`.
 *
 * @param {HTMLElement|null} legendContainer - DOM container for the legend items.
 * @param {Set<string>} activeStages - Set of currently enabled stage keys (`Q1`, `Q2`, `Q3`).
 * @param {string} stagePrefix - Session stage prefix (`Q` or `SQ`).
 * @param {Function} onToggle - Callback invoked when stage visibility is toggled.
 * @returns {void}
 */
function _buildProgressionLegend(legendContainer, activeStages, stagePrefix, onToggle) {
    if (!legendContainer) return;

    const stages = [
        { key: 'Q1', label: `${stagePrefix}1 LAP`, color: _Q1_COLOR, isHollow: true },
        { key: 'Q2', label: `${stagePrefix}2 LAP`, color: _Q2_COLOR, isHollow: false },
        { key: 'Q3', label: `${stagePrefix}3 SHOOTOUT`, color: _Q3_DEFAULT_COLOR, isHollow: false }
    ];

    stages.forEach((stage) => {
        const item = document.createElement('div');
        item.className = 'legend-item';
        item.dataset.stage = stage.key;

        const swatch = document.createElement('div');
        swatch.className = 'legend-color';
        if (stage.isHollow) {
            swatch.style.backgroundColor = 'transparent';
            swatch.style.border = `2px solid ${stage.color}`;
        } else {
            swatch.style.backgroundColor = stage.color;
        }

        item.appendChild(swatch);
        item.appendChild(document.createTextNode(stage.label));

        item.addEventListener('click', () => {
            const isCurrentlyActive = activeStages.has(stage.key);
            if (isCurrentlyActive) {
                if (activeStages.size > 1) {
                    activeStages.delete(stage.key);
                }
            } else {
                activeStages.add(stage.key);
            }
            _updateProgressionLegendState(legendContainer, activeStages);
            onToggle();
        });

        legendContainer.appendChild(item);
    });

    _updateProgressionLegendState(legendContainer, activeStages);
}

/**
 * Builds a single stage lap time row for the progression hover tooltip.
 *
 * @param {string} label - Stage label (`Q1`, `Q2`, `Q3`).
 * @param {number|null|undefined} timeVal - Stage lap time in seconds, or null if eliminated.
 * @param {string} badgeColor - Stage label color.
 * @returns {HTMLDivElement} Constructed tooltip stage row element.
 */
function _buildTooltipStageRow(label, timeVal, badgeColor) {
    const line = document.createElement('div');
    line.style.display = 'flex';
    line.style.justifyContent = 'space-between';
    line.style.gap = '14px';
    line.style.fontSize = '0.8rem';
    line.style.marginBottom = '2px';

    const left = document.createElement('span');
    left.style.color = badgeColor;
    left.style.fontWeight = '700';
    left.textContent = label;

    const hasStageTime = Boolean(timeVal);
    const right = document.createElement('span');
    right.style.fontWeight = '600';
    right.style.color = hasStageTime ? 'var(--text-primary)' : 'var(--text-muted)';
    right.textContent = hasStageTime ? _formatLapTime(timeVal, 3) : 'ELIMINATED';

    line.appendChild(left);
    line.appendChild(right);
    return line;
}

/**
 * Populates the shared `#tooltip` element with a driver's Q1, Q2, Q3 progression details.
 *
 * @param {HTMLElement|null} tooltipNode - Shared `#tooltip` DOM node.
 * @param {Object} entry - Qualifying result entry for the hovered driver.
 * @param {string} teamColor - Driver's constructor hex color.
 * @param {string} [stagePrefix='Q'] - Session stage prefix (`Q` or `SQ`).
 * @returns {void}
 */
function _populateProgressionTooltip(tooltipNode, entry, teamColor, stagePrefix = 'Q') {
    if (!tooltipNode) return;

    const header = document.createElement('div');
    header.style.fontFamily = 'Montserrat, sans-serif';
    header.style.fontWeight = '700';
    header.style.marginBottom = '4px';
    header.style.textTransform = 'uppercase';
    header.appendChild(document.createTextNode(`P${entry.grid_pos} ${entry.driver} `));

    const teamSpan = document.createElement('span');
    teamSpan.style.color = 'var(--text-muted)';
    teamSpan.style.fontWeight = '600';
    teamSpan.style.fontSize = '0.75rem';
    teamSpan.textContent = entry.team;
    header.appendChild(teamSpan);

    const isPolePosition = entry.grid_pos === 1;
    const summary = document.createElement('div');
    summary.style.marginTop = '5px';
    summary.style.paddingTop = '4px';
    summary.style.borderTop = '1px solid rgba(255, 255, 255, 0.1)';
    summary.style.fontSize = '0.78rem';
    summary.style.fontWeight = '700';
    summary.style.color = isPolePosition ? _POLE_HIGHLIGHT_COLOR : 'var(--text-primary)';

    const hasComparableQ1AndBest =
        Number.isFinite(entry.q1_time) && Number.isFinite(entry.best_time);
    const progressionGain = hasComparableQ1AndBest ? entry.q1_time - entry.best_time : 0;
    const hasSignificantGain = progressionGain > _PROGRESSION_GAIN_THRESHOLD_S;
    const gainText = hasSignificantGain
        ? ` | ${stagePrefix}1→Best: -${progressionGain.toFixed(3)}s`
        : '';

    summary.textContent = isPolePosition
        ? `POLE POSITION (${_formatLapTime(entry.best_time, 3)})${gainText}`
        : `Gap to Pole: +${entry.gap_to_pole.toFixed(3)}s${gainText}`;

    tooltipNode.replaceChildren(
        header,
        _buildTooltipStageRow(`${stagePrefix}1`, entry.q1_time, _Q1_COLOR),
        _buildTooltipStageRow(`${stagePrefix}2`, entry.q2_time, _Q2_COLOR),
        _buildTooltipStageRow(`${stagePrefix}3`, entry.q3_time, teamColor),
        summary
    );
}

/**
 * Renders the vertical gridlines and bottom X-axis for lap times (`m:ss.s`).
 *
 * @param {Object} svg - Root translated D3 `<g>` selection.
 * @param {Function} xScale - D3 linear scale for lap time.
 * @param {number} width - Inner chart width in pixels.
 * @param {number} height - Inner chart height in pixels.
 * @returns {void}
 */
function _renderProgressionAxesAndGrid(svg, xScale, width, height) {
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
                .tickFormat((d) => _formatLapTime(d, 1))
        );

    xAxisGroup
        .append('text')
        .attr('x', width)
        .attr('y', _X_AXIS_LABEL_Y_OFFSET_PX)
        .attr('fill', 'var(--text-muted)')
        .attr('text-anchor', 'end')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '10.5px')
        .style('font-weight', '700')
        .text('QUALIFYING LAP TIME (M:SS.S)');
}

/**
 * Renders a horizontal dashed knockout zone divider between `afterGridPos` and `afterGridPos + 1`.
 *
 * @param {Object} svg - Root translated D3 `<g>` selection.
 * @param {Array<Object>} results - Sorted qualifying results array.
 * @param {Function} yScale - D3 band scale for driver rows.
 * @param {number} width - Inner chart width in pixels.
 * @param {number} afterGridPos - Grid position immediately above the knockout line.
 * @param {string} labelText - Uppercase label text for the knockout divider.
 * @param {string} strokeColor - Hex color for the divider line and text.
 * @returns {void}
 */
function _renderHorizontalKnockoutDivider(
    svg,
    results,
    yScale,
    width,
    afterGridPos,
    labelText,
    strokeColor
) {
    const upperDriver = results.find((d) => d.grid_pos === afterGridPos);
    const lowerDriver = results.find((d) => d.grid_pos === afterGridPos + 1);
    if (!upperDriver || !lowerDriver) return;

    const yTop = yScale(upperDriver.driver) + yScale.bandwidth();
    const yBottom = yScale(lowerDriver.driver);
    const dividerY = (yTop + yBottom) / 2;

    svg.append('line')
        .attr('x1', -_CHART_MARGIN.left + _HORIZONTAL_DIVIDER_INSET_PX)
        .attr('x2', width + _CHART_MARGIN.right - _HORIZONTAL_DIVIDER_INSET_PX)
        .attr('y1', dividerY)
        .attr('y2', dividerY)
        .attr('stroke', strokeColor)
        .attr('stroke-width', _HORIZONTAL_DIVIDER_STROKE_WIDTH_PX)
        .attr('stroke-dasharray', _HORIZONTAL_DIVIDER_DASH_ARRAY)
        .attr('opacity', _HORIZONTAL_DIVIDER_OPACITY);

    svg.append('text')
        .attr('x', width - _HORIZONTAL_DIVIDER_LABEL_X_INSET_PX)
        .attr('y', dividerY + _HORIZONTAL_DIVIDER_LABEL_Y_OFFSET_PX)
        .attr('text-anchor', 'end')
        .attr('fill', strokeColor)
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '9px')
        .style('font-weight', '700')
        .style('letter-spacing', '0.6px')
        .text(labelText);
}

/**
 * Renders a vertical dashed session cutoff line and top staggered label at `timeSeconds`.
 *
 * @param {Object} svg - Root translated D3 `<g>` selection.
 * @param {Function} xScale - D3 linear scale for lap time.
 * @param {number} width - Inner chart width in pixels.
 * @param {number} height - Inner chart height in pixels.
 * @param {number|null|undefined} timeSeconds - Cutoff lap time in seconds.
 * @param {string} labelText - Cutoff label prefix.
 * @param {string} strokeColor - Hex color for the cutoff line and label.
 * @param {number} labelYOffset - Vertical Y offset in pixels to prevent label collision.
 * @returns {void}
 */
function _renderVerticalCutoffLine(
    svg,
    xScale,
    width,
    height,
    timeSeconds,
    labelText,
    strokeColor,
    labelYOffset
) {
    if (!Number.isFinite(timeSeconds)) return;
    const cx = xScale(timeSeconds);
    const clampedTextX = Math.max(
        _CUTOFF_LABEL_CLAMP_PADDING_PX,
        Math.min(width - _CUTOFF_LABEL_CLAMP_PADDING_PX, cx)
    );

    svg.append('line')
        .attr('x1', cx)
        .attr('x2', cx)
        .attr('y1', labelYOffset + _VERTICAL_CUTOFF_LINE_TOP_OFFSET_PX)
        .attr('y2', height)
        .attr('stroke', strokeColor)
        .attr('stroke-width', _VERTICAL_CUTOFF_STROKE_WIDTH_PX)
        .attr('stroke-dasharray', _VERTICAL_CUTOFF_DASH_ARRAY)
        .attr('opacity', _VERTICAL_CUTOFF_OPACITY);

    svg.append('text')
        .attr('x', clampedTextX)
        .attr('y', labelYOffset)
        .attr('text-anchor', 'middle')
        .attr('fill', strokeColor)
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '9.5px')
        .style('font-weight', '700')
        .text(`${labelText} (${_formatLapTime(timeSeconds, 3)})`);
}

/**
 * Renders both horizontal grid-position knockout dividers and vertical lap-time cutoff lines.
 *
 * @param {Object} svg - Root translated D3 `<g>` selection.
 * @param {Array<Object>} results - Sorted qualifying results array.
 * @param {Object} cutoffs - Qualifying cutoff times (`q3_cutoff_time`, `q2_cutoff_time`).
 * @param {Function} xScale - D3 linear scale for lap time.
 * @param {Function} yScale - D3 band scale for driver rows.
 * @param {number} width - Inner chart width in pixels.
 * @param {number} height - Inner chart height in pixels.
 * @param {string} stagePrefix - Session stage prefix (`Q` or `SQ`).
 * @returns {void}
 */
function _renderKnockoutCutoffs(
    svg,
    results,
    cutoffs,
    xScale,
    yScale,
    width,
    height,
    stagePrefix
) {
    _renderHorizontalKnockoutDivider(
        svg,
        results,
        yScale,
        width,
        _Q3_CUTOFF_GRID_POS,
        `▲ ${stagePrefix}3 SHOOTOUT CUTOFF (TOP 10)`,
        _Q3_CUTOFF_COLOR
    );
    _renderHorizontalKnockoutDivider(
        svg,
        results,
        yScale,
        width,
        _Q2_CUTOFF_GRID_POS,
        `▲ ${stagePrefix}2 KNOCKOUT CUTOFF (TOP 16)`,
        _Q2_CUTOFF_COLOR
    );

    _renderVerticalCutoffLine(
        svg,
        xScale,
        width,
        height,
        cutoffs.q3_cutoff_time,
        `${stagePrefix}3 CUTOFF`,
        _Q3_CUTOFF_COLOR,
        _Q3_VERTICAL_CUTOFF_LABEL_Y_PX
    );
    _renderVerticalCutoffLine(
        svg,
        xScale,
        width,
        height,
        cutoffs.q2_cutoff_time,
        `${stagePrefix}2 CUTOFF`,
        _Q2_CUTOFF_COLOR,
        _Q2_VERTICAL_CUTOFF_LABEL_Y_PX
    );
}

/**
 * Renders all driver rows including track guides, left driver labels, stage connector lines,
 * Q1/Q2/Q3 stage dots, right-side gap badges, and hover hit areas.
 *
 * @param {Object} svg - Root translated D3 `<g>` selection.
 * @param {Array<Object>} results - Sorted qualifying results array.
 * @param {Function} xScale - D3 linear scale for lap time.
 * @param {Function} yScale - D3 band scale for driver rows.
 * @param {number} width - Inner chart width in pixels.
 * @param {Map<string, string>} colorMap - Map of driver code to constructor hex color.
 * @returns {{
 *   rowGroups: Object,
 *   connectorLines: Object,
 *   q1Dots: Object,
 *   q2Dots: Object,
 *   q3Dots: Object
 * }} D3 selections for the rendered driver row elements.
 */
function _renderDriverProgressionRows(svg, results, xScale, yScale, width, colorMap) {
    const rowGroups = svg
        .selectAll('g.progression-driver-row')
        .data(results)
        .enter()
        .append('g')
        .attr('class', 'progression-driver-row')
        .attr('transform', (d) => `translate(0,${yScale(d.driver) + yScale.bandwidth() / 2})`)
        .style('cursor', 'pointer');

    rowGroups
        .append('line')
        .attr('x1', 0)
        .attr('x2', width)
        .attr('y1', 0)
        .attr('y2', 0)
        .attr('stroke', _ROW_GUIDE_STROKE_COLOR)
        .attr('stroke-width', 1);

    rowGroups
        .append('text')
        .attr('x', _DRIVER_LABEL_X_OFFSET_PX)
        .attr('y', 0)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'end')
        .attr('fill', (d) => colorMap.get(d.driver) || d.color || 'var(--text-primary)')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '11px')
        .style('font-weight', '700')
        .text((d) => `P${d.grid_pos} ${d.driver}`);

    const connectorLines = rowGroups
        .append('line')
        .attr('class', 'stage-connector')
        .attr('y1', 0)
        .attr('y2', 0)
        .attr('stroke', (d) => colorMap.get(d.driver) || d.color || _CONNECTOR_FALLBACK_COLOR)
        .attr('stroke-width', _CONNECTOR_STROKE_WIDTH_PX)
        .attr('stroke-opacity', _CONNECTOR_STROKE_OPACITY);

    const q1Dots = rowGroups
        .filter((d) => Number.isFinite(d.q1_time))
        .append('circle')
        .attr('class', 'stage-dot stage-q1')
        .attr('cx', (d) => xScale(d.q1_time))
        .attr('cy', 0)
        .attr('r', _Q1_DOT_RADIUS_PX)
        .attr('fill', 'var(--bg-dark)')
        .attr('stroke', _Q1_COLOR)
        .attr('stroke-width', _Q1_DOT_STROKE_WIDTH_PX);

    const q2Dots = rowGroups
        .filter((d) => Number.isFinite(d.q2_time))
        .append('circle')
        .attr('class', 'stage-dot stage-q2')
        .attr('cx', (d) => xScale(d.q2_time))
        .attr('cy', 0)
        .attr('r', _Q2_DOT_RADIUS_PX)
        .attr('fill', _Q2_COLOR)
        .attr('stroke', 'var(--bg-dark)')
        .attr('stroke-width', _Q2_DOT_STROKE_WIDTH_PX);

    const q3Dots = rowGroups
        .filter((d) => Number.isFinite(d.q3_time))
        .append('circle')
        .attr('class', 'stage-dot stage-q3')
        .attr('cx', (d) => xScale(d.q3_time))
        .attr('cy', 0)
        .attr('r', _Q3_DOT_RADIUS_PX)
        .attr('fill', (d) => colorMap.get(d.driver) || d.color || _Q3_DEFAULT_COLOR)
        .attr('stroke', _Q3_DOT_STROKE_COLOR)
        .attr('stroke-width', _Q3_DOT_STROKE_WIDTH_PX);

    rowGroups
        .append('text')
        .attr('x', width + _GAP_BADGE_X_OFFSET_PX)
        .attr('y', 0)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'start')
        .attr('fill', _resolveDriverGapBadgeColor)
        .style('font-family', 'Titillium Web, sans-serif')
        .style('font-size', '11.5px')
        .style('font-weight', '700')
        .text(_formatDriverGapBadgeText);

    rowGroups
        .append('rect')
        .attr('x', -_CHART_MARGIN.left)
        .attr('y', -_ROW_HEIGHT_PX / 2)
        .attr('width', width + _CHART_MARGIN.left + _CHART_MARGIN.right)
        .attr('height', _ROW_HEIGHT_PX)
        .attr('fill', 'transparent');

    return { rowGroups, connectorLines, q1Dots, q2Dots, q3Dots };
}

/**
 * Updates stage dot visibility, connector line spans, and driver row focus opacities.
 *
 * @param {{
 *   rowGroups: Object,
 *   connectorLines: Object,
 *   q1Dots: Object,
 *   q2Dots: Object,
 *   q3Dots: Object
 * }} elements - D3 selections for driver row elements.
 * @param {Set<string>} activeStages - Set of currently enabled stage keys (`Q1`, `Q2`, `Q3`).
 * @param {Function} xScale - D3 linear scale for lap time.
 * @param {string|null} focusedDriverCode - Currently hovered or externally focused driver code.
 * @returns {void}
 */
function _updateProgressionVisualState(elements, activeStages, xScale, focusedDriverCode) {
    const { rowGroups, connectorLines, q1Dots, q2Dots, q3Dots } = elements;

    q1Dots.style('display', activeStages.has('Q1') ? null : 'none');
    q2Dots.style('display', activeStages.has('Q2') ? null : 'none');
    q3Dots.style('display', activeStages.has('Q3') ? null : 'none');

    connectorLines.each(function (entry) {
        const activeTimes = _collectActiveStageTimes(entry, activeStages);
        const lineSelection = d3.select(this);
        const hasMultipleActiveStages = activeTimes.length >= 2;

        if (hasMultipleActiveStages) {
            lineSelection
                .style('display', null)
                .attr('x1', xScale(d3.min(activeTimes)))
                .attr('x2', xScale(d3.max(activeTimes)));
        } else {
            lineSelection.style('display', 'none');
        }
    });

    rowGroups.style('opacity', (d) => {
        const isRowActive = focusedDriverCode === null || d.driver === focusedDriverCode;
        return isRowActive ? _ACTIVE_OPACITY : _DIMMED_OPACITY;
    });
}

/**
 * Binds mouseover, mousemove, and mouseout listeners to driver progression rows.
 *
 * @param {Object} rowGroups - D3 selection of `.progression-driver-row` groups.
 * @param {Object} tooltip - D3 selection of the `#tooltip` element.
 * @param {Map<string, string>} colorMap - Map of driver code to constructor hex color.
 * @param {string} stagePrefix - Session stage prefix (`Q` or `SQ`).
 * @param {Function} onHoverChange - Callback invoked with hovered driver code (or null on mouseout).
 * @returns {void}
 */
function _bindProgressionRowInteractions(rowGroups, tooltip, colorMap, stagePrefix, onHoverChange) {
    rowGroups
        .on('mouseover', (event, d) => {
            onHoverChange(d.driver);

            const teamColor = colorMap.get(d.driver) || d.color || 'var(--accent)';
            _populateProgressionTooltip(tooltip.node(), d, teamColor, stagePrefix);

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
 * Renders the Q1 / Q2 / Q3 Knockout Progression & Cutoff Gaps chart.
 *
 * @param {Object} data - Race telemetry payload containing `qualifying.results` and `qualifying.cutoffs`.
 * @returns {void}
 */
export function renderQualiProgression(data) {
    const container = document.getElementById('quali-progression-chart');
    const legendContainer = document.getElementById('quali-progression-legend');
    if (!container) return;

    container.replaceChildren();
    if (legendContainer) legendContainer.replaceChildren();

    const results = (data.qualifying?.results || [])
        .slice()
        .sort((a, b) => a.grid_pos - b.grid_pos);
    const cutoffs = data.qualifying?.cutoffs || {};

    const hasProgressionResults = results.length > 0;
    if (!hasProgressionResults) {
        _externalFocusHandler = null;
        _renderEmptyState(container, 'No qualifying progression data available.');
        return;
    }

    const colorMap = _buildDriverColorMap(data);
    const tooltip = d3.select('#tooltip');
    const activeStages = new Set(['Q1', 'Q2', 'Q3']);
    const stagePrefix = data.qualifying?.stage_prefix || 'Q';

    const width = Math.max(
        _MIN_CHART_WIDTH_PX,
        container.clientWidth - _CHART_MARGIN.left - _CHART_MARGIN.right
    );
    const height = results.length * _ROW_HEIGHT_PX;

    const lapTimeDomain = _computeLapTimeDomain(results, cutoffs);
    const xScale = d3.scaleLinear().domain(lapTimeDomain).range([0, width]);

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

    _renderProgressionAxesAndGrid(svg, xScale, width, height);
    _renderKnockoutCutoffs(svg, results, cutoffs, xScale, yScale, width, height, stagePrefix);

    const rowElements = _renderDriverProgressionRows(
        svg,
        results,
        xScale,
        yScale,
        width,
        colorMap
    );

    let externalDriver = null;
    let hoveredDriver = null;

    const syncVisualState = () => {
        const focusedDriverCode = hoveredDriver !== null ? hoveredDriver : externalDriver;
        _updateProgressionVisualState(rowElements, activeStages, xScale, focusedDriverCode);
    };

    _bindProgressionRowInteractions(
        rowElements.rowGroups,
        tooltip,
        colorMap,
        stagePrefix,
        (newHoveredDriver) => {
            hoveredDriver = newHoveredDriver;
            syncVisualState();
        }
    );

    _externalFocusHandler = (driverCode) => {
        externalDriver = driverCode;
        syncVisualState();
    };

    _buildProgressionLegend(legendContainer, activeStages, stagePrefix, syncVisualState);
    syncVisualState();
}
