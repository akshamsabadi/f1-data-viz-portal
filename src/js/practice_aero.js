const _CHART_MARGIN = { top: 28, right: 36, bottom: 52, left: 64 };
const _CHART_HEIGHT_PX = 420;
const _MIN_CHART_WIDTH_PX = 300;
const _DEFAULT_CONTAINER_WIDTH_PX = 560;

const _NODE_RADIUS_PX = 6.5;
const _TEAMMATE_NODE_RADIUS_PX = 7.5;
const _FOCUSED_NODE_RADIUS_PX = 8.5;
const _HOVER_NODE_RADIUS_PX = 9.0;

const _DEFAULT_NODE_STROKE_WIDTH_PX = 1.5;
const _FOCUSED_NODE_STROKE_WIDTH_PX = 2.2;
const _FOCUSED_NODE_STROKE_COLOR = '#ffffff';

const _TEAMMATE_LINK_STROKE_WIDTH_PX = 1.75;
const _TEAMMATE_LINK_DASH_ARRAY = '3,3';
const _FOCUSED_TEAMMATE_LINK_OPACITY = 0.75;

const _ACTIVE_OPACITY = 1.0;
const _DIMMED_OPACITY = 0.18;

const _DOMAIN_PADDING_RATIO = 0.12;
const _MIN_DOMAIN_PAD_KMH = 1.2;

const _AXIS_TICK_COUNT = 6;
const _AXIS_TICK_PADDING_PX = 10;
const _X_AXIS_TITLE_OFFSET_Y_PX = 40;
const _Y_AXIS_TITLE_OFFSET_Y_PX = -48;

const _CROSSHAIR_STROKE_COLOR = 'rgba(255, 255, 255, 0.22)';
const _CROSSHAIR_STROKE_WIDTH_PX = 1.25;
const _CROSSHAIR_DASH_ARRAY = '5,5';

const _QUADRANT_LABEL_INSET_PX = 8;
const _QUADRANT_LABEL_TOP_Y_PX = 13;
const _QUADRANT_LABEL_FONT_SIZE = '8.5px';

const _LABEL_EDGE_MARGIN_PX = 42;
const _ESTIMATED_LABEL_WIDTH_PX = 28;
const _ESTIMATED_LABEL_HEIGHT_PX = 11;
const _LABEL_BASELINE_ADJUST_PX = 2;
const _NODE_PROXIMITY_THRESHOLD_PX = 10;
const _NODE_PROXIMITY_PENALTY_WEIGHT = 20;
const _BOX_OVERLAP_PENALTY_WEIGHT = 5;
const _DEFAULT_LABEL_DX_PX = 8;
const _DEFAULT_LABEL_DY_PX = -8;

const _LABEL_OFFSET_CANDIDATES = [
    { dx: 9, dy: -6, anchor: 'start' },
    { dx: 9, dy: 13, anchor: 'start' },
    { dx: -9, dy: -6, anchor: 'end' },
    { dx: -9, dy: 13, anchor: 'end' },
    { dx: 0, dy: -11, anchor: 'middle' },
    { dx: 0, dy: 17, anchor: 'middle' }
];

const _TOOLTIP_OFFSET_X_PX = 15;
const _TOOLTIP_OFFSET_Y_PX = -28;

let _externalAeroFocusHandler = null;

/**
 * Sets or clears an external driver focus filter on the Practice Aero Setup Balance scatter plot.
 * Highlights the focused driver and their constructor teammate while dimming other entries.
 *
 * @param {string|null} driverCode - Three-letter driver code to highlight, or null to restore.
 * @returns {void}
 */
export function setPracticeAeroExternalFocus(driverCode) {
    if (_externalAeroFocusHandler) {
        _externalAeroFocusHandler(driverCode);
    }
}

/**
 * Extracts classification entries with finite cornering and speed trap telemetry.
 *
 * @param {Object} data - Race telemetry payload containing `data.practice`.
 * @returns {Array<Object>} Valid aero telemetry entries.
 */
function _extractValidAeroEntries(data) {
    const rawClassification = data?.practice?.classification || [];
    return rawClassification.filter(
        (d) => Number.isFinite(d.mean_corner_kmh) && Number.isFinite(d.speed_trap_kmh)
    );
}

/**
 * Computes the bounding box of a candidate driver label placement in pixel coordinates.
 *
 * @param {{px: number, py: number}} node - Positioned driver scatter node.
 * @param {{dx: number, dy: number, anchor: string}} candidate - Candidate offset descriptor.
 * @returns {{x: number, y: number, w: number, h: number}} Label bounding box.
 */
function _calculateLabelBoundingBox(node, candidate) {
    const x =
        candidate.anchor === 'start'
            ? node.px + candidate.dx
            : candidate.anchor === 'end'
              ? node.px + candidate.dx - _ESTIMATED_LABEL_WIDTH_PX
              : node.px - _ESTIMATED_LABEL_WIDTH_PX / 2;
    const y = node.py + candidate.dy - _ESTIMATED_LABEL_HEIGHT_PX + _LABEL_BASELINE_ADJUST_PX;
    return {
        x,
        y,
        w: _ESTIMATED_LABEL_WIDTH_PX,
        h: _ESTIMATED_LABEL_HEIGHT_PX
    };
}

/**
 * Evaluates the overlap penalty score for a candidate label bounding box against other nodes and placed labels.
 *
 * @param {{driver: string, px: number, py: number}} node - Target driver node.
 * @param {{x: number, y: number, w: number, h: number}} candidateBox - Candidate label bounding box.
 * @param {Array<{driver: string, px: number, py: number}>} allNodes - All positioned scatter nodes.
 * @param {Array<{x: number, y: number, w: number, h: number}>} placedBoxes - Already placed label boxes.
 * @returns {number} Computed overlap penalty score (lower is better).
 */
function _scoreLabelCandidatePenalty(node, candidateBox, allNodes, placedBoxes) {
    let penalty = 0;

    allNodes.forEach((other) => {
        if (other.driver === node.driver) return;
        const clampedX = Math.max(candidateBox.x, Math.min(other.px, candidateBox.x + candidateBox.w));
        const clampedY = Math.max(candidateBox.y, Math.min(other.py, candidateBox.y + candidateBox.h));
        const distance = Math.hypot(other.px - clampedX, other.py - clampedY);
        if (distance < _NODE_PROXIMITY_THRESHOLD_PX) {
            penalty += (_NODE_PROXIMITY_THRESHOLD_PX - distance) * _NODE_PROXIMITY_PENALTY_WEIGHT;
        }
    });

    placedBoxes.forEach((box) => {
        const overlapX = Math.max(
            0,
            Math.min(candidateBox.x + candidateBox.w, box.x + box.w) - Math.max(candidateBox.x, box.x)
        );
        const overlapY = Math.max(
            0,
            Math.min(candidateBox.y + candidateBox.h, box.y + box.h) - Math.max(candidateBox.y, box.y)
        );
        if (overlapX > 0 && overlapY > 0) {
            penalty += overlapX * overlapY * _BOX_OVERLAP_PENALTY_WEIGHT;
        }
    });

    return penalty;
}

/**
 * Computes smart label offsets `(dx, dy, anchor)` for each driver node to minimize label overlap.
 *
 * @param {Array<Object>} nodes - Array of positioned driver classification nodes with `px` and `py`.
 * @param {number} width - Inner chart width in pixels.
 * @returns {Map<string, {dx: number, dy: number, anchor: string}>} Map of driver code to label offset descriptor.
 */
function _computeLabelOffsets(nodes, width) {
    const offsets = new Map();
    const placedBoxes = [];
    const sortedNodes = nodes.slice().sort((a, b) => a.py - b.py || a.px - b.px);

    sortedNodes.forEach((node) => {
        let bestCandidate = _LABEL_OFFSET_CANDIDATES[0];
        let bestPenalty = Infinity;

        _LABEL_OFFSET_CANDIDATES.forEach((candidate) => {
            const isClippedRight = node.px > width - _LABEL_EDGE_MARGIN_PX && candidate.anchor === 'start';
            const isClippedLeft = node.px < _LABEL_EDGE_MARGIN_PX && candidate.anchor === 'end';
            if (isClippedRight || isClippedLeft) return;

            const candidateBox = _calculateLabelBoundingBox(node, candidate);
            const penalty = _scoreLabelCandidatePenalty(node, candidateBox, nodes, placedBoxes);

            if (penalty < bestPenalty) {
                bestPenalty = penalty;
                bestCandidate = candidate;
            }
        });

        placedBoxes.push(_calculateLabelBoundingBox(node, bestCandidate));
        offsets.set(node.driver, bestCandidate);
    });

    return offsets;
}

/**
 * Creates padded X and Y linear scales and computes session medians for cornering and top speed.
 *
 * @param {Array<Object>} entries - Valid aero classification entries.
 * @param {number} width - Inner chart width in pixels.
 * @param {number} height - Inner chart height in pixels.
 * @returns {{xScale: Function, yScale: Function, medianX: number, medianY: number}} Scales and session median values.
 */
function _createAeroScalesAndMedians(entries, width, height) {
    const xExtent = d3.extent(entries, (d) => d.mean_corner_kmh);
    const yExtent = d3.extent(entries, (d) => d.speed_trap_kmh);

    const xPad = Math.max(_MIN_DOMAIN_PAD_KMH, (xExtent[1] - xExtent[0]) * _DOMAIN_PADDING_RATIO);
    const yPad = Math.max(_MIN_DOMAIN_PAD_KMH, (yExtent[1] - yExtent[0]) * _DOMAIN_PADDING_RATIO);

    const xScale = d3
        .scaleLinear()
        .domain([xExtent[0] - xPad, xExtent[1] + xPad])
        .range([0, width]);

    const yScale = d3
        .scaleLinear()
        .domain([yExtent[0] - yPad, yExtent[1] + yPad])
        .range([height, 0]);

    const medianX = d3.median(entries, (d) => d.mean_corner_kmh) || 0;
    const medianY = d3.median(entries, (d) => d.speed_trap_kmh) || 0;

    return { xScale, yScale, medianX, medianY };
}

/**
 * Groups positioned driver nodes by constructor to form teammate connector pairs.
 *
 * @param {Array<Object>} positionedNodes - Driver nodes augmented with `px` and `py`.
 * @returns {Array<{team: string, color: string, a: Object, b: Object}>} Teammate link descriptors.
 */
function _buildTeammatePairs(positionedNodes) {
    const teamPairs = [];
    const byTeam = d3.group(positionedNodes, (d) => d.team);
    byTeam.forEach((members, team) => {
        if (members.length >= 2) {
            teamPairs.push({
                team,
                color: members[0].color || '#ffffff',
                a: members[0],
                b: members[1]
            });
        }
    });
    return teamPairs;
}

/**
 * Renders background gridlines, X-axis (Mean Cornering Speed), and Y-axis (Speed Trap).
 *
 * @param {Object} svg - D3 selection for the chart's main translated group.
 * @param {Function} xScale - D3 linear scale for mean cornering speed (km/h).
 * @param {Function} yScale - D3 linear scale for straight-line speed trap (km/h).
 * @param {number} width - Inner chart width in pixels.
 * @param {number} height - Inner chart height in pixels.
 * @returns {void}
 */
function _renderAeroAxesAndGrid(svg, xScale, yScale, width, height) {
    svg.append('g')
        .attr('class', 'gridline')
        .call(d3.axisLeft(yScale).tickSize(-width).tickFormat('').ticks(_AXIS_TICK_COUNT));

    svg.append('g')
        .attr('class', 'gridline')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(xScale).tickSize(-height).tickFormat('').ticks(_AXIS_TICK_COUNT));

    const xAxisGroup = svg
        .append('g')
        .attr('transform', `translate(0,${height})`)
        .call(
            d3
                .axisBottom(xScale)
                .ticks(_AXIS_TICK_COUNT)
                .tickFormat((d) => `${d}`)
                .tickSize(0)
                .tickPadding(_AXIS_TICK_PADDING_PX)
        )
        .call((g) => g.select('.domain').attr('stroke', 'var(--border-color)'));

    xAxisGroup
        .append('text')
        .attr('x', width)
        .attr('y', _X_AXIS_TITLE_OFFSET_Y_PX)
        .attr('fill', 'var(--text-muted)')
        .attr('text-anchor', 'end')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-weight', '600')
        .style('font-size', '11px')
        .style('letter-spacing', '0.8px')
        .text('MEAN CORNERING SPEED (KM/H)');

    const yAxisGroup = svg
        .append('g')
        .call(
            d3
                .axisLeft(yScale)
                .ticks(_AXIS_TICK_COUNT)
                .tickFormat((d) => `${d}`)
                .tickSize(0)
                .tickPadding(_AXIS_TICK_PADDING_PX)
        )
        .call((g) => g.select('.domain').remove());

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
        .style('letter-spacing', '0.8px')
        .text('STRAIGHT-LINE SPEED TRAP (KM/H)');
}

/**
 * Renders dashed median crosshair lines and subtle corner quadrant annotations.
 *
 * @param {Object} svg - D3 selection for the chart's main translated group.
 * @param {Function} xScale - D3 linear scale for mean cornering speed.
 * @param {Function} yScale - D3 linear scale for straight-line speed trap.
 * @param {number} medianX - Session median cornering speed in km/h.
 * @param {number} medianY - Session median speed trap in km/h.
 * @param {number} width - Inner chart width in pixels.
 * @param {number} height - Inner chart height in pixels.
 * @returns {void}
 */
function _renderCrosshairsAndQuadrants(svg, xScale, yScale, medianX, medianY, width, height) {
    const crosshairsGroup = svg.append('g').attr('class', 'aero-crosshairs');

    const mx = xScale(medianX);
    const my = yScale(medianY);

    crosshairsGroup
        .append('line')
        .attr('x1', mx)
        .attr('x2', mx)
        .attr('y1', 0)
        .attr('y2', height)
        .attr('stroke', _CROSSHAIR_STROKE_COLOR)
        .attr('stroke-width', _CROSSHAIR_STROKE_WIDTH_PX)
        .attr('stroke-dasharray', _CROSSHAIR_DASH_ARRAY);

    crosshairsGroup
        .append('line')
        .attr('x1', 0)
        .attr('x2', width)
        .attr('y1', my)
        .attr('y2', my)
        .attr('stroke', _CROSSHAIR_STROKE_COLOR)
        .attr('stroke-width', _CROSSHAIR_STROKE_WIDTH_PX)
        .attr('stroke-dasharray', _CROSSHAIR_DASH_ARRAY);

    const quadrants = [
        {
            x: width - _QUADRANT_LABEL_INSET_PX,
            y: _QUADRANT_LABEL_TOP_Y_PX,
            anchor: 'end',
            label: 'HIGH AERO EFFICIENCY',
            color: 'rgba(74, 222, 128, 0.6)'
        },
        {
            x: _QUADRANT_LABEL_INSET_PX,
            y: _QUADRANT_LABEL_TOP_Y_PX,
            anchor: 'start',
            label: 'LOW-DRAG TRIM (TOP SPEED)',
            color: 'rgba(56, 189, 248, 0.6)'
        },
        {
            x: width - _QUADRANT_LABEL_INSET_PX,
            y: height - _QUADRANT_LABEL_INSET_PX,
            anchor: 'end',
            label: 'HIGH-DOWNFORCE TRIM',
            color: 'rgba(250, 204, 21, 0.6)'
        },
        {
            x: _QUADRANT_LABEL_INSET_PX,
            y: height - _QUADRANT_LABEL_INSET_PX,
            anchor: 'start',
            label: 'LOW GRIP / HIGH DRAG',
            color: 'rgba(248, 113, 113, 0.5)'
        }
    ];

    crosshairsGroup
        .selectAll('text.quadrant-label')
        .data(quadrants)
        .enter()
        .append('text')
        .attr('class', 'quadrant-label')
        .attr('x', (d) => d.x)
        .attr('y', (d) => d.y)
        .attr('text-anchor', (d) => d.anchor)
        .attr('fill', (d) => d.color)
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', _QUADRANT_LABEL_FONT_SIZE)
        .style('font-weight', '700')
        .style('letter-spacing', '0.4px')
        .style('pointer-events', 'none')
        .text((d) => d.label);
}

/**
 * Renders dashed teammate connector lines, scatter nodes, and non-overlapping driver code labels.
 *
 * @param {Object} svg - D3 selection for the chart's main translated group.
 * @param {Array<Object>} positionedNodes - Driver nodes with pixel coordinates `px` and `py`.
 * @param {Array<Object>} teamPairs - Teammate pair link descriptors.
 * @param {Map<string, {dx: number, dy: number, anchor: string}>} labelOffsets - Computed label offsets by driver code.
 * @returns {{teammateLinks: Object, circles: Object, labels: Object}} D3 selections for interactive styling.
 */
function _renderAeroElements(svg, positionedNodes, teamPairs, labelOffsets) {
    const connectorsGroup = svg.append('g').attr('class', 'aero-teammate-connectors');
    const teammateLinks = connectorsGroup
        .selectAll('line.teammate-link')
        .data(teamPairs, (d) => d.team)
        .enter()
        .append('line')
        .attr('class', 'teammate-link')
        .attr('x1', (d) => d.a.px)
        .attr('y1', (d) => d.a.py)
        .attr('x2', (d) => d.b.px)
        .attr('y2', (d) => d.b.py)
        .attr('stroke', (d) => d.color)
        .attr('stroke-width', _TEAMMATE_LINK_STROKE_WIDTH_PX)
        .attr('stroke-dasharray', _TEAMMATE_LINK_DASH_ARRAY)
        .style('opacity', 0)
        .style('pointer-events', 'none');

    const nodesGroup = svg.append('g').attr('class', 'aero-nodes');
    const circles = nodesGroup
        .selectAll('circle.aero-node')
        .data(positionedNodes, (d) => d.driver)
        .enter()
        .append('circle')
        .attr('class', 'aero-node data-point')
        .attr('cx', (d) => d.px)
        .attr('cy', (d) => d.py)
        .attr('r', _NODE_RADIUS_PX)
        .attr('fill', (d) => d.color || 'var(--accent)')
        .attr('stroke', 'var(--bg-dark)')
        .attr('stroke-width', _DEFAULT_NODE_STROKE_WIDTH_PX)
        .style('cursor', 'pointer');

    const labelsGroup = svg.append('g').attr('class', 'aero-labels');
    const labels = labelsGroup
        .selectAll('text.aero-driver-label')
        .data(positionedNodes, (d) => d.driver)
        .enter()
        .append('text')
        .attr('class', 'aero-driver-label driver-label')
        .attr('x', (d) => d.px + (labelOffsets.get(d.driver)?.dx ?? _DEFAULT_LABEL_DX_PX))
        .attr('y', (d) => d.py + (labelOffsets.get(d.driver)?.dy ?? _DEFAULT_LABEL_DY_PX))
        .attr('text-anchor', (d) => labelOffsets.get(d.driver)?.anchor || 'start')
        .attr('fill', (d) => d.color || '#ffffff')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '11px')
        .style('font-weight', '700')
        .style('pointer-events', 'none')
        .text((d) => d.driver);

    return { teammateLinks, circles, labels };
}

/**
 * Updates node radii, strokes, label opacities, and teammate link visibility based on the focused driver.
 *
 * @param {Object} circles - D3 selection of driver scatter circles.
 * @param {Object} labels - D3 selection of driver text labels.
 * @param {Object} teammateLinks - D3 selection of teammate connector lines.
 * @param {Map<string, string>} driverToTeam - Map of driver code to constructor team name.
 * @param {string|null} effectiveDriver - Currently focused driver code, or null.
 * @returns {void}
 */
function _applyAeroFocusStyles(circles, labels, teammateLinks, driverToTeam, effectiveDriver) {
    const focusedTeam = effectiveDriver ? driverToTeam.get(effectiveDriver) : null;

    circles
        .attr('r', (d) => {
            if (effectiveDriver === null) return _NODE_RADIUS_PX;
            if (d.driver === effectiveDriver) return _FOCUSED_NODE_RADIUS_PX;
            if (focusedTeam && d.team === focusedTeam) return _TEAMMATE_NODE_RADIUS_PX;
            return _NODE_RADIUS_PX;
        })
        .attr('stroke', (d) =>
            d.driver === effectiveDriver ? _FOCUSED_NODE_STROKE_COLOR : 'var(--bg-dark)'
        )
        .attr('stroke-width', (d) =>
            d.driver === effectiveDriver ? _FOCUSED_NODE_STROKE_WIDTH_PX : _DEFAULT_NODE_STROKE_WIDTH_PX
        )
        .style('opacity', (d) => {
            if (effectiveDriver === null) return _ACTIVE_OPACITY;
            const isHighlighted = d.driver === effectiveDriver || (focusedTeam && d.team === focusedTeam);
            return isHighlighted ? _ACTIVE_OPACITY : _DIMMED_OPACITY;
        });

    labels.style('opacity', (d) => {
        if (effectiveDriver === null) return _ACTIVE_OPACITY;
        const isHighlighted = d.driver === effectiveDriver || (focusedTeam && d.team === focusedTeam);
        return isHighlighted ? _ACTIVE_OPACITY : _DIMMED_OPACITY;
    });

    teammateLinks.style('opacity', (d) =>
        focusedTeam && d.team === focusedTeam ? _FOCUSED_TEAMMATE_LINK_OPACITY : 0
    );
}

/**
 * Builds the HTML markup for the aero balance tooltip.
 *
 * @param {Object} entry - Hovered driver aero telemetry record.
 * @param {number} medianX - Session median cornering speed in km/h.
 * @param {number} medianY - Session median speed trap in km/h.
 * @returns {string} Tooltip HTML content.
 */
function _buildAeroTooltipHtml(entry, medianX, medianY) {
    const cornerDelta = entry.mean_corner_kmh - medianX;
    const trapDelta = entry.speed_trap_kmh - medianY;

    return `
        <div style="font-family: Montserrat, sans-serif; font-weight: 700; margin-bottom: 4px; text-transform: uppercase;">
            P${entry.rank} ${entry.driver} <span style="color: var(--text-muted); font-weight: 600; font-size: 0.75rem;">${entry.team}</span>
        </div>
        <div style="font-size: 0.85rem; font-weight: 600; margin-bottom: 2px;">
            Speed Trap: <span style="color: #fff;">${entry.speed_trap_kmh.toFixed(1)} km/h</span>
            <span style="color: var(--text-muted); font-size: 0.75rem;">(${trapDelta >= 0 ? '+' : ''}${trapDelta.toFixed(1)})</span>
        </div>
        <div style="font-size: 0.85rem; font-weight: 600;">
            Mean Cornering: <span style="color: #fff;">${entry.mean_corner_kmh.toFixed(1)} km/h</span>
            <span style="color: var(--text-muted); font-size: 0.75rem;">(${cornerDelta >= 0 ? '+' : ''}${cornerDelta.toFixed(1)})</span>
        </div>
    `;
}

/**
 * Binds hover and click-lock interaction handlers to the scatter plot circles.
 *
 * @param {Object} circles - D3 selection of driver scatter circles.
 * @param {Object} tooltip - D3 selection for the shared tooltip element.
 * @param {number} medianX - Session median cornering speed in km/h.
 * @param {number} medianY - Session median speed trap in km/h.
 * @param {{onHover: Function, onToggleLock: Function}} handlers - State update callbacks.
 * @returns {void}
 */
function _bindAeroNodeInteractions(circles, tooltip, medianX, medianY, handlers) {
    circles
        .on('mouseover', (event, d) => {
            handlers.onHover(d.driver);
            d3.select(event.currentTarget).attr('r', _HOVER_NODE_RADIUS_PX);

            tooltip
                .classed('hidden', false)
                .style('border-left-color', d.color || 'var(--accent)')
                .html(_buildAeroTooltipHtml(d, medianX, medianY))
                .style('left', `${event.pageX + _TOOLTIP_OFFSET_X_PX}px`)
                .style('top', `${event.pageY + _TOOLTIP_OFFSET_Y_PX}px`);
        })
        .on('mousemove', (event) => {
            tooltip
                .style('left', `${event.pageX + _TOOLTIP_OFFSET_X_PX}px`)
                .style('top', `${event.pageY + _TOOLTIP_OFFSET_Y_PX}px`);
        })
        .on('mouseout', () => {
            handlers.onHover(null);
            tooltip.classed('hidden', true);
        })
        .on('click', (event, d) => {
            handlers.onToggleLock(d.driver);
        });
}

/**
 * Renders the Aero Setup Balance Scatter Plot inside `#practice-aero-chart`.
 *
 * @param {Object} data - Race telemetry payload containing `data.practice`.
 * @returns {void}
 */
export function renderPracticeAero(data) {
    const container = document.getElementById('practice-aero-chart');
    if (!container) return;

    container.innerHTML = '';

    const entries = _extractValidAeroEntries(data);
    if (entries.length === 0) {
        _externalAeroFocusHandler = null;
        container.innerHTML =
            '<p style="color: var(--text-muted); text-align: center; padding-top: 2rem; font-family: Montserrat, sans-serif; text-transform: uppercase;">No aero speed telemetry available.</p>';
        return;
    }

    const rawWidth = container.clientWidth || _DEFAULT_CONTAINER_WIDTH_PX;
    const width = Math.max(_MIN_CHART_WIDTH_PX, rawWidth - _CHART_MARGIN.left - _CHART_MARGIN.right);
    const height = _CHART_HEIGHT_PX - _CHART_MARGIN.top - _CHART_MARGIN.bottom;
    const tooltip = d3.select('#tooltip');

    const { xScale, yScale, medianX, medianY } = _createAeroScalesAndMedians(entries, width, height);
    const positionedNodes = entries.map((d) => ({
        ...d,
        px: xScale(d.mean_corner_kmh),
        py: yScale(d.speed_trap_kmh)
    }));

    const driverToTeam = new Map(positionedNodes.map((d) => [d.driver, d.team]));
    const labelOffsets = _computeLabelOffsets(positionedNodes, width);
    const teamPairs = _buildTeammatePairs(positionedNodes);

    const svg = d3
        .select(container)
        .append('svg')
        .attr('width', width + _CHART_MARGIN.left + _CHART_MARGIN.right)
        .attr('height', height + _CHART_MARGIN.top + _CHART_MARGIN.bottom)
        .append('g')
        .attr('transform', `translate(${_CHART_MARGIN.left},${_CHART_MARGIN.top})`);

    _renderAeroAxesAndGrid(svg, xScale, yScale, width, height);
    _renderCrosshairsAndQuadrants(svg, xScale, yScale, medianX, medianY, width, height);

    const { teammateLinks, circles, labels } = _renderAeroElements(
        svg,
        positionedNodes,
        teamPairs,
        labelOffsets
    );

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
        _applyAeroFocusStyles(circles, labels, teammateLinks, driverToTeam, effectiveDriver);
    };

    _bindAeroNodeInteractions(circles, tooltip, medianX, medianY, {
        onHover: (driverCode) => {
            hoveredDriver = driverCode;
            refreshStyles();
        },
        onToggleLock: (driverCode) => {
            lockedDriver = lockedDriver === driverCode ? null : driverCode;
            refreshStyles();
        }
    });

    _externalAeroFocusHandler = (driverCode) => {
        externalDriver = driverCode;
        refreshStyles();
    };

    refreshStyles();
}
