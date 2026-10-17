import { renderBeeswarm } from './beeswarm.js';
import { renderCornerSpeed } from './corner_speed.js';
import { renderBump } from './bump.js';
import { renderStandings, broadcastDashboardFocus } from './standings.js';
import { renderPracticeDegradation } from './practice_degradation.js';
import { renderPracticeAero } from './practice_aero.js';
import { renderPracticeLongRun } from './practice_longrun.js';
import { renderPracticeProgramme } from './practice_programme.js';
import { renderQualiTrace } from './quali_trace.js';
import { renderQualiProgression } from './quali_progression.js';
import { renderQualiTeammate } from './quali_teammate.js';
import { renderQualiSectors } from './quali_sectors.js';
import { renderRaceStrategy } from './race_strategy.js';
import { renderRaceWorm } from './race_worm.js';
import { renderRacePitStops } from './race_pitstops.js';
import { renderRaceStintPace } from './race_stint_pace.js';

const APP_VERSION = 'v1.18.0';

const _OFFICIAL_TEAM_COLORS = {
    'Ferrari': '#e30002',
    'McLaren': '#fe7b04',
    'Mercedes': '#00e3c0',
    'Red Bull Racing': '#3671c6',
    'Red Bull': '#3671c6',
    'Racing Bulls': '#6692ff',
    'RB': '#6692ff',
    'Alpine': '#ff7ed1',
    'Audi': '#ff3a28',
    'Haas F1 Team': '#fefefe',
    'Haas': '#fefefe',
    'Williams': '#1868db',
    'Cadillac': '#9ca3af',
    'Aston Martin': '#229971'
};

const _SESSION_EYEBROWS = {
    practice: '// PRACTICE TELEMETRY · FP1–FP3 PROGRAMME',
    qualifying: '// QUALIFYING TELEMETRY · Q1 / Q2 / Q3 SHOOTOUT',
    race: '// GRAND PRIX RACE TELEMETRY'
};

const _RESIZE_THRESHOLD_PX = 10;
const _RESIZE_DEBOUNCE_MS = 150;

let _currentData = null;
let _activeSession = 'race';
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
 * Formats the display title for a Grand Prix option.
 *
 * @param {{year: number, name: string, file: string}} race - Race manifest entry.
 * @returns {string} Formatted Grand Prix label.
 */
function _formatRaceOptionLabel(race) {
    return `${race.year} ${race.name}`;
}

/**
 * Populates both the native `<select>` element and custom Grand Prix dropdown options.
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
function _populateGrandPrixOptions(races, elements) {
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
 * Binds open/close and change listeners for the Grand Prix selector dropdown.
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
        _loadGrandPrix(event.target.value);
    });
}

/**
 * Binds click and change listeners for the Select Session tab bar (`Practice`, `Qualifying`, `Race`)
 * and its synchronized accessible `<select id="session-selector">`.
 *
 * @returns {void}
 */
function _bindSessionTabEvents() {
    const sessionTabsContainer = document.getElementById('session-tabs');
    const sessionSelector = document.getElementById('session-selector');
    if (!sessionTabsContainer) return;

    const tabButtons = Array.from(sessionTabsContainer.querySelectorAll('.session-tab'));

    const activateSession = (sessionKey) => {
        if (!sessionKey || !['practice', 'qualifying', 'race'].includes(sessionKey)) return;
        _activeSession = sessionKey;

        tabButtons.forEach((btn) => {
            const isMatch = btn.dataset.session === sessionKey;
            btn.classList.toggle('active', isMatch);
            btn.setAttribute('aria-selected', isMatch ? 'true' : 'false');
        });

        if (sessionSelector && sessionSelector.value !== sessionKey) {
            sessionSelector.value = sessionKey;
        }

        ['practice', 'qualifying', 'race'].forEach((panelKey) => {
            const panel = document.getElementById(`tab-panel-${panelKey}`);
            if (panel) {
                panel.classList.toggle('hidden', panelKey !== sessionKey);
            }
        });

        const eyebrowEl = document.getElementById('session-eyebrow');
        if (eyebrowEl) {
            eyebrowEl.textContent = _SESSION_EYEBROWS[sessionKey] || _SESSION_EYEBROWS.race;
        }

        const tooltip = document.getElementById('tooltip');
        if (tooltip) {
            tooltip.classList.add('hidden');
        }

        if (_currentData) {
            broadcastDashboardFocus(null, _activeSession);
            _renderActiveSession(_currentData, _activeSession);
        }
    };

    tabButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            activateSession(btn.dataset.session);
        });
    });

    if (sessionSelector) {
        sessionSelector.addEventListener('change', (event) => {
            activateSession(event.target.value);
        });
    }

    const urlSession = new URLSearchParams(window.location.search).get('session');
    if (urlSession && ['practice', 'qualifying', 'race'].includes(urlSession.toLowerCase())) {
        activateSession(urlSession.toLowerCase());
    }
}

/**
 * Selects and loads the most recent Grand Prix in the manifest by default.
 *
 * @param {Array<{year: number, name: string, file: string}>} races - List of race entries from the manifest.
 * @param {{
 *   raceSelector: HTMLSelectElement,
 *   customLabel: HTMLElement,
 *   customOptionsContainer: HTMLElement
 * }} elements - Dropdown DOM element references.
 * @returns {void}
 */
function _selectInitialGrandPrix(races, elements) {
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

    _loadGrandPrix(latestRace.file);
}

/**
 * Overrides driver and constructor color properties across all session blocks with
 * high-contrast dark-mode broadcast hex colors.
 *
 * @param {Object} rawData - Parsed Grand Prix telemetry payload.
 * @returns {void}
 */
function _applyOfficialTeamColors(rawData) {
    const applyTeamColor = (item) => {
        if (item && item.team && _OFFICIAL_TEAM_COLORS[item.team]) {
            item.color = _OFFICIAL_TEAM_COLORS[item.team];
        }
    };

    (rawData.drivers || []).forEach(applyTeamColor);
    (rawData.corners || []).forEach(applyTeamColor);

    if (rawData.practice) {
        (rawData.practice.classification || []).forEach(applyTeamColor);
        (rawData.practice.stint_laps || []).forEach(applyTeamColor);
    }

    if (rawData.qualifying) {
        (rawData.qualifying.results || []).forEach(applyTeamColor);
        (rawData.qualifying.teammate_deltas || []).forEach(applyTeamColor);
        (rawData.qualifying.corners || []).forEach(applyTeamColor);
    }

    if (rawData.race_telemetry) {
        (rawData.race_telemetry.stints || []).forEach(applyTeamColor);
        (rawData.race_telemetry.pit_stops || []).forEach(applyTeamColor);
    }
}

/**
 * Updates the dashboard header title and eyebrow for the selected Grand Prix and session.
 *
 * @param {Object} data - Grand Prix telemetry payload containing `race_info`.
 * @param {string} activeSession - Active session key (`'practice'`, `'qualifying'`, or `'race'`).
 * @returns {void}
 */
function _updateDashboardHeader(data, activeSession) {
    const { year, gp } = data.race_info;
    document.getElementById('race-title').textContent = `${year} ${gp}`;
    const eyebrowEl = document.getElementById('session-eyebrow');
    if (eyebrowEl) {
        eyebrowEl.textContent = _SESSION_EYEBROWS[activeSession] || _SESSION_EYEBROWS.race;
    }
}

/**
 * Renders only the primary telemetry visualizations belonging to the currently active session tab.
 *
 * @param {Object} data - Enriched Grand Prix telemetry payload.
 * @param {string} activeSession - Active session tab (`'practice'`, `'qualifying'`, or `'race'`).
 * @returns {void}
 */
function _renderSessionCharts(data, activeSession) {
    if (activeSession === 'practice') {
        renderPracticeDegradation(data);
        renderPracticeAero(data);
        renderPracticeLongRun(data);
        renderPracticeProgramme(data);
        return;
    }

    if (activeSession === 'qualifying') {
        renderQualiTrace(data);
        renderQualiProgression(data);
        renderQualiTeammate(data);
        renderQualiSectors(data);
        renderCornerSpeed({
            ...data,
            corners: (data.qualifying && data.qualifying.corners) || data.corners || []
        });
        return;
    }

    renderBeeswarm(data);
    renderRaceStrategy(data);
    renderRaceWorm(data);
    renderBump(data);
    renderRacePitStops(data);
    renderRaceStintPace(data);
}

/**
 * Renders both the active session's telemetry charts and the right-hand Session Classification sidebar.
 *
 * @param {Object} data - Enriched Grand Prix telemetry payload.
 * @param {string} activeSession - Active session tab (`'practice'`, `'qualifying'`, or `'race'`).
 * @returns {void}
 */
function _renderActiveSession(data, activeSession) {
    _renderSessionCharts(data, activeSession);
    renderStandings(data, activeSession);
}

/**
 * Fetches a specific Grand Prix dataset, applies team branding, and renders the active session view.
 *
 * @param {string} dataFile - Filename of the Grand Prix JSON payload to load.
 * @returns {Promise<void>}
 */
async function _loadGrandPrix(dataFile) {
    _setLoaderVisibility(true);
    document.getElementById('race-title').textContent = 'Loading...';

    try {
        const response = await fetch(`src/assets/data/${dataFile}?v=${APP_VERSION}`);
        const rawData = await response.json();

        _applyOfficialTeamColors(rawData);
        _currentData = rawData;
        _updateDashboardHeader(_currentData, _activeSession);

        _renderActiveSession(_currentData, _activeSession);

        const dashboard = document.querySelector('.dashboard');
        if (dashboard) {
            _lastWidth = dashboard.clientWidth;
        }
    } catch (error) {
        console.error('Failed to load Grand Prix data', error);
        document.getElementById('race-title').textContent = 'Error loading Grand Prix data';
    } finally {
        _setLoaderVisibility(false);
    }
}

/**
 * Initializes the application by fetching the Grand Prix manifest and binding dropdown & session tab controls.
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

        _populateGrandPrixOptions(manifest.races, dropdownElements);
        _bindDropdownEvents(dropdownElements);
        _bindSessionTabEvents();
        _selectInitialGrandPrix(manifest.races, dropdownElements);
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
        _renderSessionCharts(_currentData, _activeSession);
    }, _RESIZE_DEBOUNCE_MS);
});

document.addEventListener('DOMContentLoaded', () => {
    _init();
    const dashboard = document.querySelector('.dashboard');
    if (dashboard) {
        _resizeObserver.observe(dashboard);
    }
});
