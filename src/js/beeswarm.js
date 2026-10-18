import { calculateDriverClassification } from './standings.js';

const _CHART_MARGIN = { top: 20, right: 30, bottom: 60, left: 60 };
const _CHART_HEIGHT_PX = 600;
const _COMPOUND_ORDER = ['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET', 'UNKNOWN'];
const _COMPOUND_COLORS = ['#ef4444', '#eab308', '#fafafa', '#22c55e', '#3b82f6', '#a1a1aa'];
const _UNKNOWN_COMPOUND_SORT_INDEX = 99;

const _Q1_QUANTILE = 0.25;
const _MEDIAN_QUANTILE = 0.5;
const _Q3_QUANTILE = 0.75;
const _IQR_OUTLIER_MULTIPLIER = 1.5;
const _TIME_AXIS_PADDING_RATIO = 0.05;

const _SIMULATION_TICKS = 120;
const _POINT_RADIUS_PX = 3.5;
const _POINT_HOVER_RADIUS_PX = 6;
const _DEFAULT_POINT_STROKE_WIDTH_PX = 1;
const _HOVER_POINT_STROKE_WIDTH_PX = 2;
const _COLLIDE_RADIUS_PX = 4;
const _X_FORCE_STRENGTH = 0.2;
const _Y_FORCE_STRENGTH = 1;
const _MEDIAN_HALF_WIDTH_PX = 20;

const _ACTIVE_OPACITY = 1;
const _DIMMED_OPACITY = 0.08;
const _DIMMED_LABEL_OPACITY = 0.35;

const _AXIS_TICK_COUNT = 10;
const _DRIVER_LABEL_FONT_SIZE = '12px';
const _X_AXIS_TITLE_OFFSET_Y_PX = 40;
const _Y_AXIS_TITLE_OFFSET_Y_PX = -45;

const _TOOLTIP_OFFSET_X_PX = 15;
const _TOOLTIP_OFFSET_Y_PX = -30;

let _externalRefreshHandler = null;

/**
 * Sets or clears an external driver focus filter (e.g., from Session Classification)
 * while preserving active tire compound filters and local chart state.
 *
 * @param {string|null} driverCode - Three-letter driver code to highlight, or null to restore.
 * @returns {void}
 */
export function setBeeswarmExternalFocus(driverCode) {
    if (_externalRefreshHandler) {
        _externalRefreshHandler(driverCode);
    }
}

/**
 * Determines the ordered list of driver codes matching official Session Classification (P1-P22).
 *
 * @param {Object} data - Race telemetry payload with `laps` and `drivers`.
 * @returns {Array<string>} Ordered list of three-letter driver codes.
 */
function _getOrderedDrivers(data) {
    const { classification } = calculateDriverClassification(data);
    if (classification.length > 0) {
        return classification.map((entry) => entry.code);
    }
    return (data.drivers || []).map((driver) => driver.code);
}

/**
 * Builds a lookup table mapping driver codes to team hex colors.
 *
 * @param {Array<{code: string, color: string}>} drivers - Array of driver metadata objects.
 * @returns {Object<string, string>} Map of driver code to color string.
 */
function _buildDriverColorMap(drivers) {
    const colorMap = {};
    drivers.forEach((driver) => {
        colorMap[driver.code] = driver.color;
    });
    return colorMap;
}

/**
 * Extracts distinct tire compounds used in the race sorted in canonical order.
 *
 * @param {Array<{compound: string}>} laps - Array of lap records.
 * @returns {Array<string>} Sorted list of uppercase compound names.
 */
function _getCompoundsInRace(laps) {
    return Array.from(new Set(laps.map((d) => d.compound.toUpperCase()))).sort((a, b) => {
        const indexA = _COMPOUND_ORDER.indexOf(a);
        const indexB = _COMPOUND_ORDER.indexOf(b);
        const sortA = indexA === -1 ? _UNKNOWN_COMPOUND_SORT_INDEX : indexA;
        const sortB = indexB === -1 ? _UNKNOWN_COMPOUND_SORT_INDEX : indexB;
        return sortA - sortB;
    });
}

/**
 * Renders the interactive tire compound filter legend.
 *
 * @param {HTMLElement|null} legendContainer - DOM container for the legend items.
 * @param {Array<{compound: string}>} laps - Array of lap records.
 * @param {Function} colorScale - D3 ordinal color scale for tire compounds.
 * @param {Set<string>} activeCompounds - Set of currently active compound names.
 * @param {Function} onToggle - Callback invoked after a compound filter changes.
 * @returns {void}
 */
function _buildCompoundLegend(legendContainer, laps, colorScale, activeCompounds, onToggle) {
    if (!legendContainer) return;

    const updateLegendUI = () => {
        Array.from(legendContainer.children).forEach((child) => {
            const compound = child.textContent.trim();
            child.classList.toggle('inactive', !activeCompounds.has(compound));
        });
    };

    const compoundsInRace = _getCompoundsInRace(laps);
    compoundsInRace.forEach((compound) => {
        const item = document.createElement('div');
        item.className = 'legend-item';

        const swatch = document.createElement('div');
        swatch.className = 'legend-color';
        swatch.style.backgroundColor = colorScale(compound);
        item.appendChild(swatch);
        item.appendChild(document.createTextNode(compound));

        item.addEventListener('click', () => {
            if (activeCompounds.has(compound)) {
                if (activeCompounds.size > 1) {
                    activeCompounds.delete(compound);
                }
            } else {
                activeCompounds.add(compound);
            }
            updateLegendUI();
            onToggle();
        });

        legendContainer.appendChild(item);
    });

    updateLegendUI();
}

/**
 * Filters out slow outlier laps using the 1.5x IQR rule when requested and returns cloned lap records.
 *
 * @param {Array<Object>} laps - Raw lap objects from the dataset.
 * @param {boolean} showOutliers - Whether to include slow outlier laps.
 * @returns {Array<Object>} Cloned lap records ready for D3 simulation without mutating caller data.
 */
function _filterOutlierLaps(laps, showOutliers) {
    const sortedTimes = laps.map((d) => d.time).sort(d3.ascending);
    const q1 = d3.quantile(sortedTimes, _Q1_QUANTILE);
    const q3 = d3.quantile(sortedTimes, _Q3_QUANTILE);
    const iqr = q3 - q1;
    const maxAllowedTime = q3 + _IQR_OUTLIER_MULTIPLIER * iqr;

    const filteredLaps = showOutliers ? laps : laps.filter((d) => d.time <= maxAllowedTime);
    return filteredLaps.map((lap) => ({ ...lap }));
}

/**
 * Computes the median lap time for each driver across the filtered lap set.
 *
 * @param {Array<string>} orderedDrivers - Ordered driver codes.
 * @param {Array<{driver: string, time: number}>} laps - Filtered lap records.
 * @returns {Array<{driver: string, median: number}>} Per-driver median lap times.
 */
function _calculateDriverMedians(orderedDrivers, laps) {
    return orderedDrivers
        .map((driver) => {
            const driverTimes = laps
                .filter((d) => d.driver === driver)
                .map((d) => d.time)
                .sort(d3.ascending);
            if (driverTimes.length === 0) return null;
            return {
                driver,
                median: d3.quantile(driverTimes, _MEDIAN_QUANTILE)
            };
        })
        .filter((entry) => entry !== null);
}

/**
 * Creates the horizontal driver point scale and vertical lap time linear scale.
 *
 * @param {Array<string>} orderedDrivers - Ordered driver codes.
 * @param {Array<{time: number}>} laps - Filtered lap records.
 * @param {number} width - Inner plot width in pixels.
 * @param {number} height - Inner plot height in pixels.
 * @returns {{xScale: Function, yScale: Function}} D3 scales for X and Y axes.
 */
function _createBeeswarmScales(orderedDrivers, laps, width, height) {
    const xScale = d3
        .scalePoint()
        .domain(orderedDrivers)
        .range([0, width])
        .padding(1);

    const timeExtent = d3.extent(laps, (d) => d.time);
    const timePadding = (timeExtent[1] - timeExtent[0]) * _TIME_AXIS_PADDING_RATIO;

    const yScale = d3
        .scaleLinear()
        .domain([timeExtent[0] - timePadding, timeExtent[1] + timePadding])
        .range([height, 0]);

    return { xScale, yScale };
}

/**
 * Runs a deterministic D3 force simulation to position lap points horizontally per driver.
 *
 * @param {Array<Object>} simulationNodes - Cloned lap records to position.
 * @param {Function} xScale - D3 point scale mapping driver codes to X coordinates.
 * @param {Function} yScale - D3 linear scale mapping lap times to Y coordinates.
 * @returns {void}
 */
function _runBeeswarmSimulation(simulationNodes, xScale, yScale) {
    const simulation = d3
        .forceSimulation(simulationNodes)
        .force('x', d3.forceX((d) => xScale(d.driver)).strength(_X_FORCE_STRENGTH))
        .force('y', d3.forceY((d) => yScale(d.time)).strength(_Y_FORCE_STRENGTH))
        .force('collide', d3.forceCollide(_COLLIDE_RADIUS_PX))
        .stop();

    for (let i = 0; i < _SIMULATION_TICKS; ++i) {
        simulation.tick();
    }
}

/**
 * Renders gridlines, X-axis driver labels, and Y-axis lap time ticks.
 *
 * @param {Object} gridGroup - D3 selection for background gridlines.
 * @param {Object} axesGroup - D3 selection for X and Y axes.
 * @param {Function} xScale - D3 scale for the horizontal driver axis.
 * @param {Function} yScale - D3 scale for the vertical lap time axis.
 * @param {number} width - Inner plot width in pixels.
 * @param {number} height - Inner plot height in pixels.
 * @param {Object<string, string>} driverColorMap - Lookup map of driver code to color.
 * @param {Function} onDriverClick - Click handler invoked with a clicked driver code.
 * @returns {Object} D3 selection of X-axis driver text labels.
 */
function _renderAxesAndGrid(
    gridGroup,
    axesGroup,
    xScale,
    yScale,
    width,
    height,
    driverColorMap,
    onDriverClick
) {
    gridGroup.call(
        d3.axisLeft(yScale).tickSize(-width).tickFormat('').ticks(_AXIS_TICK_COUNT)
    );

    const xAxisGroup = axesGroup
        .append('g')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(xScale).tickSize(0))
        .call((g) => g.select('.domain').remove());

    const driverLabels = xAxisGroup
        .selectAll('.tick text')
        .attr('class', 'driver-label')
        .style('fill', (d) => driverColorMap[d] || 'var(--text-muted)')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-weight', '700')
        .style('font-size', _DRIVER_LABEL_FONT_SIZE)
        .on('click', (event, driverCode) => onDriverClick(driverCode));

    xAxisGroup
        .append('text')
        .attr('x', width)
        .attr('y', _X_AXIS_TITLE_OFFSET_Y_PX)
        .attr('fill', 'var(--text-muted)')
        .attr('text-anchor', 'end')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-weight', '600')
        .style('pointer-events', 'none')
        .text('DRIVER (FINISHING ORDER)');

    const yAxisGroup = axesGroup
        .append('g')
        .call(d3.axisLeft(yScale).ticks(_AXIS_TICK_COUNT).tickSize(0))
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
        .text('LAP TIME (S)');

    return driverLabels;
}

/**
 * Renders horizontal per-driver median lap time indicator bars.
 *
 * @param {Object} mediansGroup - D3 selection for the medians layer.
 * @param {Array<{driver: string, median: number}>} medians - Per-driver median descriptors.
 * @param {Function} xScale - D3 point scale for drivers.
 * @param {Function} yScale - D3 linear scale for lap times.
 * @param {Object<string, string>} driverColorMap - Lookup map of driver code to team color.
 * @returns {Object} D3 selection of `.median-line` elements.
 */
function _renderMedianLines(mediansGroup, medians, xScale, yScale, driverColorMap) {
    return mediansGroup
        .selectAll('line.median-line')
        .data(medians)
        .enter()
        .append('line')
        .attr('class', 'median-line')
        .attr('x1', (d) => xScale(d.driver) - _MEDIAN_HALF_WIDTH_PX)
        .attr('x2', (d) => xScale(d.driver) + _MEDIAN_HALF_WIDTH_PX)
        .attr('y1', (d) => yScale(d.median))
        .attr('y2', (d) => yScale(d.median))
        .attr('stroke', (d) => driverColorMap[d.driver] || 'var(--text-muted)');
}

/**
 * Renders individual lap circles and binds hover tooltip interactions.
 *
 * @param {Object} pointsGroup - D3 selection for the points layer.
 * @param {Array<Object>} simulationNodes - Positioned lap records.
 * @param {Function} colorScale - D3 color scale for tire compounds.
 * @param {Object<string, string>} driverColorMap - Lookup map of driver code to team color.
 * @param {Object} tooltip - D3 selection for the shared tooltip element.
 * @returns {Object} D3 selection of rendered circle elements.
 */
function _renderPoints(pointsGroup, simulationNodes, colorScale, driverColorMap, tooltip) {
    return pointsGroup
        .selectAll('circle.data-point')
        .data(simulationNodes)
        .enter()
        .append('circle')
        .attr('class', 'data-point')
        .attr('cx', (d) => d.x)
        .attr('cy', (d) => d.y)
        .attr('r', _POINT_RADIUS_PX)
        .attr('fill', (d) => colorScale(d.compound.toUpperCase()))
        .attr('stroke', 'var(--bg-dark)')
        .attr('stroke-width', _DEFAULT_POINT_STROKE_WIDTH_PX)
        .on('mouseover', (event, d) => {
            const compoundColor = colorScale(d.compound.toUpperCase());
            const teamColor = driverColorMap[d.driver] || 'var(--accent)';

            tooltip
                .classed('hidden', false)
                .style('border-left-color', teamColor)
                .html(`
                    <div style="font-family: Montserrat, sans-serif; font-weight: 700; margin-bottom: 4px; text-transform: uppercase;">
                        ${d.driver} <span style="color: var(--text-muted); font-weight: 600; font-size: 0.75rem;">LAP ${d.lap}</span>
                    </div>
                    <div style="font-size: 1rem; font-weight: 600; margin-bottom: 4px;">
                        ${d.time.toFixed(3)}s
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px; font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted);">
                        <div style="width: 10px; height: 10px; border-radius: 50%; background-color: ${compoundColor};"></div>
                        ${d.compound} (Tyre Life: ${d.tyre_life || 1}L)
                    </div>
                `)
                .style('left', `${event.pageX + _TOOLTIP_OFFSET_X_PX}px`)
                .style('top', `${event.pageY + _TOOLTIP_OFFSET_Y_PX}px`);

            d3.select(event.currentTarget)
                .attr('stroke', '#ffffff')
                .attr('stroke-width', _HOVER_POINT_STROKE_WIDTH_PX)
                .attr('r', _POINT_HOVER_RADIUS_PX);
        })
        .on('mouseout', (event) => {
            tooltip.classed('hidden', true);
            d3.select(event.currentTarget)
                .attr('stroke', 'var(--bg-dark)')
                .attr('stroke-width', _DEFAULT_POINT_STROKE_WIDTH_PX)
                .attr('r', _POINT_RADIUS_PX);
        });
}

/**
 * Updates visual opacities across points, labels, and medians based on active filters.
 *
 * @param {Object} points - D3 selection of lap circles.
 * @param {Object} driverLabels - D3 selection of X-axis driver labels.
 * @param {Object} medianLines - D3 selection of median indicator lines.
 * @param {Set<string>} activeCompounds - Set of currently enabled tire compounds.
 * @param {string|null} effectiveDriver - Currently focused driver code, or null if none.
 * @returns {void}
 */
function _applyFocusStyles(points, driverLabels, medianLines, activeCompounds, effectiveDriver) {
    if (!points || !driverLabels || !medianLines) return;

    points.style('opacity', (d) => {
        const isCompoundActive = activeCompounds.has(d.compound.toUpperCase());
        const isDriverFocused = effectiveDriver === null || effectiveDriver === d.driver;
        return isCompoundActive && isDriverFocused ? _ACTIVE_OPACITY : _DIMMED_OPACITY;
    });

    driverLabels.style('opacity', (d) => {
        return effectiveDriver === null || effectiveDriver === d ? _ACTIVE_OPACITY : _DIMMED_LABEL_OPACITY;
    });

    medianLines.style('opacity', (d) => {
        return effectiveDriver === null || effectiveDriver === d.driver ? _ACTIVE_OPACITY : _DIMMED_OPACITY;
    });
}

/**
 * Renders the Lap Times Beeswarm chart with tire compound filtering and outlier controls.
 *
 * @param {Object} data - Race telemetry payload containing `laps` and `drivers`.
 * @returns {void}
 */
export function renderBeeswarm(data) {
    const container = document.getElementById('beeswarm-plot');
    const legendContainer = document.getElementById('beeswarm-legend');
    const outlierToggle = document.getElementById('outlier-toggle');

    container.innerHTML = '';
    if (legendContainer) legendContainer.innerHTML = '';

    if (!data.laps || data.laps.length === 0) {
        _externalRefreshHandler = null;
        container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding-top: 2rem; font-family: Montserrat, sans-serif; text-transform: uppercase;">No lap data available for this race.</p>';
        return;
    }

    const width = container.clientWidth - _CHART_MARGIN.left - _CHART_MARGIN.right;
    const height = _CHART_HEIGHT_PX - _CHART_MARGIN.top - _CHART_MARGIN.bottom;

    const orderedDrivers = _getOrderedDrivers(data);
    const driverColorMap = _buildDriverColorMap(data.drivers);
    const tooltip = d3.select('#tooltip');

    const colorScale = d3
        .scaleOrdinal()
        .domain(_COMPOUND_ORDER)
        .range(_COMPOUND_COLORS);

    const activeCompounds = new Set(_COMPOUND_ORDER);
    let focusedDriver = null;
    let externalFocusedDriver = null;
    let showOutliers = outlierToggle ? outlierToggle.checked : false;
    let currentPoints = null;
    let currentDriverLabels = null;
    let currentMedianLines = null;

    const refreshStyles = () => {
        const effectiveDriver = externalFocusedDriver !== null ? externalFocusedDriver : focusedDriver;
        _applyFocusStyles(
            currentPoints,
            currentDriverLabels,
            currentMedianLines,
            activeCompounds,
            effectiveDriver
        );
    };

    _externalRefreshHandler = (driverCode) => {
        externalFocusedDriver = driverCode;
        refreshStyles();
    };

    _buildCompoundLegend(legendContainer, data.laps, colorScale, activeCompounds, refreshStyles);

    const svg = d3
        .select('#beeswarm-plot')
        .append('svg')
        .attr('width', width + _CHART_MARGIN.left + _CHART_MARGIN.right)
        .attr('height', height + _CHART_MARGIN.top + _CHART_MARGIN.bottom);

    const mainGroup = svg
        .append('g')
        .attr('transform', `translate(${_CHART_MARGIN.left},${_CHART_MARGIN.top})`);

    const gridGroup = mainGroup.append('g').attr('class', 'gridline');
    const axesGroup = mainGroup.append('g').attr('class', 'axes');
    const pointsGroup = mainGroup.append('g').attr('class', 'points');
    const mediansGroup = mainGroup.append('g').attr('class', 'medians');

    const drawChart = () => {
        gridGroup.selectAll('*').remove();
        mediansGroup.selectAll('*').remove();
        pointsGroup.selectAll('*').remove();
        axesGroup.selectAll('*').remove();

        const lapsToUse = _filterOutlierLaps(data.laps, showOutliers);
        const { xScale, yScale } = _createBeeswarmScales(orderedDrivers, lapsToUse, width, height);

        currentDriverLabels = _renderAxesAndGrid(
            gridGroup,
            axesGroup,
            xScale,
            yScale,
            width,
            height,
            driverColorMap,
            (clickedDriver) => {
                focusedDriver = focusedDriver === clickedDriver ? null : clickedDriver;
                refreshStyles();
            }
        );

        const medians = _calculateDriverMedians(orderedDrivers, lapsToUse);
        currentMedianLines = _renderMedianLines(
            mediansGroup,
            medians,
            xScale,
            yScale,
            driverColorMap
        );

        _runBeeswarmSimulation(lapsToUse, xScale, yScale);

        currentPoints = _renderPoints(pointsGroup, lapsToUse, colorScale, driverColorMap, tooltip);
        refreshStyles();
    };

    if (outlierToggle) {
        outlierToggle.onchange = (event) => {
            showOutliers = event.target.checked;
            drawChart();
        };
    }

    drawChart();
}
