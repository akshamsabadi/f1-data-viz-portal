import { renderBeeswarm } from './beeswarm.js';
import { renderCornerSpeed } from './corner_speed.js';
import { renderBump } from './bump.js';

const APP_VERSION = 'v1.16.11';

const OFFICIAL_COLORS = {
    "Ferrari": "#e50004",
    "McLaren": "#fe7b00",
    "Mercedes": "#01e6c2",
    "Red Bull Racing": "#14127f",
    "Racing Bulls": "#4c68fe",
    "Alpine": "#fe7fcf",
    "Audi": "#ff3a28",
    "Haas F1 Team": "#fcffff",
    "Williams": "#0143ff",
    "Cadillac": "#272828",
    "Aston Martin": "#03604d"
};

let currentData = null;

async function init() {
    try {
        const response = await fetch(`src/assets/data/races_manifest.json?v=${APP_VERSION}`);
        const manifest = await response.json();
        
        const raceSelector = document.getElementById('race-selector');

        manifest.races.forEach((race) => {
            const option = document.createElement('option');
            option.value = race.file;
            option.textContent = `${race.year} ${race.name}`;
            raceSelector.appendChild(option);
        });

        raceSelector.addEventListener('change', (e) => {
            loadRace(e.target.value);
        });

        if (manifest.races.length > 0) {
            const latestRaceIndex = manifest.races.length - 1;
            const latestRace = manifest.races[latestRaceIndex];
            
            raceSelector.value = latestRace.file;
            loadRace(latestRace.file);
        }
    } catch (e) {
        console.error("Failed to load manifest", e);
        document.getElementById('race-title').textContent = "Error loading data";
    }
}

async function loadRace(dataFile) {
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
        
        // Render visualizations
        renderBeeswarm(currentData);
        renderCornerSpeed(currentData);
        renderBump(currentData);
        
    } catch (e) {
        console.error("Failed to load race data", e);
        document.getElementById('race-title').textContent = "Error loading race data";
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
const resizeObserver = new ResizeObserver(() => {
    if (!currentData) return;
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
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