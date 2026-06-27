import { renderBeeswarm } from './beeswarm.js';
import { renderCornerSpeed } from './corner_speed.js';
import { renderBump } from './bump.js';

const APP_VERSION = 'v1.16.7';
let currentData = null;

async function init() {
    try {
        const response = await fetch(`assets/data/races_manifest.json?v=${APP_VERSION}`);
        const manifest = await response.json();
        
        const dropdownMenu = document.getElementById('dropdown-options');
        const dropdownTrigger = document.getElementById('dropdown-btn');
        const customDropdown = document.getElementById('gp-dropdown');

        manifest.races.forEach((race, index) => {
            const item = document.createElement('div');
            item.className = 'dropdown-item';
            item.dataset.value = race.file;
            item.textContent = `${race.year} ${race.name}`;
            
            item.addEventListener('click', () => {
                dropdownMenu.querySelectorAll('.dropdown-item').forEach(el => el.classList.remove('selected'));
                item.classList.add('selected');
                dropdownTrigger.textContent = `${race.year} ${race.name}`;
                customDropdown.classList.remove('active');
                loadRace(race.file);
            });
            
            dropdownMenu.appendChild(item);
        });

        dropdownTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            customDropdown.classList.toggle('active');
        });

        document.addEventListener('click', () => {
            customDropdown.classList.remove('active');
        });

        if (manifest.races.length > 0) {
            const latestRaceIndex = manifest.races.length - 1;
            const latestRace = manifest.races[latestRaceIndex];
            
            dropdownTrigger.textContent = `${latestRace.year} ${latestRace.name}`;
            const items = dropdownMenu.querySelectorAll('.dropdown-item');
            if (items[latestRaceIndex]) {
                items[latestRaceIndex].classList.add('selected');
            }
            
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
        const response = await fetch(`assets/data/${dataFile}?v=${APP_VERSION}`);
        currentData = await response.json();
        
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