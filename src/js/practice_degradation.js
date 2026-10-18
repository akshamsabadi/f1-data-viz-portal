const _CHART_MARGIN = { top: 24, right: 118, bottom: 52, left: 68 };
const _CHART_HEIGHT_PX = 430;
const _MIN_CHART_WIDTH_PX = 320;
const _DEFAULT_CONTAINER_WIDTH_PX = 800;

const _SECONDS_PER_MINUTE = 60;
const _COMPOUND_ORDER = ['SOFT', 'MEDIUM', 'HARD'];
const _DEFAULT_COMPOUND = 'MEDIUM';
const _COMPOUND_COLORS = {
    SOFT: '#FF3333',
    MEDIUM: '#FFE600',
    HARD: '#F0F0F5'
};

const _TYRE_AGE_DOMAIN = [1, 15];
const _X_AXIS_TICKS = 15;
const _Y_AXIS_TICKS = 8;
const _AXIS_TICK_PADDING_PX = 10;
const _X_AXIS_TITLE_OFFSET_Y_PX = 40;
const _Y_AXIS_TITLE_OFFSET_Y_PX = -52;

const _Y_AXIS_PADDING_RATIO = 0.08;
const _MIN_TIME_SPAN_SECONDS = 0.5;
const _FALLBACK_MIN_TIME_SECONDS = 85;
const _FALLBACK_MAX_TIME_SECONDS = 90;

const _DEFAULT_STINT_OPACITY = 0.45;
const _DEFAULT_DOT_OPACITY = 0.72;
const _FOCUSED_STINT_OPACITY = 1.0;
const _DIMMED_STINT_OPACITY = 0.15;

const _DEFAULT_SLOPE_OPACITY = 0.95;
const _FOCUSED_DRIVER_SLOPE_OPACITY = 0.55;

const _DEFAULT_STINT_WIDTH = 1.75;
const _FOCUSED_STINT_WIDTH = 3.5;
const _HIT_TARGET_WIDTH = 12;

const _DEFAULT_DOT_RADIUS = 3.2;
const _FOCUSED_DOT_RADIUS = 4.8;
const _HOVER_DOT_RADIUS = 6.0;
const _DEFAULT_DOT_STROKE_WIDTH_PX = 1;
const _HOVER_DOT_STROKE_WIDTH_PX = 2;

const _SLOPE_HALO_COLOR = 'rgba(15, 15, 22, 0.85)';
const _SLOPE_HALO_STROKE_WIDTH_PX = 5;
const _SLOPE_LINE_STROKE_WIDTH_PX = 2.8;
const _SLOPE_LINE_DASH_ARRAY = '7,4';
const _SLOPE_LABEL_OFFSET_X_PX = 8;
const _MIN_SLOPE_LABEL_SEPARATION_PX = 15;

const _BADGE_OFFSET_X_PX = 7;
const _BADGE_RECT_X_PX = -3;
const _BADGE_RECT_Y_PX = -9;
const _BADGE_WIDTH_PX = 36;
const _BADGE_HEIGHT_PX = 17;
const _BADGE_CORNER_RADIUS_PX = 3;
const _BADGE_BG_FILL = 'rgba(15, 15, 22, 0.92)';
const _BADGE_STROKE_WIDTH_PX = 1.2;
const _BADGE_TEXT_CENTER_X_PX = 15;

const _TOOLTIP_OFFSET_X_PX = 15;
const _TOOLTIP_OFFSET_Y_PX = -28;

let _externalDegFocusHandler = null;

/**
 * Sets or clears an external driver focus filter on the Practice Tyre Degradation chart.
 *
 * @param {string|null} driverCode - Three-letter driver code to highlight, or null to restore.
 * @returns {void}
 */
export function setPracticeDegradationExternalFocus(driverCode) {
    if (_externalDegFocusHandler) {
        _externalDegFocusHandler(driverCode);
    }
}

/**
 * Formats a lap time in seconds as `m:ss.s` for axis tick labels.
 *
 * @param {number} seconds - Lap time in seconds.
 * @returns {string} Formatted lap time string.
 */
function _formatLapTimeAxis(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '';
    const mins = Math.floor(seconds / _SECONDS_PER_MINUTE);
    const secs = (seconds % _SECONDS_PER_MINUTE).toFixed(1).padStart(4, '0');
    return `${mins}:${secs}`;
}

/**
 * Formats a lap time in seconds as `m:ss.sss` for telemetry tooltips.
 *
 * @param {number} seconds - Lap time in seconds.
 * @returns {string} Formatted lap time string.
 */
function _formatLapTimeFull(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return 'N/A';
    const mins = Math.floor(seconds / _SECONDS_PER_MINUTE);
    const secs = (seconds % _SECONDS_PER_MINUTE).toFixed(3).padStart(6, '0');
    return `${mins}:${secs}`;
}

/**
 * Groups individual long-run stint laps by driver and compound, sorted by tyre age ascending.
 *
 * @param {Array<{driver: string, team: string, color: string, compound: string, tyre_life: number, time: number}>} stintLaps - Stint lap records.
 * @returns {Array<{key: string, driver: string, team: string, color: string, compound: string, laps: Array<Object>}>} Grouped stint trajectories.
 */
function _groupStintsByDriverAndCompound(stintLaps) {
    const groups = new Map();

    stintLaps.forEach((lap) => {
        const compound = (lap.compound || _DEFAULT_COMPOUND).toUpperCase();
        const key = `${lap.driver}__${compound}`;
        if (!groups.has(key)) {
            groups.set(key, {
                key,
                driver: lap.driver,
                team: lap.team || '',
                color: lap.color || '#ffffff',
                compound,
                laps: []
            });
        }
        groups.get(key).laps.push({
            ...lap,
            compound
        });
    });

    const result = [];
    groups.forEach((stint) => {
        stint.laps.sort((a, b) => a.tyre_life - b.tyre_life);
        result.push(stint);
    });

    return result;
}

/**
 * Computes the padded Y-axis lap time domain across all stint laps and regression curves.
 *
 * @param {Array<{time: number}>} stintLaps - Recorded stint lap entries.
 * @param {Array<{curve_points?: Array<{predicted_time: number}>}>} degradationSlopes - Compound regression curves.
 * @returns {[number, number]} Lower and upper lap time bounds in seconds.
 */
function _calculateDegradationTimeDomain(stintLaps, degradationSlopes) {
    const allTimes = [
        ...stintLaps.map((d) => d.time),
        ...degradationSlopes.flatMap((s) => (s.curve_points || []).map((pt) => pt.predicted_time))
    ].filter(Number.isFinite);

    const timeExtent = d3.extent(allTimes);
    const minTime = timeExtent[0] ?? _FALLBACK_MIN_TIME_SECONDS;
    const maxTime = timeExtent[1] ?? _FALLBACK_MAX_TIME_SECONDS;
    const timeSpan = Math.max(_MIN_TIME_SPAN_SECONDS, maxTime - minTime);
    const timePadding = timeSpan * _Y_AXIS_PADDING_RATIO;

    return [minTime - timePadding, maxTime + timePadding];
}

/**
 * Computes vertically de-overlapped right-hand label coordinates for compound regression curves.
 *
 * @param {Array<{compound: string, curve_points?: Array<{tyre_life: number, predicted_time: number}>}>} degradationSlopes - Regression slope models.
 * @param {Function} xScale - D3 linear scale for tyre age.
 * @param {Function} yScale - D3 linear scale for lap time.
 * @param {number} width - Inner chart width in pixels.
 * @returns {Map<string, {compound: string, x: number, rawY: number}>} Map of compound name to label coordinates.
 */
function _computeSlopeLabelPositions(degradationSlopes, xScale, yScale, width) {
    const slopeLabelPositions = new Map();
    const rawSlopeTargets = degradationSlopes
        .map((d) => {
            const pts = d.curve_points || [];
            const last = pts[pts.length - 1];
            return {
                compound: d.compound,
                x: last ? xScale(last.tyre_life) + _SLOPE_LABEL_OFFSET_X_PX : width + _SLOPE_LABEL_OFFSET_X_PX,
                rawY: last ? yScale(last.predicted_time) : 0
            };
        })
        .sort((a, b) => a.rawY - b.rawY);

    for (let i = 1; i < rawSlopeTargets.length; i++) {
        if (rawSlopeTargets[i].rawY - rawSlopeTargets[i - 1].rawY < _MIN_SLOPE_LABEL_SEPARATION_PX) {
            rawSlopeTargets[i].rawY = rawSlopeTargets[i - 1].rawY + _MIN_SLOPE_LABEL_SEPARATION_PX;
        }
    }

    rawSlopeTargets.forEach((target) => slopeLabelPositions.set(target.compound, target));
    return slopeLabelPositions;
}

/**
 * Renders interactive compound filter pills with degradation slope readouts inside `#practice-deg-legend`.
 *
 * @param {HTMLElement|null} legendContainer - DOM container for the compound filter pills.
 * @param {Array<Object>} degradationSlopes - Array of compound degradation slope records.
 * @param {Set<string>} activeCompounds - Set of currently active compound names.
 * @param {Function} onToggle - Callback invoked when a compound pill is toggled.
 * @returns {void}
 */
function _buildDegradationLegend(legendContainer, degradationSlopes, activeCompounds, onToggle) {
    if (!legendContainer) return;
    legendContainer.innerHTML = '';

    const slopeMap = new Map(
        (degradationSlopes || []).map((entry) => [entry.compound.toUpperCase(), entry])
    );

    const updateLegendUI = () => {
        Array.from(legendContainer.children).forEach((child) => {
            const compound = child.dataset.compound;
            if (compound) {
                child.classList.toggle('inactive', !activeCompounds.has(compound));
            }
        });
    };

    _COMPOUND_ORDER.forEach((compound) => {
        const slopeInfo = slopeMap.get(compound);
        const slopeText = slopeInfo
            ? `${compound} (+${slopeInfo.slope_sec_per_lap.toFixed(3)}s/lap)`
            : compound;

        const item = document.createElement('div');
        item.className = 'legend-item';
        item.dataset.compound = compound;

        const swatch = document.createElement('div');
        swatch.className = 'legend-color';
        swatch.style.backgroundColor = _COMPOUND_COLORS[compound] || '#ccc';
        item.appendChild(swatch);
        item.appendChild(document.createTextNode(slopeText));

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
 * Renders background gridlines, the horizontal Tyre Age axis, and the vertical Lap Time axis.
 *
 * @param {Object} svg - D3 selection for the chart's main translated group.
 * @param {Function} xScale - D3 linear scale for tyre age in laps.
 * @param {Function} yScale - D3 linear scale for lap times in seconds.
 * @param {number} width - Inner chart width in pixels.
 * @param {number} height - Inner chart height in pixels.
 * @returns {void}
 */
function _renderAxesAndGrid(svg, xScale, yScale, width, height) {
    svg.append('g')
        .attr('class', 'gridline')
        .call(d3.axisLeft(yScale).tickSize(-width).tickFormat('').ticks(_Y_AXIS_TICKS));

    svg.append('g')
        .attr('class', 'gridline')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(xScale).tickSize(-height).tickFormat('').ticks(_X_AXIS_TICKS));

    const xAxisGroup = svg
        .append('g')
        .attr('transform', `translate(0,${height})`)
        .call(
            d3
                .axisBottom(xScale)
                .ticks(_X_AXIS_TICKS)
                .tickFormat(d3.format('d'))
                .tickSize(0)
                .tickPadding(_AXIS_TICK_PADDING_PX)
        )
        .call((g) => g.select('.domain').attr('stroke', 'var(--border-color)'));

    xAxisGroup
        .append('text')
        .attr('x', width)
        .attr('y', _X_AXIS_TITLE_OFFSET_Y_PX)
        .attr('fill', 'var(--text-muted)')
        .attr('text-anchor', 'end')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-weight', '600')
        .style('font-size', '11px')
        .style('letter-spacing', '0.8px')
        .text('TYRE AGE (LAPS)');

    const yAxisGroup = svg
        .append('g')
        .call(
            d3
                .axisLeft(yScale)
                .ticks(_Y_AXIS_TICKS)
                .tickFormat(_formatLapTimeAxis)
                .tickSize(0)
                .tickPadding(_AXIS_TICK_PADDING_PX)
        )
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
        .style('font-size', '11px')
        .style('letter-spacing', '0.8px')
        .text('LAP TIME (M:SS.S)');
}

/**
 * Renders driver stint curves, wide transparent hit targets, and individual lap circles.
 *
 * @param {Object} svg - D3 selection for the chart's main translated group.
 * @param {Array<Object>} stints - Grouped stint trajectories.
 * @param {Array<Object>} stintLaps - Individual stint lap records.
 * @param {Function} xScale - D3 linear scale for tyre age.
 * @param {Function} yScale - D3 linear scale for lap times.
 * @returns {{stintPaths: Object, stintHitPaths: Object, lapDots: Object}} D3 selections for stint elements.
 */
function _renderDriverStintSeries(svg, stints, stintLaps, xScale, yScale) {
    const stintLineGenerator = d3
        .line()
        .x((d) => xScale(d.tyre_life))
        .y((d) => yScale(d.time))
        .curve(d3.curveMonotoneX);

    const stintsGroup = svg.append('g').attr('class', 'practice-stint-lines');
    const dotsGroup = svg.append('g').attr('class', 'practice-stint-dots');

    const stintPaths = stintsGroup
        .selectAll('path.stint-curve')
        .data(stints, (d) => d.key)
        .enter()
        .append('path')
        .attr('class', 'stint-curve')
        .attr('fill', 'none')
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round')
        .attr('d', (d) => stintLineGenerator(d.laps));

    const stintHitPaths = stintsGroup
        .selectAll('path.stint-hit')
        .data(stints, (d) => d.key)
        .enter()
        .append('path')
        .attr('class', 'stint-hit')
        .attr('fill', 'none')
        .attr('stroke', 'transparent')
        .attr('stroke-width', _HIT_TARGET_WIDTH)
        .style('cursor', 'pointer')
        .attr('d', (d) => stintLineGenerator(d.laps));

    const lapDots = dotsGroup
        .selectAll('circle.stint-lap-dot')
        .data(stintLaps)
        .enter()
        .append('circle')
        .attr('class', 'stint-lap-dot data-point')
        .attr('cx', (d) => xScale(d.tyre_life))
        .attr('cy', (d) => yScale(d.time))
        .attr('r', _DEFAULT_DOT_RADIUS)
        .attr('stroke', 'var(--bg-dark)')
        .attr('stroke-width', _DEFAULT_DOT_STROKE_WIDTH_PX)
        .style('cursor', 'pointer');

    return { stintPaths, stintHitPaths, lapDots };
}

/**
 * Renders compound regression trendlines with dark halo backings, slope labels, and hover tooltips.
 *
 * @param {Object} svg - D3 selection for the chart's main translated group.
 * @param {Array<Object>} degradationSlopes - Compound regression slope descriptors.
 * @param {Function} xScale - D3 linear scale for tyre age.
 * @param {Function} yScale - D3 linear scale for lap times.
 * @param {number} width - Inner chart width in pixels.
 * @param {Object} tooltip - D3 selection for the shared tooltip element.
 * @returns {Object} D3 selection of `.deg-slope-item` groups.
 */
function _renderDegradationTrendlines(svg, degradationSlopes, xScale, yScale, width, tooltip) {
    const trendLineGenerator = d3
        .line()
        .x((d) => xScale(d.tyre_life))
        .y((d) => yScale(d.predicted_time))
        .curve(d3.curveMonotoneX);

    const slopesGroup = svg.append('g').attr('class', 'practice-deg-slopes');
    const slopeGroups = slopesGroup
        .selectAll('g.deg-slope-item')
        .data(degradationSlopes, (d) => d.compound)
        .enter()
        .append('g')
        .attr('class', 'deg-slope-item');

    slopeGroups
        .append('path')
        .attr('class', 'deg-slope-halo')
        .attr('fill', 'none')
        .attr('stroke', _SLOPE_HALO_COLOR)
        .attr('stroke-width', _SLOPE_HALO_STROKE_WIDTH_PX)
        .attr('stroke-linecap', 'round')
        .attr('d', (d) => trendLineGenerator(d.curve_points || []));

    slopeGroups
        .append('path')
        .attr('class', 'deg-slope-line')
        .attr('fill', 'none')
        .attr('stroke', (d) => _COMPOUND_COLORS[d.compound.toUpperCase()] || '#ffffff')
        .attr('stroke-width', _SLOPE_LINE_STROKE_WIDTH_PX)
        .attr('stroke-dasharray', _SLOPE_LINE_DASH_ARRAY)
        .attr('stroke-linecap', 'round')
        .style('cursor', 'pointer')
        .attr('d', (d) => trendLineGenerator(d.curve_points || []))
        .on('mouseover', (event, d) => {
            const comp = d.compound.toUpperCase();
            const color = _COMPOUND_COLORS[comp] || '#ffffff';
            tooltip
                .classed('hidden', false)
                .style('border-left-color', color)
                .html(`
                    <div style="font-family: Montserrat, sans-serif; font-weight: 700; margin-bottom: 4px; text-transform: uppercase; color: ${color};">
                        ${comp} REGRESSION MODEL
                    </div>
                    <div style="font-size: 0.95rem; font-weight: 700; margin-bottom: 2px;">
                        +${d.slope_sec_per_lap.toFixed(3)}s / lap
                    </div>
                    <div style="font-size: 0.78rem; color: var(--text-muted);">
                        Base Pace: ${_formatLapTimeFull(d.base_time)} &bull; R&sup2; = ${d.r2.toFixed(2)}
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

    const slopeLabelPositions = _computeSlopeLabelPositions(degradationSlopes, xScale, yScale, width);

    slopeGroups
        .append('text')
        .attr('class', 'deg-slope-label')
        .attr('x', (d) => slopeLabelPositions.get(d.compound)?.x ?? width + _SLOPE_LABEL_OFFSET_X_PX)
        .attr('y', (d) => slopeLabelPositions.get(d.compound)?.rawY ?? 0)
        .attr('dy', '0.35em')
        .attr('fill', (d) => _COMPOUND_COLORS[d.compound.toUpperCase()] || '#ffffff')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '10px')
        .style('font-weight', '700')
        .text((d) => `${d.compound.toUpperCase()} +${d.slope_sec_per_lap.toFixed(3)}s/L`);

    return slopeGroups;
}

/**
 * Renders end-of-stint driver code badges that appear when a driver is focused.
 *
 * @param {Object} svg - D3 selection for the chart's main translated group.
 * @param {Array<Object>} stints - Grouped stint trajectories.
 * @param {Function} xScale - D3 linear scale for tyre age.
 * @param {Function} yScale - D3 linear scale for lap times.
 * @returns {Object} D3 selection of `.driver-stint-badge` groups.
 */
function _renderDriverStintBadges(svg, stints, xScale, yScale) {
    const badgesGroup = svg.append('g').attr('class', 'practice-deg-badges');

    const driverBadges = badgesGroup
        .selectAll('g.driver-stint-badge')
        .data(stints, (d) => d.key)
        .enter()
        .append('g')
        .attr('class', 'driver-stint-badge')
        .attr('transform', (d) => {
            const lastLap = d.laps[d.laps.length - 1];
            return `translate(${xScale(lastLap.tyre_life) + _BADGE_OFFSET_X_PX},${yScale(lastLap.time)})`;
        })
        .style('pointer-events', 'none')
        .style('opacity', 0);

    driverBadges
        .append('rect')
        .attr('x', _BADGE_RECT_X_PX)
        .attr('y', _BADGE_RECT_Y_PX)
        .attr('width', _BADGE_WIDTH_PX)
        .attr('height', _BADGE_HEIGHT_PX)
        .attr('rx', _BADGE_CORNER_RADIUS_PX)
        .attr('fill', _BADGE_BG_FILL)
        .attr('stroke', (d) => d.color)
        .attr('stroke-width', _BADGE_STROKE_WIDTH_PX);

    driverBadges
        .append('text')
        .attr('x', _BADGE_TEXT_CENTER_X_PX)
        .attr('y', 0)
        .attr('dy', '0.32em')
        .attr('text-anchor', 'middle')
        .attr('fill', (d) => d.color)
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-size', '10px')
        .style('font-weight', '700')
        .text((d) => d.driver);

    return driverBadges;
}

/**
 * Updates visual styles across stint curves, lap dots, slope lines, and driver badges.
 *
 * @param {{stintPaths: Object, stintHitPaths: Object, lapDots: Object, slopeGroups: Object, driverBadges: Object}} selections - D3 chart layer selections.
 * @param {Set<string>} activeCompounds - Currently enabled compound names.
 * @param {string|null} effectiveDriver - Focused driver code, or null.
 * @returns {void}
 */
function _applyDegradationFocusStyles(selections, activeCompounds, effectiveDriver) {
    const { stintPaths, stintHitPaths, lapDots, slopeGroups, driverBadges } = selections;

    stintPaths
        .attr('stroke', (d) => {
            if (effectiveDriver === d.driver) {
                return d.color || _COMPOUND_COLORS[d.compound];
            }
            return _COMPOUND_COLORS[d.compound] || d.color;
        })
        .attr('stroke-width', (d) =>
            effectiveDriver === d.driver ? _FOCUSED_STINT_WIDTH : _DEFAULT_STINT_WIDTH
        )
        .style('opacity', (d) => {
            if (!activeCompounds.has(d.compound)) return 0;
            if (effectiveDriver === null) return _DEFAULT_STINT_OPACITY;
            return effectiveDriver === d.driver ? _FOCUSED_STINT_OPACITY : _DIMMED_STINT_OPACITY;
        });

    stintHitPaths.style('pointer-events', (d) =>
        activeCompounds.has(d.compound) ? 'stroke' : 'none'
    );

    lapDots
        .attr('fill', (d) => {
            const comp = (d.compound || _DEFAULT_COMPOUND).toUpperCase();
            if (effectiveDriver === d.driver) {
                return d.color || _COMPOUND_COLORS[comp];
            }
            return _COMPOUND_COLORS[comp] || d.color;
        })
        .attr('r', (d) =>
            effectiveDriver === d.driver ? _FOCUSED_DOT_RADIUS : _DEFAULT_DOT_RADIUS
        )
        .style('opacity', (d) => {
            const comp = (d.compound || _DEFAULT_COMPOUND).toUpperCase();
            if (!activeCompounds.has(comp)) return 0;
            if (effectiveDriver === null) return _DEFAULT_DOT_OPACITY;
            return effectiveDriver === d.driver ? _FOCUSED_STINT_OPACITY : _DIMMED_STINT_OPACITY;
        })
        .style('pointer-events', (d) =>
            activeCompounds.has((d.compound || _DEFAULT_COMPOUND).toUpperCase()) ? 'all' : 'none'
        );

    slopeGroups.style('opacity', (d) => {
        const comp = d.compound.toUpperCase();
        if (!activeCompounds.has(comp)) return 0;
        return effectiveDriver === null ? _DEFAULT_SLOPE_OPACITY : _FOCUSED_DRIVER_SLOPE_OPACITY;
    });

    driverBadges.style('opacity', (d) => {
        if (!activeCompounds.has(d.compound)) return 0;
        return effectiveDriver !== null && effectiveDriver === d.driver ? _FOCUSED_STINT_OPACITY : 0;
    });
}

/**
 * Builds HTML content for a hovered stint trajectory tooltip.
 *
 * @param {Object} stint - Grouped driver compound stint object.
 * @returns {string} Tooltip HTML string.
 */
function _buildStintTooltipHtml(stint) {
    const compColor = _COMPOUND_COLORS[stint.compound] || '#ffffff';
    const firstLap = stint.laps[0];
    const lastLap = stint.laps[stint.laps.length - 1];
    const degDelta = stint.laps.length > 1 ? lastLap.time - firstLap.time : 0;

    return `
        <div style="font-family: Montserrat, sans-serif; font-weight: 700; margin-bottom: 4px; text-transform: uppercase;">
            ${stint.driver} <span style="color: var(--text-muted); font-weight: 600; font-size: 0.75rem;">${stint.team}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 6px; font-size: 0.8rem; font-weight: 600; margin-bottom: 3px;">
            <span style="width: 9px; height: 9px; border-radius: 50%; background: ${compColor}; display: inline-block;"></span>
            ${stint.compound} STINT (${stint.laps.length} LAPS)
        </div>
        <div style="font-size: 0.78rem; color: var(--text-muted);">
            Start: ${_formatLapTimeFull(firstLap.time)} &rarr; End: ${_formatLapTimeFull(lastLap.time)} (${degDelta >= 0 ? '+' : ''}${degDelta.toFixed(3)}s)
        </div>
    `;
}

/**
 * Builds HTML content for a hovered individual stint lap dot tooltip.
 *
 * @param {Object} lap - Individual stint lap record.
 * @param {string} comp - Uppercase compound name.
 * @param {string} compColor - Hex color for the compound.
 * @returns {string} Tooltip HTML string.
 */
function _buildLapDotTooltipHtml(lap, comp, compColor) {
    return `
        <div style="font-family: Montserrat, sans-serif; font-weight: 700; margin-bottom: 4px; text-transform: uppercase;">
            ${lap.driver} <span style="color: var(--text-muted); font-weight: 600; font-size: 0.75rem;">TYRE LIFE: ${lap.tyre_life}L</span>
        </div>
        <div style="font-size: 1rem; font-weight: 700; margin-bottom: 4px;">
            ${_formatLapTimeFull(lap.time)}
        </div>
        <div style="display: flex; align-items: center; gap: 6px; font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted);">
            <div style="width: 9px; height: 9px; border-radius: 50%; background-color: ${compColor};"></div>
            ${comp} COMPOUND &bull; ${lap.team || ''}
        </div>
    `;
}

/**
 * Binds hover, tooltip, and click-lock listeners to stint hit paths and individual lap dots.
 *
 * @param {Object} stintHitPaths - D3 selection of stint hit-target paths.
 * @param {Object} lapDots - D3 selection of individual lap circles.
 * @param {Object} tooltip - D3 selection for the shared tooltip element.
 * @param {{onHover: Function, onToggleLock: Function}} handlers - Focus state callbacks.
 * @returns {void}
 */
function _bindStintAndDotInteractions(stintHitPaths, lapDots, tooltip, handlers) {
    stintHitPaths
        .on('mouseover', (event, d) => {
            handlers.onHover(d.driver);
            const compColor = _COMPOUND_COLORS[d.compound] || '#ffffff';

            tooltip
                .classed('hidden', false)
                .style('border-left-color', d.color || compColor)
                .html(_buildStintTooltipHtml(d))
                .style('left', `${event.pageX + _TOOLTIP_OFFSET_X_PX}px`)
                .style('top', `${event.pageY + _TOOLTIP_OFFSET_Y_PX}px`);
        })
        .on('mousemove', (event) => {
            tooltip
                .style('left', `${event.pageX + _TOOLTIP_OFFSET_X_PX}px`)
                .style('top', `${event.pageY + _TOOLTIP_OFFSET_Y_PX}px`);
        })
        .on('mouseout', () => {
            handlers.onHover(null);
            tooltip.classed('hidden', true);
        })
        .on('click', (event, d) => {
            handlers.onToggleLock(d.driver);
        });

    lapDots
        .on('mouseover', (event, d) => {
            handlers.onHover(d.driver);

            const comp = (d.compound || _DEFAULT_COMPOUND).toUpperCase();
            const compColor = _COMPOUND_COLORS[comp] || '#ffffff';

            d3.select(event.currentTarget)
                .attr('r', _HOVER_DOT_RADIUS)
                .attr('stroke', '#ffffff')
                .attr('stroke-width', _HOVER_DOT_STROKE_WIDTH_PX);

            tooltip
                .classed('hidden', false)
                .style('border-left-color', d.color || compColor)
                .html(_buildLapDotTooltipHtml(d, comp, compColor))
                .style('left', `${event.pageX + _TOOLTIP_OFFSET_X_PX}px`)
                .style('top', `${event.pageY + _TOOLTIP_OFFSET_Y_PX}px`);
        })
        .on('mousemove', (event) => {
            tooltip
                .style('left', `${event.pageX + _TOOLTIP_OFFSET_X_PX}px`)
                .style('top', `${event.pageY + _TOOLTIP_OFFSET_Y_PX}px`);
        })
        .on('mouseout', (event) => {
            d3.select(event.currentTarget)
                .attr('stroke', 'var(--bg-dark)')
                .attr('stroke-width', _DEFAULT_DOT_STROKE_WIDTH_PX);
            handlers.onHover(null);
            tooltip.classed('hidden', true);
        })
        .on('click', (event, d) => {
            handlers.onToggleLock(d.driver);
        });
}

/**
 * Renders the Long-Run Stint Pace & Tyre Degradation Curves chart in `#practice-deg-chart`.
 *
 * @param {Object} data - Race telemetry payload containing `data.practice`.
 * @returns {void}
 */
export function renderPracticeDegradation(data) {
    const container = document.getElementById('practice-deg-chart');
    const legendContainer = document.getElementById('practice-deg-legend');
    if (!container) return;

    container.innerHTML = '';
    if (legendContainer) legendContainer.innerHTML = '';

    const practice = data?.practice;
    const stintLaps = practice?.stint_laps || [];
    const degradationSlopes = practice?.degradation_slopes || [];

    if (stintLaps.length === 0) {
        _externalDegFocusHandler = null;
        container.innerHTML =
            '<p style="color: var(--text-muted); text-align: center; padding-top: 2rem; font-family: Montserrat, sans-serif; text-transform: uppercase;">No practice stint telemetry available.</p>';
        return;
    }

    const rawWidth = container.clientWidth || _DEFAULT_CONTAINER_WIDTH_PX;
    const width = Math.max(_MIN_CHART_WIDTH_PX, rawWidth - _CHART_MARGIN.left - _CHART_MARGIN.right);
    const height = _CHART_HEIGHT_PX - _CHART_MARGIN.top - _CHART_MARGIN.bottom;

    const tooltip = d3.select('#tooltip');
    const activeCompounds = new Set(_COMPOUND_ORDER);
    const stints = _groupStintsByDriverAndCompound(stintLaps);
    const timeDomain = _calculateDegradationTimeDomain(stintLaps, degradationSlopes);

    const xScale = d3.scaleLinear().domain(_TYRE_AGE_DOMAIN).range([0, width]);
    const yScale = d3.scaleLinear().domain(timeDomain).range([height, 0]);

    const svg = d3
        .select(container)
        .append('svg')
        .attr('width', width + _CHART_MARGIN.left + _CHART_MARGIN.right)
        .attr('height', height + _CHART_MARGIN.top + _CHART_MARGIN.bottom)
        .append('g')
        .attr('transform', `translate(${_CHART_MARGIN.left},${_CHART_MARGIN.top})`);

    _renderAxesAndGrid(svg, xScale, yScale, width, height);

    const { stintPaths, stintHitPaths, lapDots } = _renderDriverStintSeries(
        svg,
        stints,
        stintLaps,
        xScale,
        yScale
    );
    const slopeGroups = _renderDegradationTrendlines(
        svg,
        degradationSlopes,
        xScale,
        yScale,
        width,
        tooltip
    );
    const driverBadges = _renderDriverStintBadges(svg, stints, xScale, yScale);

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

        _applyDegradationFocusStyles(
            { stintPaths, stintHitPaths, lapDots, slopeGroups, driverBadges },
            activeCompounds,
            effectiveDriver
        );
    };

    _bindStintAndDotInteractions(stintHitPaths, lapDots, tooltip, {
        onHover: (driverCode) => {
            hoveredDriver = driverCode;
            refreshStyles();
        },
        onToggleLock: (driverCode) => {
            lockedDriver = lockedDriver === driverCode ? null : driverCode;
            refreshStyles();
        }
    });

    _externalDegFocusHandler = (driverCode) => {
        externalDriver = driverCode;
        refreshStyles();
    };

    _buildDegradationLegend(legendContainer, degradationSlopes, activeCompounds, refreshStyles);
    refreshStyles();
}
