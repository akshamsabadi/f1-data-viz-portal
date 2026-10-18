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
import { renderRaceScrubber, stopRaceScrubberPlayback } from './race_scrubber.js';

const APP_VERSION = 'v1.18.11';

const _DEFAULT_SESSION = 'race';
const _PANEL_KEYS = ['practice', 'qualifying', 'race'];
const _SPRINT_SESSION_KEYS = new Set(['sprint_qualifying', 'sprint']);
const _MANIFEST_PATH = 'src/assets/data/races_manifest.json';
const _DATA_BASE_DIR = 'src/assets/data';
const _SPRINT_PROGRESSION_TITLE = 'SQ1 / SQ2 / SQ3 Knockout Progression';
const _QUALI_PROGRESSION_TITLE = 'Q1 / Q2 / Q3 Knockout Progression';

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

const _VALID_SESSIONS = ['practice', 'sprint_qualifying', 'sprint', 'qualifying', 'race'];

const _SESSION_EYEBROWS = {
    practice: '// PRACTICE TELEMETRY · FP1–FP3 PROGRAMME',
    sprint_qualifying: '// SPRINT QUALIFYING TELEMETRY · SQ1 / SQ2 / SQ3 SHOOTOUT',
    sprint: '// SPRINT RACE TELEMETRY · SHORT-FORMAT SPRINT',
    qualifying: '// QUALIFYING TELEMETRY · Q1 / Q2 / Q3 SHOOTOUT',
    race: '// GRAND PRIX RACE TELEMETRY'
};

const _RESIZE_THRESHOLD_PX = 10;
const _RESIZE_DEBOUNCE_MS = 150;

let _currentData = null;
let _activeSession = _DEFAULT_SESSION;
let _resizeTimeout = null;
let _lastWidth = 0;

/**
 * Checks whether a session key corresponds to a Sprint weekend session (`sprint_qualifying` or `sprint`).
 *
 * @param {string} sessionKey - Session identifier.
 * @returns {boolean} True when the session is a Sprint session.
 */
function _isSprintSession(sessionKey) {
    return _SPRINT_SESSION_KEYS.has(sessionKey);
}

/**
 * Checks whether a Grand Prix payload contains Sprint weekend telemetry.
 *
 * @param {Object|null} grandPrixData - Enriched Grand Prix payload.
 * @returns {boolean} True when Sprint tabs should be enabled.
 */
function _hasSprintSessions(grandPrixData) {
    return Boolean(
        grandPrixData &&
            (grandPrixData.is_sprint_weekend ||
                grandPrixData.sprint_qualifying ||
                grandPrixData.sprint)
    );
}

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
 * Maps an active session identifier (`practice`, `sprint_qualifying`, `sprint`, `qualifying`, `race`)
 * to its corresponding DOM tab panel key (`practice`, `qualifying`, `race`).
 *
 * @param {string} sessionKey - Active session identifier.
 * @returns {'practice'|'qualifying'|'race'} Panel key.
 */
function _resolvePanelKeyForSession(sessionKey) {
    if (sessionKey === 'practice') return 'practice';
    if (sessionKey === 'qualifying' || sessionKey === 'sprint_qualifying') return 'qualifying';
    return 'race';
}

/**
 * Synchronizes the Session tab bar buttons, accessible `<select>`, panel visibility, and eyebrow text.
 *
 * @param {string} sessionKey - Session identifier to activate.
 * @returns {void}
 */
function _syncSessionTabUI(sessionKey) {
    const sessionTabsContainer = document.getElementById('session-tabs');
    const sessionSelector = document.getElementById('session-selector');
    if (sessionTabsContainer) {
        sessionTabsContainer.querySelectorAll('.session-tab').forEach((btn) => {
            const isMatch = btn.dataset.session === sessionKey;
            btn.classList.toggle('active', isMatch);
            btn.setAttribute('aria-selected', isMatch ? 'true' : 'false');
        });
    }

    if (sessionSelector && sessionSelector.value !== sessionKey) {
        sessionSelector.value = sessionKey;
    }

    const activePanelKey = _resolvePanelKeyForSession(sessionKey);
    _PANEL_KEYS.forEach((panelKey) => {
        const panel = document.getElementById(`tab-panel-${panelKey}`);
        if (panel) {
            panel.classList.toggle('hidden', panelKey !== activePanelKey);
        }
    });

    const progTitleEl = document.getElementById('quali-progression-title');
    if (progTitleEl) {
        progTitleEl.textContent =
            sessionKey === 'sprint_qualifying'
                ? _SPRINT_PROGRESSION_TITLE
                : _QUALI_PROGRESSION_TITLE;
    }

    const eyebrowEl = document.getElementById('session-eyebrow');
    if (eyebrowEl) {
        eyebrowEl.textContent = _SESSION_EYEBROWS[sessionKey] || _SESSION_EYEBROWS.race;
    }

    const tooltip = document.getElementById('tooltip');
    if (tooltip) {
        tooltip.classList.add('hidden');
    }
}

/**
 * Updates visibility of Sprint Qualifying (`SQ`) and Sprint (`SPR`) tabs based on whether
 * the selected Grand Prix is a Sprint weekend.
 *
 * @param {Object} data - Enriched Grand Prix payload.
 * @returns {void}
 */
function _updateSprintTabsAvailability(data) {
    const isSprintWeekend = _hasSprintSessions(data);
    document.querySelectorAll('.sprint-only-tab').forEach((btn) => {
        btn.classList.toggle('hidden', !isSprintWeekend);
    });

    const sessionSelector = document.getElementById('session-selector');
    if (sessionSelector) {
        Array.from(sessionSelector.options).forEach((opt) => {
            if (_isSprintSession(opt.value)) {
                opt.disabled = !isSprintWeekend;
                opt.hidden = !isSprintWeekend;
            }
        });
    }

    if (!isSprintWeekend && _isSprintSession(_activeSession)) {
        _activeSession = _DEFAULT_SESSION;
    }
}

/**
 * Binds click and change listeners for the Select Session tab bar
 * and its synchronized accessible `<select id="session-selector">`.
 *
 * @returns {void}
 */
function _bindSessionTabEvents() {
    const sessionTabsContainer = document.getElementById('session-tabs');
    const sessionSelector = document.getElementById('session-selector');
    if (!sessionTabsContainer) return;

    const activateSession = (sessionKey) => {
        if (!sessionKey || !_VALID_SESSIONS.includes(sessionKey)) return;
        stopRaceScrubberPlayback();
        _activeSession = sessionKey;
        _syncSessionTabUI(_activeSession);

        if (_currentData) {
            broadcastDashboardFocus(null, _activeSession);
            _renderActiveSession(_currentData, _activeSession);
        }
    };

    sessionTabsContainer.querySelectorAll('.session-tab').forEach((btn) => {
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
    if (urlSession && _VALID_SESSIONS.includes(urlSession.toLowerCase())) {
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

    ['qualifying', 'sprint_qualifying'].forEach((qKey) => {
        if (rawData[qKey]) {
            (rawData[qKey].results || []).forEach(applyTeamColor);
            (rawData[qKey].teammate_deltas || []).forEach(applyTeamColor);
            (rawData[qKey].corners || []).forEach(applyTeamColor);
        }
    });

    if (rawData.race_telemetry) {
        (rawData.race_telemetry.stints || []).forEach(applyTeamColor);
        (rawData.race_telemetry.pit_stops || []).forEach(applyTeamColor);
    }

    if (rawData.sprint && rawData.sprint.race_telemetry) {
        (rawData.sprint.race_telemetry.stints || []).forEach(applyTeamColor);
        (rawData.sprint.race_telemetry.pit_stops || []).forEach(applyTeamColor);
    }
}

/**
 * Builds a session-scoped data view for `sprint_qualifying` or `sprint` so all Qualifying
 * and Race chart modules can render Sprint sessions seamlessly.
 *
 * @param {Object} data - Full Grand Prix payload.
 * @param {string} activeSession - Active session identifier.
 * @returns {Object} Session-scoped telemetry object.
 */
function _resolveSessionViewData(data, activeSession) {
    if (activeSession === 'sprint_qualifying' && data.sprint_qualifying) {
        return {
            ...data,
            qualifying: data.sprint_qualifying,
            corners: data.sprint_qualifying.corners || data.corners || []
        };
    }

    if (activeSession === 'sprint' && data.sprint) {
        return {
            ...data,
            qualifying: data.sprint_qualifying || data.qualifying,
            race_info: {
                ...data.race_info,
                total_laps: data.sprint.total_laps || data.race_info.total_laps,
                winner: data.sprint.winner || data.race_info.winner
            },
            laps: data.sprint.laps || data.laps,
            race_telemetry: data.sprint.race_telemetry || data.race_telemetry
        };
    }

    return data;
}

/**
 * Updates the dashboard header title and eyebrow for the selected Grand Prix and session.
 *
 * @param {Object} data - Grand Prix telemetry payload containing `race_info`.
 * @param {string} activeSession - Active session key.
 * @returns {void}
 */
function _updateDashboardHeader(data, activeSession) {
    const { year, gp } = data.race_info;
    document.getElementById('race-title').textContent = `${year} ${gp}`;
    _syncSessionTabUI(activeSession);
}

/**
 * Renders only the primary telemetry visualizations belonging to the currently active session tab.
 *
 * @param {Object} data - Enriched Grand Prix telemetry payload.
 * @param {string} activeSession - Active session tab.
 * @returns {void}
 */
function _renderSessionCharts(data, activeSession) {
    const viewData = _resolveSessionViewData(data, activeSession);

    if (activeSession === 'practice') {
        renderPracticeDegradation(viewData);
        renderPracticeAero(viewData);
        renderPracticeLongRun(viewData);
        renderPracticeProgramme(viewData);
        return;
    }

    if (activeSession === 'qualifying' || activeSession === 'sprint_qualifying') {
        renderQualiTrace(viewData);
        renderQualiProgression(viewData);
        renderQualiTeammate(viewData);
        renderQualiSectors(viewData);
        renderCornerSpeed({
            ...viewData,
            corners: (viewData.qualifying && viewData.qualifying.corners) || viewData.corners || []
        });
        return;
    }

    renderRaceScrubber(viewData);
    renderBeeswarm(viewData);
    renderRaceStrategy(viewData);
    renderRaceWorm(viewData);
    renderBump(viewData);
    renderRacePitStops(viewData);
    renderRaceStintPace(viewData);
}

/**
 * Renders both the active session's telemetry charts and the right-hand Session Classification sidebar.
 *
 * @param {Object} data - Enriched Grand Prix telemetry payload.
 * @param {string} activeSession - Active session tab.
 * @returns {void}
 */
function _renderActiveSession(data, activeSession) {
    const viewData = _resolveSessionViewData(data, activeSession);
    _renderSessionCharts(data, activeSession);
    renderStandings(viewData, activeSession);
}

/**
 * Fetches a specific Grand Prix dataset, applies team branding, and renders the active session view.
 *
 * @param {string} dataFile - Filename of the Grand Prix JSON payload to load.
 * @returns {Promise<void>}
 */
async function _loadGrandPrix(dataFile) {
    stopRaceScrubberPlayback();
    _setLoaderVisibility(true);
    document.getElementById('race-title').textContent = 'Loading...';

    try {
        const response = await fetch(`${_DATA_BASE_DIR}/${dataFile}?v=${APP_VERSION}`);
        const rawData = await response.json();

        _applyOfficialTeamColors(rawData);
        _currentData = rawData;
        _updateSprintTabsAvailability(_currentData);
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
        const response = await fetch(`${_MANIFEST_PATH}?v=${APP_VERSION}`);
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
