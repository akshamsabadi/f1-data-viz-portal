const _CHART_MARGIN = { top: 36, right: 118, bottom: 44, left: 82 };
const _ROW_HEIGHT_PX = 25;
const _MIN_CHART_WIDTH_PX = 340;
const _Q1_COLOR = '#9ca3af';
const _Q2_COLOR = '#facc15';
const _Q3_CUTOFF_COLOR = '#facc15';
const _Q2_CUTOFF_COLOR = '#ef4444';
const _ACTIVE_OPACITY = 1;
const _DIMMED_OPACITY = 0.16;
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
 * Builds the interactive Q1 / Q2 / Q3 session stage legend inside `#quali-progression-legend`.
 *
 * @param {HTMLElement|null} legendContainer - DOM container for the legend items.
 * @param {Set<string>} activeStages - Set of currently enabled stage keys (`Q1`, `Q2`, `Q3`).
 * @param {Function} onToggle - Callback invoked when stage visibility is toggled.
 * @returns {void}
 */
function _buildProgressionLegend(legendContainer, activeStages, stagePrefix, onToggle) {
    if (!legendContainer) return;

    const stages = [
        { key: 'Q1', label: `${stagePrefix}1 LAP`, color: _Q1_COLOR, hollow: true },
        { key: 'Q2', label: `${stagePrefix}2 LAP`, color: _Q2_COLOR, hollow: false },
        { key: 'Q3', label: `${stagePrefix}3 SHOOTOUT`, color: '#ef4444', hollow: false }
    ];

    const updateLegendUI = () => {
        Array.from(legendContainer.children).forEach((child) => {
            const stageKey = child.dataset.stage;
            if (stageKey) {
                child.classList.toggle('inactive', !activeStages.has(stageKey));
            }
        });
    };

    stages.forEach((stage) => {
        const item = document.createElement('div');
        item.className = 'legend-item';
        item.dataset.stage = stage.key;

        const swatch = document.createElement('div');
        swatch.className = 'legend-color';
        if (stage.hollow) {
            swatch.style.backgroundColor = 'transparent';
            swatch.style.border = `2px solid ${stage.color}`;
        } else {
            swatch.style.backgroundColor = stage.color;
        }

        item.appendChild(swatch);
        item.appendChild(document.createTextNode(stage.label));

        item.addEventListener('click', () => {
            if (activeStages.has(stage.key)) {
                if (activeStages.size > 1) {
                    activeStages.delete(stage.key);
                }
            } else {
                activeStages.add(stage.key);
            }
            updateLegendUI();
            onToggle();
        });

        legendContainer.appendChild(item);
    });

    updateLegendUI();
}

/**
 * Populates the shared `#tooltip` element with a driver's Q1, Q2, Q3 progression details.
 *
 * @param {HTMLElement|null} tooltipNode - Shared `#tooltip` DOM node.
 * @param {Object} entry - Qualifying result entry for the hovered driver.
 * @param {string} teamColor - Driver's constructor hex color.
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

    const buildStageLine = (label, timeVal, badgeColor) => {
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

        const right = document.createElement('span');
        right.style.fontWeight = '600';
        right.style.color = timeVal ? 'var(--text-primary)' : 'var(--text-muted)';
        right.textContent = timeVal ? _formatLapTime(timeVal, 3) : 'ELIMINATED';

        line.appendChild(left);
        line.appendChild(right);
        return line;
    };

    const summary = document.createElement('div');
    summary.style.marginTop = '5px';
    summary.style.paddingTop = '4px';
    summary.style.borderTop = '1px solid rgba(255, 255, 255, 0.1)';
    summary.style.fontSize = '0.78rem';
    summary.style.fontWeight = '700';
    summary.style.color = entry.grid_pos === 1 ? '#4ade80' : 'var(--text-primary)';

    const progressionGain =
        Number.isFinite(entry.q1_time) && Number.isFinite(entry.best_time)
            ? entry.q1_time - entry.best_time
            : 0;
    const gainText =
        progressionGain > 0.0005 ? ` | ${stagePrefix}1→Best: -${progressionGain.toFixed(3)}s` : '';

    summary.textContent =
        entry.grid_pos === 1
            ? `POLE POSITION (${_formatLapTime(entry.best_time, 3)})${gainText}`
            : `Gap to Pole: +${entry.gap_to_pole.toFixed(3)}s${gainText}`;

    tooltipNode.replaceChildren(
        header,
        buildStageLine(`${stagePrefix}1`, entry.q1_time, _Q1_COLOR),
        buildStageLine(`${stagePrefix}2`, entry.q2_time, _Q2_COLOR),
        buildStageLine(`${stagePrefix}3`, entry.q3_time, teamColor),
        summary
    );
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

    if (results.length === 0) {
        _externalFocusHandler = null;
        const emptyMsg = document.createElement('p');
        emptyMsg.style.color = 'var(--text-muted)';
        emptyMsg.style.textAlign = 'center';
        emptyMsg.style.paddingTop = '2rem';
        emptyMsg.style.fontFamily = 'Montserrat, sans-serif';
        emptyMsg.style.textTransform = 'uppercase';
        emptyMsg.textContent = 'No qualifying progression data available.';
        container.replaceChildren(emptyMsg);
        return;
    }

    const colorMap = _buildDriverColorMap(data);
    const tooltip = d3.select('#tooltip');
    const activeStages = new Set(['Q1', 'Q2', 'Q3']);

    const width = Math.max(
        _MIN_CHART_WIDTH_PX,
        container.clientWidth - _CHART_MARGIN.left - _CHART_MARGIN.right
    );
    const height = results.length * _ROW_HEIGHT_PX;

    const allStageTimes = [];
    results.forEach((entry) => {
        if (Number.isFinite(entry.q1_time)) allStageTimes.push(entry.q1_time);
        if (Number.isFinite(entry.q2_time)) allStageTimes.push(entry.q2_time);
        if (Number.isFinite(entry.q3_time)) allStageTimes.push(entry.q3_time);
    });

    const minTime = d3.min(allStageTimes) || cutoffs.pole_time || 75;
    const maxTime = d3.max(allStageTimes) || minTime + 3;
    const timeSpan = Math.max(0.5, maxTime - minTime);

    const xScale = d3
        .scaleLinear()
        .domain([minTime - timeSpan * 0.06, maxTime + timeSpan * 0.06])
        .range([0, width]);

    const yScale = d3
        .scaleBand()
        .domain(results.map((d) => d.driver))
        .range([0, height])
        .paddingInner(0.22)
        .paddingOuter(0.15);

    const svg = d3
        .select(container)
        .append('svg')
        .attr('width', width + _CHART_MARGIN.left + _CHART_MARGIN.right)
        .attr('height', height + _CHART_MARGIN.top + _CHART_MARGIN.bottom)
        .append('g')
        .attr('transform', `translate(${_CHART_MARGIN.left},${_CHART_MARGIN.top})`);

    // Vertical gridlines
    svg.append('g')
        .attr('class', 'gridline')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(xScale).ticks(7).tickSize(-height).tickFormat(''));

    // Bottom X-axis (Lap Time m:ss.s)
    const xAxisGroup = svg
        .append('g')
        .attr('transform', `translate(0,${height})`)
        .call(
            d3
                .axisBottom(xScale)
                .ticks(7)
                .tickFormat((d) => _formatLapTime(d, 1))
        );

    xAxisGroup
        .append('text')
        .attr('x', width)
        .attr('y', 36)
        .attr('fill', 'var(--text-muted)')
        .attr('text-anchor', 'end')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '10.5px')
        .style('font-weight', '700')
        .text('QUALIFYING LAP TIME (M:SS.S)');

    // Horizontal Knockout Zone Dividers after P10 (Q3 Cutoff) and P16 (Q2 Cutoff)
    const drawHorizontalKnockoutDivider = (afterGridPos, labelText, strokeColor) => {
        const upperDriver = results.find((d) => d.grid_pos === afterGridPos);
        const lowerDriver = results.find((d) => d.grid_pos === afterGridPos + 1);
        if (!upperDriver || !lowerDriver) return;

        const yTop = yScale(upperDriver.driver) + yScale.bandwidth();
        const yBottom = yScale(lowerDriver.driver);
        const dividerY = (yTop + yBottom) / 2;

        svg.append('line')
            .attr('x1', -_CHART_MARGIN.left + 8)
            .attr('x2', width + _CHART_MARGIN.right - 8)
            .attr('y1', dividerY)
            .attr('y2', dividerY)
            .attr('stroke', strokeColor)
            .attr('stroke-width', 1.2)
            .attr('stroke-dasharray', '5,4')
            .attr('opacity', 0.7);

        svg.append('text')
            .attr('x', width - 4)
            .attr('y', dividerY - 4)
            .attr('text-anchor', 'end')
            .attr('fill', strokeColor)
            .style('font-family', 'Montserrat, sans-serif')
            .style('font-size', '9px')
            .style('font-weight', '700')
            .style('letter-spacing', '0.6px')
            .text(labelText);
    };

    const stagePrefix = data.qualifying?.stage_prefix || 'Q';
    drawHorizontalKnockoutDivider(
        10,
        `▲ ${stagePrefix}3 SHOOTOUT CUTOFF (TOP 10)`,
        _Q3_CUTOFF_COLOR
    );
    drawHorizontalKnockoutDivider(
        16,
        `▲ ${stagePrefix}2 KNOCKOUT CUTOFF (TOP 16)`,
        _Q2_CUTOFF_COLOR
    );

    // Vertical Dashed Cutoff Lines at cutoffs.q3_cutoff_time and cutoffs.q2_cutoff_time
    // Stagger vertical Y offsets (-21px vs -7px) so Q3 and Q2 cutoff labels never collide horizontally
    const drawVerticalCutoffLine = (timeSeconds, labelText, color, labelYOffset) => {
        if (!Number.isFinite(timeSeconds)) return;
        const cx = xScale(timeSeconds);
        const clampedTextX = Math.max(68, Math.min(width - 68, cx));

        svg.append('line')
            .attr('x1', cx)
            .attr('x2', cx)
            .attr('y1', labelYOffset + 4)
            .attr('y2', height)
            .attr('stroke', color)
            .attr('stroke-width', 1.3)
            .attr('stroke-dasharray', '4,4')
            .attr('opacity', 0.75);

        svg.append('text')
            .attr('x', clampedTextX)
            .attr('y', labelYOffset)
            .attr('text-anchor', 'middle')
            .attr('fill', color)
            .style('font-family', 'Montserrat, sans-serif')
            .style('font-size', '9.5px')
            .style('font-weight', '700')
            .text(`${labelText} (${_formatLapTime(timeSeconds, 3)})`);
    };

    drawVerticalCutoffLine(
        cutoffs.q3_cutoff_time,
        `${stagePrefix}3 CUTOFF`,
        _Q3_CUTOFF_COLOR,
        -21
    );
    drawVerticalCutoffLine(
        cutoffs.q2_cutoff_time,
        `${stagePrefix}2 CUTOFF`,
        _Q2_CUTOFF_COLOR,
        -7
    );

    // Driver Rows Group
    const rowGroups = svg
        .selectAll('g.progression-driver-row')
        .data(results)
        .enter()
        .append('g')
        .attr('class', 'progression-driver-row')
        .attr('transform', (d) => `translate(0,${yScale(d.driver) + yScale.bandwidth() / 2})`)
        .style('cursor', 'pointer');

    // Subtle horizontal track guide per row
    rowGroups
        .append('line')
        .attr('x1', 0)
        .attr('x2', width)
        .attr('y1', 0)
        .attr('y2', 0)
        .attr('stroke', 'rgba(255, 255, 255, 0.05)')
        .attr('stroke-width', 1);

    // Left Y-axis Driver Label (`P1 VER`)
    rowGroups
        .append('text')
        .attr('x', -10)
        .attr('y', 0)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'end')
        .attr('fill', (d) => colorMap.get(d.driver) || d.color || 'var(--text-primary)')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '11px')
        .style('font-weight', '700')
        .text((d) => `P${d.grid_pos} ${d.driver}`);

    // Connecting progression bar across active stages for each driver
    const connectorLines = rowGroups
        .append('line')
        .attr('class', 'stage-connector')
        .attr('y1', 0)
        .attr('y2', 0)
        .attr('stroke', (d) => colorMap.get(d.driver) || d.color || '#ffffff')
        .attr('stroke-width', 2.2)
        .attr('stroke-opacity', 0.65);

    // Stage Dots: Q1 (hollow/muted circle #9ca3af), Q2 (medium circle #facc15), Q3 (bright filled circle)
    const q1Dots = rowGroups
        .filter((d) => Number.isFinite(d.q1_time))
        .append('circle')
        .attr('class', 'stage-dot stage-q1')
        .attr('cx', (d) => xScale(d.q1_time))
        .attr('cy', 0)
        .attr('r', 4.2)
        .attr('fill', 'var(--bg-dark)')
        .attr('stroke', _Q1_COLOR)
        .attr('stroke-width', 2);

    const q2Dots = rowGroups
        .filter((d) => Number.isFinite(d.q2_time))
        .append('circle')
        .attr('class', 'stage-dot stage-q2')
        .attr('cx', (d) => xScale(d.q2_time))
        .attr('cy', 0)
        .attr('r', 4.8)
        .attr('fill', _Q2_COLOR)
        .attr('stroke', 'var(--bg-dark)')
        .attr('stroke-width', 1.2);

    const q3Dots = rowGroups
        .filter((d) => Number.isFinite(d.q3_time))
        .append('circle')
        .attr('class', 'stage-dot stage-q3')
        .attr('cx', (d) => xScale(d.q3_time))
        .attr('cy', 0)
        .attr('r', 5.6)
        .attr('fill', (d) => colorMap.get(d.driver) || d.color || '#ef4444')
        .attr('stroke', '#ffffff')
        .attr('stroke-width', 1.4);

    // Right-side Final Gap / Elimination Badge
    rowGroups
        .append('text')
        .attr('x', width + 10)
        .attr('y', 0)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'start')
        .attr('fill', (d) => {
            if (d.grid_pos === 1) return '#4ade80';
            if (d.eliminated_in === 'Q3' || d.eliminated_in === 'SQ3') return 'var(--text-primary)';
            return 'var(--text-muted)';
        })
        .style('font-family', 'Titillium Web, sans-serif')
        .style('font-size', '11.5px')
        .style('font-weight', '700')
        .text((d) => {
            if (d.grid_pos === 1) {
                return `POLE (${_formatLapTime(d.best_time, 3)})`;
            }
            const isTop10 = d.eliminated_in === 'Q3' || d.eliminated_in === 'SQ3';
            const stageSuffix = !isTop10 ? ` [${d.eliminated_in}]` : '';
            return `+${d.gap_to_pole.toFixed(3)}s${stageSuffix}`;
        });

    // Transparent hover hit area per row
    rowGroups
        .append('rect')
        .attr('x', -_CHART_MARGIN.left)
        .attr('y', -_ROW_HEIGHT_PX / 2)
        .attr('width', width + _CHART_MARGIN.left + _CHART_MARGIN.right)
        .attr('height', _ROW_HEIGHT_PX)
        .attr('fill', 'transparent');

    let externalDriver = null;
    let hoveredDriver = null;

    const updateVisualState = () => {
        q1Dots.style('display', activeStages.has('Q1') ? null : 'none');
        q2Dots.style('display', activeStages.has('Q2') ? null : 'none');
        q3Dots.style('display', activeStages.has('Q3') ? null : 'none');

        connectorLines.each(function (d) {
            const activeTimes = [];
            if (activeStages.has('Q1') && Number.isFinite(d.q1_time)) activeTimes.push(d.q1_time);
            if (activeStages.has('Q2') && Number.isFinite(d.q2_time)) activeTimes.push(d.q2_time);
            if (activeStages.has('Q3') && Number.isFinite(d.q3_time)) activeTimes.push(d.q3_time);

            const lineSel = d3.select(this);
            if (activeTimes.length >= 2) {
                lineSel
                    .style('display', null)
                    .attr('x1', xScale(d3.min(activeTimes)))
                    .attr('x2', xScale(d3.max(activeTimes)));
            } else {
                lineSel.style('display', 'none');
            }
        });

        const focused = hoveredDriver !== null ? hoveredDriver : externalDriver;
        rowGroups.style('opacity', (d) =>
            focused === null || d.driver === focused ? _ACTIVE_OPACITY : _DIMMED_OPACITY
        );
    };

    rowGroups
        .on('mouseover', (event, d) => {
            hoveredDriver = d.driver;
            updateVisualState();

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
            hoveredDriver = null;
            updateVisualState();
            tooltip.classed('hidden', true);
        });

    _externalFocusHandler = (driverCode) => {
        externalDriver = driverCode;
        updateVisualState();
    };

    _buildProgressionLegend(legendContainer, activeStages, stagePrefix, updateVisualState);
    updateVisualState();
}
