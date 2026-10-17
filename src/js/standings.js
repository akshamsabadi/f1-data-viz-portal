import { setBeeswarmExternalFocus } from './beeswarm.js';
import { setCornerSpeedExternalFocus } from './corner_speed.js';
import { setBumpExternalFocus } from './bump.js';
import { setPracticeDegradationExternalFocus } from './practice_degradation.js';
import { setPracticeAeroExternalFocus } from './practice_aero.js';
import { setPracticeLongRunExternalFocus } from './practice_longrun.js';
import { setPracticeProgrammeExternalFocus } from './practice_programme.js';
import { setQualiTraceExternalFocus } from './quali_trace.js';
import { setQualiProgressionExternalFocus } from './quali_progression.js';
import { setQualiTeammateExternalFocus } from './quali_teammate.js';
import { setQualiSectorsExternalFocus } from './quali_sectors.js';
import { setRaceStrategyExternalFocus } from './race_strategy.js';
import { setRaceWormExternalFocus } from './race_worm.js';
import { setRacePitStopsExternalFocus } from './race_pitstops.js';
import { setRaceStintPaceExternalFocus } from './race_stint_pace.js';

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

const _COMPOUND_COLORS = {
    SOFT: '#FF3333',
    MEDIUM: '#FFE600',
    HARD: '#F0F0F5',
    INTERMEDIATE: '#39B54A',
    WET: '#00AEEF'
};

const _SESSION_TITLES = {
    practice: 'Practice Classification',
    qualifying: 'Qualifying Classification',
    race: 'Race Classification'
};

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
 * Computes the official race classification, ranks, and DNF/DNS statuses for all drivers.
 * Shared between the Session Classification sidebar, Lap Times X-axis, Strategy chart, and Bump chart.
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

    const unsortedClassification = (data.drivers || []).map((driver) => {
        const laps = (driverLapsMap.get(driver.code) || []).slice().sort((a, b) => a.lap - b.lap);
        const lastLapRecord = laps.length > 0 ? laps[laps.length - 1] : null;
        const lapsCompleted = lastLapRecord ? lastLapRecord.lap : 0;
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
 * Formats the primary gap label and optional retirement lap subtitle for a classified race driver.
 *
 * @param {Object} driver - Classified driver entry.
 * @param {number} index - Zero-based finishing position index.
 * @param {number} winnerTime - Session time of the race winner in seconds.
 * @param {number} maxLap - Total laps completed by the race winner.
 * @returns {{gapText: string, detailText: string}} Formatted display strings for the row.
 */
function _formatRaceGapAndDetail(driver, index, winnerTime, maxLap) {
    let gapText = '';
    let detailText = '';

    if (driver.isDns) {
        gapText = _STATUS_DNS;
    } else if (driver.isDnf) {
        gapText = _STATUS_DNF;
        detailText = `Lap ${driver.lapsCompleted}`;
    } else if (index === 0) {
        gapText = formatSessionDuration(winnerTime);
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
 * Propagates a unified focus state across all telemetry visualizations in the active session tab.
 *
 * @param {{code: string, team: string}|null} targetDriver - Driver to highlight across the dashboard, or null to restore.
 * @param {string} activeSession - Active tab identifier (`'practice'`, `'qualifying'`, or `'race'`).
 * @returns {void}
 */
export function broadcastDashboardFocus(targetDriver, activeSession = 'race') {
    const driverCode = targetDriver ? targetDriver.code : null;
    const teamName = targetDriver ? targetDriver.team : null;

    if (activeSession === 'practice') {
        setPracticeDegradationExternalFocus(driverCode);
        setPracticeAeroExternalFocus(driverCode);
        setPracticeLongRunExternalFocus(driverCode);
        setPracticeProgrammeExternalFocus(driverCode);
        return;
    }

    if (activeSession === 'qualifying') {
        setQualiTraceExternalFocus(driverCode);
        setQualiProgressionExternalFocus(driverCode);
        setQualiTeammateExternalFocus(driverCode);
        setQualiSectorsExternalFocus(driverCode);
        setCornerSpeedExternalFocus(teamName);
        return;
    }

    setBeeswarmExternalFocus(driverCode);
    setRaceStrategyExternalFocus(driverCode);
    setRaceWormExternalFocus(driverCode);
    setBumpExternalFocus(driverCode);
    setRacePitStopsExternalFocus(driverCode);
    setRaceStintPaceExternalFocus(driverCode);
}

/**
 * Creates a compact DOM element for a single driver row in the Session Classification list.
 *
 * @param {Object} driver - Classified driver object (`{ code, team, color }`).
 * @param {number} index - Zero-based position index.
 * @param {string} gapHtml - Formatted primary gap/time HTML.
 * @param {string} detailHtml - Optional secondary subtitle HTML.
 * @returns {HTMLElement} Constructed `.standings-row` element.
 */
function _createStandingsRowElement(driver, index, gapHtml, detailHtml) {
    const row = document.createElement('div');
    row.className = 'standings-row';
    row.dataset.driverCode = driver.code;
    const subHtml = detailHtml ? `<div class="standings-laps-dnf">${detailHtml}</div>` : '';
    row.innerHTML = `
        <div class="standings-row-left">
            <div class="standings-pos">P${index + 1}</div>
            <div class="standings-color-bar" style="background-color: ${driver.color}"></div>
            <div class="standings-driver-info">
                <span class="standings-code-team">${driver.code}</span>
                <span class="standings-team-name">${driver.team}</span>
            </div>
        </div>
        <div class="standings-row-right">
            <div class="standings-gap">${gapHtml}</div>
            ${subHtml}
        </div>
    `;
    return row;
}

/**
 * Creates a horizontal knockout divider element for the Qualifying Classification sidebar.
 *
 * @param {string} label - Cutoff label (e.g. `'Q3 CUTOFF · TOP 10'`).
 * @param {string} cutoffTimeText - Formatted cutoff time string.
 * @returns {HTMLElement} Divider element.
 */
function _createCutoffDividerElement(label, cutoffTimeText) {
    const divider = document.createElement('div');
    divider.className = 'standings-cutoff-divider';
    divider.innerHTML = `<span>${label}</span><span>${cutoffTimeText}</span>`;
    return divider;
}

/**
 * Binds unified hover and click-lock interaction listeners to all `.standings-row` elements.
 *
 * @param {HTMLElement} container - `#standings-list` container element.
 * @param {Array<{row: HTMLElement, driver: {code: string, team: string}}>} rowBindings - Row and driver pairs.
 * @param {string} activeSession - Active tab identifier (`'practice'`, `'qualifying'`, or `'race'`).
 * @returns {void}
 */
function _bindStandingsRowInteractions(container, rowBindings, activeSession) {
    let lockedDriverCode = null;

    rowBindings.forEach(({ row, driver }) => {
        row.addEventListener('mouseover', () => {
            if (!lockedDriverCode) {
                broadcastDashboardFocus(driver, activeSession);
            }
        });

        row.addEventListener('mouseout', () => {
            if (!lockedDriverCode) {
                broadcastDashboardFocus(null, activeSession);
            }
        });

        row.addEventListener('click', () => {
            if (lockedDriverCode === driver.code) {
                lockedDriverCode = null;
                row.classList.remove('selected');
                broadcastDashboardFocus(null, activeSession);
            } else {
                lockedDriverCode = driver.code;
                container
                    .querySelectorAll('.standings-row')
                    .forEach((el) => el.classList.remove('selected'));
                row.classList.add('selected');
                broadcastDashboardFocus(driver, activeSession);
            }
        });
    });
}

/**
 * Renders the Session Classification sidebar table for the active session (`practice`, `qualifying`, or `race`)
 * and binds unified cross-chart hover and click-lock interactions.
 *
 * @param {Object} data - Enriched Grand Prix telemetry payload.
 * @param {string} [activeSession='race'] - Active session tab (`'practice'`, `'qualifying'`, or `'race'`).
 * @returns {void}
 */
export function renderStandings(data, activeSession = 'race') {
    const container = document.getElementById('standings-list');
    const titleEl = document.getElementById('standings-title');
    if (titleEl) {
        titleEl.textContent = _SESSION_TITLES[activeSession] || _SESSION_TITLES.race;
    }
    if (!container) return;
    container.innerHTML = '';

    const rowBindings = [];

    if (activeSession === 'practice' && data.practice && Array.isArray(data.practice.classification)) {
        data.practice.classification.forEach((entry, index) => {
            const code = entry.driver;
            const compoundColor = _COMPOUND_COLORS[entry.compound] || '#F0F0F5';
            const dotHtml = `<span class="standings-compound-badge" style="background-color: ${compoundColor}" title="${entry.compound}"></span>`;
            const gapHtml =
                index === 0
                    ? `${dotHtml}${formatSessionDuration(entry.best_lap)}`
                    : `${dotHtml}+${Number(entry.gap_to_p1).toFixed(3)}s`;
            const detailHtml = `${entry.total_laps} Laps`;
            const driverObj = { code, team: entry.team, color: entry.color };
            const row = _createStandingsRowElement(driverObj, index, gapHtml, detailHtml);
            container.appendChild(row);
            rowBindings.push({ row, driver: driverObj });
        });
        _bindStandingsRowInteractions(container, rowBindings, activeSession);
        return;
    }

    if (activeSession === 'qualifying' && data.qualifying && Array.isArray(data.qualifying.results)) {
        const cutoffs = data.qualifying.cutoffs || {};
        data.qualifying.results.forEach((entry, index) => {
            const code = entry.driver;
            const gapHtml =
                index === 0
                    ? formatSessionDuration(entry.best_time)
                    : `+${Number(entry.gap_to_pole).toFixed(3)}s`;
            const detailHtml = `${entry.eliminated_in} · ${formatSessionDuration(entry.best_time)}`;
            const driverObj = { code, team: entry.team, color: entry.color };
            const row = _createStandingsRowElement(driverObj, index, gapHtml, detailHtml);
            container.appendChild(row);
            rowBindings.push({ row, driver: driverObj });

            if (index === 9 && data.qualifying.results.length > 10) {
                container.appendChild(
                    _createCutoffDividerElement(
                        'Q3 CUTOFF · TOP 10',
                        formatSessionDuration(cutoffs.q3_cutoff_time || entry.best_time)
                    )
                );
            } else if (index === 15 && data.qualifying.results.length > 16) {
                container.appendChild(
                    _createCutoffDividerElement(
                        'Q2 CUTOFF · TOP 16',
                        formatSessionDuration(cutoffs.q2_cutoff_time || entry.best_time)
                    )
                );
            }
        });
        _bindStandingsRowInteractions(container, rowBindings, activeSession);
        return;
    }

    // Default: Race Classification
    const { validLaps, maxLap, classification } = calculateDriverClassification(data);
    if (validLaps.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted)">No classification data available.</p>';
        return;
    }

    const winnerTime = classification[0].lastLapTime;
    classification.forEach((driver, index) => {
        const { gapText, detailText } = _formatRaceGapAndDetail(driver, index, winnerTime, maxLap);
        const row = _createStandingsRowElement(driver, index, gapText, detailText);
        container.appendChild(row);
        rowBindings.push({ row, driver });
    });

    _bindStandingsRowInteractions(container, rowBindings, activeSession);
}
