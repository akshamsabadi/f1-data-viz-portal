const _DNF_TIME_THRESHOLD_SECONDS = 180;
const _SECONDS_PER_HOUR = 3600;
const _SECONDS_PER_MINUTE = 60;
const _DNS_LINE_OPACITY = 0.25;
const _DNF_LINE_OPACITY = 0.5;
const _ACTIVE_OPACITY = 1;
const _DIMMED_HOVER_OPACITY = 0.05;
const _BUMP_DEFAULT_STROKE_WIDTH = 2;
const _BUMP_HOVER_STROKE_WIDTH = 3.5;
const _BUMP_DIMMED_STROKE_WIDTH = 1;

const _STATUS_FINISHER = 'FINISHER';
const _STATUS_LAPPED = 'LAPPED';
const _STATUS_DNF = 'DNF';
const _STATUS_DNS = 'DNS';

/**
 * Checks whether a driver retired early (DNF) rather than finishing on the lead lap or lapped.
 *
 * @param {{lap: number, session_time: number}|null} lastLapRecord - Final recorded lap for the driver.
 * @param {number} maxLap - Total race laps completed by the winner.
 * @param {number} maxSessionTime - Maximum session timestamp recorded at the end of the race.
 * @returns {boolean} True if the driver retired prior to the end of the session.
 */
function _isDriverDnf(lastLapRecord, maxLap, maxSessionTime) {
    if (!lastLapRecord) return false;
    const finishedBeforeFinalLap = maxLap - lastLapRecord.lap > 0;
    const stoppedLongBeforeCheckeredFlag =
        maxSessionTime - lastLapRecord.session_time > _DNF_TIME_THRESHOLD_SECONDS;
    return finishedBeforeFinalLap && stoppedLongBeforeCheckeredFlag;
}

/**
 * Determines the classification status string for a driver.
 *
 * @param {number} lapsCompleted - Number of valid laps completed by the driver.
 * @param {{lap: number, session_time: number}|null} lastLapRecord - Driver's final lap object.
 * @param {number} maxLap - Total laps completed by the race winner.
 * @param {number} maxSessionTime - Maximum session timestamp in seconds.
 * @returns {string} One of `DNS`, `DNF`, `LAPPED`, or `FINISHER`.
 */
function _determineDriverStatus(lapsCompleted, lastLapRecord, maxLap, maxSessionTime) {
    if (lapsCompleted === 0) {
        return _STATUS_DNS;
    }
    if (_isDriverDnf(lastLapRecord, maxLap, maxSessionTime)) {
        return _STATUS_DNF;
    }
    if (lapsCompleted < maxLap) {
        return _STATUS_LAPPED;
    }
    return _STATUS_FINISHER;
}

/**
 * Computes the official session classification, ranks, and DNF/DNS statuses for all drivers.
 * Shared between the Session Classification sidebar and the Track Position bump chart.
 *
 * @param {Object} data - Race telemetry payload containing `drivers` and `laps`.
 * @returns {{
 *   validLaps: Array<Object>,
 *   maxLap: number,
 *   maxSessionTime: number,
 *   classification: Array<Object>
 * }} Classification summary and race extent metadata.
 */
export function calculateDriverClassification(data) {
    const validLaps = (data.laps || []).filter((d) => d.position !== null);
    if (validLaps.length === 0) {
        return {
            validLaps: [],
            maxLap: 0,
            maxSessionTime: 0,
            classification: []
        };
    }

    const maxLap = d3.max(validLaps, (d) => d.lap);
    const maxSessionTime = d3.max(validLaps, (d) => d.session_time);
    const driverLapsMap = d3.group(validLaps, (d) => d.driver);

    const unsortedClassification = data.drivers.map((driver) => {
        const laps = driverLapsMap.get(driver.code) || [];
        const lapsCompleted = laps.length;
        const lastLapRecord = lapsCompleted > 0 ? laps[lapsCompleted - 1] : null;
        const lastLapTime = lastLapRecord ? lastLapRecord.session_time : Infinity;
        const status = _determineDriverStatus(lapsCompleted, lastLapRecord, maxLap, maxSessionTime);

        return {
            ...driver,
            laps,
            lapsCompleted,
            lastLapTime,
            status,
            isDns: status === _STATUS_DNS,
            isDnf: status === _STATUS_DNF
        };
    });

    unsortedClassification.sort((a, b) => {
        if (b.lapsCompleted !== a.lapsCompleted) {
            return b.lapsCompleted - a.lapsCompleted;
        }
        if (a.isDns !== b.isDns) {
            return a.isDns ? 1 : -1;
        }
        return a.lastLapTime - b.lastLapTime;
    });

    const classification = unsortedClassification.map((entry, index) => ({
        ...entry,
        rank: index + 1
    }));

    return {
        validLaps,
        maxLap,
        maxSessionTime,
        classification
    };
}

/**
 * Returns the default resting stroke opacity for a driver's bump chart line.
 *
 * @param {Array<{isDns?: boolean, isDnf?: boolean}>} laps - Processed lap series for a driver.
 * @returns {number} Resting opacity value (`0.25` for DNS, `0.5` for DNF, `1` for finishers).
 */
export function getBumpLineOpacity(laps) {
    if (!laps || laps.length === 0) return _ACTIVE_OPACITY;
    const isDns = Boolean(laps[0].isDns);
    const isDnf = Boolean(laps[laps.length - 1].isDnf);
    if (isDns) return _DNS_LINE_OPACITY;
    if (isDnf) return _DNF_LINE_OPACITY;
    return _ACTIVE_OPACITY;
}

/**
 * Formats the race winner's total session time as `h:mm:ss.sss` or `m:ss.sss`.
 *
 * @param {number} totalSeconds - Winner's total session time in seconds.
 * @returns {string} Formatted duration string.
 */
function _formatWinnerTime(totalSeconds) {
    const hours = Math.floor(totalSeconds / _SECONDS_PER_HOUR);
    const minutes = Math.floor((totalSeconds % _SECONDS_PER_HOUR) / _SECONDS_PER_MINUTE);
    const seconds = (totalSeconds % _SECONDS_PER_MINUTE).toFixed(3);

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.padStart(6, '0')}`;
    }
    return `${minutes}:${seconds.padStart(6, '0')}`;
}

/**
 * Formats the primary gap label and secondary detail subtitle for a classified driver.
 *
 * @param {Object} driver - Classified driver entry.
 * @param {number} index - Zero-based finishing position index.
 * @param {number} winnerTime - Session time of the race winner in seconds.
 * @param {number} maxLap - Total laps completed by the race winner.
 * @returns {{gapText: string, detailText: string}} Formatted display strings for the row.
 */
function _formatDriverGapAndDetail(driver, index, winnerTime, maxLap) {
    let gapText = '';
    let detailText = `Laps: ${driver.lapsCompleted}`;

    if (driver.isDns) {
        gapText = _STATUS_DNS;
        detailText = 'Did Not Start';
    } else if (driver.isDnf) {
        gapText = _STATUS_DNF;
        detailText = `Retired - Lap ${driver.lapsCompleted}`;
    } else if (index === 0) {
        gapText = _formatWinnerTime(winnerTime);
        detailText = 'Winner';
    } else if (driver.status === _STATUS_LAPPED) {
        const lapsBehind = maxLap - driver.lapsCompleted;
        gapText = `+${lapsBehind} ${lapsBehind === 1 ? 'Lap' : 'Laps'}`;
    } else {
        const gap = driver.lastLapTime - winnerTime;
        gapText = `+${gap.toFixed(3)}s`;
    }

    return { gapText, detailText };
}

/**
 * Binds cross-dashboard hover highlighting to a standings row element.
 *
 * @param {HTMLElement} row - Standings row DOM node.
 * @param {string} driverCode - Three-letter code of the driver represented by the row.
 * @returns {void}
 */
function _bindStandingsHoverEvents(row, driverCode) {
    row.addEventListener('mouseover', () => {
        d3.selectAll('circle.data-point').style('opacity', (c) =>
            c.driver === driverCode ? _ACTIVE_OPACITY : _DIMMED_HOVER_OPACITY
        );

        d3.selectAll('.bump-line')
            .attr('opacity', (p) => (p[0] === driverCode ? _ACTIVE_OPACITY : _DIMMED_HOVER_OPACITY))
            .attr('stroke-width', (p) =>
                p[0] === driverCode ? _BUMP_HOVER_STROKE_WIDTH : _BUMP_DIMMED_STROKE_WIDTH
            );

        d3.selectAll('.end-label, .end-node, .start-node').attr('opacity', (p) =>
            p[0] === driverCode ? _ACTIVE_OPACITY : _DIMMED_HOVER_OPACITY
        );
    });

    row.addEventListener('mouseout', () => {
        d3.selectAll('circle.data-point').style('opacity', _ACTIVE_OPACITY);

        d3.selectAll('.bump-line')
            .attr('opacity', (p) => getBumpLineOpacity(p[1]))
            .attr('stroke-width', _BUMP_DEFAULT_STROKE_WIDTH);

        d3.selectAll('.end-label, .end-node, .start-node').attr('opacity', _ACTIVE_OPACITY);
    });
}

/**
 * Creates a DOM element for a single driver row in the Session Classification list.
 *
 * @param {Object} driver - Classified driver object.
 * @param {number} index - Zero-based finishing position index.
 * @param {string} gapText - Formatted time gap or status label.
 * @param {string} detailText - Formatted lap count or retirement subtitle.
 * @returns {HTMLElement} Constructed `.standings-row` element.
 */
function _createStandingsRowElement(driver, index, gapText, detailText) {
    const row = document.createElement('div');
    row.className = 'standings-row';
    row.innerHTML = `
        <div class="standings-row-left">
            <div class="standings-pos">P${index + 1}</div>
            <div class="standings-color-bar" style="background-color: ${driver.color}"></div>
            <div class="standings-driver-info">
                <span class="standings-code-team">${driver.code} <span style="font-size: 0.75rem; font-weight: normal; color: var(--text-muted); font-family: 'Titillium Web', sans-serif;">${driver.name}</span></span>
                <span class="standings-team-name">${driver.team}</span>
            </div>
        </div>
        <div class="standings-row-right">
            <div class="standings-gap">${gapText}</div>
            <div class="standings-laps-dnf">${detailText}</div>
        </div>
    `;
    return row;
}

/**
 * Renders the Session Classification sidebar table and binds cross-chart focus interactions.
 *
 * @param {Object} data - Race telemetry payload containing `drivers` and `laps`.
 * @returns {void}
 */
export function renderStandings(data) {
    const container = document.getElementById('standings-list');
    if (!container) return;
    container.innerHTML = '';

    const { validLaps, maxLap, classification } = calculateDriverClassification(data);
    if (validLaps.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); font-size: 0.8rem; text-align: center; padding: 1rem 0; text-transform: uppercase; font-family: Montserrat;">No classification available.</p>';
        return;
    }

    const winnerTime = classification[0].lastLapTime;

    classification.forEach((driver, index) => {
        const { gapText, detailText } = _formatDriverGapAndDetail(driver, index, winnerTime, maxLap);
        const row = _createStandingsRowElement(driver, index, gapText, detailText);
        _bindStandingsHoverEvents(row, driver.code);
        container.appendChild(row);
    });
}
