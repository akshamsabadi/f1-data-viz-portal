import { renderBeeswarm } from './beeswarm.js';
import { renderInterval } from './interval.js';
import { renderBump } from './bump.js';

const APP_VERSION = 'v1.9.0';
let currentData = null;

async function init() {
    try {
        const response = await fetch(`assets/data/races_manifest.json?v=${APP_VERSION}`);
        const manifest = await response.json();
        
        const selector = document.getElementById('race-selector');
        manifest.races.forEach(race => {
            const option = document.createElement('option');
            option.value = race.file;
            option.textContent = `${race.year} ${race.name}`;
            selector.appendChild(option);
        });

        selector.addEventListener('change', (e) => loadRace(e.target.value));

        if (manifest.races.length > 0) {
            loadRace(manifest.races[0].file);
        }
    } catch (e) {
        console.error("Failed to load manifest", e);
        document.getElementById('race-title').textContent = "Error loading data";
    }
}

async function loadRace(dataFile) {
    document.getElementById('race-title').textContent = "Loading...";
    try {
        const response = await fetch(`assets/data/${dataFile}?v=${APP_VERSION}`);
        currentData = await response.json();
        
        updateDashboardHeader(currentData);
        
        // Render visualizations
        renderBeeswarm(currentData);
        renderInterval(currentData);
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

document.addEventListener('DOMContentLoaded', init);