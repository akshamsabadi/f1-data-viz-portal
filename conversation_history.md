# F1 Data Viz Portal - Conversation History & Progress Report

**Date:** Tuesday, June 16, 2026  
**Current Version:** `v1.14.6`  
**Repository:** `akshamsabadi/f1-data-viz-portal`

---

## 1. Lap-Time Beeswarm Plot Overhaul (Complete)
We completed a series of interactive and aesthetic improvements to the Lap-Time Beeswarm chart.

### Features Implemented:
*   **Interactive Tyre Legend:** Added a minimalistic, clickable legend for tyre compounds (`SOFT`, `MEDIUM`, `HARD`, etc.) that filters/highlights corresponding laps.
*   **Driver Highlighting:** Clicking on any driver name on the X-axis fades out all other drivers to isolate their performance.
*   **Enhanced Median Pace Lines:** Added thick, highly visible horizontal median lines (`4px` thick with drop shadows and `opacity: 1`) drawn directly on top of the data points.
*   **No Zoom:** Removed D3 zoom per preferences, locking the chart to its crisp, default bounding box.
*   **Outlier Toggle:** Added a checkbox above the plot to easily show or hide outlier lap times (e.g., pit stops or VSC laps) without breaking the D3 physics engine.

---

## 2. Average Corner Speeds Chart Overhaul (In Progress)
We restructured the average corner speeds chart to handle high-volume overlapping data points.

### Refinements Implemented:
*   **Responsive Subplots:** Split the chart into three separate speed-based columns using a CSS Grid:
    *   **Slow Corners:** < 130 km/h
    *   **Medium Corners:** 130 - 200 km/h
    *   **Fast Corners:** > 200 km/h
*   **Strict Turn Gridline Locking:** Applied D3's `d.fy` (fixed Y coordinate) to strictly align all team data points to their specific horizontal turn line, completely eliminating vertical bleeding between turns.
*   **Padding & Axis Buffer:** Added a `10 km/h` boundary buffer on the X-axis domain to ensure that when points slide horizontally to avoid overlapping, they don't clip off the left/right boundaries of the chart.
*   **Aesthetic Circular Dots:** Redesigned data points to be uniform white circles (`radius: 14px`) with a dark border, ready to hold the official team emblems.

---

## 3. Custom SVG Logo Implementation (Pending User Push)
To guarantee 100% official, crisp, and CORS/rate-limit-free team logos, we agreed that the user will push their custom SVG files directly to GitHub under `src/assets/logos/`.

### Expected Filenames:
*   `mercedes.svg` (Mercedes star)
*   `mclaren.svg` (McLaren swoosh)
*   `ferrari.svg` (Ferrari shield)
*   `alpine.svg` (Alpine 'A')
*   `redbull.svg` (Red Bull bull/sun)
*   `rbf1.svg` (Racing Bulls bull)
*   `haas.svg` (Haas 'H')
*   `audi.svg` (Audi 4 rings)
*   `williams.svg` (Williams 'W')
*   `cadillac.svg` (Cadillac crest)
*   `astonmartin.svg` (Aston Martin wings)

---

## Next Steps
1.  **User:** Push the custom SVG files to your GitHub repository in the `src/assets/logos/` directory.
2.  **Gemini CLI:** 
    *   Pull the latest changes from your branch.
    *   Verify the local files are loading correctly.
    *   Bump the version to `v1.14.7` or `v1.15.0`.
