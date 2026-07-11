import { renderBeeswarm } from './beeswarm.js';
import { renderCornerSpeed } from './corner_speed.js';
import { renderBump } from './bump.js';
import { renderStandings } from './standings.js';

const APP_VERSION = 'v1.16.24';

const OFFICIAL_COLORS = {
    "Ferrari": "#e30002",
    "McLaren": "#fe7b04",
    "Mercedes": "#00e3c0",
    "Red Bull Racing": "#141283",
    "Racing Bulls": "#4c68fe",
    "Alpine": "#ff7ed1",
    "Audi": "#ff3a28",
    "Haas F1 Team": "#fefefe",
    "Williams": "#0545ff",
    "Cadillac": "#282828",
    "Aston Martin": "#00644f"
};

let currentData = null;

async function init() {
    try {
        const response = await fetch(`src/assets/data/races_manifest.json?v=${APP_VERSION}`);
        const manifest = await response.json();
        
        const raceSelector = document.getElementById('race-selector');
        const customContainer = document.getElementById('custom-select-container');
        const customTrigger = document.getElementById('custom-select-trigger');
        const customLabel = document.getElementById('custom-select-label');
        const customOptionsContainer = document.getElementById('custom-select-options');

        // Populate Options
        manifest.races.forEach((race, index) => {
            // 1. Populate native hidden select for accessibility
            const option = document.createElement('option');
            option.value = race.file;
            option.textContent = `${race.year} ${race.name}`;
            raceSelector.appendChild(option);

            // 2. Populate custom glassmorphic options
            const customOption = document.createElement('div');
            customOption.className = 'custom-select-option';
            customOption.dataset.value = race.file;
            customOption.textContent = `${race.year} ${race.name}`;

            customOption.addEventListener('click', () => {
                // Remove selected class from others
                customOptionsContainer.querySelectorAll('.custom-select-option').forEach(el => el.classList.remove('selected'));
                // Add selected class to this option
                customOption.classList.add('selected');
                // Update trigger label
                customLabel.textContent = `${race.year} ${race.name}`;
                // Hide dropdown overlay
                customContainer.classList.remove('active');
                customOptionsContainer.classList.add('hidden');
                
                // Sync native select value & dispatch change event
                raceSelector.value = race.file;
                raceSelector.dispatchEvent(new Event('change'));
            });

            customOptionsContainer.appendChild(customOption);
        });

        // Trigger Click: Toggle Dropdown
        customTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            customContainer.classList.toggle('active');
            customOptionsContainer.classList.toggle('hidden');
        });

        // Global Click: Close Dropdown when clicking outside
        document.addEventListener('click', () => {
            customContainer.classList.remove('active');
            customOptionsContainer.classList.add('hidden');
        });

        // Native Select Change Event Listener
        raceSelector.addEventListener('change', (e) => {
            loadRace(e.target.value);
        });

        // Load Default Latest Race
        if (manifest.races.length > 0) {
            const latestRaceIndex = manifest.races.length - 1;
            const latestRace = manifest.races[latestRaceIndex];
            
            raceSelector.value = latestRace.file;
            
            // Set initial custom UI states
            customLabel.textContent = `${latestRace.year} ${latestRace.name}`;
            const customOptions = customOptionsContainer.querySelectorAll('.custom-select-option');
            if (customOptions[latestRaceIndex]) {
                customOptions[latestRaceIndex].classList.add('selected');
            }

            loadRace(latestRace.file);
        }
    } catch (e) {
        console.error("Failed to load manifest", e);
        document.getElementById('race-title').textContent = "Error loading data";
        const loader = document.getElementById('loader-overlay');
        if (loader) loader.classList.add('hidden');
    }
}

async function loadRace(dataFile) {
    const loader = document.getElementById('loader-overlay');
    if (loader) loader.classList.remove('hidden');

    document.getElementById('race-title').textContent = "Loading...";
    try {
        const response = await fetch(`src/assets/data/${dataFile}?v=${APP_VERSION}`);
        const rawData = await response.json();
        
        // Override team colors with new official hex colors
        if (rawData.drivers) {
            rawData.drivers.forEach(d => {
                if (OFFICIAL_COLORS[d.team]) {
                    d.color = OFFICIAL_COLORS[d.team];
                }
            });
        }
        if (rawData.corners) {
            rawData.corners.forEach(c => {
                if (OFFICIAL_COLORS[c.team]) {
                    c.color = OFFICIAL_COLORS[c.team];
                }
            });
        }
        
        currentData = rawData;
        updateDashboardHeader(currentData);
        
        // Render visualizations and sidebar standings
        renderBeeswarm(currentData);
        renderCornerSpeed(currentData);
        renderBump(currentData);
        renderStandings(currentData);
        
        const dashboard = document.querySelector('.dashboard');
        if (dashboard) {
            lastWidth = dashboard.clientWidth;
        }
        
        if (loader) loader.classList.add('hidden');
    } catch (e) {
        console.error("Failed to load race data", e);
        document.getElementById('race-title').textContent = "Error loading race data";
        if (loader) loader.classList.add('hidden');
    }
}

function updateDashboardHeader(data) {
    const { year, gp, total_laps, winner } = data.race_info;
    const winnerDriver = data.drivers.find(d => d.code === winner);
    const winnerColor = winnerDriver ? winnerDriver.color : 'var(--text-primary)';
    
    document.getElementById('race-title').textContent = `${year} ${gp}`;
    document.getElementById('race-stats').innerHTML = `Total Laps: ${total_laps} | Winner: <span style="color: ${winnerColor}; font-weight: bold;">${winner || 'N/A'}</span>`;
}

let resizeTimeout = null;
let lastWidth = 0;
const resizeObserver = new ResizeObserver((entries) => {
    if (!currentData || !entries[0]) return;
    const width = entries[0].contentRect.width;
    
    // Only trigger re-render if width change is significant (prevents scrollbar toggle loops)
    if (Math.abs(width - lastWidth) < 10) return;
    
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        lastWidth = width;
        renderBeeswarm(currentData);
        renderCornerSpeed(currentData);
        renderBump(currentData);
    }, 150);
});

document.addEventListener('DOMContentLoaded', () => {
    init();
    const dashboard = document.querySelector('.dashboard');
    if (dashboard) {
        resizeObserver.observe(dashboard);
    }
});