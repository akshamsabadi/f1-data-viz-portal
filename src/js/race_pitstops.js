const _CHART_MARGIN = { top: 24, right: 185, bottom: 42, left: 102 };
const _ROW_HEIGHT_PX = 28;
const _MIN_CHART_HEIGHT_PX = 360;
const _BAR_CORNER_RADIUS_PX = 4;
const _ACTIVE_OPACITY = 1;
const _RESTING_OPACITY = 0.9;
const _DIMMED_OPACITY = 0.2;
const _TOOLTIP_OFFSET_X_PX = 15;
const _TOOLTIP_OFFSET_Y_PX = -28;

const _METRIC_STATIONARY = 'stationary_s';
const _METRIC_PIT_LOSS = 'pit_loss_s';

const _COMPOUND_COLORS = {
    SOFT: '#FF3333',
    MEDIUM: '#FFE600',
    HARD: '#F0F0F5',
    INTERMEDIATE: '#39B54A',
    WET: '#00AEEF',
    UNKNOWN: '#888888'
};

const _COMPOUND_ABBREVIATIONS = {
    SOFT: 'S',
    MEDIUM: 'M',
    HARD: 'H',
    INTERMEDIATE: 'I',
    WET: 'W',
    UNKNOWN: 'U'
};

let _externalPitStopsFocusHandler = null;

/**
 * Highlights or restores a driver's pit stop bars from an external trigger.
 *
 * @param {string|null} driverCode - Three-letter driver code to highlight, or null to restore.
 * @returns {void}
 */
export function setRacePitStopsExternalFocus(driverCode) {
    if (_externalPitStopsFocusHandler) {
        _externalPitStopsFocusHandler(driverCode);
    }
}

/**
 * Normalizes a raw tyre compound string to a supported uppercase key.
 *
 * @param {string|null|undefined} compound - Raw compound name.
 * @returns {string} Normalized uppercase compound name.
 */
function _normalizeCompound(compound) {
    const upper = String(compound || 'UNKNOWN').toUpperCase();
    return _COMPOUND_COLORS[upper] ? upper : 'UNKNOWN';
}

/**
 * Extracts and normalizes pit stop records from `data.race_telemetry.pit_stops`.
 *
 * @param {Object} data - Race telemetry payload.
 * @returns {Array<Object>} Normalized pit stop entries with unique row keys.
 */
function _resolvePitStops(data) {
    const rawStops =
        data.race_telemetry && Array.isArray(data.race_telemetry.pit_stops)
            ? data.race_telemetry.pit_stops
            : [];

    const driverMetaByCode = new Map((data.drivers || []).map((d) => [d.code, d]));

    return rawStops
        .map((stop, idx) => {
            const meta = driverMetaByCode.get(stop.driver);
            const fromCompound = _normalizeCompound(stop.from_compound);
            const toCompound = _normalizeCompound(stop.to_compound);
            const stopNum = Number(stop.stop_number) || 1;
            const lapNum = Number(stop.lap) || 1;
            const stationary = Number.isFinite(Number(stop.stationary_s))
                ? Number(stop.stationary_s)
                : null;
            const pitLoss = Number.isFinite(Number(stop.pit_loss_s))
                ? Number(stop.pit_loss_s)
                : null;

            return {
                id: `${stop.driver}-S${stopNum}-L${lapNum}-${idx}`,
                driver: stop.driver,
                name: stop.name || meta?.name || stop.driver,
                team: stop.team || meta?.team || '',
                color: meta?.color || stop.color || '#888888',
                lap: lapNum,
                stop_number: stopNum,
                from_compound: fromCompound,
                to_compound: toCompound,
                stationary_s: stationary,
                pit_loss_s: pitLoss
            };
        })
        .filter(
            (s) =>
                (Number.isFinite(s.stationary_s) && s.stationary_s > 0) ||
                (Number.isFinite(s.pit_loss_s) && s.pit_loss_s > 0)
        );
}

/**
 * Builds the metric toggle controls (`Stationary Stop Time` vs `Total Pit-Lane Loss`)
 * inside `#race-pitstops-controls`.
 *
 * @param {HTMLElement|null} controlsContainer - DOM container for the metric toggle buttons.
 * @param {string} activeMetric - Currently selected metric key (`'stationary_s'` or `'pit_loss_s'`).
 * @param {Function} onMetricChange - Callback invoked when the user switches metrics.
 * @returns {void}
 */
function _buildPitStopControls(controlsContainer, activeMetric, onMetricChange) {
    if (!controlsContainer) return;
    controlsContainer.replaceChildren();

    const options = [
        { key: _METRIC_STATIONARY, label: 'Stationary Stop (s)' },
        { key: _METRIC_PIT_LOSS, label: 'Total Pit Loss (s)' }
    ];

    const buttons = [];

    const updateButtonStyles = (currentMetric) => {
        buttons.forEach(({ btn, key }) => {
            const isSelected = key === currentMetric;
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
        btn.className = 'legend-item pitstop-metric-btn';
        btn.style.fontFamily = 'Montserrat, sans-serif';
        btn.style.fontWeight = '700';
        btn.style.cursor = 'pointer';
        btn.textContent = label;

        btn.addEventListener('click', () => {
            updateButtonStyles(key);
            onMetricChange(key);
        });

        buttons.push({ btn, key });
        controlsContainer.appendChild(btn);
    });

    updateButtonStyles(activeMetric);
}

/**
 * Populates the shared `#tooltip` element with pit stop telemetry details.
 *
 * @param {HTMLElement|null} tooltipNode - DOM node of `#tooltip`.
 * @param {Object} stop - Hovered pit stop entry.
 * @param {number} rank - 1-based rank of this stop for the active metric.
 * @param {number} fastestVal - Fastest value for the active metric.
 * @param {string} activeMetric - Active metric key.
 * @returns {void}
 */
function _populatePitStopTooltip(tooltipNode, stop, rank, fastestVal, activeMetric) {
    if (!tooltipNode) return;

    const headerDiv = document.createElement('div');
    headerDiv.style.fontFamily = 'Montserrat, sans-serif';
    headerDiv.style.fontWeight = '700';
    headerDiv.style.marginBottom = '4px';
    headerDiv.style.textTransform = 'uppercase';
    headerDiv.appendChild(document.createTextNode(`#${rank} ${stop.driver} `));

    const teamSpan = document.createElement('span');
    teamSpan.style.color = 'var(--text-muted)';
    teamSpan.style.fontWeight = '600';
    teamSpan.style.fontSize = '0.75rem';
    teamSpan.textContent = `· ${stop.team}`;
    headerDiv.appendChild(teamSpan);

    const metaDiv = document.createElement('div');
    metaDiv.style.fontSize = '0.8rem';
    metaDiv.style.marginBottom = '4px';
    metaDiv.style.color = 'var(--text-primary)';
    metaDiv.textContent = `Stop #${stop.stop_number} · Lap ${stop.lap} (${stop.from_compound} → ${stop.to_compound})`;

    const stationaryText = Number.isFinite(stop.stationary_s)
        ? `${stop.stationary_s.toFixed(2)}s`
        : 'N/A';
    const pitLossText = Number.isFinite(stop.pit_loss_s)
        ? `${stop.pit_loss_s.toFixed(2)}s`
        : 'N/A';

    const stationaryDiv = document.createElement('div');
    stationaryDiv.style.fontSize = '0.82rem';
    stationaryDiv.style.fontWeight =
        activeMetric === _METRIC_STATIONARY ? '700' : '600';
    stationaryDiv.style.color =
        activeMetric === _METRIC_STATIONARY ? '#ffffff' : 'var(--text-muted)';
    stationaryDiv.textContent = `Stationary Time: ${stationaryText}`;

    const lossDiv = document.createElement('div');
    lossDiv.style.fontSize = '0.82rem';
    lossDiv.style.fontWeight = activeMetric === _METRIC_PIT_LOSS ? '700' : '600';
    lossDiv.style.color =
        activeMetric === _METRIC_PIT_LOSS ? '#ffffff' : 'var(--text-muted)';
    lossDiv.textContent = `Total Pit-Lane Loss: ${pitLossText}`;

    const currentVal = stop[activeMetric];
    const delta = Number.isFinite(currentVal) ? currentVal - fastestVal : 0;
    const deltaDiv = document.createElement('div');
    deltaDiv.style.fontSize = '0.76rem';
    deltaDiv.style.marginTop = '3px';
    deltaDiv.style.fontWeight = '600';
    deltaDiv.style.color = delta <= 0.001 ? '#34d399' : '#facc15';
    deltaDiv.textContent =
        delta <= 0.001
            ? 'Fastest Pit Stop of Race'
            : `+${delta.toFixed(2)}s vs Fastest Stop`;

    tooltipNode.replaceChildren(headerDiv, metaDiv, stationaryDiv, lossDiv, deltaDiv);
}

/**
 * Renders the Pit Stop Duration & Time Loss Ranking horizontal bar chart inside `#race-pitstops-chart`.
 *
 * @param {Object} data - Race telemetry payload containing `drivers` and `race_telemetry.pit_stops`.
 * @returns {void}
 */
export function renderRacePitStops(data) {
    const container = document.getElementById('race-pitstops-chart');
    const controlsContainer = document.getElementById('race-pitstops-controls');
    if (!container) return;

    container.replaceChildren();
    if (controlsContainer) controlsContainer.replaceChildren();

    const allStops = _resolvePitStops(data);
    if (allStops.length === 0) {
        _externalPitStopsFocusHandler = null;
        const emptyMsg = document.createElement('p');
        emptyMsg.style.color = 'var(--text-muted)';
        emptyMsg.style.textAlign = 'center';
        emptyMsg.style.paddingTop = '2rem';
        emptyMsg.style.fontFamily = 'Montserrat, sans-serif';
        emptyMsg.style.textTransform = 'uppercase';
        emptyMsg.textContent = 'No pit stop telemetry recorded for this race.';
        container.replaceChildren(emptyMsg);
        return;
    }

    const hasStationary = allStops.some(
        (s) => Number.isFinite(s.stationary_s) && s.stationary_s > 0
    );
    let activeMetric = hasStationary ? _METRIC_STATIONARY : _METRIC_PIT_LOSS;
    let externalFocusedDriver = null;
    let localFocusedDriver = null;
    let hoveredDriver = null;

    const tooltip = d3.select('#tooltip');
    let rowGroups = null;
    let yAxisLabels = null;

    const updateFocusStyles = () => {
        if (!rowGroups) return;
        const effectiveDriver =
            hoveredDriver !== null
                ? hoveredDriver
                : externalFocusedDriver !== null
                  ? externalFocusedDriver
                  : localFocusedDriver;

        rowGroups.style('opacity', (d) =>
            effectiveDriver === null || d.driver === effectiveDriver
                ? _ACTIVE_OPACITY
                : _DIMMED_OPACITY
        );

        if (yAxisLabels) {
            yAxisLabels.style('opacity', (d) =>
                effectiveDriver === null || d.driver === effectiveDriver
                    ? _ACTIVE_OPACITY
                    : _DIMMED_OPACITY
            );
        }
    };

    const drawChart = () => {
        container.replaceChildren();

        const sortedAll = allStops
            .filter((s) => Number.isFinite(s[activeMetric]) && s[activeMetric] > 0)
            .slice()
            .sort((a, b) => a[activeMetric] - b[activeMetric]);

        const seenDrivers = new Set();
        const validStops = sortedAll.filter((s) => {
            if (seenDrivers.has(s.driver)) return false;
            seenDrivers.add(s.driver);
            return true;
        });

        if (validStops.length === 0) {
            const fallbackMsg = document.createElement('p');
            fallbackMsg.style.color = 'var(--text-muted)';
            fallbackMsg.style.textAlign = 'center';
            fallbackMsg.style.paddingTop = '2rem';
            fallbackMsg.style.fontFamily = 'Montserrat, sans-serif';
            fallbackMsg.style.textTransform = 'uppercase';
            fallbackMsg.textContent = 'Selected pit stop metric is unavailable for this session.';
            container.replaceChildren(fallbackMsg);
            return;
        }

        const fastestValue = validStops[0][activeMetric];
        const slowestValue = validStops[validStops.length - 1][activeMetric];
        const medianValue = d3.median(validStops, (d) => d[activeMetric]) || fastestValue;

        const containerWidth = Math.max(360, container.clientWidth || 860);
        const width = containerWidth - _CHART_MARGIN.left - _CHART_MARGIN.right;
        const height = Math.max(
            _MIN_CHART_HEIGHT_PX - _CHART_MARGIN.top - _CHART_MARGIN.bottom,
            validStops.length * _ROW_HEIGHT_PX
        );

        const xScale = d3
            .scaleLinear()
            .domain([0, slowestValue * 1.08])
            .range([0, width]);

        const yScale = d3
            .scaleBand()
            .domain(validStops.map((d) => d.id))
            .range([0, height])
            .paddingInner(0.24)
            .paddingOuter(0.1);

        const stopById = new Map(validStops.map((d) => [d.id, d]));

        const svg = d3
            .select(container)
            .append('svg')
            .attr('width', width + _CHART_MARGIN.left + _CHART_MARGIN.right)
            .attr('height', height + _CHART_MARGIN.top + _CHART_MARGIN.bottom)
            .append('g')
            .attr('transform', `translate(${_CHART_MARGIN.left},${_CHART_MARGIN.top})`);

        // Vertical gridlines
        svg.append('g')
            .attr('class', 'gridline')
            .attr('transform', `translate(0,${height})`)
            .call(d3.axisBottom(xScale).ticks(8).tickSize(-height).tickFormat(''));

        // X-axis
        const xAxisGroup = svg
            .append('g')
            .attr('transform', `translate(0,${height})`)
            .call(
                d3
                    .axisBottom(xScale)
                    .ticks(8)
                    .tickFormat((d) => `${d.toFixed(1)}s`)
            );

        xAxisGroup
            .append('text')
            .attr('x', width)
            .attr('y', 36)
            .attr('fill', 'var(--text-muted)')
            .attr('text-anchor', 'end')
            .style('font-family', 'Montserrat, sans-serif')
            .style('font-weight', '600')
            .style('font-size', '11px')
            .text(
                activeMetric === _METRIC_STATIONARY
                    ? 'STATIONARY PIT STOP TIME (SECONDS)'
                    : 'TOTAL PIT-LANE LOSS (SECONDS)'
            );

        // Y-axis labels (Driver + Stop Lap)
        const yAxisGroup = svg
            .append('g')
            .call(
                d3
                    .axisLeft(yScale)
                    .tickSize(0)
                    .tickPadding(8)
                    .tickFormat((id) => {
                        const s = stopById.get(id);
                        return s ? `${s.driver} · L${s.lap}` : id;
                    })
            )
            .call((g) => g.select('.domain').remove());

        yAxisLabels = yAxisGroup
            .selectAll('.tick text')
            .datum((id) => stopById.get(id))
            .attr('class', 'driver-label')
            .style('fill', (d) => d?.color || 'var(--text-primary)')
            .style('font-family', 'Montserrat, sans-serif')
            .style('font-weight', '700')
            .style('font-size', '11px')
            .style('cursor', 'pointer')
            .on('click', (event, d) => {
                if (!d) return;
                localFocusedDriver = localFocusedDriver === d.driver ? null : d.driver;
                updateFocusStyles();
            });

        // Median reference line
        const medianX = xScale(medianValue);
        svg.append('line')
            .attr('x1', medianX)
            .attr('x2', medianX)
            .attr('y1', -6)
            .attr('y2', height)
            .attr('stroke', 'rgba(255, 255, 255, 0.35)')
            .attr('stroke-width', 1.5)
            .attr('stroke-dasharray', '4,4');

        svg.append('text')
            .attr('x', medianX)
            .attr('y', -10)
            .attr('text-anchor', 'middle')
            .attr('fill', 'var(--text-muted)')
            .style('font-family', 'Montserrat, sans-serif')
            .style('font-size', '9.5px')
            .style('font-weight', '700')
            .text(`MEDIAN ${medianValue.toFixed(2)}s`);

        // Horizontal bars and compound transition pills
        const barsLayer = svg.append('g').attr('class', 'pitstops-bars-layer');

        rowGroups = barsLayer
            .selectAll('g.pitstop-row')
            .data(validStops)
            .enter()
            .append('g')
            .attr('class', 'pitstop-row')
            .style('cursor', 'pointer');

        // Bar track background
        rowGroups
            .append('rect')
            .attr('x', 0)
            .attr('y', (d) => yScale(d.id))
            .attr('width', width)
            .attr('height', yScale.bandwidth())
            .attr('rx', _BAR_CORNER_RADIUS_PX)
            .attr('fill', 'rgba(255, 255, 255, 0.025)');

        // Main horizontal duration bar
        rowGroups
            .append('rect')
            .attr('class', 'pitstop-bar')
            .attr('x', 0)
            .attr('y', (d) => yScale(d.id))
            .attr('width', (d) => Math.max(4, xScale(d[activeMetric])))
            .attr('height', yScale.bandwidth())
            .attr('rx', _BAR_CORNER_RADIUS_PX)
            .attr('fill', (d) => d.color)
            .attr('opacity', _RESTING_OPACITY)
            .attr('stroke', '#111118')
            .attr('stroke-width', 1);

        // Compound transition pill + time label positioned to the right of each bar
        const pillGroup = rowGroups
            .append('g')
            .attr('class', 'pitstop-transition-pill')
            .attr(
                'transform',
                (d) =>
                    `translate(${xScale(d[activeMetric]) + 8},${
                        yScale(d.id) + yScale.bandwidth() / 2
                    })`
            );

        // Pill background
        pillGroup
            .append('rect')
            .attr('x', 0)
            .attr('y', -9)
            .attr('width', 58)
            .attr('height', 18)
            .attr('rx', 4)
            .attr('fill', 'rgba(17, 17, 24, 0.96)')
            .attr('stroke', 'rgba(255, 255, 255, 0.16)')
            .attr('stroke-width', 1);

        // From-compound dot
        pillGroup
            .append('circle')
            .attr('cx', 10)
            .attr('cy', 0)
            .attr('r', 4)
            .attr(
                'fill',
                (d) => _COMPOUND_COLORS[d.from_compound] || _COMPOUND_COLORS.UNKNOWN
            );

        // Transition text (e.g., "M→H")
        pillGroup
            .append('text')
            .attr('x', 29)
            .attr('y', 0)
            .attr('dy', '0.35em')
            .attr('text-anchor', 'middle')
            .attr('fill', '#ffffff')
            .style('font-family', 'Montserrat, sans-serif')
            .style('font-size', '9px')
            .style('font-weight', '700')
            .text((d) => {
                const fromAbbr = _COMPOUND_ABBREVIATIONS[d.from_compound] || 'U';
                const toAbbr = _COMPOUND_ABBREVIATIONS[d.to_compound] || 'U';
                return `${fromAbbr}→${toAbbr}`;
            });

        // To-compound dot
        pillGroup
            .append('circle')
            .attr('cx', 48)
            .attr('cy', 0)
            .attr('r', 4)
            .attr(
                'fill',
                (d) => _COMPOUND_COLORS[d.to_compound] || _COMPOUND_COLORS.UNKNOWN
            );

        // Dark backing behind numeric readout so median dashed line never bleeds through text
        pillGroup
            .append('rect')
            .attr('x', 62)
            .attr('y', -9)
            .attr('width', 112)
            .attr('height', 18)
            .attr('rx', 3)
            .attr('fill', 'rgba(21, 21, 30, 0.92)');

        // Numeric duration & delta readout
        pillGroup
            .append('text')
            .attr('x', 66)
            .attr('y', 0)
            .attr('dy', '0.35em')
            .attr('fill', (d, idx) => (idx === 0 ? '#34d399' : 'var(--text-primary)'))
            .style('font-family', 'Titillium Web, sans-serif')
            .style('font-size', '11.5px')
            .style('font-weight', '700')
            .text((d, idx) => {
                const val = d[activeMetric];
                const delta = val - fastestValue;
                return idx === 0
                    ? `${val.toFixed(2)}s (BEST)`
                    : `${val.toFixed(2)}s (+${delta.toFixed(2)}s)`;
            });

        rowGroups
            .on('mouseover', (event, d) => {
                hoveredDriver = d.driver;
                updateFocusStyles();

                d3.select(event.currentTarget)
                    .select('rect.pitstop-bar')
                    .attr('stroke', '#ffffff')
                    .attr('stroke-width', 1.8)
                    .attr('opacity', 1);

                const rank = validStops.indexOf(d) + 1;
                _populatePitStopTooltip(
                    tooltip.node(),
                    d,
                    rank,
                    fastestValue,
                    activeMetric
                );

                tooltip
                    .classed('hidden', false)
                    .style('border-left-color', d.color || 'var(--accent)')
                    .style('left', `${event.pageX + _TOOLTIP_OFFSET_X_PX}px`)
                    .style('top', `${event.pageY + _TOOLTIP_OFFSET_Y_PX}px`);
            })
            .on('mousemove', (event) => {
                tooltip
                    .style('left', `${event.pageX + _TOOLTIP_OFFSET_X_PX}px`)
                    .style('top', `${event.pageY + _TOOLTIP_OFFSET_Y_PX}px`);
            })
            .on('mouseout', (event) => {
                hoveredDriver = null;
                updateFocusStyles();

                d3.select(event.currentTarget)
                    .select('rect.pitstop-bar')
                    .attr('stroke', '#111118')
                    .attr('stroke-width', 1)
                    .attr('opacity', _RESTING_OPACITY);

                tooltip.classed('hidden', true);
            });

        updateFocusStyles();
    };

    _externalPitStopsFocusHandler = (driverCode) => {
        externalFocusedDriver = driverCode;
        updateFocusStyles();
    };

    _buildPitStopControls(controlsContainer, activeMetric, (nextMetric) => {
        activeMetric = nextMetric;
        drawChart();
    });

    drawChart();
}
