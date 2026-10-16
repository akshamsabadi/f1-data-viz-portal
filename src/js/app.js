import { renderBeeswarm } from './beeswarm.js';
import { renderCornerSpeed } from './corner_speed.js';
import { renderBump } from './bump.js';
import {
    renderStandings,
    calculateDriverClassification,
    formatSessionDuration
} from './standings.js';

const APP_VERSION = 'v1.16.30';

const _OFFICIAL_TEAM_COLORS = {
    'Ferrari': '#e30002',
    'McLaren': '#fe7b04',
    'Mercedes': '#00e3c0',
    'Red Bull Racing': '#3671c6',
    'Racing Bulls': '#6692ff',
    'Alpine': '#ff7ed1',
    'Audi': '#ff3a28',
    'Haas F1 Team': '#fefefe',
    'Williams': '#1868db',
    'Cadillac': '#9ca3af',
    'Aston Martin': '#229971'
};

const _RESIZE_THRESHOLD_PX = 10;
const _RESIZE_DEBOUNCE_MS = 150;

let _currentData = null;
let _resizeTimeout = null;
let _lastWidth = 0;

/**
 * Toggles the visibility of the telemetry loading overlay.
 *
 * @param {boolean} isVisible - Whether the loader overlay should be shown.
 * @returns {void}
 */
function _setLoaderVisibility(isVisible) {
    const loader = document.getElementById('loader-overlay');
    if (!loader) return;
    loader.classList.toggle('hidden', !isVisible);
}

/**
 * Formats the display title for a race session option.
 *
 * @param {{year: number, name: string, file: string}} race - Race manifest entry.
 * @returns {string} Formatted session label.
 */
function _formatRaceOptionLabel(race) {
    return `${race.year} ${race.name}`;
}

/**
 * Populates both the native `<select>` element and custom dropdown options.
 *
 * @param {Array<{year: number, name: string, file: string}>} races - List of race entries from the manifest.
 * @param {{
 *   raceSelector: HTMLSelectElement,
 *   customContainer: HTMLElement,
 *   customLabel: HTMLElement,
 *   customOptionsContainer: HTMLElement
 * }} elements - Dropdown DOM element references.
 * @returns {void}
 */
function _populateSessionOptions(races, elements) {
    const { raceSelector, customContainer, customLabel, customOptionsContainer } = elements;

    races.forEach((race) => {
        const label = _formatRaceOptionLabel(race);

        const nativeOption = document.createElement('option');
        nativeOption.value = race.file;
        nativeOption.textContent = label;
        raceSelector.appendChild(nativeOption);

        const customOption = document.createElement('div');
        customOption.className = 'custom-select-option';
        customOption.dataset.value = race.file;
        customOption.textContent = label;

        customOption.addEventListener('click', () => {
            customOptionsContainer
                .querySelectorAll('.custom-select-option')
                .forEach((el) => el.classList.remove('selected'));
            customOption.classList.add('selected');
            customLabel.textContent = label;
            customContainer.classList.remove('active');
            customOptionsContainer.classList.add('hidden');

            raceSelector.value = race.file;
            raceSelector.dispatchEvent(new Event('change'));
        });

        customOptionsContainer.appendChild(customOption);
    });
}

/**
 * Binds open/close and change listeners for the session selector dropdown.
 *
 * @param {{
 *   raceSelector: HTMLSelectElement,
 *   customContainer: HTMLElement,
 *   customTrigger: HTMLElement,
 *   customOptionsContainer: HTMLElement
 * }} elements - Dropdown DOM element references.
 * @returns {void}
 */
function _bindDropdownEvents(elements) {
    const { raceSelector, customContainer, customTrigger, customOptionsContainer } = elements;

    customTrigger.addEventListener('click', (event) => {
        event.stopPropagation();
        customContainer.classList.toggle('active');
        customOptionsContainer.classList.toggle('hidden');
    });

    document.addEventListener('click', () => {
        customContainer.classList.remove('active');
        customOptionsContainer.classList.add('hidden');
    });

    raceSelector.addEventListener('change', (event) => {
        _loadRace(event.target.value);
    });
}

/**
 * Selects and loads the most recent race in the manifest by default.
 *
 * @param {Array<{year: number, name: string, file: string}>} races - List of race entries from the manifest.
 * @param {{
 *   raceSelector: HTMLSelectElement,
 *   customLabel: HTMLElement,
 *   customOptionsContainer: HTMLElement
 * }} elements - Dropdown DOM element references.
 * @returns {void}
 */
function _selectInitialSession(races, elements) {
    if (!races || races.length === 0) return;

    const { raceSelector, customLabel, customOptionsContainer } = elements;
    const latestRaceIndex = races.length - 1;
    const latestRace = races[latestRaceIndex];

    raceSelector.value = latestRace.file;
    customLabel.textContent = _formatRaceOptionLabel(latestRace);

    const customOptions = customOptionsContainer.querySelectorAll('.custom-select-option');
    if (customOptions[latestRaceIndex]) {
        customOptions[latestRaceIndex].classList.add('selected');
    }

    _loadRace(latestRace.file);
}

/**
 * Overrides driver and corner color properties with high-contrast dark-mode broadcast hex colors.
 *
 * @param {Object} rawData - Parsed race telemetry payload.
 * @returns {void}
 */
function _applyOfficialTeamColors(rawData) {
    if (Array.isArray(rawData.drivers)) {
        rawData.drivers.forEach((driver) => {
            if (_OFFICIAL_TEAM_COLORS[driver.team]) {
                driver.color = _OFFICIAL_TEAM_COLORS[driver.team];
            }
        });
    }

    if (Array.isArray(rawData.corners)) {
        rawData.corners.forEach((corner) => {
            if (_OFFICIAL_TEAM_COLORS[corner.team]) {
                corner.color = _OFFICIAL_TEAM_COLORS[corner.team];
            }
        });
    }
}

/**
 * Finds the fastest valid non-interpolated lap across the race session.
 *
 * @param {Array<Object>} laps - Race lap records.
 * @returns {Object|null} Fastest lap object, or null if no valid laps exist.
 */
function _findFastestLap(laps) {
    if (!Array.isArray(laps) || laps.length === 0) return null;
    const candidates = laps.filter((lap) => lap.time > 0 && !lap.interpolated);
    const pool = candidates.length > 0 ? candidates : laps.filter((lap) => lap.time > 0);
    if (pool.length === 0) return null;
    return pool.reduce((best, current) => (current.time < best.time ? current : best), pool[0]);
}

/**
 * Creates a single telemetry KPI stat pill element for the dashboard header.
 *
 * @param {string} label - Uppercase KPI category title.
 * @param {string} primaryText - Primary headline metric value.
 * @param {string} subText - Secondary context subtitle.
 * @param {string} accentColor - Left-border accent color CSS value.
 * @returns {HTMLDivElement} Constructed `.kpi-pill` element.
 */
function _createKpiPill(label, primaryText, subText, accentColor) {
    const pill = document.createElement('div');
    pill.className = 'kpi-pill';
    pill.style.borderLeftColor = accentColor || 'var(--accent)';

    const labelEl = document.createElement('div');
    labelEl.className = 'kpi-label';
    labelEl.textContent = label;

    const valueEl = document.createElement('div');
    valueEl.className = 'kpi-value';
    valueEl.textContent = primaryText;

    const subEl = document.createElement('div');
    subEl.className = 'kpi-subvalue';
    subEl.textContent = subText;

    pill.appendChild(labelEl);
    pill.appendChild(valueEl);
    pill.appendChild(subEl);
    return pill;
}

/**
 * Updates the dashboard title and renders the 4 F1 telemetry KPI pills.
 *
 * @param {Object} data - Race telemetry payload containing `race_info`, `drivers`, and `laps`.
 * @returns {void}
 */
function _updateDashboardHeader(data) {
    const { year, gp, total_laps: totalLaps, winner } = data.race_info;
    document.getElementById('race-title').textContent = `${year} ${gp}`;

    const raceStatsEl = document.getElementById('race-stats');
    raceStatsEl.innerHTML = '';

    const { classification } = calculateDriverClassification(data);
    const driverByCode = new Map((data.drivers || []).map((d) => [d.code, d]));

    const winnerEntry = classification[0] || driverByCode.get(winner);
    const winnerColor = winnerEntry?.color || 'var(--accent)';
    const winnerName = winnerEntry ? `${winnerEntry.code} • ${winnerEntry.name}` : winner || 'N/A';
    const winnerSubtext =
        winnerEntry && Number.isFinite(winnerEntry.lastLapTime)
            ? `${winnerEntry.team} (${formatSessionDuration(winnerEntry.lastLapTime)})`
            : 'Session Winner';

    const fastestLap = _findFastestLap(data.laps);
    const fastestDriver = fastestLap ? driverByCode.get(fastestLap.driver) : null;
    const fastestValue = fastestLap
        ? `${fastestLap.driver} • ${formatSessionDuration(fastestLap.time)}`
        : 'N/A';
    const fastestSubtext = fastestLap
        ? `Lap ${fastestLap.lap} • ${fastestLap.compound || 'UNKNOWN'}`
        : 'No lap time recorded';
    const fastestColor = fastestDriver?.color || '#a855f7';

    const totalDrivers = (data.drivers || []).length;
    const dnfCount = classification.filter((d) => d.isDnf).length;
    const dnsCount = classification.filter((d) => d.isDns).length;
    const finishersCount = Math.max(0, totalDrivers - dnfCount - dnsCount);
    const retirementParts = [];
    if (dnfCount > 0) retirementParts.push(`${dnfCount} DNF`);
    if (dnsCount > 0) retirementParts.push(`${dnsCount} DNS`);
    const classificationSubtext =
        retirementParts.length > 0 ? retirementParts.join(' • ') : 'All Starters Classified';

    const compoundsUsed = Array.from(
        new Set((data.laps || []).map((l) => (l.compound || 'UNKNOWN').toUpperCase()))
    ).filter((c) => c !== 'UNKNOWN');

    raceStatsEl.appendChild(_createKpiPill('Race Winner', winnerName, winnerSubtext, winnerColor));
    raceStatsEl.appendChild(
        _createKpiPill('Fastest Lap', fastestValue, fastestSubtext, fastestColor)
    );
    raceStatsEl.appendChild(
        _createKpiPill(
            'Race Distance',
            `${totalLaps} Laps`,
            compoundsUsed.length > 0 ? `Compounds: ${compoundsUsed.join(', ')}` : 'Grand Prix Session',
            'var(--accent)'
        )
    );
    raceStatsEl.appendChild(
        _createKpiPill(
            'Classification',
            `${finishersCount} / ${totalDrivers} Classified`,
            classificationSubtext,
            '#22c55e'
        )
    );
}

/**
 * Renders all primary telemetry charts for the active dataset.
 *
 * @param {Object} data - Race telemetry payload.
 * @returns {void}
 */
function _renderPrimaryCharts(data) {
    renderBeeswarm(data);
    renderCornerSpeed(data);
    renderBump(data);
}

/**
 * Fetches a specific race dataset, applies team branding, and renders all views.
 *
 * @param {string} dataFile - Filename of the race JSON payload to load.
 * @returns {Promise<void>}
 */
async function _loadRace(dataFile) {
    _setLoaderVisibility(true);
    document.getElementById('race-title').textContent = 'Loading...';

    try {
        const response = await fetch(`src/assets/data/${dataFile}?v=${APP_VERSION}`);
        const rawData = await response.json();

        _applyOfficialTeamColors(rawData);
        _currentData = rawData;
        _updateDashboardHeader(_currentData);

        _renderPrimaryCharts(_currentData);
        renderStandings(_currentData);

        const dashboard = document.querySelector('.dashboard');
        if (dashboard) {
            _lastWidth = dashboard.clientWidth;
        }
    } catch (error) {
        console.error('Failed to load race data', error);
        document.getElementById('race-title').textContent = 'Error loading race data';
    } finally {
        _setLoaderVisibility(false);
    }
}

/**
 * Initializes the application by fetching the race manifest and setting up controls.
 *
 * @returns {Promise<void>}
 */
async function _init() {
    try {
        const response = await fetch(`src/assets/data/races_manifest.json?v=${APP_VERSION}`);
        const manifest = await response.json();

        const dropdownElements = {
            raceSelector: document.getElementById('race-selector'),
            customContainer: document.getElementById('custom-select-container'),
            customTrigger: document.getElementById('custom-select-trigger'),
            customLabel: document.getElementById('custom-select-label'),
            customOptionsContainer: document.getElementById('custom-select-options')
        };

        _populateSessionOptions(manifest.races, dropdownElements);
        _bindDropdownEvents(dropdownElements);
        _selectInitialSession(manifest.races, dropdownElements);
    } catch (error) {
        console.error('Failed to load manifest', error);
        document.getElementById('race-title').textContent = 'Error loading data';
        _setLoaderVisibility(false);
    }
}

const _resizeObserver = new ResizeObserver((entries) => {
    if (!_currentData || !entries[0]) return;
    const width = entries[0].contentRect.width;

    if (Math.abs(width - _lastWidth) < _RESIZE_THRESHOLD_PX) return;

    clearTimeout(_resizeTimeout);
    _resizeTimeout = setTimeout(() => {
        _lastWidth = width;
        _renderPrimaryCharts(_currentData);
    }, _RESIZE_DEBOUNCE_MS);
});

document.addEventListener('DOMContentLoaded', () => {
    _init();
    const dashboard = document.querySelector('.dashboard');
    if (dashboard) {
        _resizeObserver.observe(dashboard);
    }
});
