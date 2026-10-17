const _CHART_MARGIN = { top: 28, right: 32, bottom: 42, left: 138 };
const _ROW_HEIGHT_PX = 34;
const _MIN_CHART_WIDTH_PX = 340;
const _ACTIVE_OPACITY = 1;
const _DIMMED_OPACITY = 0.18;
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
    if (!Number.isFinite(seconds) || seconds <= 0) return 'N/A';
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

    const fasterLine = document.createElement('div');
    fasterLine.style.display = 'flex';
    fasterLine.style.justifyContent = 'space-between';
    fasterLine.style.gap = '14px';
    fasterLine.style.fontSize = '0.82rem';
    fasterLine.style.marginBottom = '3px';

    const fasterLeft = document.createElement('span');
    fasterLeft.style.fontWeight = '700';
    fasterLeft.style.color = '#4ade80';
    fasterLeft.textContent = `▲ ${entry.faster_driver} (P${entry.faster_grid})`;

    const fasterRight = document.createElement('span');
    fasterRight.style.fontWeight = '600';
    fasterRight.textContent = _formatLapTime(entry.faster_time);

    fasterLine.appendChild(fasterLeft);
    fasterLine.appendChild(fasterRight);

    const slowerLine = document.createElement('div');
    slowerLine.style.display = 'flex';
    slowerLine.style.justifyContent = 'space-between';
    slowerLine.style.gap = '14px';
    slowerLine.style.fontSize = '0.82rem';
    slowerLine.style.marginBottom = '4px';

    const slowerLeft = document.createElement('span');
    slowerLeft.style.fontWeight = '700';
    slowerLeft.style.color = 'var(--text-muted)';
    slowerLeft.textContent = `▼ ${entry.slower_driver} (P${entry.slower_grid})`;

    const slowerRight = document.createElement('span');
    slowerRight.style.fontWeight = '600';
    slowerRight.style.color = 'var(--text-muted)';
    slowerRight.textContent = _formatLapTime(entry.slower_time);

    slowerLine.appendChild(slowerLeft);
    slowerLine.appendChild(slowerRight);

    const deltaSummary = document.createElement('div');
    deltaSummary.style.paddingTop = '4px';
    deltaSummary.style.borderTop = '1px solid rgba(255, 255, 255, 0.1)';
    deltaSummary.style.fontSize = '0.8rem';
    deltaSummary.style.fontWeight = '700';
    deltaSummary.style.color = 'var(--text-primary)';
    deltaSummary.textContent = `Teammate Delta: +${entry.delta_s.toFixed(3)}s (${(entry.delta_s * 1000).toFixed(0)} ms)`;

    tooltipNode.replaceChildren(header, fasterLine, slowerLine, deltaSummary);
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
    if (rawDeltas.length === 0) {
        _externalFocusHandler = null;
        const emptyMsg = document.createElement('p');
        emptyMsg.style.color = 'var(--text-muted)';
        emptyMsg.style.textAlign = 'center';
        emptyMsg.style.paddingTop = '2rem';
        emptyMsg.style.fontFamily = 'Montserrat, sans-serif';
        emptyMsg.style.textTransform = 'uppercase';
        emptyMsg.textContent = 'No teammate head-to-head qualifying data available.';
        container.replaceChildren(emptyMsg);
        return;
    }

    const teamColorMap = _buildTeamColorMap(data);
    const tooltip = d3.select('#tooltip');
    const deltas = rawDeltas.map((d) => ({
        ...d,
        resolvedColor: teamColorMap.get(d.team) || d.color || 'var(--accent)'
    }));

    const width = Math.max(
        _MIN_CHART_WIDTH_PX,
        container.clientWidth - _CHART_MARGIN.left - _CHART_MARGIN.right
    );
    const height = deltas.length * _ROW_HEIGHT_PX;

    const maxDelta = Math.max(0.4, d3.max(deltas, (d) => d.delta_s) || 1.0);
    const domainBound = maxDelta * 1.48;

    const xScale = d3
        .scaleLinear()
        .domain([-domainBound, domainBound])
        .range([0, width]);

    const yScale = d3
        .scaleBand()
        .domain(deltas.map((d) => d.team))
        .range([0, height])
        .paddingInner(0.28)
        .paddingOuter(0.15);

    const svgRoot = d3
        .select(container)
        .append('svg')
        .attr('width', width + _CHART_MARGIN.left + _CHART_MARGIN.right)
        .attr('height', height + _CHART_MARGIN.top + _CHART_MARGIN.bottom);

    // Define diagonal stripe overlay pattern for slower teammate bars
    const defs = svgRoot.append('defs');
    const pattern = defs
        .append('pattern')
        .attr('id', 'quali-teammate-stripe-pattern')
        .attr('width', 6)
        .attr('height', 6)
        .attr('patternUnits', 'userSpaceOnUse')
        .attr('patternTransform', 'rotate(45)');

    pattern
        .append('line')
        .attr('x1', 0)
        .attr('y1', 0)
        .attr('x2', 0)
        .attr('y2', 6)
        .attr('stroke', 'rgba(15, 15, 22, 0.55)')
        .attr('stroke-width', 3);

    const svg = svgRoot
        .append('g')
        .attr('transform', `translate(${_CHART_MARGIN.left},${_CHART_MARGIN.top})`);

    const centerX = xScale(0);

    // Vertical gridlines
    svg.append('g')
        .attr('class', 'gridline')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(xScale).ticks(7).tickSize(-height).tickFormat(''));

    // Top directional column headers
    svg.append('text')
        .attr('x', centerX - 12)
        .attr('y', -10)
        .attr('text-anchor', 'end')
        .attr('fill', '#4ade80')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '9.5px')
        .style('font-weight', '700')
        .style('letter-spacing', '0.6px')
        .text('◀ FASTER TEAMMATE (-Δs)');

    svg.append('text')
        .attr('x', centerX + 12)
        .attr('y', -10)
        .attr('text-anchor', 'start')
        .attr('fill', 'var(--text-muted)')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '9.5px')
        .style('font-weight', '700')
        .style('letter-spacing', '0.6px')
        .text('SLOWER TEAMMATE (+Δs) ▶');

    // Bottom X-axis
    const xAxisGroup = svg
        .append('g')
        .attr('transform', `translate(0,${height})`)
        .call(
            d3
                .axisBottom(xScale)
                .ticks(7)
                .tickFormat((d) => {
                    if (Math.abs(d) < 0.0005) return '0.000s';
                    return `${d > 0 ? '+' : ''}${d.toFixed(2)}s`;
                })
        );

    xAxisGroup
        .append('text')
        .attr('x', width)
        .attr('y', 35)
        .attr('fill', 'var(--text-muted)')
        .attr('text-anchor', 'end')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '10.5px')
        .style('font-weight', '700')
        .text('TEAMMATE QUALIFYING DELTA (SECONDS)');

    const rowGroups = svg
        .selectAll('g.teammate-row')
        .data(deltas)
        .enter()
        .append('g')
        .attr('class', 'teammate-row')
        .attr('transform', (d) => `translate(0,${yScale(d.team)})`)
        .style('cursor', 'pointer');

    const barHeight = yScale.bandwidth();

    // Subtle row guide line
    rowGroups
        .append('line')
        .attr('x1', 0)
        .attr('x2', width)
        .attr('y1', barHeight / 2)
        .attr('y2', barHeight / 2)
        .attr('stroke', 'rgba(255, 255, 255, 0.04)')
        .attr('stroke-width', 1);

    // Left Y-axis Constructor Label + Color Bar
    rowGroups
        .append('rect')
        .attr('x', -12)
        .attr('y', 3)
        .attr('width', 3)
        .attr('height', Math.max(8, barHeight - 6))
        .attr('rx', 1.5)
        .attr('fill', (d) => d.resolvedColor);

    rowGroups
        .append('text')
        .attr('x', -18)
        .attr('y', barHeight / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'end')
        .attr('fill', 'var(--text-primary)')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '10.5px')
        .style('font-weight', '700')
        .text((d) => d.team.toUpperCase());

    // Left Bar: Faster Driver (-delta_s to 0) in full team color
    rowGroups
        .append('rect')
        .attr('class', 'faster-bar')
        .attr('x', (d) => xScale(-d.delta_s))
        .attr('y', 2)
        .attr('width', (d) => Math.max(2, centerX - xScale(-d.delta_s)))
        .attr('height', Math.max(8, barHeight - 4))
        .attr('rx', 3)
        .attr('fill', (d) => d.resolvedColor)
        .attr('fill-opacity', 0.92);

    // Right Bar Base: Slower Driver (0 to +delta_s) in muted team color
    rowGroups
        .append('rect')
        .attr('class', 'slower-bar-base')
        .attr('x', centerX)
        .attr('y', 2)
        .attr('width', (d) => Math.max(2, xScale(d.delta_s) - centerX))
        .attr('height', Math.max(8, barHeight - 4))
        .attr('rx', 3)
        .attr('fill', (d) => d.resolvedColor)
        .attr('fill-opacity', 0.38)
        .attr('stroke', (d) => d.resolvedColor)
        .attr('stroke-opacity', 0.65)
        .attr('stroke-width', 1);

    // Right Bar Diagonal Stripe Overlay
    rowGroups
        .append('rect')
        .attr('class', 'slower-bar-stripes')
        .attr('x', centerX)
        .attr('y', 2)
        .attr('width', (d) => Math.max(2, xScale(d.delta_s) - centerX))
        .attr('height', Math.max(8, barHeight - 4))
        .attr('rx', 3)
        .attr('fill', 'url(#quali-teammate-stripe-pattern)');

    // Left Badge: `faster_driver (P{faster_grid})`
    rowGroups
        .append('text')
        .attr('x', (d) => Math.max(4, xScale(-d.delta_s) - 7))
        .attr('y', barHeight / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'end')
        .attr('fill', (d) => d.resolvedColor)
        .style('font-family', 'Titillium Web, sans-serif')
        .style('font-size', '11.5px')
        .style('font-weight', '700')
        .text((d) => `${d.faster_driver} (P${d.faster_grid})`);

    // Right Badge: `slower_driver (P{slower_grid}) +delta_s`
    rowGroups
        .append('text')
        .attr('x', (d) => Math.min(width - 4, xScale(d.delta_s) + 7))
        .attr('y', barHeight / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'start')
        .attr('fill', 'var(--text-muted)')
        .style('font-family', 'Titillium Web, sans-serif')
        .style('font-size', '11.5px')
        .style('font-weight', '700')
        .text((d) => `${d.slower_driver} (P${d.slower_grid}) +${d.delta_s.toFixed(3)}s`);

    // Center 0.000s Reference Axis Line
    svg.append('line')
        .attr('x1', centerX)
        .attr('x2', centerX)
        .attr('y1', -4)
        .attr('y2', height)
        .attr('stroke', 'rgba(255, 255, 255, 0.55)')
        .attr('stroke-width', 1.5);

    // Transparent hover hit area per row
    rowGroups
        .append('rect')
        .attr('x', -_CHART_MARGIN.left)
        .attr('y', 0)
        .attr('width', width + _CHART_MARGIN.left + _CHART_MARGIN.right)
        .attr('height', barHeight)
        .attr('fill', 'transparent');

    let externalFocusKey = null;
    let hoveredTeam = null;

    const updateFocusState = () => {
        rowGroups.style('opacity', (d) => {
            if (hoveredTeam !== null) {
                return d.team === hoveredTeam ? _ACTIVE_OPACITY : _DIMMED_OPACITY;
            }
            if (externalFocusKey !== null) {
                const matchesTeamOrDriver =
                    d.team === externalFocusKey ||
                    d.faster_driver === externalFocusKey ||
                    d.slower_driver === externalFocusKey;
                return matchesTeamOrDriver ? _ACTIVE_OPACITY : _DIMMED_OPACITY;
            }
            return _ACTIVE_OPACITY;
        });
    };

    rowGroups
        .on('mouseover', (event, d) => {
            hoveredTeam = d.team;
            updateFocusState();

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
            hoveredTeam = null;
            updateFocusState();
            tooltip.classed('hidden', true);
        });

    _externalFocusHandler = (driverOrTeamCode) => {
        externalFocusKey = driverOrTeamCode;
        updateFocusState();
    };
}
