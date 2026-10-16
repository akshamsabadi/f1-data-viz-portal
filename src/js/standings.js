import { setBeeswarmExternalFocus } from './beeswarm.js';
import { setCornerSpeedExternalFocus } from './corner_speed.js';
import { setBumpExternalFocus } from './bump.js';

const _DNF_TIME_THRESHOLD_SECONDS = 180;
const _SECONDS_PER_HOUR = 3600;
const _SECONDS_PER_MINUTE = 60;
const _DNS_LINE_OPACITY = 0.25;
const _DNF_LINE_OPACITY = 0.5;
const _ACTIVE_OPACITY = 1;

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
 * Shared between the Session Classification sidebar, Lap Times X-axis, and Track Position bump chart.
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
 * Formats a total duration in seconds as `h:mm:ss.sss` or `m:ss.sss`.
 *
 * @param {number} totalSeconds - Duration in seconds.
 * @returns {string} Formatted duration string.
 */
export function formatSessionDuration(totalSeconds) {
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return 'N/A';
    const hours = Math.floor(totalSeconds / _SECONDS_PER_HOUR);
    const minutes = Math.floor((totalSeconds % _SECONDS_PER_HOUR) / _SECONDS_PER_MINUTE);
    const seconds = (totalSeconds % _SECONDS_PER_MINUTE).toFixed(3);

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.padStart(6, '0')}`;
    }
    if (minutes > 0) {
        return `${minutes}:${seconds.padStart(6, '0')}`;
    }
    return `${seconds}s`;
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
        gapText = formatSessionDuration(winnerTime);
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
 * Propagates a unified focus state across Lap Times, Corner Speeds, and Track Position charts.
 *
 * @param {{code: string, team: string}|null} targetDriver - Driver to highlight across the dashboard, or null to restore.
 * @returns {void}
 */
function _broadcastDashboardFocus(targetDriver) {
    const driverCode = targetDriver ? targetDriver.code : null;
    const teamName = targetDriver ? targetDriver.team : null;
    setBeeswarmExternalFocus(driverCode);
    setCornerSpeedExternalFocus(teamName);
    setBumpExternalFocus(driverCode);
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
    row.dataset.driverCode = driver.code;
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
 * Renders the Session Classification sidebar table and binds unified cross-chart hover and click-lock interactions.
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
    let lockedDriver = null;

    const updateRowSelectionStyles = () => {
        container.querySelectorAll('.standings-row').forEach((rowEl) => {
            rowEl.classList.toggle(
                'selected',
                lockedDriver !== null && rowEl.dataset.driverCode === lockedDriver.code
            );
        });
    };

    classification.forEach((driver, index) => {
        const { gapText, detailText } = _formatDriverGapAndDetail(driver, index, winnerTime, maxLap);
        const row = _createStandingsRowElement(driver, index, gapText, detailText);

        row.addEventListener('mouseover', () => {
            _broadcastDashboardFocus(driver);
        });

        row.addEventListener('mouseout', () => {
            _broadcastDashboardFocus(lockedDriver);
        });

        row.addEventListener('click', () => {
            if (lockedDriver && lockedDriver.code === driver.code) {
                lockedDriver = null;
            } else {
                lockedDriver = driver;
            }
            updateRowSelectionStyles();
            _broadcastDashboardFocus(lockedDriver);
        });

        container.appendChild(row);
    });
}
