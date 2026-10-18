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
import { setRaceScrubberExternalFocus } from './race_scrubber.js';

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
const _STATUS_DSQ = 'DSQ';

const _Q3_CUTOFF_INDEX = 9;
const _Q3_TOP_COUNT = 10;
const _Q2_CUTOFF_INDEX = 15;
const _Q2_TOP_COUNT = 16;

const _DEFAULT_COMPOUND_COLOR = '#F0F0F5';
const _COMPOUND_COLORS = {
    SOFT: '#FF3333',
    MEDIUM: '#FFE600',
    HARD: '#F0F0F5',
    INTERMEDIATE: '#39B54A',
    WET: '#00AEEF'
};

const _SESSION_TITLES = {
    practice: 'Practice Classification',
    sprint_qualifying: 'Sprint Qualifying',
    sprint: 'Sprint Classification',
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
 * Builds an unranked classification summary entry for a single driver.
 *
 * @param {Object} driver - Driver metadata object (`{ code, team, color }`).
 * @param {Map<string, Array<Object>>} driverLapsMap - Map of driver code to valid race laps.
 * @param {Map<string, Object>} officialMap - Map of driver code to official race classification entry.
 * @param {number} maxLap - Total laps completed by the race winner.
 * @param {number} maxSessionTime - Maximum session timestamp in seconds.
 * @returns {Object} Enriched unranked driver classification entry.
 */
function _buildDriverClassificationEntry(driver, driverLapsMap, officialMap, maxLap, maxSessionTime) {
    const laps = (driverLapsMap.get(driver.code) || []).slice().sort((a, b) => a.lap - b.lap);
    const lastLapRecord = laps.length > 0 ? laps[laps.length - 1] : null;
    const lapsCompleted = lastLapRecord ? lastLapRecord.lap : 0;
    const lastLapTime = lastLapRecord ? lastLapRecord.session_time : Infinity;
    const official = officialMap.get(driver.code);
    const status = official?.status
        ? official.status
        : _determineDriverStatus(lapsCompleted, lastLapRecord, maxLap, maxSessionTime);

    return {
        ...driver,
        laps,
        lapsCompleted,
        lastLapTime,
        status,
        officialPosition: official?.position ?? null,
        officialGap: official?.gap_to_leader ?? null,
        isDns: status === _STATUS_DNS,
        isDnf: status === _STATUS_DNF || status === _STATUS_DSQ,
        isDsq: status === _STATUS_DSQ
    };
}

/**
 * Comparator function ordering classified drivers by official position, laps completed, DNS status, and finish time.
 *
 * @param {Object} a - First driver classification entry.
 * @param {Object} b - Second driver classification entry.
 * @returns {number} Negative if `a` ranks ahead of `b`, positive otherwise.
 */
function _compareClassifiedDrivers(a, b) {
    if (a.officialPosition !== null && b.officialPosition !== null) {
        return a.officialPosition - b.officialPosition;
    }
    if (b.lapsCompleted !== a.lapsCompleted) {
        return b.lapsCompleted - a.lapsCompleted;
    }
    if (a.isDns !== b.isDns) {
        return a.isDns ? 1 : -1;
    }
    return a.lastLapTime - b.lastLapTime;
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
    const officialList = data.race_telemetry?.classification || [];
    const officialMap = new Map(officialList.map((item) => [item.driver, item]));

    const unsortedClassification = (data.drivers || []).map((driver) =>
        _buildDriverClassificationEntry(driver, driverLapsMap, officialMap, maxLap, maxSessionTime)
    );

    unsortedClassification.sort(_compareClassifiedDrivers);

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

    if (driver.isDsq) {
        gapText = _STATUS_DSQ;
        detailText = `Lap ${driver.lapsCompleted}`;
    } else if (driver.isDns) {
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
        const gap =
            typeof driver.officialGap === 'number' && driver.officialGap > 0
                ? driver.officialGap
                : driver.lastLapTime - winnerTime;
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

    if (activeSession === 'qualifying' || activeSession === 'sprint_qualifying') {
        setQualiTraceExternalFocus(driverCode);
        setQualiProgressionExternalFocus(driverCode);
        setQualiTeammateExternalFocus(driverCode);
        setQualiSectorsExternalFocus(driverCode);
        setCornerSpeedExternalFocus(teamName);
        return;
    }

    setRaceScrubberExternalFocus(driverCode);
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
 * @param {string} gapText - Formatted primary gap/time text.
 * @param {string} detailText - Optional secondary subtitle text.
 * @param {{color: string, title: string}|null} [compoundBadge=null] - Optional compound dot descriptor.
 * @returns {HTMLElement} Constructed `.standings-row` element.
 */
function _createStandingsRowElement(driver, index, gapText, detailText, compoundBadge = null) {
    const row = document.createElement('div');
    row.className = 'standings-row';
    row.dataset.driverCode = driver.code;

    const leftDiv = document.createElement('div');
    leftDiv.className = 'standings-row-left';

    const posDiv = document.createElement('div');
    posDiv.className = 'standings-pos';
    posDiv.textContent = `P${index + 1}`;

    const colorBar = document.createElement('div');
    colorBar.className = 'standings-color-bar';
    colorBar.style.backgroundColor = driver.color;

    const infoDiv = document.createElement('div');
    infoDiv.className = 'standings-driver-info';

    const codeSpan = document.createElement('span');
    codeSpan.className = 'standings-code-team';
    codeSpan.textContent = driver.code;

    const teamSpan = document.createElement('span');
    teamSpan.className = 'standings-team-name';
    teamSpan.textContent = driver.team;

    infoDiv.append(codeSpan, teamSpan);
    leftDiv.append(posDiv, colorBar, infoDiv);

    const rightDiv = document.createElement('div');
    rightDiv.className = 'standings-row-right';

    const gapDiv = document.createElement('div');
    gapDiv.className = 'standings-gap';
    if (compoundBadge) {
        const dotSpan = document.createElement('span');
        dotSpan.className = 'standings-compound-badge';
        dotSpan.style.backgroundColor = compoundBadge.color;
        dotSpan.title = compoundBadge.title;
        gapDiv.appendChild(dotSpan);
    }
    gapDiv.appendChild(document.createTextNode(gapText));
    rightDiv.appendChild(gapDiv);

    if (detailText) {
        const subDiv = document.createElement('div');
        subDiv.className = 'standings-laps-dnf';
        subDiv.textContent = detailText;
        rightDiv.appendChild(subDiv);
    }

    row.append(leftDiv, rightDiv);
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
    const labelSpan = document.createElement('span');
    labelSpan.textContent = label;
    const timeSpan = document.createElement('span');
    timeSpan.textContent = cutoffTimeText;
    divider.append(labelSpan, timeSpan);
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
 * Renders the Practice Classification rows into `#standings-list`.
 *
 * @param {HTMLElement} container - `#standings-list` container element.
 * @param {Array<Object>} classification - Practice session classification entries.
 * @returns {Array<{row: HTMLElement, driver: {code: string, team: string, color: string}}>} Mounted row bindings.
 */
function _renderPracticeStandingsRows(container, classification) {
    const rowBindings = [];
    classification.forEach((entry, index) => {
        const code = entry.driver;
        const compoundColor = _COMPOUND_COLORS[entry.compound] || _DEFAULT_COMPOUND_COLOR;
        const hasBestLap = Number.isFinite(entry.best_lap) && entry.best_lap > 0;
        const gapText = !hasBestLap
            ? 'NO TIME'
            : index === 0
              ? formatSessionDuration(entry.best_lap)
              : `+${Number(entry.gap_to_p1).toFixed(3)}s`;
        const detailText = `${entry.total_laps} Laps`;
        const driverObj = { code, team: entry.team, color: entry.color };
        const row = _createStandingsRowElement(driverObj, index, gapText, detailText, {
            color: compoundColor,
            title: entry.compound
        });
        container.appendChild(row);
        rowBindings.push({ row, driver: driverObj });
    });
    return rowBindings;
}

/**
 * Renders the Qualifying or Sprint Qualifying Classification rows and knockout cutoff dividers into `#standings-list`.
 *
 * @param {HTMLElement} container - `#standings-list` container element.
 * @param {Object} qualifyingData - Qualifying session data (`{ results, cutoffs, stage_prefix }`).
 * @param {string} activeSession - Active session identifier (`'qualifying'` or `'sprint_qualifying'`).
 * @returns {Array<{row: HTMLElement, driver: {code: string, team: string, color: string}}>} Mounted row bindings.
 */
function _renderQualifyingStandingsRows(container, qualifyingData, activeSession) {
    const rowBindings = [];
    const cutoffs = qualifyingData.cutoffs || {};
    const stagePrefix =
        qualifyingData.stage_prefix || (activeSession === 'sprint_qualifying' ? 'SQ' : 'Q');
    const results = qualifyingData.results;

    results.forEach((entry, index) => {
        const code = entry.driver;
        const hasBestTime = Number.isFinite(entry.best_time) && entry.best_time > 0;
        const gapHtml = !hasBestTime
            ? 'NO TIME'
            : index === 0
              ? formatSessionDuration(entry.best_time)
              : `+${Number(entry.gap_to_pole).toFixed(3)}s`;
        const detailHtml = hasBestTime
            ? `${entry.eliminated_in} · ${formatSessionDuration(entry.best_time)}`
            : `${entry.eliminated_in} · NO TIME`;
        const driverObj = { code, team: entry.team, color: entry.color };
        const row = _createStandingsRowElement(driverObj, index, gapHtml, detailHtml);
        container.appendChild(row);
        rowBindings.push({ row, driver: driverObj });

        if (index === _Q3_CUTOFF_INDEX && results.length > _Q3_TOP_COUNT) {
            container.appendChild(
                _createCutoffDividerElement(
                    `${stagePrefix}3 CUTOFF · TOP ${_Q3_TOP_COUNT}`,
                    formatSessionDuration(cutoffs.q3_cutoff_time || entry.best_time)
                )
            );
        } else if (index === _Q2_CUTOFF_INDEX && results.length > _Q2_TOP_COUNT) {
            container.appendChild(
                _createCutoffDividerElement(
                    `${stagePrefix}2 CUTOFF · TOP ${_Q2_TOP_COUNT}`,
                    formatSessionDuration(cutoffs.q2_cutoff_time || entry.best_time)
                )
            );
        }
    });

    return rowBindings;
}

/**
 * Renders the Race or Sprint Classification rows into `#standings-list`.
 *
 * @param {HTMLElement} container - `#standings-list` container element.
 * @param {Object} data - Enriched Grand Prix telemetry payload.
 * @returns {Array<{row: HTMLElement, driver: Object}>} Mounted row bindings.
 */
function _renderRaceStandingsRows(container, data) {
    const { validLaps, maxLap, classification } = calculateDriverClassification(data);
    if (validLaps.length === 0) {
        const emptyParagraph = document.createElement('p');
        emptyParagraph.style.color = 'var(--text-muted)';
        emptyParagraph.textContent = 'No classification data available.';
        container.replaceChildren(emptyParagraph);
        return [];
    }

    const rowBindings = [];
    const winnerTime = classification[0].lastLapTime;
    classification.forEach((driver, index) => {
        const { gapText, detailText } = _formatRaceGapAndDetail(driver, index, winnerTime, maxLap);
        const row = _createStandingsRowElement(driver, index, gapText, detailText);
        container.appendChild(row);
        rowBindings.push({ row, driver });
    });

    return rowBindings;
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
    container.replaceChildren();

    let rowBindings = [];

    if (activeSession === 'practice' && Array.isArray(data?.practice?.classification)) {
        rowBindings = _renderPracticeStandingsRows(container, data.practice.classification);
    } else if (
        (activeSession === 'qualifying' || activeSession === 'sprint_qualifying') &&
        Array.isArray(data?.qualifying?.results)
    ) {
        rowBindings = _renderQualifyingStandingsRows(container, data.qualifying, activeSession);
    } else {
        rowBindings = _renderRaceStandingsRows(container, data);
    }

    if (rowBindings.length > 0) {
        _bindStandingsRowInteractions(container, rowBindings, activeSession);
    }
}
