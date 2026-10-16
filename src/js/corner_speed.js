const _SLOW_CORNER_MAX_KMH = 130;
const _MEDIUM_CORNER_MAX_KMH = 200;
const _SUBPLOT_MARGIN = { top: 20, right: 30, bottom: 50, left: 50 };
const _MIN_SUBPLOT_HEIGHT_PX = 300;
const _HEIGHT_PER_TURN_PX = 40;
const _SPEED_DOMAIN_BUFFER_KMH = 10;
const _RANGE_PADDING_PX = 30;
const _Y_SCALE_PADDING = 0.5;
const _X_AXIS_TICKS = 5;
const _NODE_RADIUS_PX = 5;
const _NODE_HOVER_RADIUS_OFFSET_PX = 1.5;
const _COLLIDE_PADDING_PX = 1;
const _SIMULATION_TICKS = 120;
const _TOOLTIP_OFFSET_X_PX = 15;
const _TOOLTIP_OFFSET_Y_PX = -30;

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
 * Runs a 1D horizontal collision force simulation with locked vertical turn coordinates.
 *
 * @param {Array<Object>} corners - Cloned corner records for the subplot.
 * @param {Function} xScale - D3 linear scale mapping speed to X coordinate.
 * @param {Function} yScale - D3 point scale mapping turn number to Y coordinate.
 * @returns {void}
 */
function _runCornerSimulation(corners, xScale, yScale) {
    corners.forEach((d) => {
        d.x = xScale(d.speed);
        d.fy = yScale(d.turn);
    });

    const simulation = d3
        .forceSimulation(corners)
        .force('x', d3.forceX((d) => xScale(d.speed)).strength(1))
        .force('collide', d3.forceCollide(_NODE_RADIUS_PX + _COLLIDE_PADDING_PX))
        .stop();

    for (let i = 0; i < _SIMULATION_TICKS; ++i) {
        simulation.tick();
    }
}

/**
 * Renders positioned team speed nodes and binds tooltip hover interactions.
 *
 * @param {Object} svg - D3 selection for the subplot's main translated group.
 * @param {Array<Object>} corners - Simulated corner speed records.
 * @param {number} width - Inner subplot width in pixels.
 * @param {Object} tooltip - D3 selection for the shared tooltip element.
 * @returns {void}
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
                .select('circle')
                .attr('stroke', '#ffffff')
                .attr('stroke-width', 1.5)
                .attr('r', _NODE_RADIUS_PX + _NODE_HOVER_RADIUS_OFFSET_PX);
        })
        .on('mouseout', (event) => {
            tooltip.classed('hidden', true);
            d3.select(event.currentTarget)
                .select('circle')
                .attr('stroke', 'var(--bg-dark)')
                .attr('stroke-width', 1)
                .attr('r', _NODE_RADIUS_PX);
        });

    nodes
        .append('circle')
        .attr('r', _NODE_RADIUS_PX)
        .attr('fill', (d) => d.color || 'var(--accent)')
        .attr('stroke', 'var(--bg-dark)')
        .attr('stroke-width', 1);
}

/**
 * Renders a single corner speed category subplot if it contains at least one turn.
 *
 * @param {HTMLElement} container - Parent DOM container for all corner speed subplots.
 * @param {{title: string, turns: Array<number>, corners: Array<Object>}} categoryData - Category turns and records.
 * @param {Object} tooltip - D3 selection for the shared tooltip element.
 * @returns {void}
 */
function _renderCategorySubplot(container, categoryData, tooltip) {
    if (categoryData.turns.length === 0) return;

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
    _runCornerSimulation(categoryData.corners, xScale, yScale);
    _renderCornerNodes(svg, categoryData.corners, width, tooltip);
}

/**
 * Renders the Corner Speeds chart partitioned into Slow, Medium, and Fast turn subplots.
 *
 * @param {Object} data - Race telemetry payload containing `corners`.
 * @returns {void}
 */
export function renderCornerSpeed(data) {
    const container = document.getElementById('corner-speed-chart');
    container.innerHTML = '';

    if (!data.corners || data.corners.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding-top: 2rem; font-family: Montserrat, sans-serif; text-transform: uppercase;">No corner speed data available.</p>';
        return;
    }

    const categories = _categorizeCornersBySpeed(data.corners);
    const tooltip = d3.select('#tooltip');

    Object.values(categories).forEach((categoryData) => {
        _renderCategorySubplot(container, categoryData, tooltip);
    });
}
