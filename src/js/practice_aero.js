const _CHART_MARGIN = { top: 28, right: 36, bottom: 52, left: 64 };
const _CHART_HEIGHT_PX = 420;
const _MIN_CHART_WIDTH_PX = 300;

const _NODE_RADIUS_PX = 6.5;
const _FOCUSED_NODE_RADIUS_PX = 8.5;
const _HOVER_NODE_RADIUS_PX = 9.0;

const _ACTIVE_OPACITY = 1.0;
const _DIMMED_OPACITY = 0.18;

const _DOMAIN_PADDING_RATIO = 0.12;
const _MIN_DOMAIN_PAD_KMH = 1.2;

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
 * Computes smart label offsets `(dx, dy, anchor)` for each driver node to minimize label overlap.
 *
 * @param {Array<Object>} nodes - Array of positioned driver classification nodes with `px` and `py`.
 * @param {number} width - Inner chart width in pixels.
 * @returns {Map<string, {dx: number, dy: number, anchor: string}>} Map of driver code to label offset descriptor.
 */
function _computeLabelOffsets(nodes, width) {
    const offsets = new Map();
    const placedBoxes = [];
    const sorted = nodes.slice().sort((a, b) => a.py - b.py || a.px - b.px);

    const candidates = [
        { dx: 9, dy: -6, anchor: 'start' },
        { dx: 9, dy: 13, anchor: 'start' },
        { dx: -9, dy: -6, anchor: 'end' },
        { dx: -9, dy: 13, anchor: 'end' },
        { dx: 0, dy: -11, anchor: 'middle' },
        { dx: 0, dy: 17, anchor: 'middle' }
    ];

    sorted.forEach((node) => {
        let bestCandidate = candidates[0];
        let bestPenalty = Infinity;

        candidates.forEach((cand) => {
            if (node.px > width - 42 && cand.anchor === 'start') return;
            if (node.px < 42 && cand.anchor === 'end') return;

            const labelW = 28;
            const labelH = 11;
            const lx =
                cand.anchor === 'start'
                    ? node.px + cand.dx
                    : cand.anchor === 'end'
                      ? node.px + cand.dx - labelW
                      : node.px - labelW / 2;
            const ly = node.py + cand.dy - labelH + 2;

            let penalty = 0;
            nodes.forEach((other) => {
                if (other.driver === node.driver) return;
                const cx = Math.max(lx, Math.min(other.px, lx + labelW));
                const cy = Math.max(ly, Math.min(other.py, ly + labelH));
                const dist = Math.hypot(other.px - cx, other.py - cy);
                if (dist < 10) penalty += (10 - dist) * 20;
            });

            placedBoxes.forEach((box) => {
                const overlapX = Math.max(0, Math.min(lx + labelW, box.x + box.w) - Math.max(lx, box.x));
                const overlapY = Math.max(0, Math.min(ly + labelH, box.y + box.h) - Math.max(ly, box.y));
                if (overlapX > 0 && overlapY > 0) {
                    penalty += overlapX * overlapY * 5;
                }
            });

            if (penalty < bestPenalty) {
                bestPenalty = penalty;
                bestCandidate = cand;
            }
        });

        const labelW = 28;
        const labelH = 11;
        const lx =
            bestCandidate.anchor === 'start'
                ? node.px + bestCandidate.dx
                : bestCandidate.anchor === 'end'
                  ? node.px + bestCandidate.dx - labelW
                  : node.px - labelW / 2;
        const ly = node.py + bestCandidate.dy - labelH + 2;
        placedBoxes.push({ x: lx, y: ly, w: labelW, h: labelH });
        offsets.set(node.driver, bestCandidate);
    });

    return offsets;
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
        .call(d3.axisLeft(yScale).tickSize(-width).tickFormat('').ticks(6));

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
                .tickFormat((d) => `${d}`)
                .tickSize(0)
                .tickPadding(10)
        )
        .call((g) => g.select('.domain').attr('stroke', 'var(--border-color)'));

    xAxisGroup
        .append('text')
        .attr('x', width)
        .attr('y', 40)
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
                .ticks(6)
                .tickFormat((d) => `${d}`)
                .tickSize(0)
                .tickPadding(10)
        )
        .call((g) => g.select('.domain').remove());

    yAxisGroup
        .append('text')
        .attr('transform', 'rotate(-90)')
        .attr('y', -48)
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
        .attr('stroke', 'rgba(255, 255, 255, 0.22)')
        .attr('stroke-width', 1.25)
        .attr('stroke-dasharray', '5,5');

    crosshairsGroup
        .append('line')
        .attr('x1', 0)
        .attr('x2', width)
        .attr('y1', my)
        .attr('y2', my)
        .attr('stroke', 'rgba(255, 255, 255, 0.22)')
        .attr('stroke-width', 1.25)
        .attr('stroke-dasharray', '5,5');

    const quadrants = [
        {
            x: width - 8,
            y: 13,
            anchor: 'end',
            label: 'HIGH AERO EFFICIENCY',
            color: 'rgba(74, 222, 128, 0.6)'
        },
        {
            x: 8,
            y: 13,
            anchor: 'start',
            label: 'LOW-DRAG TRIM (TOP SPEED)',
            color: 'rgba(56, 189, 248, 0.6)'
        },
        {
            x: width - 8,
            y: height - 8,
            anchor: 'end',
            label: 'HIGH-DOWNFORCE TRIM',
            color: 'rgba(250, 204, 21, 0.6)'
        },
        {
            x: 8,
            y: height - 8,
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
        .style('font-size', '8.5px')
        .style('font-weight', '700')
        .style('letter-spacing', '0.4px')
        .style('pointer-events', 'none')
        .text((d) => d.label);
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

    const practice = data && data.practice;
    const rawClassification = (practice && practice.classification) || [];
    const entries = rawClassification.filter(
        (d) => Number.isFinite(d.mean_corner_kmh) && Number.isFinite(d.speed_trap_kmh)
    );

    if (entries.length === 0) {
        _externalAeroFocusHandler = null;
        container.innerHTML =
            '<p style="color: var(--text-muted); text-align: center; padding-top: 2rem; font-family: Montserrat, sans-serif; text-transform: uppercase;">No aero speed telemetry available.</p>';
        return;
    }

    const rawWidth = container.clientWidth || 560;
    const width = Math.max(_MIN_CHART_WIDTH_PX, rawWidth - _CHART_MARGIN.left - _CHART_MARGIN.right);
    const height = _CHART_HEIGHT_PX - _CHART_MARGIN.top - _CHART_MARGIN.bottom;

    const tooltip = d3.select('#tooltip');

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

    const positionedNodes = entries.map((d) => ({
        ...d,
        px: xScale(d.mean_corner_kmh),
        py: yScale(d.speed_trap_kmh)
    }));

    const driverToTeam = new Map(positionedNodes.map((d) => [d.driver, d.team]));
    const labelOffsets = _computeLabelOffsets(positionedNodes, width);

    const svgRoot = d3
        .select(container)
        .append('svg')
        .attr('width', width + _CHART_MARGIN.left + _CHART_MARGIN.right)
        .attr('height', height + _CHART_MARGIN.top + _CHART_MARGIN.bottom);

    const svg = svgRoot
        .append('g')
        .attr('transform', `translate(${_CHART_MARGIN.left},${_CHART_MARGIN.top})`);

    _renderAeroAxesAndGrid(svg, xScale, yScale, width, height);
    _renderCrosshairsAndQuadrants(svg, xScale, yScale, medianX, medianY, width, height);

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
        .attr('stroke-width', 1.75)
        .attr('stroke-dasharray', '3,3')
        .style('opacity', 0)
        .style('pointer-events', 'none');

    const nodesGroup = svg.append('g').attr('class', 'aero-nodes');
    const labelsGroup = svg.append('g').attr('class', 'aero-labels');

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
        .attr('stroke-width', 1.5)
        .style('cursor', 'pointer');

    const labels = labelsGroup
        .selectAll('text.aero-driver-label')
        .data(positionedNodes, (d) => d.driver)
        .enter()
        .append('text')
        .attr('class', 'aero-driver-label driver-label')
        .attr('x', (d) => d.px + (labelOffsets.get(d.driver)?.dx || 8))
        .attr('y', (d) => d.py + (labelOffsets.get(d.driver)?.dy || -8))
        .attr('text-anchor', (d) => labelOffsets.get(d.driver)?.anchor || 'start')
        .attr('fill', (d) => d.color || '#ffffff')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '11px')
        .style('font-weight', '700')
        .style('pointer-events', 'none')
        .text((d) => d.driver);

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

        const focusedTeam = effectiveDriver ? driverToTeam.get(effectiveDriver) : null;

        circles
            .attr('r', (d) => {
                if (effectiveDriver === null) return _NODE_RADIUS_PX;
                if (d.driver === effectiveDriver) return _FOCUSED_NODE_RADIUS_PX;
                if (focusedTeam && d.team === focusedTeam) return _NODE_RADIUS_PX + 1;
                return _NODE_RADIUS_PX;
            })
            .attr('stroke', (d) =>
                d.driver === effectiveDriver ? '#ffffff' : 'var(--bg-dark)'
            )
            .attr('stroke-width', (d) => (d.driver === effectiveDriver ? 2.2 : 1.5))
            .style('opacity', (d) => {
                if (effectiveDriver === null) return _ACTIVE_OPACITY;
                return d.driver === effectiveDriver || (focusedTeam && d.team === focusedTeam)
                    ? _ACTIVE_OPACITY
                    : _DIMMED_OPACITY;
            });

        labels.style('opacity', (d) => {
            if (effectiveDriver === null) return _ACTIVE_OPACITY;
            return d.driver === effectiveDriver || (focusedTeam && d.team === focusedTeam)
                ? _ACTIVE_OPACITY
                : _DIMMED_OPACITY;
        });

        teammateLinks.style('opacity', (d) =>
            focusedTeam && d.team === focusedTeam ? 0.75 : 0
        );
    };

    circles
        .on('mouseover', (event, d) => {
            hoveredDriver = d.driver;
            refreshStyles();

            d3.select(event.currentTarget).attr('r', _HOVER_NODE_RADIUS_PX);

            const cornerDelta = d.mean_corner_kmh - medianX;
            const trapDelta = d.speed_trap_kmh - medianY;

            tooltip
                .classed('hidden', false)
                .style('border-left-color', d.color || 'var(--accent)')
                .html(`
                    <div style="font-family: Montserrat, sans-serif; font-weight: 700; margin-bottom: 4px; text-transform: uppercase;">
                        P${d.rank} ${d.driver} <span style="color: var(--text-muted); font-weight: 600; font-size: 0.75rem;">${d.team}</span>
                    </div>
                    <div style="font-size: 0.85rem; font-weight: 600; margin-bottom: 2px;">
                        Speed Trap: <span style="color: #fff;">${d.speed_trap_kmh.toFixed(1)} km/h</span>
                        <span style="color: var(--text-muted); font-size: 0.75rem;">(${trapDelta >= 0 ? '+' : ''}${trapDelta.toFixed(1)})</span>
                    </div>
                    <div style="font-size: 0.85rem; font-weight: 600;">
                        Mean Cornering: <span style="color: #fff;">${d.mean_corner_kmh.toFixed(1)} km/h</span>
                        <span style="color: var(--text-muted); font-size: 0.75rem;">(${cornerDelta >= 0 ? '+' : ''}${cornerDelta.toFixed(1)})</span>
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

    _externalAeroFocusHandler = (driverCode) => {
        externalDriver = driverCode;
        refreshStyles();
    };

    refreshStyles();
}
