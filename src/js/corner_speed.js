const _SLOW_CORNER_MAX_KMH = 130;
const _MEDIUM_CORNER_MAX_KMH = 200;
const _SUBPLOT_MARGIN = { top: 20, right: 30, bottom: 50, left: 50 };
const _MIN_SUBPLOT_HEIGHT_PX = 300;
const _HEIGHT_PER_TURN_PX = 42;
const _SPEED_DOMAIN_BUFFER_KMH = 6;
const _RANGE_PADDING_PX = 24;
const _Y_SCALE_PADDING = 0.5;
const _X_AXIS_TICKS = 5;
const _NODE_RADIUS_PX = 5.5;
const _NODE_HOVER_RADIUS_OFFSET_PX = 2;
const _MAX_VERTICAL_JITTER_PX = 5;
const _ACTIVE_OPACITY = 1;
const _DIMMED_OPACITY = 0.12;
const _TOOLTIP_OFFSET_X_PX = 15;
const _TOOLTIP_OFFSET_Y_PX = -30;

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
 * Maps an average turn apex speed in km/h to its speed category key.
 *
 * @param {number} avgSpeed - Mean speed across teams for a given turn.
 * @returns {'Slow'|'Medium'|'Fast'} Speed category identifier.
 */
function _getCornerCategoryKey(avgSpeed) {
    if (avgSpeed < _SLOW_CORNER_MAX_KMH) return 'Slow';
    if (avgSpeed <= _MEDIUM_CORNER_MAX_KMH) return 'Medium';
    return 'Fast';
}

/**
 * Groups turns and cloned corner speed measurements into Slow, Medium, and Fast categories.
 *
 * @param {Array<{turn: number, team: string, speed: number, color?: string}>} corners - Raw corner speed records.
 * @returns {Object<string, {title: string, turns: Array<number>, corners: Array<Object>}>} Categorized corner data with cloned records.
 */
function _categorizeCornersBySpeed(corners) {
    const turnAverages = d3.rollups(
        corners,
        (values) => d3.mean(values, (d) => d.speed),
        (d) => d.turn
    );

    const categories = {
        Slow: { title: `Slow Corners (< ${_SLOW_CORNER_MAX_KMH} km/h)`, turns: [], corners: [] },
        Medium: {
            title: `Medium Corners (${_SLOW_CORNER_MAX_KMH} - ${_MEDIUM_CORNER_MAX_KMH} km/h)`,
            turns: [],
            corners: []
        },
        Fast: { title: `Fast Corners (> ${_MEDIUM_CORNER_MAX_KMH} km/h)`, turns: [], corners: [] }
    };

    const turnToCategory = new Map();
    turnAverages.forEach(([turn, avgSpeed]) => {
        const categoryKey = _getCornerCategoryKey(avgSpeed);
        categories[categoryKey].turns.push(turn);
        turnToCategory.set(turn, categoryKey);
    });

    corners.forEach((corner) => {
        const categoryKey = turnToCategory.get(corner.turn);
        if (categoryKey) {
            categories[categoryKey].corners.push({ ...corner });
        }
    });

    return categories;
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
 * Creates the DOM wrapper and title for a single corner speed category subplot.
 *
 * @param {HTMLElement} parentContainer - Parent container holding all subplots.
 * @param {string} titleText - Heading text for the subplot category.
 * @returns {HTMLDivElement} Inner chart container `div` where the SVG will be mounted.
 */
function _createSubplotContainer(parentContainer, titleText) {
    const subplotWrap = document.createElement('div');
    subplotWrap.className = 'subplot-container';

    const title = document.createElement('div');
    title.className = 'subplot-title';
    title.textContent = titleText;
    subplotWrap.appendChild(title);

    const chartDiv = document.createElement('div');
    subplotWrap.appendChild(chartDiv);
    parentContainer.appendChild(subplotWrap);

    return chartDiv;
}

/**
 * Renders gridlines, horizontal Speed axis, and vertical Turn axis for a subplot.
 *
 * @param {Object} svg - D3 selection for the subplot's main translated group.
 * @param {Function} xScale - D3 linear scale for corner speeds.
 * @param {Function} yScale - D3 point scale for turn numbers.
 * @param {number} width - Inner subplot width in pixels.
 * @param {number} height - Inner subplot height in pixels.
 * @returns {void}
 */
function _renderSubplotAxesAndGrid(svg, xScale, yScale, width, height) {
    svg.append('g')
        .attr('class', 'gridline')
        .call(d3.axisLeft(yScale).tickSize(-width).tickFormat(''));

    svg.append('g')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(xScale).ticks(_X_AXIS_TICKS))
        .append('text')
        .attr('x', width / 2)
        .attr('y', 40)
        .attr('fill', 'var(--text-muted)')
        .attr('text-anchor', 'middle')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-weight', '600')
        .text('SPEED (KM/H)');

    svg.append('g')
        .call(d3.axisLeft(yScale).tickFormat((d) => `T${d}`))
        .selectAll('.tick text')
        .style('fill', 'var(--text-muted)')
        .style('font-family', 'Titillium Web, sans-serif')
        .style('font-weight', '700')
        .style('font-size', '12px');
}

/**
 * Positions each corner node at its true X-axis speed (`xScale(d.speed)`) and applies a
 * deterministic vertical jitter (`±5px`) within each turn's band so overlapping teams remain visible
 * without distorting horizontal km/h readings.
 *
 * @param {Array<Object>} corners - Cloned corner records for the subplot.
 * @param {Function} xScale - D3 linear scale mapping speed to X coordinate.
 * @param {Function} yScale - D3 point scale mapping turn number to Y coordinate.
 * @returns {void}
 */
function _positionCornerNodesTrueSpeed(corners, xScale, yScale) {
    const byTurn = d3.group(corners, (d) => d.turn);
    byTurn.forEach((turnCorners, turn) => {
        turnCorners.sort((a, b) => a.speed - b.speed);
        const baseY = yScale(turn);
        const count = turnCorners.length;
        turnCorners.forEach((d, idx) => {
            d.x = xScale(d.speed);
            const normalizedOffset = count > 1 ? ((idx % 3) - 1) * (_MAX_VERTICAL_JITTER_PX * 0.85) : 0;
            const fineOffset = count > 3 ? (((idx % 2) - 0.5) * 2.5) : 0;
            d.y = baseY + Math.max(-_MAX_VERTICAL_JITTER_PX, Math.min(_MAX_VERTICAL_JITTER_PX, normalizedOffset + fineOffset));
        });
    });
}

/**
 * Renders a subtle horizontal min-to-max speed range bar per turn so the spread across constructors is clear.
 *
 * @param {Object} svg - D3 selection for the subplot's main translated group.
 * @param {Array<Object>} corners - Corner speed records for the subplot.
 * @param {Function} xScale - D3 linear scale mapping speed to X coordinate.
 * @param {Function} yScale - D3 point scale mapping turn number to Y coordinate.
 * @returns {void}
 */
function _renderTurnRangeBars(svg, corners, xScale, yScale) {
    const turnExtents = d3.rollups(
        corners,
        (values) => ({
            minSpeed: d3.min(values, (d) => d.speed),
            maxSpeed: d3.max(values, (d) => d.speed)
        }),
        (d) => d.turn
    );

    svg.append('g')
        .attr('class', 'turn-range-bars')
        .selectAll('line.turn-range-bar')
        .data(turnExtents)
        .enter()
        .append('line')
        .attr('class', 'turn-range-bar')
        .attr('x1', ([_, ext]) => xScale(ext.minSpeed))
        .attr('x2', ([_, ext]) => xScale(ext.maxSpeed))
        .attr('y1', ([turn]) => yScale(turn))
        .attr('y2', ([turn]) => yScale(turn))
        .attr('stroke', 'rgba(255, 255, 255, 0.16)')
        .attr('stroke-width', 4)
        .attr('stroke-linecap', 'round');
}

/**
 * Renders positioned team speed nodes and binds tooltip hover interactions.
 *
 * @param {Object} svg - D3 selection for the subplot's main translated group.
 * @param {Array<Object>} corners - Positioned corner speed records.
 * @param {number} width - Inner subplot width in pixels.
 * @param {Object} tooltip - D3 selection for the shared tooltip element.
 * @returns {Object} D3 selection of rendered `.team-node` groups.
 */
function _renderCornerNodes(svg, corners, width, tooltip) {
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
            const teamColor = d.color || 'var(--accent)';

            tooltip
                .classed('hidden', false)
                .style('border-left-color', teamColor)
                .html(`
                    <div style="font-family: Montserrat, sans-serif; font-weight: 700; margin-bottom: 4px; text-transform: uppercase;">
                        ${d.team} <span style="color: var(--text-muted); font-weight: 600; font-size: 0.75rem;">TURN ${d.turn}</span>
                    </div>
                    <div style="font-size: 1rem; font-weight: 600;">
                        ${d.speed.toFixed(1)} km/h
                    </div>
                `)
                .style('left', `${event.pageX + _TOOLTIP_OFFSET_X_PX}px`)
                .style('top', `${event.pageY + _TOOLTIP_OFFSET_Y_PX}px`);

            d3.select(event.currentTarget)
                .raise()
                .select('circle')
                .attr('stroke', '#ffffff')
                .attr('stroke-width', 2)
                .attr('r', _NODE_RADIUS_PX + _NODE_HOVER_RADIUS_OFFSET_PX);
        })
        .on('mouseout', (event) => {
            tooltip.classed('hidden', true);
            d3.select(event.currentTarget)
                .select('circle')
                .attr('stroke', 'rgba(255, 255, 255, 0.35)')
                .attr('stroke-width', 1)
                .attr('r', _NODE_RADIUS_PX);
        });

    nodes
        .append('circle')
        .attr('r', _NODE_RADIUS_PX)
        .attr('fill', (d) => d.color || 'var(--accent)')
        .attr('stroke', 'rgba(255, 255, 255, 0.35)')
        .attr('stroke-width', 1);

    return nodes;
}

/**
 * Renders a single corner speed category subplot if it contains at least one turn.
 *
 * @param {HTMLElement} container - Parent DOM container for all corner speed subplots.
 * @param {{title: string, turns: Array<number>, corners: Array<Object>}} categoryData - Category turns and records.
 * @param {Object} tooltip - D3 selection for the shared tooltip element.
 * @returns {Object|null} D3 selection of rendered nodes in this subplot, or null if empty.
 */
function _renderCategorySubplot(container, categoryData, tooltip) {
    if (categoryData.turns.length === 0) return null;

    const chartDiv = _createSubplotContainer(container, categoryData.title);
    const width = chartDiv.clientWidth - _SUBPLOT_MARGIN.left - _SUBPLOT_MARGIN.right;
    const height = Math.max(_MIN_SUBPLOT_HEIGHT_PX, categoryData.turns.length * _HEIGHT_PER_TURN_PX);

    const svg = d3
        .select(chartDiv)
        .append('svg')
        .attr('width', width + _SUBPLOT_MARGIN.left + _SUBPLOT_MARGIN.right)
        .attr('height', height + _SUBPLOT_MARGIN.top + _SUBPLOT_MARGIN.bottom)
        .append('g')
        .attr('transform', `translate(${_SUBPLOT_MARGIN.left},${_SUBPLOT_MARGIN.top})`);

    const sortedTurns = categoryData.turns.slice().sort((a, b) => a - b);
    const speedExtent = d3.extent(categoryData.corners, (d) => d.speed);

    const xScale = d3
        .scaleLinear()
        .domain([
            speedExtent[0] - _SPEED_DOMAIN_BUFFER_KMH,
            speedExtent[1] + _SPEED_DOMAIN_BUFFER_KMH
        ])
        .range([_RANGE_PADDING_PX, width - _RANGE_PADDING_PX])
        .nice();

    const yScale = d3
        .scalePoint()
        .domain(sortedTurns)
        .range([0, height])
        .padding(_Y_SCALE_PADDING);

    _renderSubplotAxesAndGrid(svg, xScale, yScale, width, height);
    _renderTurnRangeBars(svg, categoryData.corners, xScale, yScale);
    _positionCornerNodesTrueSpeed(categoryData.corners, xScale, yScale);
    return _renderCornerNodes(svg, categoryData.corners, width, tooltip);
}

/**
 * Updates node opacities and radii across all corner speed subplots based on active teams and hovered team.
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
                    ? '#ffffff'
                    : 'rgba(255, 255, 255, 0.35)'
            )
            .attr('stroke-width', (d) =>
                highlightedTeam !== null && highlightedTeam === d.team ? 2 : 1
            );

        if (highlightedTeam !== null) {
            nodes.filter((d) => d.team === highlightedTeam).raise();
        }
    });
}

/**
 * Renders the Corner Speeds chart partitioned into Slow, Medium, and Fast turn subplots.
 *
 * @param {Object} data - Race telemetry payload containing `corners`.
 * @returns {void}
 */
export function renderCornerSpeed(data) {
    const container = document.getElementById('corner-speed-chart');
    const legendContainer = document.getElementById('corner-speed-legend');
    container.innerHTML = '';
    if (legendContainer) legendContainer.innerHTML = '';

    if (!data.corners || data.corners.length === 0) {
        _externalTeamFocusHandler = null;
        container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding-top: 2rem; font-family: Montserrat, sans-serif; text-transform: uppercase;">No corner speed data available.</p>';
        return;
    }

    const teams = _extractTeamsFromCorners(data.corners);
    const activeTeams = new Set(teams.map((t) => t.team));
    let hoveredLegendTeam = null;
    let externalFocusedTeam = null;

    const categories = _categorizeCornersBySpeed(data.corners);
    const tooltip = d3.select('#tooltip');

    const subplotNodeSelections = Object.values(categories)
        .map((categoryData) => _renderCategorySubplot(container, categoryData, tooltip))
        .filter((sel) => sel !== null);

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
