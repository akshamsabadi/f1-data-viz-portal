import { calculateDriverClassification } from './standings.js';

const _CHART_MARGIN = { top: 24, right: 36, bottom: 44, left: 84 };
const _ROW_HEIGHT_PX = 28;
const _MIN_CHART_HEIGHT_PX = 420;
const _NODE_RADIUS_PX = 7.5;
const _NODE_HOVER_RADIUS_PX = 9.5;
const _LINK_STROKE_WIDTH = 2.4;
const _LINK_HOVER_STROKE_WIDTH = 3.6;
const _ACTIVE_OPACITY = 1;
const _DIMMED_OPACITY = 0.18;
const _IQR_OUTLIER_MULTIPLIER = 2.5;
const _DOMAIN_PADDING_RATIO = 0.08;
const _MIN_DOMAIN_PADDING_S = 0.25;
const _TOOLTIP_OFFSET_X_PX = 15;
const _TOOLTIP_OFFSET_Y_PX = -28;
const _SECONDS_PER_MINUTE = 60;
const _FUEL_BURN_CORRECTION_PER_LAP_S = 0.055;

const _METRIC_FUEL_CORRECTED = 'fuel_corrected_pace';
const _METRIC_RAW_PACE = 'avg_pace';

const _COMPOUND_COLORS = {
    SOFT: '#FF3333',
    MEDIUM: '#FFE600',
    HARD: '#F0F0F5',
    INTERMEDIATE: '#39B54A',
    WET: '#00AEEF',
    UNKNOWN: '#888888'
};

const _DARK_TEXT_COMPOUNDS = new Set(['MEDIUM', 'HARD', 'INTERMEDIATE']);

let _externalStintPaceFocusHandler = null;

/**
 * Highlights or restores a driver's stint pace progression from an external trigger.
 *
 * @param {string|null} driverCode - Three-letter driver code to highlight, or null to restore.
 * @returns {void}
 */
export function setRaceStintPaceExternalFocus(driverCode) {
    if (_externalStintPaceFocusHandler) {
        _externalStintPaceFocusHandler(driverCode);
    }
}

/**
 * Formats a pace value in seconds as `m:ss.sss (ss.sss s)` or `ss.sss s`.
 *
 * @param {number|null|undefined} paceSeconds - Pace in seconds.
 * @returns {string} Formatted pace string.
 */
function _formatPace(paceSeconds) {
    if (!Number.isFinite(paceSeconds) || paceSeconds <= 0) {
        return 'N/A';
    }
    const minutes = Math.floor(paceSeconds / _SECONDS_PER_MINUTE);
    const rem = (paceSeconds % _SECONDS_PER_MINUTE).toFixed(3);
    if (minutes > 0) {
        return `${minutes}:${rem.padStart(6, '0')} (${paceSeconds.toFixed(3)}s)`;
    }
    return `${paceSeconds.toFixed(3)}s`;
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
 * Derives stint pace records from `data.laps` when `data.race_telemetry.stints` is absent.
 *
 * @param {Object} data - Race telemetry payload.
 * @param {Map<string, Object>} driverMetaByCode - Lookup map of driver code to metadata.
 * @param {number} maxLap - Maximum race lap count.
 * @returns {Array<Object>} Derived stint objects.
 */
function _deriveStintsFromLaps(data, driverMetaByCode, maxLap) {
    const lapsByDriver = d3.group(data.laps || [], (d) => d.driver);
    const derived = [];

    lapsByDriver.forEach((driverLaps, driverCode) => {
        const sorted = driverLaps.slice().sort((a, b) => a.lap - b.lap);
        if (sorted.length === 0) return;

        const meta = driverMetaByCode.get(driverCode) || {
            code: driverCode,
            name: driverCode,
            team: '',
            color: '#888888'
        };

        let stintNumber = 1;
        let currentCompound = _normalizeCompound(sorted[0].compound);
        let startLap = sorted[0].lap;
        let endLap = sorted[0].lap;
        let bucket = [sorted[0]];

        const flush = () => {
            const validTimes = bucket
                .filter((l) => !l.interpolated && Number.isFinite(l.time) && l.time > 0)
                .map((l) => l.time);
            const avgPace = validTimes.length > 0 ? d3.mean(validTimes) : null;
            const midLap = (startLap + endLap) / 2;
            const remainingLaps = Math.max(0, maxLap - midLap);
            const fuelCorrectedPace =
                avgPace !== null
                    ? avgPace - remainingLaps * _FUEL_BURN_CORRECTION_PER_LAP_S
                    : null;

            derived.push({
                driver: driverCode,
                name: meta.name || driverCode,
                team: meta.team || '',
                color: meta.color || '#888888',
                stint: stintNumber,
                compound: currentCompound,
                start_lap: startLap,
                end_lap: endLap,
                laps_count: endLap - startLap + 1,
                avg_pace: avgPace,
                fuel_corrected_pace: fuelCorrectedPace
            });
        };

        for (let i = 1; i < sorted.length; i++) {
            const lapObj = sorted[i];
            const prevObj = sorted[i - 1];
            const nextCompound = _normalizeCompound(lapObj.compound);
            const lifeReset =
                Number.isFinite(lapObj.tyre_life) &&
                Number.isFinite(prevObj.tyre_life) &&
                lapObj.tyre_life < prevObj.tyre_life;

            if (nextCompound !== currentCompound || lifeReset) {
                flush();
                stintNumber += 1;
                currentCompound = nextCompound;
                startLap = lapObj.lap;
                endLap = lapObj.lap;
                bucket = [lapObj];
            } else {
                endLap = lapObj.lap;
                bucket.push(lapObj);
            }
        }
        flush();
    });

    return derived;
}

/**
 * Resolves and normalizes stint records for pace progression visualization.
 *
 * @param {Object} data - Race telemetry payload.
 * @param {Map<string, Object>} driverMetaByCode - Map of driver code to metadata.
 * @param {number} maxLap - Maximum race lap count.
 * @returns {Array<Object>} Normalized stint entries.
 */
function _resolveStints(data, driverMetaByCode, maxLap) {
    const rawStints =
        data.race_telemetry &&
        Array.isArray(data.race_telemetry.stints) &&
        data.race_telemetry.stints.length > 0
            ? data.race_telemetry.stints
            : _deriveStintsFromLaps(data, driverMetaByCode, maxLap);

    return rawStints.map((stint) => {
        const meta = driverMetaByCode.get(stint.driver);
        const avgPace = Number.isFinite(Number(stint.avg_pace))
            ? Number(stint.avg_pace)
            : null;
        const fuelPace = Number.isFinite(Number(stint.fuel_corrected_pace))
            ? Number(stint.fuel_corrected_pace)
            : avgPace;

        return {
            ...stint,
            name: stint.name || meta?.name || stint.driver,
            team: stint.team || meta?.team || '',
            color: meta?.color || stint.color || '#888888',
            stint: Number(stint.stint) || 1,
            compound: _normalizeCompound(stint.compound),
            start_lap: Number(stint.start_lap) || 1,
            end_lap: Number(stint.end_lap) || 1,
            laps_count: Number(stint.laps_count) || 1,
            avg_pace: avgPace,
            fuel_corrected_pace: fuelPace
        };
    });
}

/**
 * Builds the pace metric toggle (`Fuel-Corrected Pace` vs `Raw Stint Pace`)
 * inside `#race-stint-pace-controls`.
 *
 * @param {HTMLElement|null} controlsContainer - DOM container for controls.
 * @param {string} activeMetric - Currently active metric key.
 * @param {Function} onMetricChange - Callback invoked when the user switches pace metrics.
 * @returns {void}
 */
function _buildStintPaceControls(controlsContainer, activeMetric, onMetricChange) {
    if (!controlsContainer) return;
    controlsContainer.replaceChildren();

    const options = [
        { key: _METRIC_FUEL_CORRECTED, label: 'Fuel-Corrected Pace' },
        { key: _METRIC_RAW_PACE, label: 'Raw Stint Pace' }
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
        btn.className = 'legend-item stint-pace-metric-btn';
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
 * Populates the shared `#tooltip` element with stint pace progression details.
 *
 * @param {HTMLElement|null} tooltipNode - DOM node of `#tooltip`.
 * @param {Object} stint - Hovered stint entry.
 * @param {Object|null} prevStint - Previous stint for the same driver, if any.
 * @param {string} activeMetric - Currently selected metric key.
 * @returns {void}
 */
function _populateStintPaceTooltip(tooltipNode, stint, prevStint, activeMetric) {
    if (!tooltipNode) return;

    const compoundColor = _COMPOUND_COLORS[stint.compound] || _COMPOUND_COLORS.UNKNOWN;

    const headerDiv = document.createElement('div');
    headerDiv.style.fontFamily = 'Montserrat, sans-serif';
    headerDiv.style.fontWeight = '700';
    headerDiv.style.marginBottom = '4px';
    headerDiv.style.textTransform = 'uppercase';
    headerDiv.appendChild(document.createTextNode(`${stint.driver} `));

    const teamSpan = document.createElement('span');
    teamSpan.style.color = 'var(--text-muted)';
    teamSpan.style.fontWeight = '600';
    teamSpan.style.fontSize = '0.75rem';
    teamSpan.textContent = `· ${stint.team}`;
    headerDiv.appendChild(teamSpan);

    const badgeRow = document.createElement('div');
    badgeRow.style.display = 'flex';
    badgeRow.style.alignItems = 'center';
    badgeRow.style.gap = '6px';
    badgeRow.style.fontSize = '0.8rem';
    badgeRow.style.fontWeight = '700';
    badgeRow.style.marginBottom = '4px';
    badgeRow.style.textTransform = 'uppercase';

    const dot = document.createElement('span');
    dot.style.display = 'inline-block';
    dot.style.width = '10px';
    dot.style.height = '10px';
    dot.style.borderRadius = '50%';
    dot.style.backgroundColor = compoundColor;
    dot.style.border = '1px solid rgba(255, 255, 255, 0.35)';
    badgeRow.appendChild(dot);
    badgeRow.appendChild(
        document.createTextNode(
            `Stint ${stint.stint} · ${stint.compound} (L${stint.start_lap}–L${stint.end_lap}, ${stint.laps_count}L)`
        )
    );

    const fuelDiv = document.createElement('div');
    fuelDiv.style.fontSize = '0.82rem';
    fuelDiv.style.fontWeight =
        activeMetric === _METRIC_FUEL_CORRECTED ? '700' : '600';
    fuelDiv.style.color =
        activeMetric === _METRIC_FUEL_CORRECTED ? '#34d399' : 'var(--text-muted)';
    fuelDiv.textContent = `Fuel-Corrected: ${_formatPace(stint.fuel_corrected_pace)}`;

    const rawDiv = document.createElement('div');
    rawDiv.style.fontSize = '0.82rem';
    rawDiv.style.fontWeight = activeMetric === _METRIC_RAW_PACE ? '700' : '600';
    rawDiv.style.color =
        activeMetric === _METRIC_RAW_PACE ? '#ffffff' : 'var(--text-muted)';
    rawDiv.textContent = `Raw Stint Pace: ${_formatPace(stint.avg_pace)}`;

    const children = [headerDiv, badgeRow, fuelDiv, rawDiv];

    if (
        prevStint &&
        Number.isFinite(stint[activeMetric]) &&
        Number.isFinite(prevStint[activeMetric])
    ) {
        const delta = stint[activeMetric] - prevStint[activeMetric];
        const deltaDiv = document.createElement('div');
        deltaDiv.style.fontSize = '0.76rem';
        deltaDiv.style.fontWeight = '600';
        deltaDiv.style.marginTop = '3px';
        deltaDiv.style.color = delta <= 0 ? '#34d399' : '#f87171';
        const sign = delta > 0 ? '+' : '';
        deltaDiv.textContent = `Δ vs Stint ${prevStint.stint}: ${sign}${delta.toFixed(3)}s (${
            delta <= 0 ? 'faster' : 'slower'
        })`;
        children.push(deltaDiv);
    }

    tooltipNode.replaceChildren(...children);
}

/**
 * Renders the Fuel-Corrected Stint Pace Progression chart inside `#race-stint-pace-chart`.
 *
 * @param {Object} data - Race telemetry payload containing `drivers`, `laps`, and `race_telemetry`.
 * @returns {void}
 */
export function renderRaceStintPace(data) {
    const container = document.getElementById('race-stint-pace-chart');
    const controlsContainer = document.getElementById('race-stint-pace-controls');
    if (!container) return;

    container.replaceChildren();
    if (controlsContainer) controlsContainer.replaceChildren();

    const { classification, maxLap } = calculateDriverClassification(data);
    const driverMetaByCode = new Map((data.drivers || []).map((d) => [d.code, d]));
    const allStints = _resolveStints(data, driverMetaByCode, maxLap || 60);

    if (allStints.length === 0) {
        _externalStintPaceFocusHandler = null;
        const emptyMsg = document.createElement('p');
        emptyMsg.style.color = 'var(--text-muted)';
        emptyMsg.style.textAlign = 'center';
        emptyMsg.style.paddingTop = '2rem';
        emptyMsg.style.fontFamily = 'Montserrat, sans-serif';
        emptyMsg.style.textTransform = 'uppercase';
        emptyMsg.textContent = 'No stint pace telemetry available for this race.';
        container.replaceChildren(emptyMsg);
        return;
    }

    const orderedDriverCodes =
        classification.length > 0
            ? classification.map((c) => c.code)
            : Array.from(new Set(allStints.map((s) => s.driver)));

    const rankByDriver = new Map(
        orderedDriverCodes.map((code, idx) => [code, idx + 1])
    );

    let activeMetric = _METRIC_FUEL_CORRECTED;
    let externalFocusedDriver = null;
    let localFocusedDriver = null;
    let hoveredDriver = null;

    const tooltip = d3.select('#tooltip');
    let driverRowGroups = null;
    let yAxisLabels = null;

    const updateFocusStyles = () => {
        if (!driverRowGroups) return;
        const effectiveDriver =
            hoveredDriver !== null
                ? hoveredDriver
                : externalFocusedDriver !== null
                  ? externalFocusedDriver
                  : localFocusedDriver;

        driverRowGroups.style('opacity', (d) =>
            effectiveDriver === null || d.driver === effectiveDriver
                ? _ACTIVE_OPACITY
                : _DIMMED_OPACITY
        );

        driverRowGroups
            .select('path.stint-connector-line')
            .attr('stroke-width', (d) =>
                effectiveDriver !== null && d.driver === effectiveDriver
                    ? _LINK_HOVER_STROKE_WIDTH
                    : _LINK_STROKE_WIDTH
            );

        if (yAxisLabels) {
            yAxisLabels.style('opacity', (code) =>
                effectiveDriver === null || code === effectiveDriver
                    ? _ACTIVE_OPACITY
                    : _DIMMED_OPACITY
            );
        }
    };

    const drawChart = () => {
        container.replaceChildren();

        // Filter stints with valid pace for the active metric and filter extreme SC outliers
        const metricStints = allStints.filter(
            (s) =>
                Number.isFinite(s[activeMetric]) &&
                s[activeMetric] > 0 &&
                s.laps_count >= 2
        );

        const sourceStints =
            metricStints.length > 0
                ? metricStints
                : allStints.filter(
                      (s) => Number.isFinite(s[activeMetric]) && s[activeMetric] > 0
                  );

        if (sourceStints.length === 0) {
            const emptyMsg = document.createElement('p');
            emptyMsg.style.color = 'var(--text-muted)';
            emptyMsg.style.textAlign = 'center';
            emptyMsg.style.paddingTop = '2rem';
            emptyMsg.style.fontFamily = 'Montserrat, sans-serif';
            emptyMsg.style.textTransform = 'uppercase';
            emptyMsg.textContent = 'No valid stint pace values available.';
            container.replaceChildren(emptyMsg);
            return;
        }

        const sortedValues = sourceStints
            .map((s) => s[activeMetric])
            .sort(d3.ascending);
        const q1 = d3.quantile(sortedValues, 0.25) ?? sortedValues[0];
        const q3 =
            d3.quantile(sortedValues, 0.75) ?? sortedValues[sortedValues.length - 1];
        const iqr = Math.max(0.5, q3 - q1);
        const maxReasonablePace = q3 + _IQR_OUTLIER_MULTIPLIER * iqr;

        const filteredStints = sourceStints.filter(
            (s) => s[activeMetric] <= maxReasonablePace
        );
        const stintsToPlot =
            filteredStints.length > 0 ? filteredStints : sourceStints;

        const stintsByDriver = d3.group(stintsToPlot, (s) => s.driver);
        const activeDrivers = orderedDriverCodes.filter((code) =>
            stintsByDriver.has(code)
        );

        const driverSeries = activeDrivers.map((code) => {
            const stints = (stintsByDriver.get(code) || [])
                .slice()
                .sort((a, b) => a.stint - b.stint);
            const meta = driverMetaByCode.get(code);
            return {
                driver: code,
                color: meta?.color || stints[0]?.color || '#888888',
                stints
            };
        });

        const paceExtent = d3.extent(stintsToPlot, (d) => d[activeMetric]);
        const paceSpan = Math.max(0.8, (paceExtent[1] || 90) - (paceExtent[0] || 85));
        const domainPad = Math.max(
            _MIN_DOMAIN_PADDING_S,
            paceSpan * _DOMAIN_PADDING_RATIO
        );

        const containerWidth = Math.max(360, container.clientWidth || 860);
        const width = containerWidth - _CHART_MARGIN.left - _CHART_MARGIN.right;
        const height = Math.max(
            _MIN_CHART_HEIGHT_PX - _CHART_MARGIN.top - _CHART_MARGIN.bottom,
            activeDrivers.length * _ROW_HEIGHT_PX
        );

        const xScale = d3
            .scaleLinear()
            .domain([paceExtent[0] - domainPad, paceExtent[1] + domainPad])
            .range([0, width]);

        const yScale = d3
            .scaleBand()
            .domain(activeDrivers)
            .range([0, height])
            .paddingInner(0.22)
            .paddingOuter(0.1);

        const svg = d3
            .select(container)
            .append('svg')
            .attr('width', width + _CHART_MARGIN.left + _CHART_MARGIN.right)
            .attr('height', height + _CHART_MARGIN.top + _CHART_MARGIN.bottom)
            .append('g')
            .attr('transform', `translate(${_CHART_MARGIN.left},${_CHART_MARGIN.top})`);

        // Vertical pace gridlines
        svg.append('g')
            .attr('class', 'gridline')
            .attr('transform', `translate(0,${height})`)
            .call(d3.axisBottom(xScale).ticks(8).tickSize(-height).tickFormat(''));

        // Horizontal row bands
        svg.append('g')
            .attr('class', 'stint-pace-row-guides')
            .selectAll('rect.row-guide')
            .data(activeDrivers)
            .enter()
            .append('rect')
            .attr('class', 'row-guide')
            .attr('x', 0)
            .attr('y', (code) => yScale(code))
            .attr('width', width)
            .attr('height', yScale.bandwidth())
            .attr('rx', 4)
            .attr('fill', 'rgba(255, 255, 255, 0.025)');

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
                activeMetric === _METRIC_FUEL_CORRECTED
                    ? '◀ FASTER · FUEL-CORRECTED STINT PACE (S) · SLOWER ▶'
                    : '◀ FASTER · RAW AVERAGE STINT PACE (S) · SLOWER ▶'
            );

        // Y-axis driver classification labels
        const yAxisGroup = svg
            .append('g')
            .call(
                d3
                    .axisLeft(yScale)
                    .tickSize(0)
                    .tickPadding(10)
                    .tickFormat((code) => {
                        const rank = rankByDriver.get(code);
                        return rank ? `P${rank}  ${code}` : code;
                    })
            )
            .call((g) => g.select('.domain').remove());

        yAxisLabels = yAxisGroup
            .selectAll('.tick text')
            .attr('class', 'driver-label')
            .style(
                'fill',
                (code) => driverMetaByCode.get(code)?.color || 'var(--text-primary)'
            )
            .style('font-family', 'Montserrat, sans-serif')
            .style('font-weight', '700')
            .style('font-size', '11px')
            .style('cursor', 'pointer')
            .on('click', (event, code) => {
                localFocusedDriver = localFocusedDriver === code ? null : code;
                updateFocusStyles();
            });

        // Driver stint progression rows
        const rowsLayer = svg.append('g').attr('class', 'stint-pace-rows');

        driverRowGroups = rowsLayer
            .selectAll('g.driver-stint-row')
            .data(driverSeries)
            .enter()
            .append('g')
            .attr('class', 'driver-stint-row');

        const computeNodeY = (driverCode, idx, total) => {
            const center = yScale(driverCode) + yScale.bandwidth() / 2;
            if (total <= 1) return center;
            const offsetStep = Math.min(3.2, (yScale.bandwidth() - 10) / total);
            return center + (idx - (total - 1) / 2) * offsetStep;
        };

        const lineGen = d3
            .line()
            .x((d) => xScale(d.stintObj[activeMetric]))
            .y((d) => d.y);

        // Constructor-colored line connecting Stint 1 -> Stint 2 -> Stint 3
        driverRowGroups
            .append('path')
            .attr('class', 'stint-connector-line')
            .attr('fill', 'none')
            .attr('stroke', (d) => d.color)
            .attr('stroke-width', _LINK_STROKE_WIDTH)
            .attr('stroke-linecap', 'round')
            .attr('d', (d) => {
                if (d.stints.length < 2) return null;
                const pts = d.stints.map((stintObj, idx) => ({
                    stintObj,
                    y: computeNodeY(d.driver, idx, d.stints.length)
                }));
                return lineGen(pts);
            });

        // Stint compound nodes with stint number inside
        driverRowGroups.each(function (series) {
            const rowGroup = d3.select(this);
            const nodeData = series.stints.map((stintObj, idx) => ({
                stintObj,
                prevStintObj: idx > 0 ? series.stints[idx - 1] : null,
                x: xScale(stintObj[activeMetric]),
                y: computeNodeY(series.driver, idx, series.stints.length)
            }));

            const nodes = rowGroup
                .selectAll('g.stint-pace-node')
                .data(nodeData)
                .enter()
                .append('g')
                .attr('class', 'stint-pace-node')
                .attr('transform', (d) => `translate(${d.x},${d.y})`)
                .style('cursor', 'pointer');

            nodes
                .append('circle')
                .attr('r', _NODE_RADIUS_PX)
                .attr(
                    'fill',
                    (d) =>
                        _COMPOUND_COLORS[d.stintObj.compound] ||
                        _COMPOUND_COLORS.UNKNOWN
                )
                .attr('stroke', '#111118')
                .attr('stroke-width', 1.8);

            nodes
                .append('text')
                .attr('dy', '0.35em')
                .attr('text-anchor', 'middle')
                .style('font-family', 'Montserrat, sans-serif')
                .style('font-size', '9px')
                .style('font-weight', '800')
                .style('pointer-events', 'none')
                .attr('fill', (d) =>
                    _DARK_TEXT_COMPOUNDS.has(d.stintObj.compound)
                        ? '#111118'
                        : '#ffffff'
                )
                .text((d) => d.stintObj.stint);

            nodes
                .on('mouseover', (event, d) => {
                    hoveredDriver = series.driver;
                    updateFocusStyles();

                    d3.select(event.currentTarget)
                        .raise()
                        .select('circle')
                        .attr('r', _NODE_HOVER_RADIUS_PX)
                        .attr('stroke', '#ffffff')
                        .attr('stroke-width', 2.2);

                    _populateStintPaceTooltip(
                        tooltip.node(),
                        d.stintObj,
                        d.prevStintObj,
                        activeMetric
                    );

                    tooltip
                        .classed('hidden', false)
                        .style('border-left-color', series.color || 'var(--accent)')
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
                        .select('circle')
                        .attr('r', _NODE_RADIUS_PX)
                        .attr('stroke', '#111118')
                        .attr('stroke-width', 1.8);

                    tooltip.classed('hidden', true);
                });
        });

        updateFocusStyles();
    };

    _externalStintPaceFocusHandler = (driverCode) => {
        externalFocusedDriver = driverCode;
        updateFocusStyles();
    };

    _buildStintPaceControls(controlsContainer, activeMetric, (nextMetric) => {
        activeMetric = nextMetric;
        drawChart();
    });

    drawChart();
}
