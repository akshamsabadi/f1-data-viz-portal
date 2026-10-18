import { calculateDriverClassification, getBumpLineOpacity } from './standings.js';

const _CHART_MARGIN = { top: 20, right: 76, bottom: 40, left: 76 };
const _CHART_HEIGHT_PX = 440;
const _DEFAULT_MAX_POSITIONS = 22;
const _X_AXIS_TICKS = 10;
const _X_AXIS_LABEL_OFFSET_Y_PX = 35;
const _Y_AXIS_TICK_PADDING_PX = 38;
const _Y_AXIS_LABEL_OFFSET_Y_PX = -62;
const _DEFAULT_STROKE_WIDTH = 2;
const _HOVER_STROKE_WIDTH = 4;
const _HOVER_TARGET_STROKE_WIDTH = 12;
const _NODE_RADIUS_PX = 4;
const _NODE_STROKE_WIDTH_PX = 1;
const _LABEL_OFFSET_X_PX = 8;
const _LABEL_HALO_STROKE_WIDTH_PX = 3.5;
const _START_LABEL_FONT_SIZE_PX = '10.5px';
const _END_LABEL_FONT_SIZE_PX = '11px';
const _FALLBACK_LINE_COLOR = '#ccc';
const _GAIN_COLOR = '#22c55e';
const _LOSS_COLOR = '#ef4444';
const _ACTIVE_OPACITY = 1;
const _DIMMED_OPACITY = 0.38;
const _TEAMMATE_SECOND_DASH_ARRAY = '8,4';
const _DNS_DASH_ARRAY = '1,4';
const _DNF_DASH_ARRAY = '3,3';
const _TOOLTIP_OFFSET_X_PX = 15;
const _TOOLTIP_OFFSET_Y_PX = -30;

const _PLAYHEAD_COLOR = '#e5e7eb';
const _PLAYHEAD_STROKE_WIDTH_PX = 1.8;
const _PLAYHEAD_DASH_ARRAY = '5,3';
const _PLAYHEAD_PILL_WIDTH_PX = 46;
const _PLAYHEAD_PILL_HEIGHT_PX = 15;
const _PLAYHEAD_PILL_Y_OFFSET_PX = -17;
const _PLAYHEAD_PILL_RADIUS_PX = 3;
const _PLAYHEAD_PILL_BG_FILL = 'rgba(17, 17, 24, 0.96)';

let _externalBumpFocusHandler = null;
let _bumpPlayheadHandler = null;
let _currentBumpPlayheadLap = null;

/**
 * Highlights or restores a driver's trajectory in the Track Position bump chart from an external trigger.
 *
 * @param {string|null} driverCode - Three-letter driver code to highlight, or null to restore.
 * @returns {void}
 */
export function setBumpExternalFocus(driverCode) {
    if (_externalBumpFocusHandler) {
        _externalBumpFocusHandler(driverCode);
    }
}

/**
 * Updates or hides the synchronized vertical lap playhead line across `#bump-chart`.
 *
 * @param {number|null} lapNumber - Lap number to highlight (`0..maxLap`), or `null` to hide.
 * @returns {void}
 */
export function setBumpPlayheadLap(lapNumber) {
    _currentBumpPlayheadLap =
        lapNumber !== null && lapNumber !== undefined && Number.isFinite(Number(lapNumber))
            ? Number(lapNumber)
            : null;
    if (_bumpPlayheadHandler) {
        _bumpPlayheadHandler(_currentBumpPlayheadLap);
    }
}

/**
 * Determines which drivers are the second-classified teammate within their constructor.
 *
 * @param {Array<Object>} classification - Sorted driver classification list.
 * @returns {Set<string>} Set of driver codes that are the 2nd teammate on their team.
 */
function _identifySecondTeammates(classification) {
    const firstSeenByTeam = new Set();
    const secondTeammates = new Set();

    classification.forEach((entry) => {
        if (!firstSeenByTeam.has(entry.team)) {
            firstSeenByTeam.add(entry.team);
        } else {
            secondTeammates.add(entry.code);
        }
    });

    return secondTeammates;
}

/**
 * Builds a lookup map from driver code to starting grid position (Lap 0).
 * Uses `data.qualifying.results` (`grid_pos`) when available, and falls back
 * to Lap 1 order or classification rank when qualifying results are absent.
 *
 * @param {Object} data - Race telemetry payload.
 * @param {Array<Object>} classification - Computed driver classification list.
 * @returns {Map<string, number>} Map of driver code to 1-indexed starting grid position.
 */
function _buildStartingGridMap(data, classification) {
    const gridMap = new Map();
    const qualiResults = data?.qualifying?.results;

    if (Array.isArray(qualiResults) && qualiResults.length > 0) {
        qualiResults.forEach((entry) => {
            const pos = Number(entry.grid_pos ?? entry.position);
            if (entry.driver && Number.isFinite(pos) && pos > 0) {
                gridMap.set(entry.driver, pos);
            }
        });
    }

    const usedPositions = new Set(gridMap.values());
    let nextFallbackPos = 1;
    const findNextFreePos = () => {
        while (usedPositions.has(nextFallbackPos)) {
            nextFallbackPos += 1;
        }
        usedPositions.add(nextFallbackPos);
        return nextFallbackPos;
    };

    classification.forEach((entry) => {
        if (!gridMap.has(entry.code)) {
            const lap1Pos = entry.laps?.[0]?.position;
            if (Number.isFinite(lap1Pos) && !usedPositions.has(lap1Pos)) {
                usedPositions.add(lap1Pos);
                gridMap.set(entry.code, lap1Pos);
            } else {
                gridMap.set(entry.code, findNextFreePos());
            }
        }
    });

    return gridMap;
}

/**
 * Constructs a Map of driver code to processed lap arrays in the original driver list order,
 * starting every driver at `lap: 0` at their starting grid position (`gridPos`),
 * aligning all classified finishers (including lapped finishers) to `maxLap` at their `finalRank`
 * while keeping DNF drop-offs at their retirement lap.
 *
 * @param {Array<{code: string}>} drivers - Original drivers list from race payload.
 * @param {Array<Object>} classification - Computed driver classification entries from `calculateDriverClassification`.
 * @param {number} maxLap - Total laps completed by the winner.
 * @param {Set<string>} secondTeammates - Set of driver codes representing the 2nd teammate per constructor.
 * @param {Map<string, number>} gridMap - Map of driver code to starting grid position (Lap 0).
 * @returns {Map<string, Array<Object>>} Map of driver code to lap position records.
 */
function _buildProcessedDriverLaps(drivers, classification, maxLap, secondTeammates, gridMap) {
    const processedByDriver = new Map();
    const byCode = new Map(classification.map((entry) => [entry.code, entry]));

    drivers.forEach((driver) => {
        const classifiedDriver = byCode.get(driver.code);
        if (!classifiedDriver) return;

        const realLaps = classifiedDriver.laps;
        const finalRank = classifiedDriver.rank;
        const isSecondTeammate = secondTeammates.has(driver.code);
        const gridPos = gridMap.get(driver.code) ?? finalRank;

        const lap0Point = {
            driver: driver.code,
            lap: 0,
            position: gridPos,
            isGridStart: true,
            isDns: classifiedDriver.isDns,
            isSecondTeammate
        };

        let processedLaps = [];
        if (classifiedDriver.isDns) {
            processedLaps = [
                lap0Point,
                {
                    driver: driver.code,
                    lap: 1,
                    position: finalRank,
                    isDns: true,
                    isSecondTeammate
                }
            ];
        } else if (classifiedDriver.isDnf) {
            const dropLap = Math.min(classifiedDriver.lapsCompleted + 1, maxLap);
            processedLaps = [
                lap0Point,
                ...realLaps.map((lap) => ({ ...lap, isSecondTeammate })),
                {
                    driver: driver.code,
                    lap: dropLap,
                    position: finalRank,
                    isDnf: true,
                    isSecondTeammate
                }
            ];
        } else {
            const clonedLaps = realLaps.map((lap) => ({ ...lap, isSecondTeammate }));
            if (clonedLaps.length > 0) {
                const lastRecordedLap = clonedLaps[clonedLaps.length - 1];
                if (lastRecordedLap.lap < maxLap) {
                    clonedLaps.push({
                        driver: driver.code,
                        lap: maxLap,
                        position: finalRank,
                        isLappedFinisher: true,
                        isSecondTeammate
                    });
                } else {
                    lastRecordedLap.position = finalRank;
                }
            }
            processedLaps = [lap0Point, ...clonedLaps];
        }

        processedByDriver.set(driver.code, processedLaps);
    });

    return processedByDriver;
}

/**
 * Returns the SVG stroke-dasharray pattern for a driver's bump line based on DNS/DNF/teammate status.
 *
 * @param {Array<{isDns?: boolean, isDnf?: boolean, isSecondTeammate?: boolean}>} laps - Processed lap series for a driver.
 * @returns {string} SVG `stroke-dasharray` attribute value.
 */
function _getStrokeDashArray(laps) {
    const isDns = Boolean(laps[0]?.isDns);
    const isDnf = Boolean(laps[laps.length - 1]?.isDnf);
    const isSecondTeammate = Boolean(laps[0]?.isSecondTeammate);
    if (isDns) return _DNS_DASH_ARRAY;
    if (isDnf) return _DNF_DASH_ARRAY;
    if (isSecondTeammate) return _TEAMMATE_SECOND_DASH_ARRAY;
    return 'none';
}

/**
 * Formats the right-hand driver code label with `(DNS)` or `(DNF)` suffixes when applicable.
 *
 * @param {string} driverCode - Three-letter driver code.
 * @param {Array<{isDns?: boolean, isDnf?: boolean}>} laps - Processed lap series for a driver.
 * @returns {string} Formatted end label text.
 */
function _formatEndLabelText(driverCode, laps) {
    const isDns = Boolean(laps[0]?.isDns);
    const isDnf = Boolean(laps[laps.length - 1]?.isDnf);
    if (isDns) return `${driverCode} (DNS)`;
    if (isDnf) return `${driverCode} (DNF)`;
    return driverCode;
}

/**
 * Renders an empty-state message inside `#bump-chart`.
 *
 * @param {HTMLElement} container - Bump chart container element.
 * @returns {void}
 */
function _renderEmptyBumpState(container) {
    const emptyMsg = document.createElement('p');
    emptyMsg.style.color = 'var(--text-muted)';
    emptyMsg.style.textAlign = 'center';
    emptyMsg.style.paddingTop = '2rem';
    emptyMsg.style.fontFamily = 'Montserrat, sans-serif';
    emptyMsg.style.textTransform = 'uppercase';
    emptyMsg.textContent = 'No position data available.';
    container.replaceChildren(emptyMsg);
}

/**
 * Renders background gridlines, the horizontal Lap axis, and the vertical Position axis.
 *
 * @param {Object} svg - D3 selection for the chart's main translated group.
 * @param {Function} xScale - D3 linear scale for lap numbers.
 * @param {Function} yScale - D3 linear scale for track positions.
 * @param {number} width - Inner chart width in pixels.
 * @param {number} height - Inner chart height in pixels.
 * @param {number} maxPos - Total number of driver positions on the vertical axis.
 * @returns {void}
 */
function _renderBumpAxesAndGrid(svg, xScale, yScale, width, height, maxPos) {
    svg.append('g')
        .attr('class', 'gridline')
        .call(d3.axisLeft(yScale).tickSize(-width).tickFormat('').ticks(maxPos));

    svg.append('g')
        .attr('transform', `translate(0,${height + 8})`)
        .call(d3.axisBottom(xScale).ticks(_X_AXIS_TICKS).tickFormat(d3.format('d')))
        .append('text')
        .attr('x', width)
        .attr('y', _X_AXIS_LABEL_OFFSET_Y_PX - 4)
        .attr('fill', 'var(--text-muted)')
        .attr('text-anchor', 'end')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-weight', '600')
        .text('LAP');

    svg.append('g')
        .call(d3.axisLeft(yScale).ticks(maxPos).tickPadding(_Y_AXIS_TICK_PADDING_PX))
        .append('text')
        .attr('transform', 'rotate(-90)')
        .attr('y', _Y_AXIS_LABEL_OFFSET_Y_PX)
        .attr('x', 0)
        .attr('fill', 'var(--text-muted)')
        .attr('text-anchor', 'end')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-weight', '600')
        .text('POSITION');
}

/**
 * Renders the visible position paths and wider transparent hit-target paths.
 *
 * @param {Object} svg - D3 selection for the chart's main group.
 * @param {Map<string, Array<Object>>} driverLapsProcessed - Processed lap series per driver.
 * @param {Object<string, string>} driverColors - Map of driver code to team color.
 * @param {Function} lineGenerator - D3 line generator.
 * @returns {{paths: Object, hoverPaths: Object}} D3 selections for visible and hover paths.
 */
function _renderBumpLines(svg, driverLapsProcessed, driverColors, lineGenerator) {
    const linesGroup = svg.append('g').attr('class', 'lines-group');

    const paths = linesGroup
        .selectAll('.bump-line')
        .data(driverLapsProcessed)
        .enter()
        .append('path')
        .attr('class', 'bump-line')
        .attr('fill', 'none')
        .attr('stroke', (d) => driverColors[d[0]] || _FALLBACK_LINE_COLOR)
        .attr('stroke-width', _DEFAULT_STROKE_WIDTH)
        .attr('opacity', (d) => getBumpLineOpacity(d[1]))
        .attr('stroke-dasharray', (d) => _getStrokeDashArray(d[1]))
        .attr('d', (d) => lineGenerator(d[1]));

    const hoverPaths = linesGroup
        .selectAll('.bump-line-hover')
        .data(driverLapsProcessed)
        .enter()
        .append('path')
        .attr('class', 'bump-line-hover')
        .attr('fill', 'none')
        .attr('stroke', 'transparent')
        .attr('stroke-width', _HOVER_TARGET_STROKE_WIDTH)
        .style('cursor', 'pointer')
        .attr('d', (d) => lineGenerator(d[1]));

    return { paths, hoverPaths };
}

/**
 * Renders start circles, start driver labels, finishing circles, and finishing driver code labels.
 *
 * @param {Object} svg - D3 selection for the chart's main group.
 * @param {Map<string, Array<Object>>} driverLapsProcessed - Processed lap series per driver.
 * @param {Object<string, string>} driverColors - Map of driver code to team color.
 * @param {Function} xScale - D3 linear scale for lap numbers.
 * @param {Function} yScale - D3 linear scale for track positions.
 * @returns {{startNodes: Object, startLabels: Object, endNodes: Object, endLabels: Object}} D3 selections for nodes and labels.
 */
function _renderBumpNodesAndLabels(svg, driverLapsProcessed, driverColors, xScale, yScale) {
    const starters = Array.from(driverLapsProcessed);

    const startNodesGroup = svg.append('g').attr('class', 'start-nodes');
    const startNodes = startNodesGroup
        .selectAll('.start-node')
        .data(starters)
        .enter()
        .append('circle')
        .attr('class', 'start-node')
        .attr('cx', (d) => xScale(d[1][0].lap))
        .attr('cy', (d) => yScale(d[1][0].position))
        .attr('r', _NODE_RADIUS_PX)
        .attr('fill', (d) => driverColors[d[0]] || _FALLBACK_LINE_COLOR)
        .attr('stroke', 'var(--bg-dark)')
        .attr('stroke-width', _NODE_STROKE_WIDTH_PX);

    const startLabels = startNodesGroup
        .selectAll('.start-label')
        .data(starters)
        .enter()
        .append('text')
        .attr('class', 'start-label')
        .attr('x', (d) => xScale(d[1][0].lap) - _LABEL_OFFSET_X_PX)
        .attr('y', (d) => yScale(d[1][0].position))
        .attr('dy', '0.35em')
        .attr('text-anchor', 'end')
        .attr('fill', (d) => driverColors[d[0]] || _FALLBACK_LINE_COLOR)
        .style('paint-order', 'stroke')
        .attr('stroke', 'var(--bg-dark)')
        .attr('stroke-width', _LABEL_HALO_STROKE_WIDTH_PX)
        .attr('stroke-linejoin', 'round')
        .style('font-family', 'Titillium Web, sans-serif')
        .style('font-size', _START_LABEL_FONT_SIZE_PX)
        .style('font-weight', '700')
        .text((d) => d[0]);

    const endNodesGroup = svg.append('g').attr('class', 'end-nodes');
    const endNodes = endNodesGroup
        .selectAll('.end-node')
        .data(driverLapsProcessed)
        .enter()
        .append('circle')
        .attr('class', 'end-node')
        .attr('cx', (d) => xScale(d[1][d[1].length - 1].lap))
        .attr('cy', (d) => yScale(d[1][d[1].length - 1].position))
        .attr('r', _NODE_RADIUS_PX)
        .attr('fill', (d) => driverColors[d[0]] || _FALLBACK_LINE_COLOR)
        .attr('stroke', 'var(--bg-dark)')
        .attr('stroke-width', _NODE_STROKE_WIDTH_PX);

    const endLabels = endNodesGroup
        .selectAll('.end-label')
        .data(driverLapsProcessed)
        .enter()
        .append('text')
        .attr('class', 'end-label')
        .attr('x', (d) => xScale(d[1][d[1].length - 1].lap) + _LABEL_OFFSET_X_PX)
        .attr('y', (d) => yScale(d[1][d[1].length - 1].position))
        .attr('dy', '0.35em')
        .attr('fill', (d) => driverColors[d[0]] || _FALLBACK_LINE_COLOR)
        .style('paint-order', 'stroke')
        .attr('stroke', 'var(--bg-dark)')
        .attr('stroke-width', _LABEL_HALO_STROKE_WIDTH_PX)
        .attr('stroke-linejoin', 'round')
        .style('font-family', 'Titillium Web, sans-serif')
        .style('font-size', _END_LABEL_FONT_SIZE_PX)
        .style('font-weight', '700')
        .text((d) => _formatEndLabelText(d[0], d[1]));

    return { startNodes, startLabels, endNodes, endLabels };
}

/**
 * Creates a styled `<span>` element representing the position gain/loss between starting grid and finish.
 *
 * @param {number} startPos - Starting grid position.
 * @param {number} finishPos - Official final classification rank.
 * @returns {HTMLSpanElement} Styled delta badge span element.
 */
function _createPositionDeltaSpan(startPos, finishPos) {
    const delta = startPos - finishPos;
    const span = document.createElement('span');

    if (delta > 0) {
        span.style.color = _GAIN_COLOR;
        span.style.fontWeight = '700';
        span.textContent = `▲ +${delta}`;
        return span;
    }
    if (delta < 0) {
        span.style.color = _LOSS_COLOR;
        span.style.fontWeight = '700';
        span.textContent = `▼ ${delta}`;
        return span;
    }

    span.style.color = 'var(--text-muted)';
    span.style.fontWeight = '600';
    span.textContent = '— 0';
    return span;
}

/**
 * Populates the shared `#tooltip` DOM node with driver grid, Lap 1, and finish position details.
 *
 * @param {HTMLElement|null} tooltipNode - DOM node of `#tooltip`.
 * @param {Object} info - Driver classification entry.
 * @param {Array<Object>} laps - Processed lap series for the hovered driver.
 * @returns {void}
 */
function _populateBumpTooltip(tooltipNode, info, laps) {
    if (!tooltipNode || !info) return;

    const gridPos = laps[0]?.position ?? info.rank;
    const lap1Pos = laps[1]?.position ?? gridPos;
    const finishPos = info.rank;

    const headerDiv = document.createElement('div');
    headerDiv.style.fontFamily = 'Montserrat, sans-serif';
    headerDiv.style.fontWeight = '700';
    headerDiv.style.marginBottom = '4px';
    headerDiv.style.textTransform = 'uppercase';
    headerDiv.appendChild(document.createTextNode(info.code));

    const teamSpan = document.createElement('span');
    teamSpan.style.color = 'var(--text-muted)';
    teamSpan.style.fontWeight = '600';
    teamSpan.style.fontSize = '0.75rem';
    teamSpan.style.marginLeft = '6px';
    teamSpan.textContent = info.team;
    headerDiv.appendChild(teamSpan);

    const summaryDiv = document.createElement('div');
    summaryDiv.style.fontSize = '0.85rem';
    summaryDiv.style.fontWeight = '600';

    if (info.isDns) {
        summaryDiv.textContent = `Grid: P${gridPos} → DNS`;
    } else if (info.isDnf) {
        summaryDiv.textContent = `Grid: P${gridPos} · Lap 1: P${lap1Pos} → DNF (Lap ${info.lapsCompleted})`;
    } else {
        summaryDiv.appendChild(
            document.createTextNode(
                `Grid: P${gridPos} · Lap 1: P${lap1Pos} → Finish: P${finishPos} `
            )
        );
        summaryDiv.appendChild(_createPositionDeltaSpan(gridPos, finishPos));
    }

    tooltipNode.replaceChildren(headerDiv, summaryDiv);
}

/**
 * Binds mouseover, mousemove, and mouseout focus and tooltip handlers to the bump chart.
 *
 * @param {Object} hoverPaths - D3 selection of transparent hit-target paths.
 * @param {Map<string, Object>} classificationByCode - Map of driver code to classification entry.
 * @param {Function} applyFocusState - Function that highlights a given driverCode or restores default when null.
 * @returns {void}
 */
function _bindBumpHoverInteraction(
    hoverPaths,
    classificationByCode,
    applyFocusState
) {
    const tooltip = d3.select('#tooltip');

    const handleMouseOver = (event, hoveredEntry) => {
        const hoveredDriver = hoveredEntry[0];
        const laps = hoveredEntry[1];
        const info = classificationByCode.get(hoveredDriver);
        applyFocusState(hoveredDriver);

        if (!info) return;
        _populateBumpTooltip(tooltip.node(), info, laps);

        tooltip
            .classed('hidden', false)
            .style('border-left-color', info.color || 'var(--accent)')
            .style('left', `${event.pageX + _TOOLTIP_OFFSET_X_PX}px`)
            .style('top', `${event.pageY + _TOOLTIP_OFFSET_Y_PX}px`);
    };

    const handleMouseMove = (event) => {
        tooltip
            .style('left', `${event.pageX + _TOOLTIP_OFFSET_X_PX}px`)
            .style('top', `${event.pageY + _TOOLTIP_OFFSET_Y_PX}px`);
    };

    const handleMouseOut = () => {
        tooltip.classed('hidden', true);
        applyFocusState(null);
    };

    hoverPaths
        .on('mouseover', handleMouseOver)
        .on('mousemove', handleMouseMove)
        .on('mouseout', handleMouseOut);
}

/**
 * Applies visual focus styling across bump lines, start/end circles, and driver labels.
 *
 * @param {Object} selections - Object containing `paths`, `startNodes`, `startLabels`, `endNodes`, and `endLabels`.
 * @param {string|null} activeDriver - Currently focused or hovered driver code, or null.
 * @returns {void}
 */
function _applyBumpVisualFocus(selections, activeDriver) {
    const { paths, startNodes, startLabels, endNodes, endLabels } = selections;

    if (activeDriver === null) {
        paths
            .attr('opacity', (p) => getBumpLineOpacity(p[1]))
            .attr('stroke-width', _DEFAULT_STROKE_WIDTH);
        startNodes.attr('opacity', _ACTIVE_OPACITY);
        startLabels.attr('opacity', _ACTIVE_OPACITY);
        endNodes.attr('opacity', _ACTIVE_OPACITY);
        endLabels.attr('opacity', _ACTIVE_OPACITY);
        return;
    }

    paths
        .attr('opacity', (p) =>
            p[0] === activeDriver
                ? _ACTIVE_OPACITY
                : Math.min(_DIMMED_OPACITY, getBumpLineOpacity(p[1]))
        )
        .attr('stroke-width', (p) =>
            p[0] === activeDriver ? _HOVER_STROKE_WIDTH : _DEFAULT_STROKE_WIDTH
        );
    startNodes.attr('opacity', (p) =>
        p[0] === activeDriver ? _ACTIVE_OPACITY : _DIMMED_OPACITY
    );
    startLabels.attr('opacity', (p) =>
        p[0] === activeDriver ? _ACTIVE_OPACITY : _DIMMED_OPACITY
    );
    endNodes.attr('opacity', (p) =>
        p[0] === activeDriver ? _ACTIVE_OPACITY : _DIMMED_OPACITY
    );
    endLabels.attr('opacity', (p) =>
        p[0] === activeDriver ? _ACTIVE_OPACITY : _DIMMED_OPACITY
    );
}

/**
 * Creates the vertical synchronized playhead layer (`g.bump-playhead-layer`) and returns its updater.
 *
 * @param {Object} svg - D3 selection for the chart's main translated group.
 * @param {Function} xScale - D3 linear scale for lap numbers.
 * @param {number} height - Inner chart height in pixels.
 * @param {number} maxLap - Maximum race lap number.
 * @returns {Function} `updatePlayhead(lapNumber)` callback.
 */
function _createBumpPlayheadLayer(svg, xScale, height, maxLap) {
    const playheadGroup = svg
        .append('g')
        .attr('class', 'bump-playhead-layer')
        .style('display', 'none')
        .style('pointer-events', 'none');

    playheadGroup
        .append('line')
        .attr('x1', 0)
        .attr('x2', 0)
        .attr('y1', 0)
        .attr('y2', height)
        .attr('stroke', _PLAYHEAD_COLOR)
        .attr('stroke-width', _PLAYHEAD_STROKE_WIDTH_PX)
        .attr('stroke-dasharray', _PLAYHEAD_DASH_ARRAY);

    playheadGroup
        .append('rect')
        .attr('x', -_PLAYHEAD_PILL_WIDTH_PX / 2)
        .attr('y', _PLAYHEAD_PILL_Y_OFFSET_PX)
        .attr('width', _PLAYHEAD_PILL_WIDTH_PX)
        .attr('height', _PLAYHEAD_PILL_HEIGHT_PX)
        .attr('rx', _PLAYHEAD_PILL_RADIUS_PX)
        .attr('fill', _PLAYHEAD_PILL_BG_FILL)
        .attr('stroke', _PLAYHEAD_COLOR)
        .attr('stroke-width', 1.2);

    const playheadText = playheadGroup
        .append('text')
        .attr('x', 0)
        .attr('y', _PLAYHEAD_PILL_Y_OFFSET_PX + _PLAYHEAD_PILL_HEIGHT_PX / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'middle')
        .attr('fill', _PLAYHEAD_COLOR)
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '9px')
        .style('font-weight', '700')
        .text('L0');

    return (lapNumber) => {
        if (lapNumber === null || lapNumber === undefined || !Number.isFinite(lapNumber)) {
            playheadGroup.style('display', 'none');
            return;
        }
        const clampedLap = Math.max(0, Math.min(maxLap, lapNumber));
        const xPos = xScale(clampedLap);
        playheadText.text(`L${clampedLap}`);
        playheadGroup
            .style('display', null)
            .attr('transform', `translate(${xPos},0)`)
            .raise();
    };
}

/**
 * Renders the Track Position bump chart across all laps of the race.
 *
 * @param {Object} data - Race telemetry payload containing `laps` and `drivers`.
 * @returns {void}
 */
export function renderBump(data) {
    const container = document.getElementById('bump-chart');
    if (!container) return;
    container.replaceChildren();

    const { validLaps, maxLap, classification } = calculateDriverClassification(data);
    if (validLaps.length === 0) {
        _externalBumpFocusHandler = null;
        _bumpPlayheadHandler = null;
        _renderEmptyBumpState(container);
        return;
    }

    const width = container.clientWidth - _CHART_MARGIN.left - _CHART_MARGIN.right;
    const height = _CHART_HEIGHT_PX - _CHART_MARGIN.top - _CHART_MARGIN.bottom;

    const svg = d3
        .select('#bump-chart')
        .append('svg')
        .attr('width', width + _CHART_MARGIN.left + _CHART_MARGIN.right)
        .attr('height', height + _CHART_MARGIN.top + _CHART_MARGIN.bottom)
        .append('g')
        .attr('transform', `translate(${_CHART_MARGIN.left},${_CHART_MARGIN.top})`);

    const maxPos = data.drivers.length || _DEFAULT_MAX_POSITIONS;

    const xScale = d3.scaleLinear().domain([0, maxLap]).range([0, width]);
    const yScale = d3.scaleLinear().domain([1, maxPos]).range([0, height]);

    _renderBumpAxesAndGrid(svg, xScale, yScale, width, height, maxPos);

    const lineGenerator = d3
        .line()
        .x((d) => xScale(d.lap))
        .y((d) => yScale(d.position))
        .curve(d3.curveMonotoneX);

    const secondTeammates = _identifySecondTeammates(classification);
    const gridMap = _buildStartingGridMap(data, classification);
    const driverLapsProcessed = _buildProcessedDriverLaps(
        data.drivers,
        classification,
        maxLap,
        secondTeammates,
        gridMap
    );
    const driverColors = Object.fromEntries(data.drivers.map((d) => [d.code, d.color]));
    const classificationByCode = new Map(classification.map((entry) => [entry.code, entry]));

    const { paths, hoverPaths } = _renderBumpLines(
        svg,
        driverLapsProcessed,
        driverColors,
        lineGenerator
    );
    const { startNodes, startLabels, endNodes, endLabels } = _renderBumpNodesAndLabels(
        svg,
        driverLapsProcessed,
        driverColors,
        xScale,
        yScale
    );

    _bumpPlayheadHandler = _createBumpPlayheadLayer(svg, xScale, height, maxLap);
    if (_currentBumpPlayheadLap !== null) {
        _bumpPlayheadHandler(_currentBumpPlayheadLap);
    }

    let externalDriver = null;
    let localHoveredDriver = null;

    const updateVisualFocus = () => {
        const activeDriver =
            localHoveredDriver !== null ? localHoveredDriver : externalDriver;
        _applyBumpVisualFocus(
            { paths, startNodes, startLabels, endNodes, endLabels },
            activeDriver
        );
    };

    _externalBumpFocusHandler = (driverCode) => {
        externalDriver = driverCode;
        updateVisualFocus();
    };

    _bindBumpHoverInteraction(
        hoverPaths,
        classificationByCode,
        (hoveredDriver) => {
            localHoveredDriver = hoveredDriver;
            updateVisualFocus();
        }
    );
}
