const _SLOW_CORNER_MAX_KMH = 130;
const _MEDIUM_CORNER_MAX_KMH = 200;
const _TURN_SUBPLOT_MARGIN = { top: 10, right: 18, bottom: 26, left: 18 };
const _TURN_CHART_HEIGHT_PX = 44;
const _MIN_SUBPLOT_WIDTH_PX = 120;
const _SPEED_DOMAIN_BUFFER_KMH = 1.5;
const _RANGE_PADDING_PX = 14;
const _X_AXIS_TICKS = 4;
const _NODE_RADIUS_PX = 5.5;
const _NODE_HOVER_RADIUS_OFFSET_PX = 2;
const _MAX_VERTICAL_JITTER_PX = 5.5;
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
 * Maps an average turn apex speed in km/h to its speed category descriptor.
 *
 * @param {number} avgSpeed - Mean speed across constructors for a given turn.
 * @returns {{key: 'Slow'|'Medium'|'Fast', label: string, cssClass: string}} Speed category metadata.
 */
function _getCornerCategory(avgSpeed) {
    if (avgSpeed < _SLOW_CORNER_MAX_KMH) {
        return {
            key: 'Slow',
            label: `Slow (<${_SLOW_CORNER_MAX_KMH} km/h)`,
            cssClass: 'category-slow'
        };
    }
    if (avgSpeed <= _MEDIUM_CORNER_MAX_KMH) {
        return {
            key: 'Medium',
            label: `Medium (${_SLOW_CORNER_MAX_KMH}–${_MEDIUM_CORNER_MAX_KMH} km/h)`,
            cssClass: 'category-medium'
        };
    }
    return {
        key: 'Fast',
        label: `Fast (>${_MEDIUM_CORNER_MAX_KMH} km/h)`,
        cssClass: 'category-fast'
    };
}

/**
 * Groups corner speed measurements by turn number in ascending order (1..N),
 * cloning each corner record and computing per-turn speed statistics and category metadata.
 *
 * @param {Array<{turn: number, team: string, speed: number, color?: string}>} corners - Raw corner speed records.
 * @returns {Array<{turn: number, avgSpeed: number, minSpeed: number, maxSpeed: number, category: {key: string, label: string, cssClass: string}, corners: Array<Object>}>} Per-turn descriptors sorted by turn number.
 */
function _groupCornersByTurn(corners) {
    const grouped = d3.group(corners, (d) => d.turn);
    const turns = Array.from(grouped.keys()).sort((a, b) => a - b);

    return turns.map((turn) => {
        const rawTurnCorners = grouped.get(turn) || [];
        const turnCorners = rawTurnCorners.map((corner) => ({ ...corner }));
        const avgSpeed = d3.mean(turnCorners, (d) => d.speed) || 0;
        const minSpeed = d3.min(turnCorners, (d) => d.speed) || 0;
        const maxSpeed = d3.max(turnCorners, (d) => d.speed) || 0;

        return {
            turn,
            avgSpeed,
            minSpeed,
            maxSpeed,
            category: _getCornerCategory(avgSpeed),
            corners: turnCorners
        };
    });
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
 * Creates the DOM card wrapper, header with turn title and speed category badge,
 * and inner chart mount container for a single turn subplot.
 *
 * @param {HTMLElement} parentContainer - Parent container holding all turn cards.
 * @param {{turn: number, category: {key: string, label: string, cssClass: string}}} turnData - Turn metadata.
 * @returns {HTMLDivElement} Inner chart container `div.turn-chart-mount` where the SVG will be mounted.
 */
function _createTurnSubplotCard(parentContainer, turnData) {
    const subplotWrap = document.createElement('div');
    subplotWrap.className = 'subplot-container turn-subplot-card';

    const header = document.createElement('div');
    header.className = 'subplot-title turn-subplot-header';

    const turnName = document.createElement('span');
    turnName.className = 'turn-subplot-name';
    turnName.textContent = `TURN ${turnData.turn}`;

    const badge = document.createElement('span');
    badge.className = `turn-category-badge ${turnData.category.cssClass}`;
    badge.title = turnData.category.label;
    badge.textContent = turnData.category.key;

    header.appendChild(turnName);
    header.appendChild(badge);
    subplotWrap.appendChild(header);

    const chartDiv = document.createElement('div');
    chartDiv.className = 'turn-chart-mount';
    subplotWrap.appendChild(chartDiv);
    parentContainer.appendChild(subplotWrap);

    return chartDiv;
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
        .attr('stroke', 'rgba(255, 255, 255, 0.16)')
        .attr('stroke-width', 4)
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
            count > 1 ? ((idx % 3) - 1) * (_MAX_VERTICAL_JITTER_PX * 0.85) : 0;
        const fineOffset = count > 3 ? ((idx % 2) - 0.5) * 2.2 : 0;
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
    deltaDiv.style.color = delta === 0 ? '#34d399' : 'var(--text-muted)';
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
function _renderTurnCornerNodes(svg, turnData, width, tooltip) {
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
 * Draws the auto-scaled SVG inside a mounted per-turn card container after the CSS Grid layout settles.
 *
 * @param {HTMLDivElement} chartDiv - Mounted `.turn-chart-mount` container with final grid column width.
 * @param {{turn: number, minSpeed: number, maxSpeed: number, category: {key: string}, corners: Array<Object>}} turnData - Turn data and speed bounds.
 * @param {Object} tooltip - D3 selection for the shared tooltip element.
 * @returns {Object} D3 selection of rendered nodes in this turn subplot.
 */
function _drawTurnSubplotSvg(chartDiv, turnData, tooltip) {
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

    const xScale = d3
        .scaleLinear()
        .domain([
            turnData.minSpeed - _SPEED_DOMAIN_BUFFER_KMH,
            turnData.maxSpeed + _SPEED_DOMAIN_BUFFER_KMH
        ])
        .range([_RANGE_PADDING_PX, width - _RANGE_PADDING_PX])
        .nice();

    _renderTurnAxesAndGrid(svg, xScale, height);
    _renderTurnRangeBar(svg, xScale, turnData.minSpeed, turnData.maxSpeed, centerY);
    _positionTurnNodesTrueSpeed(turnData.corners, xScale, centerY);
    return _renderTurnCornerNodes(svg, turnData, width, tooltip);
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
 * Renders the Corner Speeds chart with an individual auto-scaled subplot card per turn (`Turn 1..N`)
 * and its speed category badge (`Slow`, `Medium`, `Fast`).
 * Mounts all turn cards into the CSS Grid before measuring their widths so SVG dimensions match the layout.
 *
 * @param {Object} data - Race telemetry payload containing `corners`.
 * @returns {void}
 */
export function renderCornerSpeed(data) {
    const container = document.getElementById('corner-speed-chart');
    const legendContainer = document.getElementById('corner-speed-legend');
    container.replaceChildren();
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

    const turnsData = _groupCornersByTurn(data.corners);
    const tooltip = d3.select('#tooltip');

    const mountedTurnCards = turnsData.map((turnData) => ({
        turnData,
        chartDiv: _createTurnSubplotCard(container, turnData)
    }));

    const subplotNodeSelections = mountedTurnCards.map(({ chartDiv, turnData }) =>
        _drawTurnSubplotSvg(chartDiv, turnData, tooltip)
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
