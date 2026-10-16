import { calculateDriverClassification, getBumpLineOpacity } from './standings.js';

const _CHART_MARGIN = { top: 20, right: 50, bottom: 40, left: 40 };
const _CHART_HEIGHT_PX = 400;
const _DEFAULT_MAX_POSITIONS = 22;
const _X_AXIS_TICKS = 10;
const _DEFAULT_STROKE_WIDTH = 2;
const _HOVER_STROKE_WIDTH = 4;
const _HOVER_TARGET_STROKE_WIDTH = 12;
const _NODE_RADIUS_PX = 4;
const _LABEL_OFFSET_X_PX = 8;
const _ACTIVE_OPACITY = 1;
const _DIMMED_OPACITY = 0.05;
const _DNS_DASH_ARRAY = '1,4';
const _DNF_DASH_ARRAY = '3,3';

/**
 * Constructs a Map of driver code to processed lap arrays in the original driver list order,
 * including synthetic DNS markers and DNF classification drop-off points.
 *
 * @param {Array<{code: string}>} drivers - Original drivers list from race payload.
 * @param {Array<Object>} classification - Computed driver classification entries from `calculateDriverClassification`.
 * @param {number} maxLap - Total laps completed by the winner.
 * @returns {Map<string, Array<Object>>} Map of driver code to lap position records.
 */
function _buildProcessedDriverLaps(drivers, classification, maxLap) {
    const processedByDriver = new Map();
    const byCode = new Map(classification.map((entry) => [entry.code, entry]));

    drivers.forEach((driver) => {
        const classifiedDriver = byCode.get(driver.code);
        if (!classifiedDriver) return;

        const realLaps = classifiedDriver.laps;
        const finalRank = classifiedDriver.rank;

        let processedLaps = [];
        if (classifiedDriver.isDns) {
            processedLaps = [
                {
                    driver: driver.code,
                    lap: 1,
                    position: finalRank,
                    isDns: true
                }
            ];
        } else if (classifiedDriver.isDnf) {
            const dropLap = Math.min(realLaps.length + 1, maxLap);
            processedLaps = [
                ...realLaps,
                {
                    driver: driver.code,
                    lap: dropLap,
                    position: finalRank,
                    isDnf: true
                }
            ];
        } else {
            processedLaps = realLaps;
        }

        processedByDriver.set(driver.code, processedLaps);
    });

    return processedByDriver;
}

/**
 * Returns the SVG stroke-dasharray pattern for a driver's bump line based on DNS/DNF status.
 *
 * @param {Array<{isDns?: boolean, isDnf?: boolean}>} laps - Processed lap series for a driver.
 * @returns {string} SVG `stroke-dasharray` attribute value.
 */
function _getStrokeDashArray(laps) {
    const isDns = Boolean(laps[0]?.isDns);
    const isDnf = Boolean(laps[laps.length - 1]?.isDnf);
    if (isDns) return _DNS_DASH_ARRAY;
    if (isDnf) return _DNF_DASH_ARRAY;
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
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(xScale).ticks(_X_AXIS_TICKS).tickFormat(d3.format('d')))
        .append('text')
        .attr('x', width)
        .attr('y', 35)
        .attr('fill', 'var(--text-muted)')
        .attr('text-anchor', 'end')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-weight', '600')
        .text('LAP');

    svg.append('g')
        .call(d3.axisLeft(yScale).ticks(maxPos))
        .append('text')
        .attr('transform', 'rotate(-90)')
        .attr('y', -30)
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
        .attr('stroke', (d) => driverColors[d[0]] || '#ccc')
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
 * Renders start circles, finishing circles, and finishing driver code labels.
 *
 * @param {Object} svg - D3 selection for the chart's main group.
 * @param {Map<string, Array<Object>>} driverLapsProcessed - Processed lap series per driver.
 * @param {Object<string, string>} driverColors - Map of driver code to team color.
 * @param {Function} xScale - D3 linear scale for lap numbers.
 * @param {Function} yScale - D3 linear scale for track positions.
 * @returns {{startNodes: Object, endNodes: Object, endLabels: Object}} D3 selections for nodes and labels.
 */
function _renderBumpNodesAndLabels(svg, driverLapsProcessed, driverColors, xScale, yScale) {
    const startNodesGroup = svg.append('g').attr('class', 'start-nodes');
    const startNodes = startNodesGroup
        .selectAll('.start-node')
        .data(Array.from(driverLapsProcessed).filter((d) => !d[1][0].isDns))
        .enter()
        .append('circle')
        .attr('class', 'start-node')
        .attr('cx', (d) => xScale(d[1][0].lap))
        .attr('cy', (d) => yScale(d[1][0].position))
        .attr('r', _NODE_RADIUS_PX)
        .attr('fill', (d) => driverColors[d[0]] || '#ccc')
        .attr('stroke', 'var(--bg-dark)')
        .attr('stroke-width', 1);

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
        .attr('fill', (d) => driverColors[d[0]] || '#ccc')
        .attr('stroke', 'var(--bg-dark)')
        .attr('stroke-width', 1);

    const endLabels = endNodesGroup
        .selectAll('.end-label')
        .data(driverLapsProcessed)
        .enter()
        .append('text')
        .attr('class', 'end-label')
        .attr('x', (d) => xScale(d[1][d[1].length - 1].lap) + _LABEL_OFFSET_X_PX)
        .attr('y', (d) => yScale(d[1][d[1].length - 1].position))
        .attr('dy', '0.35em')
        .attr('fill', (d) => driverColors[d[0]] || '#ccc')
        .style('font-family', 'Titillium Web, sans-serif')
        .style('font-size', '11px')
        .style('font-weight', '700')
        .text((d) => _formatEndLabelText(d[0], d[1]));

    return { startNodes, endNodes, endLabels };
}

/**
 * Binds mouseover and mouseout focus handlers to the transparent hover paths.
 *
 * @param {Object} hoverPaths - D3 selection of transparent hit-target paths.
 * @param {Object} paths - D3 selection of visible driver position paths.
 * @param {Object} startNodes - D3 selection of starting lap circles.
 * @param {Object} endNodes - D3 selection of final lap circles.
 * @param {Object} endLabels - D3 selection of final driver code labels.
 * @returns {void}
 */
function _bindBumpHoverInteraction(hoverPaths, paths, startNodes, endNodes, endLabels) {
    const handleMouseOver = (event, hoveredEntry) => {
        const hoveredDriver = hoveredEntry[0];
        paths.attr('opacity', (p) => (p[0] === hoveredDriver ? _ACTIVE_OPACITY : _DIMMED_OPACITY));
        startNodes.attr('opacity', (p) => (p[0] === hoveredDriver ? _ACTIVE_OPACITY : _DIMMED_OPACITY));
        endNodes.attr('opacity', (p) => (p[0] === hoveredDriver ? _ACTIVE_OPACITY : _DIMMED_OPACITY));
        endLabels.attr('opacity', (p) => (p[0] === hoveredDriver ? _ACTIVE_OPACITY : _DIMMED_OPACITY));

        paths
            .filter((p) => p[0] === hoveredDriver)
            .attr('stroke-width', _HOVER_STROKE_WIDTH);
    };

    const handleMouseOut = () => {
        paths
            .attr('opacity', (p) => getBumpLineOpacity(p[1]))
            .attr('stroke-width', _DEFAULT_STROKE_WIDTH);
        startNodes.attr('opacity', _ACTIVE_OPACITY);
        endNodes.attr('opacity', _ACTIVE_OPACITY);
        endLabels.attr('opacity', _ACTIVE_OPACITY);
    };

    hoverPaths.on('mouseover', handleMouseOver).on('mouseout', handleMouseOut);
}

/**
 * Renders the Track Position bump chart across all laps of the race.
 *
 * @param {Object} data - Race telemetry payload containing `laps` and `drivers`.
 * @returns {void}
 */
export function renderBump(data) {
    const container = document.getElementById('bump-chart');
    container.innerHTML = '';

    const { validLaps, maxLap, classification } = calculateDriverClassification(data);
    if (validLaps.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding-top: 2rem; font-family: Montserrat, sans-serif; text-transform: uppercase;">No position data available.</p>';
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

    const xScale = d3.scaleLinear().domain([1, maxLap]).range([0, width]);
    const yScale = d3.scaleLinear().domain([1, maxPos]).range([0, height]);

    _renderBumpAxesAndGrid(svg, xScale, yScale, width, height, maxPos);

    const lineGenerator = d3
        .line()
        .x((d) => xScale(d.lap))
        .y((d) => yScale(d.position))
        .curve(d3.curveMonotoneX);

    const driverLapsProcessed = _buildProcessedDriverLaps(data.drivers, classification, maxLap);
    const driverColors = Object.fromEntries(data.drivers.map((d) => [d.code, d.color]));

    const { paths, hoverPaths } = _renderBumpLines(
        svg,
        driverLapsProcessed,
        driverColors,
        lineGenerator
    );
    const { startNodes, endNodes, endLabels } = _renderBumpNodesAndLabels(
        svg,
        driverLapsProcessed,
        driverColors,
        xScale,
        yScale
    );

    _bindBumpHoverInteraction(hoverPaths, paths, startNodes, endNodes, endLabels);
}
