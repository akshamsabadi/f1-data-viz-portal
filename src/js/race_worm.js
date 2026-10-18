import { calculateDriverClassification } from './standings.js';

const _CHART_MARGIN = { top: 24, right: 72, bottom: 44, left: 64 };
const _MIN_CONTAINER_WIDTH_PX = 360;
const _DEFAULT_CONTAINER_WIDTH_PX = 860;
const _CHART_HEIGHT_PX = 440;
const _CLIP_RECT_VERTICAL_PAD_PX = 4;
const _LEAD_BATTLE_MAX_GAP_S = 40;
const _MIN_DOMAIN_MAX_GAP_S = 10;
const _FULL_FIELD_DOMAIN_PAD_MULTIPLIER = 1.04;
const _DEFAULT_STROKE_WIDTH = 2.2;
const _FOCUSED_STROKE_WIDTH = 3.8;
const _HIT_TARGET_STROKE_WIDTH = 12;
const _HOVER_DOT_RADIUS_PX = 4.5;
const _HOVER_DOT_STROKE_WIDTH_PX = 2;
const _LEADER_LINE_STROKE_WIDTH_PX = 1.5;
const _LEADER_LINE_DASH_ARRAY = '4,4';
const _LEADER_LINE_STROKE_COLOR = 'rgba(255, 255, 255, 0.35)';
const _END_LABEL_OFFSET_X_PX = 6;
const _MAX_X_AXIS_TICKS = 12;
const _Y_AXIS_TICKS = 8;
const _X_AXIS_TITLE_OFFSET_Y_PX = 36;
const _Y_AXIS_TITLE_OFFSET_Y_PX = -48;
const _ACTIVE_OPACITY = 1;
const _RESTING_OPACITY = 0.85;
const _DIMMED_OPACITY = 0.14;
const _SECOND_TEAMMATE_DASH = '6,3';
const _DEFAULT_DRIVER_COLOR = '#888888';
const _LEADER_HIGHLIGHT_COLOR = '#34d399';
const _TOOLTIP_OFFSET_X_PX = 15;
const _TOOLTIP_OFFSET_Y_PX = -28;

const _VIEW_MODE_LEAD = 'lead';
const _VIEW_MODE_FULL = 'full';

const _PLAYHEAD_COLOR = '#38bdf8';
const _PLAYHEAD_STROKE_WIDTH_PX = 1.8;
const _PLAYHEAD_DASH_ARRAY = '5,3';
const _PLAYHEAD_PILL_WIDTH_PX = 46;
const _PLAYHEAD_PILL_HEIGHT_PX = 15;
const _PLAYHEAD_PILL_Y_OFFSET_PX = -18;
const _PLAYHEAD_PILL_RADIUS_PX = 3;
const _PLAYHEAD_PILL_BG_FILL = 'rgba(15, 23, 42, 0.96)';

let _externalWormFocusHandler = null;
let _wormPlayheadHandler = null;
let _currentWormPlayheadLap = null;
let _clipPathCounter = 0;

/**
 * Highlights or restores a driver's trace in the Gap-to-Leader Worm chart from an external trigger.
 *
 * @param {string|null} driverCode - Three-letter driver code to highlight, or null to restore.
 * @returns {void}
 */
export function setRaceWormExternalFocus(driverCode) {
    if (_externalWormFocusHandler) {
        _externalWormFocusHandler(driverCode);
    }
}

/**
 * Updates or hides the synchronized vertical lap playhead line across `#race-worm-chart`.
 *
 * @param {number|null} lapNumber - Lap number to highlight (`1..maxLap`), or `null` to hide.
 * @returns {void}
 */
export function setRaceWormPlayheadLap(lapNumber) {
    _currentWormPlayheadLap =
        lapNumber !== null && lapNumber !== undefined && Number.isFinite(Number(lapNumber))
            ? Number(lapNumber)
            : null;
    if (_wormPlayheadHandler) {
        _wormPlayheadHandler(_currentWormPlayheadLap);
    }
}

/**
 * Identifies the second-classified teammate for each constructor so teammates can be
 * distinguished via solid (Teammate 1) vs dashed (`6,3`, Teammate 2) strokes.
 *
 * @param {Array<Object>} classification - Ordered driver classification array.
 * @returns {Set<string>} Set of driver codes representing the second teammate on their team.
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
 * Builds a lookup map of lap number to the race leader's session time and driver code on that lap.
 *
 * @param {Array<Object>} validLaps - Filtered lap telemetry records with valid `session_time`.
 * @returns {Map<number, {sessionTime: number, leader: string}>} Map of lap number to leader info.
 */
function _buildLeaderByLapMap(validLaps) {
    const lapsByNumber = d3.group(validLaps, (d) => d.lap);
    const leaderByLap = new Map();

    lapsByNumber.forEach((lapRecords, lapNumber) => {
        let minSessionTime = Infinity;
        let leaderCode = '';
        lapRecords.forEach((rec) => {
            if (rec.session_time < minSessionTime) {
                minSessionTime = rec.session_time;
                leaderCode = rec.driver;
            }
        });
        if (Number.isFinite(minSessionTime)) {
            leaderByLap.set(lapNumber, {
                sessionTime: minSessionTime,
                leader: leaderCode
            });
        }
    });

    return leaderByLap;
}

/**
 * Computes per-driver, per-lap gap-to-leader series from `data.laps`.
 *
 * @param {Object} data - Race telemetry payload containing `drivers` and `laps`.
 * @param {Array<Object>} classification - Official driver classification list.
 * @param {Set<string>} secondTeammates - Set of 2nd teammate driver codes.
 * @returns {{
 *   seriesByDriver: Array<Object>,
 *   maxLap: number,
 *   maxGapSeconds: number
 * }} Processed gap series and domain extents.
 */
function _buildGapSeries(data, classification, secondTeammates) {
    const validLaps = (data.laps || []).filter(
        (d) =>
            Number.isFinite(d.lap) &&
            d.lap >= 1 &&
            Number.isFinite(d.session_time) &&
            d.session_time > 0
    );

    if (validLaps.length === 0) {
        return { seriesByDriver: [], maxLap: 0, maxGapSeconds: _LEAD_BATTLE_MAX_GAP_S };
    }

    const leaderByLap = _buildLeaderByLapMap(validLaps);
    const maxLap = d3.max(validLaps, (d) => d.lap) || 1;
    const lapsByDriver = d3.group(validLaps, (d) => d.driver);
    const driverMetaByCode = new Map((data.drivers || []).map((d) => [d.code, d]));
    const rankByCode = new Map(classification.map((c) => [c.code, c.rank]));

    const orderedCodes =
        classification.length > 0
            ? classification.map((c) => c.code)
            : (data.drivers || []).map((d) => d.code);

    let maxGapSeconds = _MIN_DOMAIN_MAX_GAP_S;
    const seriesByDriver = [];

    orderedCodes.forEach((code) => {
        const rawDriverLaps = (lapsByDriver.get(code) || [])
            .slice()
            .sort((a, b) => a.lap - b.lap);
        if (rawDriverLaps.length === 0) return;

        const meta = driverMetaByCode.get(code) || {
            code,
            name: code,
            team: '',
            color: _DEFAULT_DRIVER_COLOR
        };

        const points = [];
        rawDriverLaps.forEach((lapRec) => {
            const leaderInfo = leaderByLap.get(lapRec.lap);
            if (!leaderInfo) return;
            const gap = Math.max(0, lapRec.session_time - leaderInfo.sessionTime);
            if (gap > maxGapSeconds) {
                maxGapSeconds = gap;
            }
            points.push({
                driver: code,
                name: meta.name || code,
                team: meta.team || '',
                color: meta.color || _DEFAULT_DRIVER_COLOR,
                rank: rankByCode.get(code) || null,
                lap: lapRec.lap,
                gap,
                lapTime: lapRec.time,
                position: lapRec.position,
                compound: lapRec.compound || 'UNKNOWN',
                leaderOnLap: leaderInfo.leader
            });
        });

        if (points.length > 0) {
            seriesByDriver.push({
                driver: code,
                name: meta.name || code,
                team: meta.team || '',
                color: meta.color || _DEFAULT_DRIVER_COLOR,
                rank: rankByCode.get(code) || null,
                isSecondTeammate: secondTeammates.has(code),
                points
            });
        }
    });

    return { seriesByDriver, maxLap, maxGapSeconds };
}

/**
 * Computes the vertical axis upper gap bound (in seconds) for the active view mode.
 *
 * @param {string} viewMode - Active view mode (`'lead'` or `'full'`).
 * @param {number} maxGapSeconds - Maximum observed gap across the field.
 * @returns {number} Upper gap domain value in seconds.
 */
function _computeWormYMax(viewMode, maxGapSeconds) {
    if (viewMode === _VIEW_MODE_LEAD) {
        return Math.min(
            _LEAD_BATTLE_MAX_GAP_S,
            Math.max(_MIN_DOMAIN_MAX_GAP_S, maxGapSeconds)
        );
    }
    return Math.max(
        _MIN_DOMAIN_MAX_GAP_S,
        maxGapSeconds * _FULL_FIELD_DOMAIN_PAD_MULTIPLIER
    );
}

/**
 * Finds the lap point on a driver's series closest to the hovered lap number.
 *
 * @param {Object} series - Driver gap series object.
 * @param {number} targetLap - Target lap number inverted from mouse X coordinate.
 * @returns {Object|undefined} Closest lap point object.
 */
function _findClosestLapPoint(series, targetLap) {
    let bestPoint = series.points[0];
    let minDiff = Infinity;
    series.points.forEach((pt) => {
        const diff = Math.abs(pt.lap - targetLap);
        if (diff < minDiff) {
            minDiff = diff;
            bestPoint = pt;
        }
    });
    return bestPoint;
}

/**
 * Builds right-hand end-label descriptors for drivers whose final lap gap falls within `[0, yMax]`.
 *
 * @param {Array<Object>} seriesByDriver - Per-driver gap series array.
 * @param {Function} xScale - D3 linear scale for lap numbers.
 * @param {Function} yScale - D3 linear scale for gap seconds.
 * @param {number} yMax - Current vertical domain upper bound in seconds.
 * @returns {Array<{driver: string, color: string, lap: number, gap: number, x: number, y: number}>} Visible end-label descriptors.
 */
function _buildVisibleEndLabelData(seriesByDriver, xScale, yScale, yMax) {
    return seriesByDriver
        .map((series) => {
            const lastPt = series.points[series.points.length - 1];
            return {
                driver: series.driver,
                color: series.color,
                lap: lastPt.lap,
                gap: lastPt.gap,
                x: xScale(lastPt.lap),
                y: yScale(lastPt.gap)
            };
        })
        .filter((d) => d.gap <= yMax);
}

/**
 * Builds the view mode toggle (`Lead Battle (≤ 40s)` vs `Full Field`) inside `#race-worm-controls`.
 *
 * @param {HTMLElement|null} controlsContainer - DOM container for controls.
 * @param {string} activeMode - Current view mode (`'lead'` or `'full'`).
 * @param {Function} onModeChange - Callback invoked when the user switches view modes.
 * @returns {void}
 */
function _buildWormControls(controlsContainer, activeMode, onModeChange) {
    if (!controlsContainer) return;
    controlsContainer.replaceChildren();

    const options = [
        { key: _VIEW_MODE_LEAD, label: 'Lead Battle (≤ 40s)' },
        { key: _VIEW_MODE_FULL, label: 'Full Field' }
    ];

    const buttons = [];

    const updateButtonStyles = (currentMode) => {
        buttons.forEach(({ btn, key }) => {
            const isSelected = key === currentMode;
            btn.classList.toggle('inactive', !isSelected);
            btn.style.borderColor = isSelected
                ? 'var(--accent)'
                : 'rgba(255, 255, 255, 0.08)';
            btn.style.background = isSelected
                ? 'rgba(225, 6, 0, 0.18)'
                : 'rgba(0, 0, 0, 0.25)';
            btn.style.color = isSelected ? '#ffffff' : 'var(--text-muted)';
        });
    };

    options.forEach(({ key, label }) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'legend-item worm-mode-btn';
        btn.style.fontFamily = 'Montserrat, sans-serif';
        btn.style.fontWeight = '700';
        btn.style.cursor = 'pointer';
        btn.textContent = label;

        btn.addEventListener('click', () => {
            updateButtonStyles(key);
            onModeChange(key);
        });

        buttons.push({ btn, key });
        controlsContainer.appendChild(btn);
    });

    updateButtonStyles(activeMode);
}

/**
 * Populates the shared `#tooltip` element with Gap-to-Leader telemetry for a hovered driver and lap.
 *
 * @param {HTMLElement|null} tooltipNode - DOM node of `#tooltip`.
 * @param {Object} series - Driver series metadata.
 * @param {Object} point - Closest lap data point on the trace.
 * @returns {void}
 */
function _populateWormTooltip(tooltipNode, series, point) {
    if (!tooltipNode || !point) return;

    const headerDiv = document.createElement('div');
    headerDiv.style.fontFamily = 'Montserrat, sans-serif';
    headerDiv.style.fontWeight = '700';
    headerDiv.style.marginBottom = '4px';
    headerDiv.style.textTransform = 'uppercase';
    headerDiv.appendChild(
        document.createTextNode(
            `${series.driver}${series.rank ? ` (P${series.rank})` : ''} `
        )
    );

    const teamSpan = document.createElement('span');
    teamSpan.style.color = 'var(--text-muted)';
    teamSpan.style.fontWeight = '600';
    teamSpan.style.fontSize = '0.75rem';
    teamSpan.textContent = `· ${series.team}`;
    headerDiv.appendChild(teamSpan);

    const lapDiv = document.createElement('div');
    lapDiv.style.fontSize = '0.8rem';
    lapDiv.style.fontWeight = '600';
    lapDiv.style.marginBottom = '2px';
    const posLabel = point.position ? ` · Track Pos: P${point.position}` : '';
    lapDiv.textContent = `Lap ${point.lap}${posLabel}`;

    const isLeader = point.gap === 0;
    const gapDiv = document.createElement('div');
    gapDiv.style.fontSize = '0.92rem';
    gapDiv.style.fontWeight = '700';
    gapDiv.style.color = isLeader ? _LEADER_HIGHLIGHT_COLOR : 'var(--text-primary)';
    gapDiv.textContent = isLeader
        ? 'RACE LEADER (0.000s)'
        : `Gap to Leader (${point.leaderOnLap}): +${point.gap.toFixed(3)}s`;

    const paceDiv = document.createElement('div');
    paceDiv.style.fontSize = '0.75rem';
    paceDiv.style.color = 'var(--text-muted)';
    paceDiv.style.marginTop = '2px';
    const lapTimeText = Number.isFinite(point.lapTime)
        ? `${point.lapTime.toFixed(3)}s`
        : 'N/A';
    paceDiv.textContent = `Lap Time: ${lapTimeText} · Tyre: ${point.compound}`;

    tooltipNode.replaceChildren(headerDiv, lapDiv, gapDiv, paceDiv);
}

/**
 * Renders an empty-state notice inside the worm chart container.
 *
 * @param {HTMLElement} container - Target chart container element.
 * @returns {void}
 */
function _renderEmptyWormState(container) {
    const emptyMsg = document.createElement('p');
    emptyMsg.style.color = 'var(--text-muted)';
    emptyMsg.style.textAlign = 'center';
    emptyMsg.style.paddingTop = '2rem';
    emptyMsg.style.fontFamily = 'Montserrat, sans-serif';
    emptyMsg.style.textTransform = 'uppercase';
    emptyMsg.textContent = 'No gap-to-leader telemetry available for this race.';
    container.replaceChildren(emptyMsg);
}

/**
 * Creates the base SVG, clipPath definition, and layered `<g>` containers for the Worm chart.
 *
 * @param {HTMLElement} container - Chart container element.
 * @param {number} width - Inner plot width in pixels.
 * @param {number} height - Inner plot height in pixels.
 * @param {string} clipId - Unique SVG clipPath identifier.
 * @returns {{
 *   svg: Object,
 *   gridGroup: Object,
 *   axesGroup: Object,
 *   plotGroup: Object,
 *   labelsGroup: Object,
 *   hoverDot: Object
 * }} Created D3 layer selections.
 */
function _createWormSvgLayers(container, width, height, clipId) {
    const svgRoot = d3
        .select(container)
        .append('svg')
        .attr('width', width + _CHART_MARGIN.left + _CHART_MARGIN.right)
        .attr('height', height + _CHART_MARGIN.top + _CHART_MARGIN.bottom);

    svgRoot
        .append('defs')
        .append('clipPath')
        .attr('id', clipId)
        .append('rect')
        .attr('x', 0)
        .attr('y', -_CLIP_RECT_VERTICAL_PAD_PX)
        .attr('width', width)
        .attr('height', height + _CLIP_RECT_VERTICAL_PAD_PX * 2);

    const svg = svgRoot
        .append('g')
        .attr('transform', `translate(${_CHART_MARGIN.left},${_CHART_MARGIN.top})`);

    const gridGroup = svg.append('g').attr('class', 'gridline');
    const axesGroup = svg.append('g').attr('class', 'axes');
    const plotGroup = svg
        .append('g')
        .attr('class', 'worm-plot-area')
        .attr('clip-path', `url(#${clipId})`);
    const labelsGroup = svg.append('g').attr('class', 'worm-end-labels');
    const hoverDot = plotGroup
        .append('circle')
        .attr('class', 'worm-hover-dot')
        .attr('r', _HOVER_DOT_RADIUS_PX)
        .attr('stroke', '#ffffff')
        .attr('stroke-width', _HOVER_DOT_STROKE_WIDTH_PX)
        .style('display', 'none')
        .style('pointer-events', 'none');

    return { svg, gridGroup, axesGroup, plotGroup, labelsGroup, hoverDot };
}

/**
 * Renders background gridlines, the 0.0s leader reference line, and the X and Y axes.
 *
 * @param {Object} gridGroup - D3 selection for the gridline layer.
 * @param {Object} axesGroup - D3 selection for the axes layer.
 * @param {Function} xScale - D3 linear scale for lap numbers.
 * @param {Function} yScale - D3 linear scale for gap seconds.
 * @param {number} width - Inner plot width in pixels.
 * @param {number} height - Inner plot height in pixels.
 * @param {number} maxLap - Maximum race lap number.
 * @returns {void}
 */
function _renderWormGridAndAxes(
    gridGroup,
    axesGroup,
    xScale,
    yScale,
    width,
    height,
    maxLap
) {
    gridGroup.call(
        d3.axisLeft(yScale).tickSize(-width).tickFormat('').ticks(_Y_AXIS_TICKS)
    );

    axesGroup
        .append('line')
        .attr('x1', 0)
        .attr('x2', width)
        .attr('y1', yScale(0))
        .attr('y2', yScale(0))
        .attr('stroke', _LEADER_LINE_STROKE_COLOR)
        .attr('stroke-width', _LEADER_LINE_STROKE_WIDTH_PX)
        .attr('stroke-dasharray', _LEADER_LINE_DASH_ARRAY);

    const xAxisGroup = axesGroup
        .append('g')
        .attr('transform', `translate(0,${height})`)
        .call(
            d3
                .axisBottom(xScale)
                .ticks(Math.min(_MAX_X_AXIS_TICKS, maxLap))
                .tickFormat((d) => `L${d}`)
        );

    xAxisGroup
        .append('text')
        .attr('x', width)
        .attr('y', _X_AXIS_TITLE_OFFSET_Y_PX)
        .attr('fill', 'var(--text-muted)')
        .attr('text-anchor', 'end')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-weight', '600')
        .style('font-size', '11px')
        .text('LAP NUMBER');

    const yAxisGroup = axesGroup
        .append('g')
        .call(
            d3
                .axisLeft(yScale)
                .ticks(_Y_AXIS_TICKS)
                .tickFormat((d) => (d === 0 ? 'LEADER' : `+${d}s`))
        );

    yAxisGroup
        .append('text')
        .attr('transform', 'rotate(-90)')
        .attr('y', _Y_AXIS_TITLE_OFFSET_Y_PX)
        .attr('x', 0)
        .attr('fill', 'var(--text-muted)')
        .attr('text-anchor', 'end')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-weight', '600')
        .style('font-size', '11px')
        .text('GAP TO LEADER (SECONDS)');
}

/**
 * Renders visible gap-to-leader traces and wider transparent hit-target paths.
 *
 * @param {Object} plotGroup - D3 selection for the clipped plot group.
 * @param {Array<Object>} seriesByDriver - Per-driver gap series array.
 * @param {Function} lineGenerator - D3 line generator.
 * @returns {{visiblePaths: Object, hitPaths: Object}} D3 selections for visible and hit-target paths.
 */
function _renderWormTraces(plotGroup, seriesByDriver, lineGenerator) {
    const visiblePaths = plotGroup
        .selectAll('path.worm-line')
        .data(seriesByDriver)
        .enter()
        .append('path')
        .attr('class', 'worm-line')
        .attr('fill', 'none')
        .attr('stroke', (d) => d.color)
        .attr('stroke-width', _DEFAULT_STROKE_WIDTH)
        .attr('stroke-dasharray', (d) =>
            d.isSecondTeammate ? _SECOND_TEAMMATE_DASH : 'none'
        )
        .attr('opacity', _RESTING_OPACITY)
        .attr('d', (d) => lineGenerator(d.points));

    const hitPaths = plotGroup
        .selectAll('path.worm-line-hover')
        .data(seriesByDriver)
        .enter()
        .append('path')
        .attr('class', 'worm-line-hover')
        .attr('fill', 'none')
        .attr('stroke', 'transparent')
        .attr('stroke-width', _HIT_TARGET_STROKE_WIDTH)
        .style('cursor', 'pointer')
        .attr('d', (d) => lineGenerator(d.points));

    return { visiblePaths, hitPaths };
}

/**
 * Renders right-hand driver code labels for traces terminating within the visible Y domain.
 *
 * @param {Object} labelsGroup - D3 selection for the end-labels group.
 * @param {Array<Object>} seriesByDriver - Per-driver gap series array.
 * @param {Function} xScale - D3 linear scale for lap numbers.
 * @param {Function} yScale - D3 linear scale for gap seconds.
 * @param {number} width - Inner plot width in pixels.
 * @param {number} yMax - Current vertical domain upper bound in seconds.
 * @param {Function} onHoverChange - Callback invoked with hovered driver code or null.
 * @returns {Object} D3 selection of `<text class="worm-end-label">` elements.
 */
function _renderWormEndLabels(
    labelsGroup,
    seriesByDriver,
    xScale,
    yScale,
    width,
    yMax,
    onHoverChange
) {
    const visibleEndLabelData = _buildVisibleEndLabelData(
        seriesByDriver,
        xScale,
        yScale,
        yMax
    );

    return labelsGroup
        .selectAll('text.worm-end-label')
        .data(visibleEndLabelData)
        .enter()
        .append('text')
        .attr('class', 'worm-end-label')
        .attr('x', (d) => Math.min(width + _END_LABEL_OFFSET_X_PX, d.x + _END_LABEL_OFFSET_X_PX))
        .attr('y', (d) => d.y)
        .attr('dy', '0.35em')
        .attr('fill', (d) => d.color)
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '10px')
        .style('font-weight', '700')
        .style('cursor', 'pointer')
        .text((d) => d.driver)
        .on('mouseover', (_event, d) => {
            onHoverChange(d.driver);
        })
        .on('mouseout', () => {
            onHoverChange(null);
        });
}

/**
 * Binds pointer hover events to transparent hit-target paths to update the hover dot and tooltip.
 *
 * @param {Object} hitPaths - D3 selection of transparent hit-target paths.
 * @param {Object} svg - D3 selection of the main translated chart `<g>`.
 * @param {Function} xScale - D3 linear scale for lap numbers.
 * @param {Function} yScale - D3 linear scale for gap seconds.
 * @param {Object} hoverDot - D3 selection of the active point hover circle.
 * @param {Object} tooltip - D3 selection of `#tooltip`.
 * @param {Function} onHoverChange - Callback invoked with hovered driver code or null.
 * @returns {void}
 */
function _bindWormHoverTargets(
    hitPaths,
    svg,
    xScale,
    yScale,
    hoverDot,
    tooltip,
    onHoverChange
) {
    const updateHoverPointAndTooltip = (event, series) => {
        const [mouseX] = d3.pointer(event, svg.node());
        const targetLap = xScale.invert(mouseX);
        const closestPt = _findClosestLapPoint(series, targetLap);
        if (!closestPt) return;

        hoverDot
            .style('display', null)
            .attr('cx', xScale(closestPt.lap))
            .attr('cy', yScale(closestPt.gap))
            .attr('fill', series.color)
            .raise();

        _populateWormTooltip(tooltip.node(), series, closestPt);
        tooltip
            .classed('hidden', false)
            .style('border-left-color', series.color || 'var(--accent)')
            .style('left', `${event.pageX + _TOOLTIP_OFFSET_X_PX}px`)
            .style('top', `${event.pageY + _TOOLTIP_OFFSET_Y_PX}px`);
    };

    hitPaths
        .on('mouseover', (event, series) => {
            onHoverChange(series.driver);
            updateHoverPointAndTooltip(event, series);
        })
        .on('mousemove', (event, series) => {
            updateHoverPointAndTooltip(event, series);
        })
        .on('mouseout', () => {
            onHoverChange(null);
            hoverDot.style('display', 'none');
            tooltip.classed('hidden', true);
        });
}

/**
 * Updates stroke widths and opacities for all worm traces and end labels based on the focused driver.
 *
 * @param {Object|null} visiblePaths - D3 selection of visible worm paths.
 * @param {Object|null} endLabels - D3 selection of right-hand driver labels.
 * @param {string|null} activeDriver - Currently focused or hovered driver code, or null.
 * @returns {void}
 */
function _applyWormFocusStyles(visiblePaths, endLabels, activeDriver) {
    if (!visiblePaths) return;

    if (activeDriver === null) {
        visiblePaths
            .attr('opacity', _RESTING_OPACITY)
            .attr('stroke-width', _DEFAULT_STROKE_WIDTH);
        if (endLabels) {
            endLabels.attr('opacity', _ACTIVE_OPACITY);
        }
        return;
    }

    visiblePaths
        .attr('opacity', (d) =>
            d.driver === activeDriver ? _ACTIVE_OPACITY : _DIMMED_OPACITY
        )
        .attr('stroke-width', (d) =>
            d.driver === activeDriver
                ? _FOCUSED_STROKE_WIDTH
                : _DEFAULT_STROKE_WIDTH
        );
    visiblePaths.filter((d) => d.driver === activeDriver).raise();

    if (endLabels) {
        endLabels.attr('opacity', (d) =>
            d.driver === activeDriver ? _ACTIVE_OPACITY : _DIMMED_OPACITY
        );
    }
}

/**
 * Renders the Gap-to-Leader Race Trace ("Worm" Chart) inside `#race-worm-chart`.
 *
 * @param {Object} data - Race telemetry payload containing `drivers` and `laps`.
 * @returns {void}
 */
export function renderRaceWorm(data) {
    const container = document.getElementById('race-worm-chart');
    const controlsContainer = document.getElementById('race-worm-controls');
    if (!container) return;

    container.replaceChildren();
    if (controlsContainer) controlsContainer.replaceChildren();

    const { classification } = calculateDriverClassification(data);
    const secondTeammates = _identifySecondTeammates(classification);
    const { seriesByDriver, maxLap, maxGapSeconds } = _buildGapSeries(
        data,
        classification,
        secondTeammates
    );

    if (seriesByDriver.length === 0 || maxLap === 0) {
        _externalWormFocusHandler = null;
        _wormPlayheadHandler = null;
        _renderEmptyWormState(container);
        return;
    }

    let currentViewMode = _VIEW_MODE_LEAD;
    let externalFocusedDriver = null;
    let hoveredDriver = null;

    const containerWidth = Math.max(
        _MIN_CONTAINER_WIDTH_PX,
        container.clientWidth || _DEFAULT_CONTAINER_WIDTH_PX
    );
    const width = containerWidth - _CHART_MARGIN.left - _CHART_MARGIN.right;
    const height = _CHART_HEIGHT_PX - _CHART_MARGIN.top - _CHART_MARGIN.bottom;

    _clipPathCounter += 1;
    const clipId = `worm-clip-${_clipPathCounter}`;

    const { svg, gridGroup, axesGroup, plotGroup, labelsGroup, hoverDot } =
        _createWormSvgLayers(container, width, height, clipId);

    const playheadGroup = svg
        .append('g')
        .attr('class', 'worm-playhead-layer')
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
        .text('L1');

    const tooltip = d3.select('#tooltip');
    let visiblePaths = null;
    let endLabels = null;

    const updateFocusStyles = () => {
        const activeDriver =
            hoveredDriver !== null ? hoveredDriver : externalFocusedDriver;
        _applyWormFocusStyles(visiblePaths, endLabels, activeDriver);
    };

    const setHoveredDriver = (driverCode) => {
        hoveredDriver = driverCode;
        updateFocusStyles();
    };

    const drawWorm = () => {
        gridGroup.selectAll('*').remove();
        axesGroup.selectAll('*').remove();
        plotGroup.selectAll('path').remove();
        labelsGroup.selectAll('*').remove();
        hoverDot.style('display', 'none');

        const yMax = _computeWormYMax(currentViewMode, maxGapSeconds);
        const xScale = d3.scaleLinear().domain([1, maxLap]).range([0, width]);
        const yScale = d3.scaleLinear().domain([0, yMax]).range([0, height]);

        _wormPlayheadHandler = (lapNumber) => {
            if (lapNumber === null || lapNumber === undefined || !Number.isFinite(lapNumber)) {
                playheadGroup.style('display', 'none');
                return;
            }
            const clampedLap = Math.max(1, Math.min(maxLap, lapNumber));
            const xPos = xScale(clampedLap);
            playheadText.text(`L${clampedLap}`);
            playheadGroup
                .style('display', null)
                .attr('transform', `translate(${xPos},0)`)
                .raise();
        };

        _renderWormGridAndAxes(
            gridGroup,
            axesGroup,
            xScale,
            yScale,
            width,
            height,
            maxLap
        );

        const lineGenerator = d3
            .line()
            .x((d) => xScale(d.lap))
            .y((d) => yScale(d.gap))
            .curve(d3.curveMonotoneX);

        const traceSelections = _renderWormTraces(
            plotGroup,
            seriesByDriver,
            lineGenerator
        );
        visiblePaths = traceSelections.visiblePaths;

        endLabels = _renderWormEndLabels(
            labelsGroup,
            seriesByDriver,
            xScale,
            yScale,
            width,
            yMax,
            setHoveredDriver
        );

        _bindWormHoverTargets(
            traceSelections.hitPaths,
            svg,
            xScale,
            yScale,
            hoverDot,
            tooltip,
            setHoveredDriver
        );

        hoverDot.raise();
        if (_currentWormPlayheadLap !== null) {
            _wormPlayheadHandler(_currentWormPlayheadLap);
        }
        updateFocusStyles();
    };

    _externalWormFocusHandler = (driverCode) => {
        externalFocusedDriver = driverCode;
        updateFocusStyles();
    };

    _buildWormControls(controlsContainer, currentViewMode, (nextMode) => {
        currentViewMode = nextMode;
        drawWorm();
    });

    drawWorm();
}
