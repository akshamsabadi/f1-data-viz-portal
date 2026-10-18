const _SLOW_CORNER_MAX_KMH = 130;
const _MEDIUM_CORNER_MAX_KMH = 200;
const _TURN_SUBPLOT_MARGIN = { top: 8, right: 12, bottom: 22, left: 12 };
const _TURN_CHART_HEIGHT_PX = 42;
const _MIN_SUBPLOT_WIDTH_PX = 120;
const _MIN_SPEED_DOMAIN_PADDING_KMH = 0.3;
const _SPEED_DOMAIN_PADDING_RATIO = 0.04;
const _X_AXIS_TICKS = 5;

const _RANGE_BAR_STROKE_COLOR = 'rgba(255, 255, 255, 0.16)';
const _RANGE_BAR_STROKE_WIDTH_PX = 4;

const _NODE_RADIUS_PX = 5.5;
const _NODE_HOVER_RADIUS_OFFSET_PX = 2;
const _DEFAULT_NODE_STROKE_COLOR = 'rgba(255, 255, 255, 0.35)';
const _HOVER_NODE_STROKE_COLOR = '#ffffff';
const _DEFAULT_NODE_STROKE_WIDTH_PX = 1;
const _HOVER_NODE_STROKE_WIDTH_PX = 2;

const _MAX_VERTICAL_JITTER_PX = 5.5;
const _COARSE_JITTER_FACTOR = 0.85;
const _FINE_JITTER_STEP_PX = 2.2;

const _ACTIVE_OPACITY = 1;
const _DIMMED_OPACITY = 0.12;
const _FASTEST_DELTA_COLOR = '#34d399';
const _TOOLTIP_OFFSET_X_PX = 15;
const _TOOLTIP_OFFSET_Y_PX = -30;

const _SECTOR_COLORS = {
    S1: '#ef4444',
    S2: '#38bdf8',
    S3: '#eab308'
};
const _CATEGORY_ACCENT_COLORS = {
    Slow: '#38bdf8',
    Medium: '#facc15',
    Fast: '#4ade80'
};
const _TRACK_VIEWBOX_W = 1000;
const _TRACK_VIEWBOX_H = 560;
const _TRACK_OUTER_CASING_WIDTH_PX = 16;
const _TRACK_BED_WIDTH_PX = 10;
const _TRACK_SECTOR_LINE_WIDTH_PX = 4.2;
const _TRACK_ACTIVE_ARC_WIDTH_PX = 11.5;
const _TURN_APEX_RADIUS_PX = 4.8;
const _TURN_APEX_ACTIVE_RADIUS_PX = 8.2;
const _TURN_BADGE_RADIUS_PX = 11.5;
const _TURN_BADGE_ACTIVE_RADIUS_PX = 14.5;
const _INSPECTOR_TOP_TEAMS_LIMIT = 5;

let _externalTeamFocusHandler = null;

/**
 * Highlights or restores team nodes in the Corner Speeds subplots from an external trigger.
 *
 * @param {string|null} teamName - Constructor name to focus, or null to restore.
 * @returns {void}
 */
export function setCornerSpeedExternalFocus(teamName) {
    if (_externalTeamFocusHandler) {
        _externalTeamFocusHandler(teamName);
    }
}

/**
 * Maps an average turn apex speed in km/h to its speed category descriptor.
 *
 * @param {number} avgSpeed - Mean speed across constructors for a given turn.
 * @returns {{key: 'Slow'|'Medium'|'Fast', title: string, label: string, cssClass: string}} Speed category metadata.
 */
function _getCornerCategory(avgSpeed) {
    if (avgSpeed < _SLOW_CORNER_MAX_KMH) {
        return {
            key: 'Slow',
            title: `Slow Corners (< ${_SLOW_CORNER_MAX_KMH} km/h)`,
            label: `Slow (<${_SLOW_CORNER_MAX_KMH} km/h)`,
            cssClass: 'category-slow'
        };
    }
    if (avgSpeed <= _MEDIUM_CORNER_MAX_KMH) {
        return {
            key: 'Medium',
            title: `Medium Corners (${_SLOW_CORNER_MAX_KMH} - ${_MEDIUM_CORNER_MAX_KMH} km/h)`,
            label: `Medium (${_SLOW_CORNER_MAX_KMH}–${_MEDIUM_CORNER_MAX_KMH} km/h)`,
            cssClass: 'category-medium'
        };
    }
    return {
        key: 'Fast',
        title: `Fast Corners (> ${_MEDIUM_CORNER_MAX_KMH} km/h)`,
        label: `Fast (>${_MEDIUM_CORNER_MAX_KMH} km/h)`,
        cssClass: 'category-fast'
    };
}

/**
 * Groups corner speed measurements by turn number in ascending order (1..N) and partitions
 * the per-turn descriptors into Slow, Medium, and Fast category columns.
 *
 * @param {Array<{turn: number, team: string, speed: number, color?: string}>} corners - Raw corner speed records.
 * @returns {Array<{key: string, title: string, cssClass: string, turns: Array<Object>}>} Non-empty category column descriptors.
 */
function _groupTurnsIntoCategoryColumns(corners) {
    const grouped = d3.group(corners, (d) => d.turn);
    const sortedTurnNumbers = Array.from(grouped.keys()).sort((a, b) => a - b);

    const columnsByKey = {
        Slow: {
            key: 'Slow',
            title: `Slow Corners (< ${_SLOW_CORNER_MAX_KMH} km/h)`,
            cssClass: 'category-slow',
            turns: []
        },
        Medium: {
            key: 'Medium',
            title: `Medium Corners (${_SLOW_CORNER_MAX_KMH} - ${_MEDIUM_CORNER_MAX_KMH} km/h)`,
            cssClass: 'category-medium',
            turns: []
        },
        Fast: {
            key: 'Fast',
            title: `Fast Corners (> ${_MEDIUM_CORNER_MAX_KMH} km/h)`,
            cssClass: 'category-fast',
            turns: []
        }
    };

    sortedTurnNumbers.forEach((turn) => {
        const rawTurnCorners = grouped.get(turn) || [];
        const turnCorners = rawTurnCorners.map((corner) => ({ ...corner }));
        const avgSpeed = d3.mean(turnCorners, (d) => d.speed) || 0;
        const minSpeed = d3.min(turnCorners, (d) => d.speed) || 0;
        const maxSpeed = d3.max(turnCorners, (d) => d.speed) || 0;
        const category = _getCornerCategory(avgSpeed);

        columnsByKey[category.key].turns.push({
            turn,
            avgSpeed,
            minSpeed,
            maxSpeed,
            category,
            corners: turnCorners
        });
    });

    return ['Slow', 'Medium', 'Fast']
        .map((key) => columnsByKey[key])
        .filter((col) => col.turns.length > 0);
}

/**
 * Extracts unique constructor teams and their colors from the corner telemetry data.
 *
 * @param {Array<{team: string, color?: string}>} corners - Corner telemetry records.
 * @returns {Array<{team: string, color: string}>} Unique team descriptors.
 */
function _extractTeamsFromCorners(corners) {
    const seen = new Map();
    corners.forEach((entry) => {
        if (!seen.has(entry.team)) {
            seen.set(entry.team, entry.color || 'var(--accent)');
        }
    });
    return Array.from(seen, ([team, color]) => ({ team, color }));
}

/**
 * Builds the interactive constructor legend in the Corner Speeds header.
 *
 * @param {HTMLElement|null} legendContainer - DOM container for team legend items.
 * @param {Array<{team: string, color: string}>} teams - Constructor list.
 * @param {Set<string>} activeTeams - Set of enabled constructor names.
 * @param {Function} onFilterChange - Callback when active teams change.
 * @param {Function} onHoverTeam - Callback when hovering/leaving a legend pill.
 * @returns {void}
 */
function _buildConstructorLegend(legendContainer, teams, activeTeams, onFilterChange, onHoverTeam) {
    if (!legendContainer) return;

    const updateLegendUI = () => {
        Array.from(legendContainer.children).forEach((child) => {
            const teamName = child.dataset.team;
            child.classList.toggle('inactive', !activeTeams.has(teamName));
        });
    };

    teams.forEach(({ team, color }) => {
        const item = document.createElement('div');
        item.className = 'legend-item';
        item.dataset.team = team;

        const swatch = document.createElement('div');
        swatch.className = 'legend-color';
        swatch.style.backgroundColor = color;
        item.appendChild(swatch);
        item.appendChild(document.createTextNode(team));

        item.addEventListener('click', () => {
            if (activeTeams.has(team)) {
                if (activeTeams.size > 1) {
                    activeTeams.delete(team);
                }
            } else {
                activeTeams.add(team);
            }
            updateLegendUI();
            onFilterChange();
        });

        item.addEventListener('mouseenter', () => onHoverTeam(team));
        item.addEventListener('mouseleave', () => onHoverTeam(null));

        legendContainer.appendChild(item);
    });

    updateLegendUI();
}

/**
 * Creates a category column wrapper (`Slow`, `Medium`, or `Fast`) with a column title header.
 *
 * @param {HTMLElement} parentContainer - Main `#corner-speed-chart` grid container.
 * @param {{title: string, cssClass: string}} columnData - Category column descriptor.
 * @returns {HTMLDivElement} Mounted `.speed-category-column` element.
 */
function _createCategoryColumn(parentContainer, columnData) {
    const columnEl = document.createElement('div');
    columnEl.className = 'speed-category-column';

    const headerEl = document.createElement('div');
    headerEl.className = 'speed-category-header';
    headerEl.textContent = columnData.title;
    columnEl.appendChild(headerEl);

    parentContainer.appendChild(columnEl);
    return columnEl;
}

/**
 * Creates the DOM card wrapper, header with turn title and speed range badge,
 * and inner chart mount container for a single turn subplot inside its category column.
 *
 * @param {HTMLElement} columnContainer - Category column container holding turn cards.
 * @param {{turn: number, minSpeed: number, maxSpeed: number, category: {key: string, label: string, cssClass: string}}} turnData - Turn metadata.
 * @param {Function} onHoverTurn - Callback invoked with `(turnNumber)` on hover or `(null)` on leave.
 * @returns {{cardEl: HTMLDivElement, chartDiv: HTMLDivElement}} Outer `.turn-subplot-card` and inner `.turn-chart-mount`.
 */
function _createTurnSubplotCard(columnContainer, turnData, onHoverTurn) {
    const subplotWrap = document.createElement('div');
    subplotWrap.className = 'subplot-container turn-subplot-card';
    subplotWrap.dataset.turn = String(turnData.turn);

    const header = document.createElement('div');
    header.className = 'subplot-title turn-subplot-header';

    const turnName = document.createElement('span');
    turnName.className = 'turn-subplot-name';
    turnName.textContent = `TURN ${turnData.turn}`;

    const badge = document.createElement('span');
    badge.className = `turn-category-badge ${turnData.category.cssClass}`;
    badge.title = turnData.category.label;
    badge.textContent = `${turnData.minSpeed.toFixed(0)}–${turnData.maxSpeed.toFixed(0)} km/h`;

    header.appendChild(turnName);
    header.appendChild(badge);
    subplotWrap.appendChild(header);

    const chartDiv = document.createElement('div');
    chartDiv.className = 'turn-chart-mount';
    subplotWrap.appendChild(chartDiv);

    subplotWrap.addEventListener('mouseenter', () => {
        if (onHoverTurn) onHoverTurn(turnData.turn);
    });
    subplotWrap.addEventListener('mouseleave', () => {
        if (onHoverTurn) onHoverTurn(null);
    });

    columnContainer.appendChild(subplotWrap);

    return { cardEl: subplotWrap, chartDiv };
}

/**
 * Renders vertical tick gridlines and a compact bottom Speed axis (km/h) for a turn card.
 *
 * @param {Object} svg - D3 selection for the turn subplot's translated group.
 * @param {Function} xScale - D3 linear scale for turn corner speeds.
 * @param {number} height - Inner subplot height in pixels.
 * @returns {void}
 */
function _renderTurnAxesAndGrid(svg, xScale, height) {
    svg.append('g')
        .attr('class', 'gridline')
        .attr('transform', `translate(0,${height})`)
        .call(
            d3
                .axisBottom(xScale)
                .ticks(_X_AXIS_TICKS)
                .tickSize(-height)
                .tickSizeOuter(0)
                .tickFormat('')
        );

    svg.append('g')
        .attr('transform', `translate(0,${height})`)
        .call(
            d3
                .axisBottom(xScale)
                .ticks(_X_AXIS_TICKS)
                .tickSizeOuter(0)
                .tickFormat((d) => `${d}`)
        );
}

/**
 * Renders a horizontal min-to-max speed range bar across the vertical center of a turn subplot.
 *
 * @param {Object} svg - D3 selection for the turn subplot's translated group.
 * @param {Function} xScale - D3 linear scale mapping speed to X coordinate.
 * @param {number} minSpeed - Slowest constructor speed in this turn.
 * @param {number} maxSpeed - Fastest constructor speed in this turn.
 * @param {number} centerY - Vertical center coordinate of the turn chart.
 * @returns {void}
 */
function _renderTurnRangeBar(svg, xScale, minSpeed, maxSpeed, centerY) {
    svg.append('line')
        .attr('class', 'turn-range-bar')
        .attr('x1', xScale(minSpeed))
        .attr('x2', xScale(maxSpeed))
        .attr('y1', centerY)
        .attr('y2', centerY)
        .attr('stroke', _RANGE_BAR_STROKE_COLOR)
        .attr('stroke-width', _RANGE_BAR_STROKE_WIDTH_PX)
        .attr('stroke-linecap', 'round');
}

/**
 * Positions each corner node at its true X-axis speed (`xScale(d.speed)`) and applies a
 * deterministic vertical offset (`±5.5px`) around `centerY` based on sorted speed index
 * so closely-spaced constructors remain easy to see and hover without distorting horizontal km/h coordinates.
 *
 * @param {Array<Object>} turnCorners - Cloned corner records for a single turn.
 * @param {Function} xScale - D3 linear scale mapping speed to X coordinate.
 * @param {number} centerY - Vertical center coordinate of the turn chart.
 * @returns {void}
 */
function _positionTurnNodesTrueSpeed(turnCorners, xScale, centerY) {
    turnCorners.sort((a, b) => a.speed - b.speed);
    const count = turnCorners.length;
    turnCorners.forEach((d, idx) => {
        d.x = xScale(d.speed);
        const normalizedOffset =
            count > 1 ? ((idx % 3) - 1) * (_MAX_VERTICAL_JITTER_PX * _COARSE_JITTER_FACTOR) : 0;
        const fineOffset = count > 3 ? ((idx % 2) - 0.5) * _FINE_JITTER_STEP_PX : 0;
        d.y =
            centerY +
            Math.max(
                -_MAX_VERTICAL_JITTER_PX,
                Math.min(_MAX_VERTICAL_JITTER_PX, normalizedOffset + fineOffset)
            );
    });
}

/**
 * Populates the shared tooltip element with constructor turn speed and delta to the fastest car in that turn.
 *
 * @param {HTMLElement|null} tooltipNode - DOM node of the shared `#tooltip` container.
 * @param {{team: string, turn: number, speed: number}} cornerEntry - Hovered corner record.
 * @param {{key: string}} category - Turn speed category descriptor.
 * @param {number} fastestInTurn - Maximum speed recorded in this turn across constructors.
 * @returns {void}
 */
function _populateCornerTooltipContent(tooltipNode, cornerEntry, category, fastestInTurn) {
    if (!tooltipNode) return;

    const headerDiv = document.createElement('div');
    headerDiv.style.fontFamily = 'Montserrat, sans-serif';
    headerDiv.style.fontWeight = '700';
    headerDiv.style.marginBottom = '4px';
    headerDiv.style.textTransform = 'uppercase';
    headerDiv.appendChild(document.createTextNode(`${cornerEntry.team} `));

    const turnSpan = document.createElement('span');
    turnSpan.style.color = 'var(--text-muted)';
    turnSpan.style.fontWeight = '600';
    turnSpan.style.fontSize = '0.75rem';
    turnSpan.textContent = `TURN ${cornerEntry.turn} (${category.key.toUpperCase()})`;
    headerDiv.appendChild(turnSpan);

    const speedDiv = document.createElement('div');
    speedDiv.style.fontSize = '0.95rem';
    speedDiv.style.fontWeight = '600';
    speedDiv.textContent = `Speed: ${cornerEntry.speed.toFixed(1)} km/h`;

    const delta = fastestInTurn - cornerEntry.speed;
    const deltaDiv = document.createElement('div');
    deltaDiv.style.fontSize = '0.8rem';
    deltaDiv.style.color = delta === 0 ? _FASTEST_DELTA_COLOR : 'var(--text-muted)';
    deltaDiv.style.marginTop = '2px';
    deltaDiv.textContent =
        delta === 0 ? 'Fastest in Turn' : `-${delta.toFixed(1)} km/h vs P1`;

    tooltipNode.replaceChildren(headerDiv, speedDiv, deltaDiv);
}

/**
 * Renders positioned team speed nodes for a single turn and binds tooltip hover interactions.
 *
 * @param {Object} svg - D3 selection for the turn subplot's translated group.
 * @param {{corners: Array<Object>, category: {key: string}, maxSpeed: number}} turnData - Turn data and speed stats.
 * @param {number} width - Inner subplot width in pixels.
 * @param {Object} tooltip - D3 selection for the shared tooltip element.
 * @returns {Object} D3 selection of rendered `.team-node` groups.
 */
function _renderTurnCornerNodes(svg, turnData, width, tooltip, onHoverTurn) {
    const { corners, category, maxSpeed: fastestInTurn } = turnData;
    const nodes = svg
        .selectAll('.team-node')
        .data(corners)
        .enter()
        .append('g')
        .attr('class', 'team-node')
        .attr('transform', (d) => {
            const clampedX = Math.max(_NODE_RADIUS_PX, Math.min(width - _NODE_RADIUS_PX, d.x));
            return `translate(${clampedX},${d.y})`;
        })
        .style('cursor', 'pointer')
        .on('mouseover', (event, d) => {
            if (onHoverTurn) onHoverTurn(turnData.turn);
            const teamColor = d.color || 'var(--accent)';
            _populateCornerTooltipContent(tooltip.node(), d, category, fastestInTurn);

            tooltip
                .classed('hidden', false)
                .style('border-left-color', teamColor)
                .style('left', `${event.pageX + _TOOLTIP_OFFSET_X_PX}px`)
                .style('top', `${event.pageY + _TOOLTIP_OFFSET_Y_PX}px`);

            d3.select(event.currentTarget)
                .raise()
                .select('circle')
                .attr('stroke', _HOVER_NODE_STROKE_COLOR)
                .attr('stroke-width', _HOVER_NODE_STROKE_WIDTH_PX)
                .attr('r', _NODE_RADIUS_PX + _NODE_HOVER_RADIUS_OFFSET_PX);
        })
        .on('mouseout', (event) => {
            tooltip.classed('hidden', true);
            d3.select(event.currentTarget)
                .select('circle')
                .attr('stroke', _DEFAULT_NODE_STROKE_COLOR)
                .attr('stroke-width', _DEFAULT_NODE_STROKE_WIDTH_PX)
                .attr('r', _NODE_RADIUS_PX);
        });

    nodes
        .append('circle')
        .attr('r', _NODE_RADIUS_PX)
        .attr('fill', (d) => d.color || 'var(--accent)')
        .attr('stroke', _DEFAULT_NODE_STROKE_COLOR)
        .attr('stroke-width', _DEFAULT_NODE_STROKE_WIDTH_PX);

    return nodes;
}

/**
 * Draws the auto-scaled SVG inside a mounted per-turn card container after the CSS Grid layout settles.
 * Sizes the X-axis tightly from `minSpeed` to `maxSpeed` across the full width of the panel.
 *
 * @param {HTMLDivElement} chartDiv - Mounted `.turn-chart-mount` container with final grid column width.
 * @param {{turn: number, minSpeed: number, maxSpeed: number, category: {key: string}, corners: Array<Object>}} turnData - Turn data and speed bounds.
 * @param {Object} tooltip - D3 selection for the shared tooltip element.
 * @param {Function} onHoverTurn - Callback invoked with `(turnNumber)` when hovering a node.
 * @returns {Object} D3 selection of rendered nodes in this turn subplot.
 */
function _drawTurnSubplotSvg(chartDiv, turnData, tooltip, onHoverTurn) {
    const width = Math.max(
        _MIN_SUBPLOT_WIDTH_PX,
        chartDiv.clientWidth - _TURN_SUBPLOT_MARGIN.left - _TURN_SUBPLOT_MARGIN.right
    );
    const height = _TURN_CHART_HEIGHT_PX;
    const centerY = height / 2;

    const svg = d3
        .select(chartDiv)
        .append('svg')
        .attr('width', width + _TURN_SUBPLOT_MARGIN.left + _TURN_SUBPLOT_MARGIN.right)
        .attr('height', height + _TURN_SUBPLOT_MARGIN.top + _TURN_SUBPLOT_MARGIN.bottom)
        .append('g')
        .attr('transform', `translate(${_TURN_SUBPLOT_MARGIN.left},${_TURN_SUBPLOT_MARGIN.top})`);

    const speedSpan = Math.max(1, turnData.maxSpeed - turnData.minSpeed);
    const domainPadding = Math.max(
        _MIN_SPEED_DOMAIN_PADDING_KMH,
        speedSpan * _SPEED_DOMAIN_PADDING_RATIO
    );

    const xScale = d3
        .scaleLinear()
        .domain([turnData.minSpeed - domainPadding, turnData.maxSpeed + domainPadding])
        .range([0, width]);

    _renderTurnAxesAndGrid(svg, xScale, height);
    _renderTurnRangeBar(svg, xScale, turnData.minSpeed, turnData.maxSpeed, centerY);
    _positionTurnNodesTrueSpeed(turnData.corners, xScale, centerY);
    return _renderTurnCornerNodes(svg, turnData, width, tooltip, onHoverTurn);
}

/**
 * Updates node opacities and radii across all turn subplots based on active teams and hovered team.
 *
 * @param {Array<Object>} subplotNodeSelections - List of D3 `.team-node` selections.
 * @param {Set<string>} activeTeams - Set of enabled constructor names.
 * @param {string|null} highlightedTeam - Currently hovered/focused team name, or null.
 * @returns {void}
 */
function _applyCornerTeamStyles(subplotNodeSelections, activeTeams, highlightedTeam) {
    subplotNodeSelections.forEach((nodes) => {
        if (!nodes) return;
        nodes.style('opacity', (d) => {
            const isTeamActive = activeTeams.has(d.team);
            const isTeamHighlighted = highlightedTeam === null || highlightedTeam === d.team;
            return isTeamActive && isTeamHighlighted ? _ACTIVE_OPACITY : _DIMMED_OPACITY;
        });

        nodes
            .select('circle')
            .attr('r', (d) =>
                highlightedTeam !== null && highlightedTeam === d.team
                    ? _NODE_RADIUS_PX + _NODE_HOVER_RADIUS_OFFSET_PX
                    : _NODE_RADIUS_PX
            )
            .attr('stroke', (d) =>
                highlightedTeam !== null && highlightedTeam === d.team
                    ? _HOVER_NODE_STROKE_COLOR
                    : _DEFAULT_NODE_STROKE_COLOR
            )
            .attr('stroke-width', (d) =>
                highlightedTeam !== null && highlightedTeam === d.team
                    ? _HOVER_NODE_STROKE_WIDTH_PX
                    : _DEFAULT_NODE_STROKE_WIDTH_PX
            );

        if (highlightedTeam !== null) {
            nodes.filter((d) => d.team === highlightedTeam).raise();
        }
    });
}

/**
 * Resolves the `track_map` geometry object from `data.track_map` or builds a procedural
 * closed-loop fallback when `track_map` is absent.
 *
 * @param {Object} data - Grand Prix telemetry payload.
 * @param {Array<Object>} allTurnsData - Sorted turn metadata objects.
 * @returns {{points: Array<[number, number]>, s1_end_idx: number, s2_end_idx: number, turns: Array<Object>}} Track map geometry.
 */
function _resolveTrackMapData(data, allTurnsData) {
    if (
        data.track_map &&
        Array.isArray(data.track_map.points) &&
        data.track_map.points.length >= 20 &&
        Array.isArray(data.track_map.turns) &&
        data.track_map.turns.length > 0
    ) {
        return data.track_map;
    }

    const numPoints = 180;
    const cx = _TRACK_VIEWBOX_W / 2;
    const cy = _TRACK_VIEWBOX_H / 2;
    const points = [];
    for (let i = 0; i < numPoints; i++) {
        const theta = (i / numPoints) * Math.PI * 2;
        const rScale = 1 + 0.2 * Math.cos(2 * theta) + 0.1 * Math.sin(3 * theta);
        const x = Number((cx + rScale * 340 * Math.cos(theta)).toFixed(1));
        const y = Number((cy + rScale * 195 * Math.sin(theta)).toFixed(1));
        points.push([x, y]);
    }

    const totalTurns = Math.max(1, allTurnsData.length);
    const turns = allTurnsData.map((t, index) => {
        const idx = Math.min(
            numPoints - 2,
            Math.max(2, Math.round(((index + 0.5) / totalTurns) * (numPoints - 4)))
        );
        const [x, y] = points[idx];
        const dx = x - cx;
        const dy = y - cy;
        const len = Math.hypot(dx, dy) || 1;
        return {
            turn: t.turn,
            idx,
            pct: Number(((idx / numPoints) * 100).toFixed(1)),
            x,
            y,
            label_x: Number((x + (dx / len) * 28).toFixed(1)),
            label_y: Number((y + (dy / len) * 28).toFixed(1)),
            arc_start_idx: Math.max(0, idx - 3),
            arc_end_idx: Math.min(numPoints - 1, idx + 3)
        };
    });

    return {
        points,
        s1_end_idx: Math.round(numPoints * 0.33),
        s2_end_idx: Math.round(numPoints * 0.67),
        turns
    };
}

/**
 * Determines which FIA Sector (`S1`, `S2`, or `S3`) a point index belongs to.
 *
 * @param {number} idx - Point index along the track loop.
 * @param {number} s1EndIdx - End index of Sector 1.
 * @param {number} s2EndIdx - End index of Sector 2.
 * @returns {'S1'|'S2'|'S3'} Sector identifier.
 */
function _resolveTurnSectorKey(idx, s1EndIdx, s2EndIdx) {
    if (idx <= s1EndIdx) return 'S1';
    if (idx <= s2EndIdx) return 'S2';
    return 'S3';
}

/**
 * Populates the right-hand Corner Telemetry Inspector card for the currently active turn.
 *
 * @param {HTMLElement} inspectorEl - Mounted `.circuit-turn-inspector` container.
 * @param {Object} turnData - Turn telemetry stats (`turn`, `minSpeed`, `maxSpeed`, `category`, `corners`).
 * @param {Object| undefined} turnGeo - Turn geometry entry (`idx`, `pct`).
 * @param {number} s1EndIdx - Sector 1 boundary index.
 * @param {number} s2EndIdx - Sector 2 boundary index.
 * @returns {void}
 */
function _populateTurnInspectorCard(inspectorEl, turnData, turnGeo, s1EndIdx, s2EndIdx) {
    if (!inspectorEl || !turnData) return;

    const topBlock = document.createElement('div');

    const headerRow = document.createElement('div');
    headerRow.className = 'inspector-header-row';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'inspector-turn-title';
    titleSpan.textContent = `TURN ${turnData.turn}`;

    const catBadge = document.createElement('span');
    catBadge.className = `turn-category-badge ${turnData.category.cssClass}`;
    catBadge.textContent = turnData.category.label;

    headerRow.append(titleSpan, catBadge);

    const sectorKey = _resolveTurnSectorKey(turnGeo?.idx ?? 0, s1EndIdx, s2EndIdx);
    const metaRow = document.createElement('div');
    metaRow.className = 'inspector-meta-row';

    const sectorSpan = document.createElement('span');
    sectorSpan.style.color = _SECTOR_COLORS[sectorKey];
    sectorSpan.style.fontWeight = '700';
    sectorSpan.textContent = `SECTOR ${sectorKey.slice(1)}`;

    const pctSpan = document.createElement('span');
    pctSpan.textContent = `${(turnGeo?.pct ?? 0).toFixed(0)}% Lap Distance`;

    const rangeSpan = document.createElement('span');
    rangeSpan.textContent = `Range: ${turnData.minSpeed.toFixed(0)}–${turnData.maxSpeed.toFixed(0)} km/h`;

    metaRow.append(sectorSpan, document.createTextNode('·'), pctSpan, document.createTextNode('·'), rangeSpan);
    topBlock.append(headerRow, metaRow);

    const leaderboard = document.createElement('div');
    leaderboard.className = 'inspector-leaderboard';

    const sortedCorners = turnData.corners
        .slice()
        .sort((a, b) => b.speed - a.speed)
        .slice(0, _INSPECTOR_TOP_TEAMS_LIMIT);
    const fastestSpeed = sortedCorners[0]?.speed ?? turnData.maxSpeed;

    sortedCorners.forEach((entry, idx) => {
        const row = document.createElement('div');
        row.className = 'inspector-team-row';

        const rankSpan = document.createElement('span');
        rankSpan.className = 'inspector-rank';
        rankSpan.textContent = `P${idx + 1}`;

        const teamWrap = document.createElement('div');
        teamWrap.className = 'inspector-team-name';
        const swatch = document.createElement('span');
        swatch.className = 'inspector-team-swatch';
        swatch.style.backgroundColor = entry.color || 'var(--accent)';
        teamWrap.append(swatch, document.createTextNode(entry.team));

        const speedSpan = document.createElement('span');
        speedSpan.className = 'inspector-speed-val';
        speedSpan.textContent = `${entry.speed.toFixed(1)} km/h`;

        const delta = fastestSpeed - entry.speed;
        const deltaSpan = document.createElement('span');
        deltaSpan.className = 'inspector-delta-val';
        if (delta <= 0.01) {
            deltaSpan.style.color = _FASTEST_DELTA_COLOR;
            deltaSpan.textContent = 'FASTEST';
        } else {
            deltaSpan.textContent = `-${delta.toFixed(1)}`;
        }

        row.append(rankSpan, teamWrap, speedSpan, deltaSpan);
        leaderboard.appendChild(row);
    });

    const hintDiv = document.createElement('div');
    hintDiv.className = 'inspector-hint';
    hintDiv.textContent = '// HOVER ANY TURN CARD BELOW OR CLICK A CORNER ON THE TRACK MAP';

    inspectorEl.replaceChildren(topBlock, leaderboard, hintDiv);
}

/**
 * Renders the interactive FIA Circuit Track Map SVG and live Corner Telemetry Inspector panel,
 * returning a controller function `setActiveTurn(turnNumber)` that highlights the corresponding
 * corner on the circuit map and updates the inspector card.
 *
 * @param {HTMLElement|null} mapWrapper - `#circuit-track-map` container element.
 * @param {Object} data - Grand Prix telemetry payload.
 * @param {Map<number, Object>} turnDataByNumber - Map of turn number to computed turn telemetry stats.
 * @param {Function} onMapTurnHover - Callback invoked when hovering/clicking a turn directly on the map.
 * @returns {Function} `setActiveTurn(turnNumber)` visual state updater.
 */
function _renderCircuitTrackMapPanel(mapWrapper, data, turnDataByNumber, onMapTurnHover) {
    if (!mapWrapper) return () => {};
    mapWrapper.replaceChildren();

    const allTurnsData = Array.from(turnDataByNumber.values()).sort((a, b) => a.turn - b.turn);
    if (allTurnsData.length === 0) return () => {};

    const trackMap = _resolveTrackMapData(data, allTurnsData);
    const { points, s1_end_idx: s1EndIdx, s2_end_idx: s2EndIdx, turns: turnGeometries } = trackMap;
    const turnGeoByNumber = new Map(turnGeometries.map((tg) => [tg.turn, tg]));

    const mapStage = document.createElement('div');
    mapStage.className = 'circuit-map-stage';

    const topBar = document.createElement('div');
    topBar.className = 'circuit-map-topbar';

    const subtitle = document.createElement('span');
    subtitle.className = 'circuit-map-subtitle';
    const gpName = data.race_info?.gp || 'Circuit';
    subtitle.textContent = `// FIA CIRCUIT TELEMETRY MAP · ${gpName.toUpperCase()} (${allTurnsData.length} TURNS)`;

    const sectorPills = document.createElement('div');
    sectorPills.className = 'circuit-sector-pills';
    [
        { key: 'S1', label: 'Sector 1', color: _SECTOR_COLORS.S1 },
        { key: 'S2', label: 'Sector 2', color: _SECTOR_COLORS.S2 },
        { key: 'S3', label: 'Sector 3', color: _SECTOR_COLORS.S3 }
    ].forEach(({ label, color }) => {
        const pill = document.createElement('span');
        pill.className = 'circuit-sector-pill';
        const dot = document.createElement('span');
        dot.className = 'circuit-sector-dot';
        dot.style.backgroundColor = color;
        pill.append(dot, document.createTextNode(label));
        sectorPills.appendChild(pill);
    });

    topBar.append(subtitle, sectorPills);
    mapStage.appendChild(topBar);

    const svgMount = document.createElement('div');
    mapStage.appendChild(svgMount);

    const inspectorEl = document.createElement('div');
    inspectorEl.className = 'circuit-turn-inspector';

    mapWrapper.append(mapStage, inspectorEl);

    const svg = d3
        .select(svgMount)
        .append('svg')
        .attr('class', 'circuit-map-svg')
        .attr('viewBox', `0 0 ${_TRACK_VIEWBOX_W} ${_TRACK_VIEWBOX_H}`)
        .attr('preserveAspectRatio', 'xMidYMid meet');

    const closedLine = d3
        .line()
        .x((d) => d[0])
        .y((d) => d[1])
        .curve(d3.curveCatmullRomClosed.alpha(0.5));

    const openLine = d3
        .line()
        .x((d) => d[0])
        .y((d) => d[1])
        .curve(d3.curveCatmullRom.alpha(0.5));

    // 1. Track outer kerb casing & dark asphalt bed
    svg.append('path')
        .datum(points)
        .attr('fill', 'none')
        .attr('stroke', 'rgba(255, 255, 255, 0.14)')
        .attr('stroke-width', _TRACK_OUTER_CASING_WIDTH_PX)
        .attr('stroke-linejoin', 'round')
        .attr('d', closedLine);

    svg.append('path')
        .datum(points)
        .attr('fill', 'none')
        .attr('stroke', '#12121b')
        .attr('stroke-width', _TRACK_BED_WIDTH_PX)
        .attr('stroke-linejoin', 'round')
        .attr('d', closedLine);

    // 2. Sector 1 / Sector 2 / Sector 3 colored racing line segments
    const s1Points = points.slice(0, s1EndIdx + 1);
    const s2Points = points.slice(s1EndIdx, s2EndIdx + 1);
    const s3Points = [...points.slice(s2EndIdx), points[0]];

    [
        { pts: s1Points, color: _SECTOR_COLORS.S1 },
        { pts: s2Points, color: _SECTOR_COLORS.S2 },
        { pts: s3Points, color: _SECTOR_COLORS.S3 }
    ].forEach(({ pts, color }) => {
        if (pts.length >= 2) {
            svg.append('path')
                .datum(pts)
                .attr('class', 'track-sector-path')
                .attr('fill', 'none')
                .attr('stroke', color)
                .attr('stroke-width', _TRACK_SECTOR_LINE_WIDTH_PX)
                .attr('stroke-linecap', 'round')
                .attr('opacity', 0.88)
                .attr('d', openLine);
        }
    });

    // 3. Start / Finish Line marker at points[0]
    if (points.length >= 3) {
        const [sx, sy] = points[0];
        const [nxPt, nyPt] = points[2];
        const angleDeg = (Math.atan2(nyPt - sy, nxPt - sx) * 180) / Math.PI;
        const sfGroup = svg
            .append('g')
            .attr('class', 'start-finish-marker')
            .attr('transform', `translate(${sx},${sy}) rotate(${angleDeg})`);

        sfGroup
            .append('line')
            .attr('x1', 0)
            .attr('y1', -11)
            .attr('x2', 0)
            .attr('y2', 11)
            .attr('stroke', '#ffffff')
            .attr('stroke-width', 3.5);

        sfGroup
            .append('polygon')
            .attr('points', '7,-5 16,0 7,5')
            .attr('fill', '#ffffff');
    }

    // 4. Per-turn highlighted corner arc segments
    const arcLayer = svg.append('g').attr('class', 'track-corner-arcs');
    const arcPaths = arcLayer
        .selectAll('path.track-corner-arc')
        .data(turnGeometries)
        .enter()
        .append('path')
        .attr('class', 'track-corner-arc')
        .attr('fill', 'none')
        .attr('stroke-linecap', 'round')
        .attr('stroke', (tg) => {
            const td = turnDataByNumber.get(tg.turn);
            const catKey = td?.category?.key || 'Medium';
            return _CATEGORY_ACCENT_COLORS[catKey] || '#ff1801';
        })
        .attr('stroke-width', _TRACK_ACTIVE_ARC_WIDTH_PX)
        .attr('opacity', 0)
        .attr('d', (tg) => {
            const start = Math.max(0, tg.arc_start_idx ?? Math.max(0, tg.idx - 3));
            const end = Math.min(
                points.length - 1,
                tg.arc_end_idx ?? Math.min(points.length - 1, tg.idx + 3)
            );
            const slice = points.slice(start, end + 1);
            return slice.length >= 2 ? openLine(slice) : null;
        });

    // 5. Interactive Turn Apex Nodes & Outward Callout Badges (T1..TN)
    const turnsLayer = svg.append('g').attr('class', 'track-turns-layer');
    const turnGroups = turnsLayer
        .selectAll('g.track-turn-node')
        .data(turnGeometries)
        .enter()
        .append('g')
        .attr('class', 'track-turn-node')
        .style('cursor', 'pointer')
        .on('mouseenter', (_event, tg) => {
            onMapTurnHover(tg.turn);
        })
        .on('mouseleave', () => {
            onMapTurnHover(null);
        })
        .on('click', (_event, tg) => {
            onMapTurnHover(tg.turn, true);
        });

    turnGroups
        .append('line')
        .attr('class', 'turn-leader-line')
        .attr('x1', (tg) => tg.x)
        .attr('y1', (tg) => tg.y)
        .attr('x2', (tg) => tg.label_x)
        .attr('y2', (tg) => tg.label_y)
        .attr('stroke', 'rgba(255, 255, 255, 0.35)')
        .attr('stroke-width', 1.2);

    const pulseRings = turnGroups
        .append('circle')
        .attr('class', 'track-turn-pulse-ring')
        .attr('cx', (tg) => tg.x)
        .attr('cy', (tg) => tg.y)
        .attr('r', _TURN_APEX_ACTIVE_RADIUS_PX)
        .attr('fill', 'none')
        .attr('stroke', '#ff1801')
        .attr('stroke-width', 2.5)
        .style('display', 'none');

    const apexDots = turnGroups
        .append('circle')
        .attr('class', 'turn-apex-dot')
        .attr('cx', (tg) => tg.x)
        .attr('cy', (tg) => tg.y)
        .attr('r', _TURN_APEX_RADIUS_PX)
        .attr('fill', (tg) => {
            const td = turnDataByNumber.get(tg.turn);
            return _CATEGORY_ACCENT_COLORS[td?.category?.key] || '#ffffff';
        })
        .attr('stroke', '#0d0d14')
        .attr('stroke-width', 1.6);

    const badgeCircles = turnGroups
        .append('circle')
        .attr('class', 'turn-badge-circle')
        .attr('cx', (tg) => tg.label_x)
        .attr('cy', (tg) => tg.label_y)
        .attr('r', _TURN_BADGE_RADIUS_PX)
        .attr('fill', 'rgba(16, 16, 24, 0.94)')
        .attr('stroke', (tg) => {
            const td = turnDataByNumber.get(tg.turn);
            return _CATEGORY_ACCENT_COLORS[td?.category?.key] || 'rgba(255, 255, 255, 0.4)';
        })
        .attr('stroke-width', 1.4);

    const badgeTexts = turnGroups
        .append('text')
        .attr('class', 'turn-badge-text')
        .attr('x', (tg) => tg.label_x)
        .attr('y', (tg) => tg.label_y)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'middle')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '9px')
        .style('font-weight', '800')
        .attr('fill', '#f3f4f6')
        .text((tg) => `T${tg.turn}`);

    const defaultTurnNumber = allTurnsData[0].turn;

    const updateMapHighlight = (activeTurnNumber) => {
        const effectiveTurn = activeTurnNumber ?? defaultTurnNumber;
        const activeTurnData = turnDataByNumber.get(effectiveTurn) || allTurnsData[0];
        const activeTurnGeo = turnGeoByNumber.get(effectiveTurn) || turnGeometries[0];

        _populateTurnInspectorCard(
            inspectorEl,
            activeTurnData,
            activeTurnGeo,
            s1EndIdx,
            s2EndIdx
        );

        const hasExplicitHighlight = activeTurnNumber !== null && activeTurnNumber !== undefined;

        arcPaths
            .attr('opacity', (tg) => (tg.turn === activeTurnNumber ? 0.95 : 0))
            .attr('stroke', (tg) => {
                const td = turnDataByNumber.get(tg.turn);
                const fastestCorner = td?.corners
                    ?.slice()
                    .sort((a, b) => b.speed - a.speed)[0];
                return fastestCorner?.color || '#ff1801';
            });

        pulseRings
            .style('display', (tg) => (tg.turn === activeTurnNumber ? null : 'none'))
            .attr('stroke', (tg) => {
                const td = turnDataByNumber.get(tg.turn);
                return _CATEGORY_ACCENT_COLORS[td?.category?.key] || '#ff1801';
            });

        apexDots
            .attr('r', (tg) =>
                tg.turn === activeTurnNumber
                    ? _TURN_APEX_ACTIVE_RADIUS_PX
                    : _TURN_APEX_RADIUS_PX
            )
            .attr('stroke', (tg) => (tg.turn === activeTurnNumber ? '#ffffff' : '#0d0d14'))
            .attr('stroke-width', (tg) => (tg.turn === activeTurnNumber ? 2.4 : 1.6));

        badgeCircles
            .attr('r', (tg) =>
                tg.turn === activeTurnNumber
                    ? _TURN_BADGE_ACTIVE_RADIUS_PX
                    : _TURN_BADGE_RADIUS_PX
            )
            .attr('fill', (tg) =>
                tg.turn === activeTurnNumber ? '#ff1801' : 'rgba(16, 16, 24, 0.94)'
            )
            .attr('stroke', (tg) => {
                if (tg.turn === activeTurnNumber) return '#ffffff';
                const td = turnDataByNumber.get(tg.turn);
                return _CATEGORY_ACCENT_COLORS[td?.category?.key] || 'rgba(255, 255, 255, 0.4)';
            })
            .attr('stroke-width', (tg) => (tg.turn === activeTurnNumber ? 2.2 : 1.4));

        badgeTexts
            .style('font-size', (tg) => (tg.turn === activeTurnNumber ? '10.5px' : '9px'))
            .attr('fill', '#ffffff');

        turnGroups.attr('opacity', (tg) =>
            !hasExplicitHighlight || tg.turn === activeTurnNumber ? 1 : 0.42
        );

        if (hasExplicitHighlight) {
            turnGroups.filter((tg) => tg.turn === activeTurnNumber).raise();
        }
    };

    updateMapHighlight(null);
    return updateMapHighlight;
}

/**
 * Renders the Corner Speeds chart organized into three columns (`Slow`, `Medium`, `Fast`),
 * with an interactive FIA Circuit Track Map above and an individual auto-scaled subplot card
 * per turn (`Turn 1..N`) inside its category column.
 *
 * @param {Object} data - Race telemetry payload containing `corners` and `track_map`.
 * @returns {void}
 */
export function renderCornerSpeed(data) {
    const container = document.getElementById('corner-speed-chart');
    const mapWrapper = document.getElementById('circuit-track-map');
    const legendContainer = document.getElementById('corner-speed-legend');
    container.replaceChildren();
    if (mapWrapper) mapWrapper.replaceChildren();
    if (legendContainer) legendContainer.replaceChildren();

    if (!data.corners || data.corners.length === 0) {
        _externalTeamFocusHandler = null;
        const emptyParagraph = document.createElement('p');
        emptyParagraph.style.color = 'var(--text-muted)';
        emptyParagraph.style.textAlign = 'center';
        emptyParagraph.style.paddingTop = '2rem';
        emptyParagraph.style.fontFamily = 'Montserrat, sans-serif';
        emptyParagraph.style.textTransform = 'uppercase';
        emptyParagraph.textContent = 'No corner speed data available.';
        container.replaceChildren(emptyParagraph);
        return;
    }

    const teams = _extractTeamsFromCorners(data.corners);
    const activeTeams = new Set(teams.map((t) => t.team));
    let hoveredLegendTeam = null;
    let externalFocusedTeam = null;
    let pinnedTurnNumber = null;

    const categoryColumns = _groupTurnsIntoCategoryColumns(data.corners);
    const turnDataByNumber = new Map();
    categoryColumns.forEach((col) => {
        col.turns.forEach((td) => {
            turnDataByNumber.set(td.turn, td);
        });
    });

    const tooltip = d3.select('#tooltip');
    const mountedTurnCards = [];
    let updateTrackMapHighlight = () => {};

    const syncActiveTurnState = (hoveredTurnNumber) => {
        const effectiveTurn = hoveredTurnNumber ?? pinnedTurnNumber;
        updateTrackMapHighlight(effectiveTurn);
        mountedTurnCards.forEach(({ cardEl, turnData }) => {
            cardEl.classList.toggle('turn-card-active', turnData.turn === effectiveTurn);
        });
    };

    updateTrackMapHighlight = _renderCircuitTrackMapPanel(
        mapWrapper,
        data,
        turnDataByNumber,
        (mapTurnNumber, isClick = false) => {
            if (isClick && mapTurnNumber !== null) {
                pinnedTurnNumber = pinnedTurnNumber === mapTurnNumber ? null : mapTurnNumber;
            }
            syncActiveTurnState(mapTurnNumber);
        }
    );

    categoryColumns.forEach((columnData) => {
        const columnEl = _createCategoryColumn(container, columnData);
        columnData.turns.forEach((turnData) => {
            const { cardEl, chartDiv } = _createTurnSubplotCard(
                columnEl,
                turnData,
                (hoveredTurn) => syncActiveTurnState(hoveredTurn)
            );
            mountedTurnCards.push({
                turnData,
                cardEl,
                chartDiv
            });
        });
    });

    const subplotNodeSelections = mountedTurnCards.map(({ chartDiv, turnData }) =>
        _drawTurnSubplotSvg(chartDiv, turnData, tooltip, (hoveredTurn) =>
            syncActiveTurnState(hoveredTurn)
        )
    );

    const refreshTeamStyles = () => {
        const effectiveHighlightedTeam =
            externalFocusedTeam !== null ? externalFocusedTeam : hoveredLegendTeam;
        _applyCornerTeamStyles(subplotNodeSelections, activeTeams, effectiveHighlightedTeam);
    };

    _externalTeamFocusHandler = (teamName) => {
        externalFocusedTeam = teamName;
        refreshTeamStyles();
    };

    _buildConstructorLegend(
        legendContainer,
        teams,
        activeTeams,
        refreshTeamStyles,
        (hoveredTeam) => {
            hoveredLegendTeam = hoveredTeam;
            refreshTeamStyles();
        }
    );

    refreshTeamStyles();
}
