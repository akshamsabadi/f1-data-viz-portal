import { calculateDriverClassification } from './standings.js';

const _CHART_MARGIN = { top: 34, right: 32, bottom: 44, left: 82 };
const _ROW_HEIGHT_PX = 26;
const _MIN_CHART_HEIGHT_PX = 420;
const _BAR_VERTICAL_PADDING_RATIO = 0.2;
const _BAR_CORNER_RADIUS_PX = 4;
const _STINT_GAP_PX = 2;
const _MIN_BAR_WIDTH_PX = 4;
const _FULL_LABEL_MIN_WIDTH_PX = 46;
const _SHORT_LABEL_MIN_WIDTH_PX = 20;
const _ACTIVE_OPACITY = 1;
const _DIMMED_OPACITY = 0.2;
const _TOOLTIP_OFFSET_X_PX = 15;
const _TOOLTIP_OFFSET_Y_PX = -28;
const _SECONDS_PER_MINUTE = 60;
const _FUEL_BURN_CORRECTION_PER_LAP_S = 0.055;

const _COMPOUND_ORDER = ['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET', 'UNKNOWN'];

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

const _DARK_TEXT_COMPOUNDS = new Set(['MEDIUM', 'HARD', 'INTERMEDIATE']);

let _externalStrategyFocusHandler = null;

/**
 * Highlights or restores a driver's row in the Tyre Strategy Gantt chart from an external trigger.
 *
 * @param {string|null} driverCode - Three-letter driver code to highlight, or null to restore.
 * @returns {void}
 */
export function setRaceStrategyExternalFocus(driverCode) {
    if (_externalStrategyFocusHandler) {
        _externalStrategyFocusHandler(driverCode);
    }
}

/**
 * Formats a lap pace value in seconds as `m:ss.sss` or `ss.sss s`.
 *
 * @param {number|null|undefined} paceSeconds - Lap pace in seconds.
 * @returns {string} Formatted pace string.
 */
function _formatPace(paceSeconds) {
    if (!Number.isFinite(paceSeconds) || paceSeconds <= 0) {
        return 'N/A';
    }
    const minutes = Math.floor(paceSeconds / _SECONDS_PER_MINUTE);
    const remainingSeconds = (paceSeconds % _SECONDS_PER_MINUTE).toFixed(3);
    if (minutes > 0) {
        return `${minutes}:${remainingSeconds.padStart(6, '0')} (${paceSeconds.toFixed(3)}s)`;
    }
    return `${paceSeconds.toFixed(3)}s`;
}

/**
 * Normalizes a raw tyre compound string to one of the supported uppercase keys.
 *
 * @param {string|null|undefined} compound - Raw compound name.
 * @returns {string} Normalized uppercase compound name.
 */
function _normalizeCompound(compound) {
    const upper = String(compound || 'UNKNOWN').toUpperCase();
    return _COMPOUND_COLORS[upper] ? upper : 'UNKNOWN';
}

/**
 * Derives stint descriptors from raw `data.laps` when `data.race_telemetry.stints` is absent.
 *
 * @param {Object} data - Race telemetry payload containing `laps` and `drivers`.
 * @param {Map<string, Object>} driverMetaByCode - Lookup map of driver code to metadata.
 * @param {number} maxLap - Maximum race lap count.
 * @returns {Array<Object>} Derived stint objects matching the `race_telemetry.stints` schema.
 */
function _deriveStintsFromLaps(data, driverMetaByCode, maxLap) {
    const lapsByDriver = d3.group(data.laps || [], (d) => d.driver);
    const derivedStints = [];

    lapsByDriver.forEach((driverLaps, driverCode) => {
        const sortedLaps = driverLaps.slice().sort((a, b) => a.lap - b.lap);
        if (sortedLaps.length === 0) return;

        const meta = driverMetaByCode.get(driverCode) || {
            code: driverCode,
            name: driverCode,
            team: '',
            color: '#888888'
        };

        let stintNumber = 1;
        let currentCompound = _normalizeCompound(sortedLaps[0].compound);
        let startLap = sortedLaps[0].lap;
        let endLap = sortedLaps[0].lap;
        let stintLaps = [sortedLaps[0]];

        const flushStint = () => {
            const validTimes = stintLaps
                .filter((l) => !l.interpolated && Number.isFinite(l.time) && l.time > 0)
                .map((l) => l.time);
            const avgPace = validTimes.length > 0 ? d3.mean(validTimes) : null;
            const midLap = (startLap + endLap) / 2;
            const remainingFuelLaps = Math.max(0, maxLap - midLap);
            const fuelCorrectedPace =
                avgPace !== null
                    ? avgPace - remainingFuelLaps * _FUEL_BURN_CORRECTION_PER_LAP_S
                    : null;

            derivedStints.push({
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

        for (let i = 1; i < sortedLaps.length; i++) {
            const lapObj = sortedLaps[i];
            const prevLapObj = sortedLaps[i - 1];
            const nextCompound = _normalizeCompound(lapObj.compound);
            const tyreLifeReset =
                Number.isFinite(lapObj.tyre_life) &&
                Number.isFinite(prevLapObj.tyre_life) &&
                lapObj.tyre_life < prevLapObj.tyre_life;

            if (nextCompound !== currentCompound || tyreLifeReset) {
                flushStint();
                stintNumber += 1;
                currentCompound = nextCompound;
                startLap = lapObj.lap;
                endLap = lapObj.lap;
                stintLaps = [lapObj];
            } else {
                endLap = lapObj.lap;
                stintLaps.push(lapObj);
            }
        }
        flushStint();
    });

    return derivedStints;
}

/**
 * Resolves the stint records for the race, enriching colors and team names from `data.drivers`.
 *
 * @param {Object} data - Race telemetry payload.
 * @param {Map<string, Object>} driverMetaByCode - Map of driver code to driver metadata.
 * @param {number} maxLap - Total laps in the race.
 * @returns {Array<Object>} Normalized stint records.
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
        const compound = _normalizeCompound(stint.compound);
        const startLap = Number(stint.start_lap) || 1;
        const endLap = Math.max(startLap, Number(stint.end_lap) || startLap);
        const lapsCount = Number(stint.laps_count) || endLap - startLap + 1;
        return {
            ...stint,
            name: stint.name || meta?.name || stint.driver,
            team: stint.team || meta?.team || '',
            color: meta?.color || stint.color || '#888888',
            compound,
            start_lap: startLap,
            end_lap: endLap,
            laps_count: lapsCount
        };
    });
}

/**
 * Builds the interactive compound legend inside `#race-strategy-legend`.
 *
 * @param {HTMLElement|null} legendContainer - DOM element for the legend.
 * @param {Array<Object>} stints - Normalized stint records.
 * @param {Array<Object>} scWindows - Normalized Safety Car / VSC lap windows.
 * @param {Set<string>} activeCompounds - Set of currently active compound names.
 * @param {Function} onToggle - Callback invoked when a compound filter is toggled.
 * @returns {void}
 */
function _buildStrategyLegend(legendContainer, stints, scWindows, activeCompounds, onToggle) {
    if (!legendContainer) return;
    legendContainer.replaceChildren();

    const compoundsPresent = Array.from(new Set(stints.map((s) => s.compound))).sort(
        (a, b) => _COMPOUND_ORDER.indexOf(a) - _COMPOUND_ORDER.indexOf(b)
    );

    const updateLegendStyles = () => {
        Array.from(legendContainer.children).forEach((child) => {
            const compound = child.dataset.compound;
            if (compound) {
                child.classList.toggle('inactive', !activeCompounds.has(compound));
            }
        });
    };

    compoundsPresent.forEach((compound) => {
        const item = document.createElement('div');
        item.className = 'legend-item';
        item.dataset.compound = compound;

        const swatch = document.createElement('div');
        swatch.className = 'legend-color';
        swatch.style.backgroundColor = _COMPOUND_COLORS[compound] || _COMPOUND_COLORS.UNKNOWN;
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
            updateLegendStyles();
            onToggle();
        });

        legendContainer.appendChild(item);
    });

    const hasSC = scWindows.some((w) => w.type === 'SC');
    const hasVSC = scWindows.some((w) => w.type === 'VSC');

    if (hasSC) {
        const scItem = document.createElement('div');
        scItem.className = 'legend-item';
        scItem.style.cursor = 'default';
        const swatch = document.createElement('div');
        swatch.className = 'legend-color';
        swatch.style.backgroundColor = 'rgba(245, 158, 11, 0.35)';
        swatch.style.border = '1.5px dashed #f59e0b';
        scItem.appendChild(swatch);
        scItem.appendChild(document.createTextNode('SAFETY CAR (SC)'));
        legendContainer.appendChild(scItem);
    }

    if (hasVSC) {
        const vscItem = document.createElement('div');
        vscItem.className = 'legend-item';
        vscItem.style.cursor = 'default';
        const swatch = document.createElement('div');
        swatch.className = 'legend-color';
        swatch.style.backgroundColor = 'rgba(250, 204, 21, 0.3)';
        swatch.style.border = '1.5px dashed #facc15';
        vscItem.appendChild(swatch);
        vscItem.appendChild(document.createTextNode('VIRTUAL SC (VSC)'));
        legendContainer.appendChild(vscItem);
    }

    updateLegendStyles();
}

/**
 * Populates the shared `#tooltip` DOM node with stint telemetry details.
 *
 * @param {HTMLElement|null} tooltipNode - Underlying DOM node for `#tooltip`.
 * @param {Object} stint - Hovered stint object.
 * @returns {void}
 */
function _populateStintTooltip(tooltipNode, stint) {
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

    const compoundRow = document.createElement('div');
    compoundRow.style.display = 'flex';
    compoundRow.style.alignItems = 'center';
    compoundRow.style.gap = '6px';
    compoundRow.style.fontSize = '0.8rem';
    compoundRow.style.fontWeight = '700';
    compoundRow.style.marginBottom = '4px';
    compoundRow.style.textTransform = 'uppercase';

    const dot = document.createElement('span');
    dot.style.display = 'inline-block';
    dot.style.width = '10px';
    dot.style.height = '10px';
    dot.style.borderRadius = '50%';
    dot.style.backgroundColor = compoundColor;
    dot.style.border = '1px solid rgba(255, 255, 255, 0.35)';
    compoundRow.appendChild(dot);
    compoundRow.appendChild(
        document.createTextNode(`Stint ${stint.stint} · ${stint.compound}`)
    );

    const lapsDiv = document.createElement('div');
    lapsDiv.style.fontSize = '0.8rem';
    lapsDiv.style.color = 'var(--text-primary)';
    lapsDiv.style.marginBottom = '4px';
    lapsDiv.textContent = `Laps ${stint.start_lap}–${stint.end_lap} (${stint.laps_count} ${
        stint.laps_count === 1 ? 'lap' : 'laps'
    })`;

    const rawPaceDiv = document.createElement('div');
    rawPaceDiv.style.fontSize = '0.76rem';
    rawPaceDiv.style.color = 'var(--text-muted)';
    rawPaceDiv.textContent = `Avg Stint Pace: ${_formatPace(stint.avg_pace)}`;

    const fuelPaceDiv = document.createElement('div');
    fuelPaceDiv.style.fontSize = '0.76rem';
    fuelPaceDiv.style.color = '#34d399';
    fuelPaceDiv.style.fontWeight = '600';
    fuelPaceDiv.textContent = `Fuel-Corrected Pace: ${_formatPace(stint.fuel_corrected_pace)}`;

    tooltipNode.replaceChildren(headerDiv, compoundRow, lapsDiv, rawPaceDiv, fuelPaceDiv);
}

/**
 * Renders the Tyre Strategy & Pit Window Gantt Chart inside `#race-strategy-chart`.
 *
 * @param {Object} data - Race telemetry payload containing `drivers`, `laps`, and `race_telemetry`.
 * @returns {void}
 */
export function renderRaceStrategy(data) {
    const container = document.getElementById('race-strategy-chart');
    const legendContainer = document.getElementById('race-strategy-legend');
    if (!container) return;

    container.replaceChildren();
    if (legendContainer) legendContainer.replaceChildren();

    const { classification, maxLap: classifiedMaxLap } = calculateDriverClassification(data);
    const driverMetaByCode = new Map(
        (data.drivers || []).map((d) => [d.code, d])
    );

    const stints = _resolveStints(data, driverMetaByCode, classifiedMaxLap || 60);
    if (stints.length === 0) {
        _externalStrategyFocusHandler = null;
        const emptyMsg = document.createElement('p');
        emptyMsg.style.color = 'var(--text-muted)';
        emptyMsg.style.textAlign = 'center';
        emptyMsg.style.paddingTop = '2rem';
        emptyMsg.style.fontFamily = 'Montserrat, sans-serif';
        emptyMsg.style.textTransform = 'uppercase';
        emptyMsg.textContent = 'No tyre strategy data available for this race.';
        container.replaceChildren(emptyMsg);
        return;
    }

    const maxLap = Math.max(
        classifiedMaxLap || 1,
        d3.max(stints, (d) => d.end_lap) || 1
    );

    const orderedDrivers =
        classification.length > 0
            ? classification.map((c) => c.code)
            : Array.from(new Set(stints.map((s) => s.driver)));

    const rankByDriver = new Map(
        orderedDrivers.map((code, idx) => [code, idx + 1])
    );

    const containerWidth = Math.max(360, container.clientWidth || 860);
    const width = containerWidth - _CHART_MARGIN.left - _CHART_MARGIN.right;
    const height = Math.max(
        _MIN_CHART_HEIGHT_PX - _CHART_MARGIN.top - _CHART_MARGIN.bottom,
        orderedDrivers.length * _ROW_HEIGHT_PX
    );

    const xScale = d3.scaleLinear().domain([0, maxLap]).range([0, width]);
    const yScale = d3
        .scaleBand()
        .domain(orderedDrivers)
        .range([0, height])
        .paddingInner(_BAR_VERTICAL_PADDING_RATIO)
        .paddingOuter(0.1);

    const svg = d3
        .select(container)
        .append('svg')
        .attr('width', width + _CHART_MARGIN.left + _CHART_MARGIN.right)
        .attr('height', height + _CHART_MARGIN.top + _CHART_MARGIN.bottom)
        .append('g')
        .attr('transform', `translate(${_CHART_MARGIN.left},${_CHART_MARGIN.top})`);

    // Vertical lap gridlines
    svg.append('g')
        .attr('class', 'gridline')
        .attr('transform', `translate(0,${height})`)
        .call(
            d3
                .axisBottom(xScale)
                .ticks(Math.min(15, maxLap))
                .tickSize(-height)
                .tickFormat('')
        );

    // Subtle horizontal row guide backgrounds
    svg.append('g')
        .attr('class', 'strategy-row-guides')
        .selectAll('rect.row-bg')
        .data(orderedDrivers)
        .enter()
        .append('rect')
        .attr('class', 'row-bg')
        .attr('x', 0)
        .attr('y', (d) => yScale(d))
        .attr('width', width)
        .attr('height', yScale.bandwidth())
        .attr('rx', _BAR_CORNER_RADIUS_PX)
        .attr('fill', 'rgba(255, 255, 255, 0.025)');

    // Safety Car (SC) & Virtual Safety Car (VSC) Window Extraction
    const rawScWindows =
        data.race_telemetry && Array.isArray(data.race_telemetry.sc_vsc_windows)
            ? data.race_telemetry.sc_vsc_windows
            : Array.isArray(data.session_events)
              ? data.session_events
              : [];

    const scWindows = rawScWindows
        .filter(
            (w) =>
                (w.type === 'SC' || w.type === 'VSC') &&
                Number.isFinite(Number(w.start_lap)) &&
                Number(w.start_lap) <= maxLap
        )
        .map((w) => {
            const startLap = Math.max(1, Number(w.start_lap));
            const endLap = Math.min(maxLap, Math.max(startLap, Number(w.end_lap) || startLap));
            return {
                type: w.type,
                start_lap: startLap,
                end_lap: endLap,
                label:
                    startLap === endLap
                        ? `${w.type} · L${startLap}`
                        : `${w.type} · L${startLap}–${endLap}`
            };
        });

    // Under-stint SC / VSC vertical shaded bands
    if (scWindows.length > 0) {
        svg.append('g')
            .attr('class', 'sc-vsc-bg-layer')
            .selectAll('rect.sc-vsc-band')
            .data(scWindows)
            .enter()
            .append('rect')
            .attr('class', 'sc-vsc-band')
            .attr('x', (w) => xScale(Math.max(0, w.start_lap - 1)))
            .attr('y', -4)
            .attr('width', (w) =>
                Math.max(6, xScale(w.end_lap) - xScale(Math.max(0, w.start_lap - 1)))
            )
            .attr('height', height + 8)
            .attr('fill', (w) =>
                w.type === 'SC' ? 'rgba(245, 158, 11, 0.14)' : 'rgba(250, 204, 21, 0.11)'
            )
            .style('pointer-events', 'none');
    }

    // X-axis
    const xAxisGroup = svg
        .append('g')
        .attr('transform', `translate(0,${height})`)
        .call(
            d3
                .axisBottom(xScale)
                .ticks(Math.min(15, maxLap))
                .tickFormat((d) => (d === 0 ? 'START' : `L${d}`))
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
        .text('LAP NUMBER');

    // Y-axis driver classification labels
    let localFocusedDriver = null;
    let externalFocusedDriver = null;
    let hoveredDriver = null;
    const activeCompounds = new Set(_COMPOUND_ORDER);

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

    const driverLabels = yAxisGroup
        .selectAll('.tick text')
        .attr('class', 'driver-label')
        .style('fill', (code) => driverMetaByCode.get(code)?.color || 'var(--text-primary)')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-weight', '700')
        .style('font-size', '11px')
        .style('cursor', 'pointer');

    const tooltip = d3.select('#tooltip');
    const stintsGroup = svg.append('g').attr('class', 'stints-layer');

    const stintGroups = stintsGroup
        .selectAll('g.stint-bar-group')
        .data(stints.filter((s) => yScale(s.driver) !== undefined))
        .enter()
        .append('g')
        .attr('class', 'stint-bar-group')
        .style('cursor', 'pointer');

    const computeBarX = (d) => xScale(Math.max(0, d.start_lap - 1)) + _STINT_GAP_PX / 2;
    const computeBarWidth = (d) => {
        const rawWidth =
            xScale(d.end_lap) - xScale(Math.max(0, d.start_lap - 1)) - _STINT_GAP_PX;
        return Math.max(_MIN_BAR_WIDTH_PX, rawWidth);
    };

    // Constructor accent underline under each stint bar
    stintGroups
        .append('rect')
        .attr('class', 'stint-team-accent')
        .attr('x', computeBarX)
        .attr('y', (d) => yScale(d.driver) + yScale.bandwidth() - 3)
        .attr('width', computeBarWidth)
        .attr('height', 3)
        .attr('rx', 1.5)
        .attr('fill', (d) => d.color);

    // Main compound rounded bar
    stintGroups
        .append('rect')
        .attr('class', 'stint-compound-bar')
        .attr('x', computeBarX)
        .attr('y', (d) => yScale(d.driver))
        .attr('width', computeBarWidth)
        .attr('height', Math.max(4, yScale.bandwidth() - 2))
        .attr('rx', _BAR_CORNER_RADIUS_PX)
        .attr('ry', _BAR_CORNER_RADIUS_PX)
        .attr('fill', (d) => _COMPOUND_COLORS[d.compound] || _COMPOUND_COLORS.UNKNOWN)
        .attr('stroke', '#111118')
        .attr('stroke-width', 1.5);

    // Centered compound + lap count text inside bar when width permits
    stintGroups
        .append('text')
        .attr('class', 'stint-bar-label')
        .attr('x', (d) => computeBarX(d) + computeBarWidth(d) / 2)
        .attr('y', (d) => yScale(d.driver) + (yScale.bandwidth() - 2) / 2)
        .attr('dy', '0.36em')
        .attr('text-anchor', 'middle')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-weight', '700')
        .style('font-size', '10px')
        .style('pointer-events', 'none')
        .style('paint-order', 'stroke')
        .attr('stroke', (d) => _COMPOUND_COLORS[d.compound] || _COMPOUND_COLORS.UNKNOWN)
        .attr('stroke-width', 4)
        .attr('stroke-linejoin', 'round')
        .attr('fill', (d) =>
            _DARK_TEXT_COMPOUNDS.has(d.compound) ? '#111118' : '#ffffff'
        )
        .text((d) => {
            const w = computeBarWidth(d);
            const abbr = _COMPOUND_ABBREVIATIONS[d.compound] || 'U';
            if (w >= _FULL_LABEL_MIN_WIDTH_PX) {
                return `${abbr} · ${d.laps_count}L`;
            }
            if (w >= _SHORT_LABEL_MIN_WIDTH_PX) {
                return abbr;
            }
            return '';
        });

    // Pit window transition ticks between consecutive stints
    const stintsByDriver = d3.group(stints, (d) => d.driver);
    const pitTransitions = [];
    stintsByDriver.forEach((driverStints, driverCode) => {
        if (yScale(driverCode) === undefined) return;
        const sorted = driverStints.slice().sort((a, b) => a.stint - b.stint);
        for (let i = 0; i < sorted.length - 1; i++) {
            pitTransitions.push({
                driver: driverCode,
                lap: sorted[i].end_lap,
                fromCompound: sorted[i].compound,
                toCompound: sorted[i + 1].compound
            });
        }
    });

    const pitTickGroups = svg
        .append('g')
        .attr('class', 'pit-transition-ticks')
        .selectAll('line.pit-tick')
        .data(pitTransitions)
        .enter()
        .append('line')
        .attr('class', 'pit-tick')
        .attr('x1', (d) => xScale(d.lap))
        .attr('x2', (d) => xScale(d.lap))
        .attr('y1', (d) => yScale(d.driver) - 2)
        .attr('y2', (d) => yScale(d.driver) + yScale.bandwidth() + 2)
        .attr('stroke', '#ffffff')
        .attr('stroke-width', 2)
        .style('pointer-events', 'none');

    // Over-stint SC / VSC dashed boundary lines & top header badges
    if (scWindows.length > 0) {
        const scOverlayGroup = svg.append('g').attr('class', 'sc-vsc-overlay-layer');

        const windowGroups = scOverlayGroup
            .selectAll('g.sc-vsc-window')
            .data(scWindows)
            .enter()
            .append('g')
            .attr('class', 'sc-vsc-window');

        windowGroups
            .append('line')
            .attr('x1', (w) => xScale(Math.max(0, w.start_lap - 1)))
            .attr('x2', (w) => xScale(Math.max(0, w.start_lap - 1)))
            .attr('y1', -6)
            .attr('y2', height)
            .attr('stroke', (w) => (w.type === 'SC' ? '#f59e0b' : '#facc15'))
            .attr('stroke-width', 1.5)
            .attr('stroke-dasharray', '4,3')
            .attr('opacity', 0.72)
            .style('pointer-events', 'none');

        windowGroups
            .append('line')
            .attr('x1', (w) => xScale(w.end_lap))
            .attr('x2', (w) => xScale(w.end_lap))
            .attr('y1', -6)
            .attr('y2', height)
            .attr('stroke', (w) => (w.type === 'SC' ? '#f59e0b' : '#facc15'))
            .attr('stroke-width', 1.5)
            .attr('stroke-dasharray', '4,3')
            .attr('opacity', 0.72)
            .style('pointer-events', 'none');

        // De-collide top SC/VSC header badges horizontally
        const badgePositions = [];
        scWindows.forEach((w) => {
            const x0 = xScale(Math.max(0, w.start_lap - 1));
            const x1 = xScale(w.end_lap);
            const badgeW = w.label.length * 6.6 + 16;
            let cx = Math.max(badgeW / 2 + 2, Math.min(width - badgeW / 2 - 2, (x0 + x1) / 2));
            let cy = -15;
            if (badgePositions.length > 0) {
                const prev = badgePositions[badgePositions.length - 1];
                const minGap = (prev.badgeW + badgeW) / 2 + 6;
                if (cx - prev.cx < minGap) {
                    cx = Math.min(width - badgeW / 2 - 2, prev.cx + minGap);
                }
            }
            badgePositions.push({ cx, cy, badgeW });
        });

        const badgeGroups = windowGroups
            .append('g')
            .attr('class', 'sc-vsc-badge')
            .attr('transform', (_w, idx) => {
                const pos = badgePositions[idx] || { cx: 40, cy: -15 };
                return `translate(${pos.cx},${pos.cy})`;
            })
            .style('cursor', 'pointer');

        badgeGroups
            .append('rect')
            .attr('x', (w) => -(w.label.length * 3.3 + 8))
            .attr('y', -9)
            .attr('width', (w) => w.label.length * 6.6 + 16)
            .attr('height', 17)
            .attr('rx', 4)
            .attr('fill', 'rgba(18, 18, 26, 0.95)')
            .attr('stroke', (w) => (w.type === 'SC' ? '#f59e0b' : '#facc15'))
            .attr('stroke-width', 1.2);

        badgeGroups
            .append('text')
            .attr('x', 0)
            .attr('y', 0)
            .attr('dy', '0.34em')
            .attr('text-anchor', 'middle')
            .attr('fill', (w) => (w.type === 'SC' ? '#f59e0b' : '#facc15'))
            .style('font-family', 'Montserrat, sans-serif')
            .style('font-size', '9.5px')
            .style('font-weight', '700')
            .style('letter-spacing', '0.4px')
            .text((w) => w.label);

        badgeGroups
            .on('mouseover', (event, w) => {
                const color = w.type === 'SC' ? '#f59e0b' : '#facc15';
                const fullTitle =
                    w.type === 'SC' ? 'SAFETY CAR DEPLOYED' : 'VIRTUAL SAFETY CAR';
                const pitsInWindow = pitTransitions.filter(
                    (p) => p.lap >= w.start_lap - 1 && p.lap <= w.end_lap
                );
                const pittedDrivers = Array.from(new Set(pitsInWindow.map((p) => p.driver)));
                const pitSummary =
                    pittedDrivers.length > 0
                        ? `Drivers Pitting (${pittedDrivers.length}): ${pittedDrivers.join(', ')}`
                        : 'No pit stops recorded in this window';

                tooltip
                    .classed('hidden', false)
                    .style('border-left-color', color)
                    .html(`
                        <div style="font-family: Montserrat, sans-serif; font-weight: 700; margin-bottom: 4px; color: ${color};">
                            ${fullTitle}
                        </div>
                        <div style="font-size: 0.82rem; font-weight: 600; margin-bottom: 4px;">
                            Active Window: Laps ${w.start_lap}&ndash;${w.end_lap}
                        </div>
                        <div style="font-size: 0.76rem; color: var(--text-muted);">
                            ${pitSummary}
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
                tooltip.classed('hidden', true);
            });
    }

    const updateFocusStyles = () => {
        const effectiveDriver =
            hoveredDriver !== null
                ? hoveredDriver
                : externalFocusedDriver !== null
                  ? externalFocusedDriver
                  : localFocusedDriver;

        stintGroups.style('opacity', (d) => {
            const compoundMatch = activeCompounds.has(d.compound);
            const driverMatch = effectiveDriver === null || d.driver === effectiveDriver;
            return compoundMatch && driverMatch ? _ACTIVE_OPACITY : _DIMMED_OPACITY;
        });

        pitTickGroups.style('opacity', (d) =>
            effectiveDriver === null || d.driver === effectiveDriver
                ? _ACTIVE_OPACITY
                : _DIMMED_OPACITY
        );

        driverLabels.style('opacity', (code) =>
            effectiveDriver === null || code === effectiveDriver
                ? _ACTIVE_OPACITY
                : _DIMMED_OPACITY
        );
    };

    driverLabels.on('click', (event, code) => {
        localFocusedDriver = localFocusedDriver === code ? null : code;
        updateFocusStyles();
    });

    stintGroups
        .on('mouseover', (event, d) => {
            hoveredDriver = d.driver;
            updateFocusStyles();

            d3.select(event.currentTarget)
                .select('rect.stint-compound-bar')
                .attr('stroke', '#ffffff')
                .attr('stroke-width', 2);

            _populateStintTooltip(tooltip.node(), d);
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
                .select('rect.stint-compound-bar')
                .attr('stroke', '#111118')
                .attr('stroke-width', 1.5);

            tooltip.classed('hidden', true);
        });

    _externalStrategyFocusHandler = (driverCode) => {
        externalFocusedDriver = driverCode;
        updateFocusStyles();
    };

    _buildStrategyLegend(legendContainer, stints, scWindows, activeCompounds, updateFocusStyles);
    updateFocusStyles();
}
