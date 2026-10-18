const _CHART_MARGIN = { top: 28, right: 32, bottom: 42, left: 138 };
const _ROW_HEIGHT_PX = 34;
const _MIN_CHART_WIDTH_PX = 340;

const _ACTIVE_OPACITY = 1;
const _DIMMED_OPACITY = 0.18;
const _FASTER_BAR_FILL_OPACITY = 0.92;
const _SLOWER_BAR_FILL_OPACITY = 0.38;
const _SLOWER_BAR_STROKE_OPACITY = 0.65;

const _FASTER_HIGHLIGHT_COLOR = '#4ade80';
const _STRIPE_PATTERN_ID = 'quali-teammate-stripe-pattern';
const _STRIPE_PATTERN_SIZE_PX = 6;
const _STRIPE_ROTATION_DEG = 45;
const _STRIPE_STROKE_COLOR = 'rgba(15, 15, 22, 0.55)';
const _STRIPE_STROKE_WIDTH_PX = 3;
const _ROW_GUIDE_STROKE_COLOR = 'rgba(255, 255, 255, 0.04)';
const _CENTER_LINE_COLOR = 'rgba(255, 255, 255, 0.55)';
const _CENTER_LINE_STROKE_WIDTH_PX = 1.5;
const _CENTER_LINE_TOP_OFFSET_PX = -4;

const _MIN_MAX_DELTA_FLOOR_S = 0.4;
const _DEFAULT_MAX_DELTA_S = 1.0;
const _DOMAIN_PADDING_FACTOR = 1.48;
const _Y_BAND_PADDING_INNER = 0.28;
const _Y_BAND_PADDING_OUTER = 0.15;
const _X_AXIS_TICKS = 7;
const _X_AXIS_LABEL_Y_OFFSET_PX = 35;
const _ZERO_TICK_EPSILON_S = 0.0005;
const _MS_PER_SECOND = 1000;

const _COLUMN_HEADER_X_OFFSET_PX = 12;
const _COLUMN_HEADER_Y_OFFSET_PX = -10;
const _TEAM_SWATCH_X_OFFSET_PX = -12;
const _TEAM_SWATCH_Y_INSET_PX = 3;
const _TEAM_SWATCH_WIDTH_PX = 3;
const _TEAM_SWATCH_CORNER_RADIUS_PX = 1.5;
const _TEAM_LABEL_X_OFFSET_PX = -18;

const _BAR_MIN_WIDTH_PX = 2;
const _BAR_MIN_HEIGHT_PX = 8;
const _BAR_VERTICAL_INSET_PX = 2;
const _BAR_CORNER_RADIUS_PX = 3;
const _BADGE_HORIZONTAL_GAP_PX = 7;
const _BADGE_EDGE_CLAMP_PX = 4;

const _TOOLTIP_OFFSET_X_PX = 15;
const _TOOLTIP_OFFSET_Y_PX = -28;

let _externalFocusHandler = null;

/**
 * Highlights the constructor row containing `driverCode` (or matching constructor name)
 * and dims other teams when triggered externally.
 *
 * @param {string|null} driverCode - Three-letter driver code or constructor name, or null to restore.
 * @returns {void}
 */
export function setQualiTeammateExternalFocus(driverCode) {
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
 * Resolves constructor hex colors from `data.drivers` and `data.qualifying.teammate_deltas`.
 *
 * @param {Object} data - Race telemetry payload.
 * @returns {Map<string, string>} Map of constructor name to hex color string.
 */
function _buildTeamColorMap(data) {
    const teamColorMap = new Map();
    if (Array.isArray(data.drivers)) {
        data.drivers.forEach((driver) => {
            if (driver.team && driver.color && !teamColorMap.has(driver.team)) {
                teamColorMap.set(driver.team, driver.color);
            }
        });
    }
    const deltas = data.qualifying?.teammate_deltas || [];
    deltas.forEach((entry) => {
        if (entry.team && entry.color && !teamColorMap.has(entry.team)) {
            teamColorMap.set(entry.team, entry.color);
        }
    });
    return teamColorMap;
}

/**
 * Enriches raw teammate delta records with their resolved constructor hex color.
 *
 * @param {Array<Object>} rawDeltas - Raw teammate delta records.
 * @param {Map<string, string>} teamColorMap - Map of constructor name to hex color.
 * @returns {Array<Object>} Enriched teammate delta records with `resolvedColor`.
 */
function _enrichTeammateDeltas(rawDeltas, teamColorMap) {
    return rawDeltas.map((entry) => ({
        ...entry,
        resolvedColor: teamColorMap.get(entry.team) || entry.color || 'var(--accent)'
    }));
}

/**
 * Computes the symmetric X-axis bound in seconds for the diverging teammate delta bars.
 *
 * @param {Array<{delta_s: number}>} deltas - Enriched teammate delta records.
 * @returns {number} Positive domain bound in seconds.
 */
function _computeTeammateDeltaDomainBound(deltas) {
    const maxDelta = Math.max(
        _MIN_MAX_DELTA_FLOOR_S,
        d3.max(deltas, (d) => (Number.isFinite(d.delta_s) ? d.delta_s : 0)) || _DEFAULT_MAX_DELTA_S
    );
    return maxDelta * _DOMAIN_PADDING_FACTOR;
}

/**
 * Determines whether a constructor row matches the external focus key (team name or either driver code).
 *
 * @param {Object} entry - Teammate delta record for a constructor.
 * @param {string} externalFocusKey - Focused driver code or constructor name.
 * @returns {boolean} True if the row matches the focused entity.
 */
function _isRowMatchingFocus(entry, externalFocusKey) {
    return (
        entry.team === externalFocusKey ||
        entry.faster_driver === externalFocusKey ||
        entry.slower_driver === externalFocusKey
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
 * Builds a single driver line (faster or slower teammate) inside the H2H tooltip.
 *
 * @param {string} prefixSymbol - Directional indicator (`▲` or `▼`).
 * @param {string} driverCode - Three-letter driver code.
 * @param {number} gridPos - Qualifying grid position.
 * @param {number} lapTimeSeconds - Best qualifying lap time in seconds.
 * @param {string} leftColor - CSS color for the driver label.
 * @param {boolean} isSlowerRow - Whether to apply muted styling to the time readout.
 * @returns {HTMLDivElement} Constructed tooltip line element.
 */
function _buildTooltipDriverComparisonRow(
    prefixSymbol,
    driverCode,
    gridPos,
    lapTimeSeconds,
    leftColor,
    isSlowerRow
) {
    const line = document.createElement('div');
    line.style.display = 'flex';
    line.style.justifyContent = 'space-between';
    line.style.gap = '14px';
    line.style.fontSize = '0.82rem';
    line.style.marginBottom = isSlowerRow ? '4px' : '3px';

    const left = document.createElement('span');
    left.style.fontWeight = '700';
    left.style.color = leftColor;
    left.textContent = `${prefixSymbol} ${driverCode} (P${gridPos})`;

    const right = document.createElement('span');
    right.style.fontWeight = '600';
    if (isSlowerRow) {
        right.style.color = 'var(--text-muted)';
    }
    right.textContent = _formatLapTime(lapTimeSeconds);

    line.appendChild(left);
    line.appendChild(right);
    return line;
}

/**
 * Populates the shared `#tooltip` element with constructor head-to-head qualifying details.
 *
 * @param {HTMLElement|null} tooltipNode - Shared `#tooltip` DOM node.
 * @param {Object} entry - Teammate delta record for a constructor.
 * @param {string} teamColor - Constructor hex color.
 * @returns {void}
 */
function _populateTeammateTooltip(tooltipNode, entry, teamColor) {
    if (!tooltipNode) return;

    const header = document.createElement('div');
    header.style.fontFamily = 'Montserrat, sans-serif';
    header.style.fontWeight = '700';
    header.style.marginBottom = '5px';
    header.style.textTransform = 'uppercase';
    header.style.color = teamColor;
    header.textContent = `${entry.team} — QUALIFYING H2H`;

    const fasterLine = _buildTooltipDriverComparisonRow(
        '▲',
        entry.faster_driver,
        entry.faster_grid,
        entry.faster_time,
        _FASTER_HIGHLIGHT_COLOR,
        false
    );

    const slowerLine = _buildTooltipDriverComparisonRow(
        '▼',
        entry.slower_driver,
        entry.slower_grid,
        entry.slower_time,
        'var(--text-muted)',
        true
    );

    const deltaSummary = document.createElement('div');
    deltaSummary.style.paddingTop = '4px';
    deltaSummary.style.borderTop = '1px solid rgba(255, 255, 255, 0.1)';
    deltaSummary.style.fontSize = '0.8rem';
    deltaSummary.style.fontWeight = '700';
    deltaSummary.style.color = 'var(--text-primary)';
    const hasValidDelta = Number.isFinite(entry.delta_s);
    deltaSummary.textContent = hasValidDelta
        ? `Teammate Delta: +${entry.delta_s.toFixed(3)}s (${(entry.delta_s * _MS_PER_SECOND).toFixed(0)} ms)`
        : 'Teammate Delta: NO TIME SET';

    tooltipNode.replaceChildren(header, fasterLine, slowerLine, deltaSummary);
}

/**
 * Appends the diagonal stripe `<pattern>` definition used on slower teammate bars.
 *
 * @param {Object} svgRoot - Root D3 `<svg>` selection.
 * @returns {void}
 */
function _appendStripePatternDefs(svgRoot) {
    const defs = svgRoot.append('defs');
    const pattern = defs
        .append('pattern')
        .attr('id', _STRIPE_PATTERN_ID)
        .attr('width', _STRIPE_PATTERN_SIZE_PX)
        .attr('height', _STRIPE_PATTERN_SIZE_PX)
        .attr('patternUnits', 'userSpaceOnUse')
        .attr('patternTransform', `rotate(${_STRIPE_ROTATION_DEG})`);

    pattern
        .append('line')
        .attr('x1', 0)
        .attr('y1', 0)
        .attr('x2', 0)
        .attr('y2', _STRIPE_PATTERN_SIZE_PX)
        .attr('stroke', _STRIPE_STROKE_COLOR)
        .attr('stroke-width', _STRIPE_STROKE_WIDTH_PX);
}

/**
 * Renders the vertical gridlines, directional top column headers, and bottom X-axis.
 *
 * @param {Object} svg - Root translated D3 `<g>` selection.
 * @param {Function} xScale - D3 linear scale for diverging delta seconds.
 * @param {number} centerX - X coordinate corresponding to `0.000s`.
 * @param {number} width - Inner chart width in pixels.
 * @param {number} height - Inner chart height in pixels.
 * @returns {void}
 */
function _renderTeammateAxesAndHeaders(svg, xScale, centerX, width, height) {
    svg.append('g')
        .attr('class', 'gridline')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(xScale).ticks(_X_AXIS_TICKS).tickSize(-height).tickFormat(''));

    svg.append('text')
        .attr('x', centerX - _COLUMN_HEADER_X_OFFSET_PX)
        .attr('y', _COLUMN_HEADER_Y_OFFSET_PX)
        .attr('text-anchor', 'end')
        .attr('fill', _FASTER_HIGHLIGHT_COLOR)
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '9.5px')
        .style('font-weight', '700')
        .style('letter-spacing', '0.6px')
        .text('◀ FASTER TEAMMATE (-Δs)');

    svg.append('text')
        .attr('x', centerX + _COLUMN_HEADER_X_OFFSET_PX)
        .attr('y', _COLUMN_HEADER_Y_OFFSET_PX)
        .attr('text-anchor', 'start')
        .attr('fill', 'var(--text-muted)')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '9.5px')
        .style('font-weight', '700')
        .style('letter-spacing', '0.6px')
        .text('SLOWER TEAMMATE (+Δs) ▶');

    const xAxisGroup = svg
        .append('g')
        .attr('transform', `translate(0,${height})`)
        .call(
            d3
                .axisBottom(xScale)
                .ticks(_X_AXIS_TICKS)
                .tickFormat((d) => {
                    const isZeroTick = Math.abs(d) < _ZERO_TICK_EPSILON_S;
                    if (isZeroTick) return '0.000s';
                    return `${d > 0 ? '+' : ''}${d.toFixed(2)}s`;
                })
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
        .text('TEAMMATE QUALIFYING DELTA (SECONDS)');
}

/**
 * Renders the horizontal row guide line, constructor color bar, and uppercase team name on the left axis.
 *
 * @param {Object} rowGroups - D3 selection of `.teammate-row` groups.
 * @param {number} width - Inner chart width in pixels.
 * @param {number} barHeight - Bandwidth height of each constructor row.
 * @returns {void}
 */
function _renderConstructorLabelColumn(rowGroups, width, barHeight) {
    rowGroups
        .append('line')
        .attr('x1', 0)
        .attr('x2', width)
        .attr('y1', barHeight / 2)
        .attr('y2', barHeight / 2)
        .attr('stroke', _ROW_GUIDE_STROKE_COLOR)
        .attr('stroke-width', 1);

    rowGroups
        .append('rect')
        .attr('x', _TEAM_SWATCH_X_OFFSET_PX)
        .attr('y', _TEAM_SWATCH_Y_INSET_PX)
        .attr('width', _TEAM_SWATCH_WIDTH_PX)
        .attr('height', Math.max(_BAR_MIN_HEIGHT_PX, barHeight - _TEAM_SWATCH_Y_INSET_PX * 2))
        .attr('rx', _TEAM_SWATCH_CORNER_RADIUS_PX)
        .attr('fill', (d) => d.resolvedColor);

    rowGroups
        .append('text')
        .attr('x', _TEAM_LABEL_X_OFFSET_PX)
        .attr('y', barHeight / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'end')
        .attr('fill', 'var(--text-primary)')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '10.5px')
        .style('font-weight', '700')
        .text((d) => d.team.toUpperCase());
}

/**
 * Renders the left (faster teammate) solid bar and right (slower teammate) striped bar for each constructor.
 *
 * @param {Object} rowGroups - D3 selection of `.teammate-row` groups.
 * @param {Function} xScale - D3 linear scale for diverging delta seconds.
 * @param {number} centerX - X coordinate corresponding to `0.000s`.
 * @param {number} barHeight - Bandwidth height of each constructor row.
 * @returns {void}
 */
function _renderDivergingDeltaBars(rowGroups, xScale, centerX, barHeight) {
    const rectHeight = Math.max(_BAR_MIN_HEIGHT_PX, barHeight - _BAR_VERTICAL_INSET_PX * 2);

    rowGroups
        .append('rect')
        .attr('class', 'faster-bar')
        .attr('x', (d) => (Number.isFinite(d.delta_s) ? xScale(-d.delta_s) : centerX))
        .attr('y', _BAR_VERTICAL_INSET_PX)
        .attr('width', (d) =>
            Number.isFinite(d.delta_s)
                ? Math.max(_BAR_MIN_WIDTH_PX, centerX - xScale(-d.delta_s))
                : 0
        )
        .attr('height', rectHeight)
        .attr('rx', _BAR_CORNER_RADIUS_PX)
        .attr('fill', (d) => d.resolvedColor)
        .attr('fill-opacity', _FASTER_BAR_FILL_OPACITY);

    rowGroups
        .append('rect')
        .attr('class', 'slower-bar-base')
        .attr('x', centerX)
        .attr('y', _BAR_VERTICAL_INSET_PX)
        .attr('width', (d) =>
            Number.isFinite(d.delta_s)
                ? Math.max(_BAR_MIN_WIDTH_PX, xScale(d.delta_s) - centerX)
                : 0
        )
        .attr('height', rectHeight)
        .attr('rx', _BAR_CORNER_RADIUS_PX)
        .attr('fill', (d) => d.resolvedColor)
        .attr('fill-opacity', _SLOWER_BAR_FILL_OPACITY)
        .attr('stroke', (d) => d.resolvedColor)
        .attr('stroke-opacity', _SLOWER_BAR_STROKE_OPACITY)
        .attr('stroke-width', 1);

    rowGroups
        .append('rect')
        .attr('class', 'slower-bar-stripes')
        .attr('x', centerX)
        .attr('y', _BAR_VERTICAL_INSET_PX)
        .attr('width', (d) =>
            Number.isFinite(d.delta_s)
                ? Math.max(_BAR_MIN_WIDTH_PX, xScale(d.delta_s) - centerX)
                : 0
        )
        .attr('height', rectHeight)
        .attr('rx', _BAR_CORNER_RADIUS_PX)
        .attr('fill', `url(#${_STRIPE_PATTERN_ID})`);
}

/**
 * Renders the outer text badges for the faster driver (`DRIVER (P#)`) and slower driver (`DRIVER (P#) +Δs`).
 *
 * @param {Object} rowGroups - D3 selection of `.teammate-row` groups.
 * @param {Function} xScale - D3 linear scale for diverging delta seconds.
 * @param {number} width - Inner chart width in pixels.
 * @param {number} barHeight - Bandwidth height of each constructor row.
 * @returns {void}
 */
function _renderDriverDeltaBadges(rowGroups, xScale, width, barHeight) {
    rowGroups
        .append('text')
        .attr('x', (d) => {
            const safeDelta = Number.isFinite(d.delta_s) ? d.delta_s : 0;
            return Math.max(_BADGE_EDGE_CLAMP_PX, xScale(-safeDelta) - _BADGE_HORIZONTAL_GAP_PX);
        })
        .attr('y', barHeight / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'end')
        .attr('fill', (d) => d.resolvedColor)
        .style('font-family', 'Titillium Web, sans-serif')
        .style('font-size', '11.5px')
        .style('font-weight', '700')
        .text((d) =>
            Number.isFinite(d.faster_time)
                ? `${d.faster_driver} (P${d.faster_grid})`
                : `${d.faster_driver} (P${d.faster_grid}) NO TIME`
        );

    rowGroups
        .append('text')
        .attr('x', (d) => {
            const safeDelta = Number.isFinite(d.delta_s) ? d.delta_s : 0;
            return Math.min(
                width - _BADGE_EDGE_CLAMP_PX,
                xScale(safeDelta) + _BADGE_HORIZONTAL_GAP_PX
            );
        })
        .attr('y', barHeight / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'start')
        .attr('fill', 'var(--text-muted)')
        .style('font-family', 'Titillium Web, sans-serif')
        .style('font-size', '11.5px')
        .style('font-weight', '700')
        .text((d) =>
            Number.isFinite(d.delta_s)
                ? `${d.slower_driver} (P${d.slower_grid}) +${d.delta_s.toFixed(3)}s`
                : `${d.slower_driver} (P${d.slower_grid}) NO TIME`
        );
}

/**
 * Renders the vertical `0.000s` center axis line dividing faster and slower teammates.
 *
 * @param {Object} svg - Root translated D3 `<g>` selection.
 * @param {number} centerX - X coordinate corresponding to `0.000s`.
 * @param {number} height - Inner chart height in pixels.
 * @returns {void}
 */
function _renderCenterReferenceLine(svg, centerX, height) {
    svg.append('line')
        .attr('x1', centerX)
        .attr('x2', centerX)
        .attr('y1', _CENTER_LINE_TOP_OFFSET_PX)
        .attr('y2', height)
        .attr('stroke', _CENTER_LINE_COLOR)
        .attr('stroke-width', _CENTER_LINE_STROKE_WIDTH_PX);
}

/**
 * Updates constructor row opacities based on hovered team or external focus key.
 *
 * @param {Object} rowGroups - D3 selection of `.teammate-row` groups.
 * @param {string|null} hoveredTeam - Currently hovered constructor name, or null.
 * @param {string|null} externalFocusKey - Externally focused driver or constructor code, or null.
 * @returns {void}
 */
function _updateTeammateFocusState(rowGroups, hoveredTeam, externalFocusKey) {
    rowGroups.style('opacity', (d) => {
        if (hoveredTeam !== null) {
            const isHoveredRow = d.team === hoveredTeam;
            return isHoveredRow ? _ACTIVE_OPACITY : _DIMMED_OPACITY;
        }
        if (externalFocusKey !== null) {
            const isMatchingTeamOrDriver = _isRowMatchingFocus(d, externalFocusKey);
            return isMatchingTeamOrDriver ? _ACTIVE_OPACITY : _DIMMED_OPACITY;
        }
        return _ACTIVE_OPACITY;
    });
}

/**
 * Appends transparent hit-area rectangles and binds hover listeners to constructor rows.
 *
 * @param {Object} rowGroups - D3 selection of `.teammate-row` groups.
 * @param {Object} tooltip - D3 selection of `#tooltip`.
 * @param {number} width - Inner chart width in pixels.
 * @param {number} barHeight - Bandwidth height of each constructor row.
 * @param {Function} onHoverChange - Callback invoked with hovered team name (or null on mouseout).
 * @returns {void}
 */
function _bindTeammateRowInteractions(rowGroups, tooltip, width, barHeight, onHoverChange) {
    rowGroups
        .append('rect')
        .attr('x', -_CHART_MARGIN.left)
        .attr('y', 0)
        .attr('width', width + _CHART_MARGIN.left + _CHART_MARGIN.right)
        .attr('height', barHeight)
        .attr('fill', 'transparent');

    rowGroups
        .on('mouseover', (event, d) => {
            onHoverChange(d.team);

            _populateTeammateTooltip(tooltip.node(), d, d.resolvedColor);
            tooltip
                .classed('hidden', false)
                .style('border-left-color', d.resolvedColor)
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
 * Renders the Teammate Qualifying Head-to-Head Delta horizontal diverging bar chart.
 *
 * @param {Object} data - Race telemetry payload containing `qualifying.teammate_deltas`.
 * @returns {void}
 */
export function renderQualiTeammate(data) {
    const container = document.getElementById('quali-teammate-chart');
    if (!container) return;

    container.replaceChildren();

    const rawDeltas = data.qualifying?.teammate_deltas || [];
    const hasTeammateDeltas = rawDeltas.length > 0;
    if (!hasTeammateDeltas) {
        _externalFocusHandler = null;
        _renderEmptyState(container, 'No teammate head-to-head qualifying data available.');
        return;
    }

    const teamColorMap = _buildTeamColorMap(data);
    const tooltip = d3.select('#tooltip');
    const deltas = _enrichTeammateDeltas(rawDeltas, teamColorMap);

    const width = Math.max(
        _MIN_CHART_WIDTH_PX,
        container.clientWidth - _CHART_MARGIN.left - _CHART_MARGIN.right
    );
    const height = deltas.length * _ROW_HEIGHT_PX;

    const domainBound = _computeTeammateDeltaDomainBound(deltas);
    const xScale = d3
        .scaleLinear()
        .domain([-domainBound, domainBound])
        .range([0, width]);

    const yScale = d3
        .scaleBand()
        .domain(deltas.map((d) => d.team))
        .range([0, height])
        .paddingInner(_Y_BAND_PADDING_INNER)
        .paddingOuter(_Y_BAND_PADDING_OUTER);

    const svgRoot = d3
        .select(container)
        .append('svg')
        .attr('width', width + _CHART_MARGIN.left + _CHART_MARGIN.right)
        .attr('height', height + _CHART_MARGIN.top + _CHART_MARGIN.bottom);

    _appendStripePatternDefs(svgRoot);

    const svg = svgRoot
        .append('g')
        .attr('transform', `translate(${_CHART_MARGIN.left},${_CHART_MARGIN.top})`);

    const centerX = xScale(0);
    _renderTeammateAxesAndHeaders(svg, xScale, centerX, width, height);

    const rowGroups = svg
        .selectAll('g.teammate-row')
        .data(deltas)
        .enter()
        .append('g')
        .attr('class', 'teammate-row')
        .attr('transform', (d) => `translate(0,${yScale(d.team)})`)
        .style('cursor', 'pointer');

    const barHeight = yScale.bandwidth();

    _renderConstructorLabelColumn(rowGroups, width, barHeight);
    _renderDivergingDeltaBars(rowGroups, xScale, centerX, barHeight);
    _renderDriverDeltaBadges(rowGroups, xScale, width, barHeight);
    _renderCenterReferenceLine(svg, centerX, height);

    let externalFocusKey = null;
    let hoveredTeam = null;

    const syncFocusState = () => {
        _updateTeammateFocusState(rowGroups, hoveredTeam, externalFocusKey);
    };

    _bindTeammateRowInteractions(rowGroups, tooltip, width, barHeight, (newHoveredTeam) => {
        hoveredTeam = newHoveredTeam;
        syncFocusState();
    });

    _externalFocusHandler = (driverOrTeamCode) => {
        externalFocusKey = driverOrTeamCode;
        syncFocusState();
    };
}
