export function renderStandings(data) {
    const container = document.getElementById('standings-list');
    if (!container) return;
    container.innerHTML = '';

    const validLaps = data.laps.filter(d => d.position !== null);
    if (!validLaps || validLaps.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); font-size: 0.8rem; text-align: center; padding: 1rem 0; text-transform: uppercase; font-family: Montserrat;">No classification available.</p>';
        return;
    }

    const maxLap = d3.max(validLaps, d => d.lap);
    const maxSessionTime = d3.max(validLaps, d => d.session_time);
    const driverLapsMap = d3.group(validLaps, d => d.driver);

    // 1. Calculate classification
    const classification = data.drivers.map(driver => {
        const laps = driverLapsMap.get(driver.code) || [];
        const lapsCompleted = laps.length;
        const lastLapRecord = lapsCompleted > 0 ? laps[lapsCompleted - 1] : null;
        const lastLapTime = lastLapRecord ? lastLapRecord.session_time : Infinity;
        
        // Statuses
        let status = "FINISHER";
        if (lapsCompleted === 0) {
            status = "DNS";
        } else if ((maxLap - lastLapRecord.lap > 0) && (maxSessionTime - lastLapTime > 180)) {
            status = "DNF";
        } else if (lapsCompleted < maxLap) {
            status = "LAPPED";
        }

        return {
            ...driver,
            lapsCompleted,
            lastLapTime,
            status
        };
    });

    // Sort classification: most laps completed first, then DNS at bottom, then faster last lap time
    classification.sort((a, b) => {
        if (b.lapsCompleted !== a.lapsCompleted) {
            return b.lapsCompleted - a.lapsCompleted;
        }
        if (a.status === "DNS") return 1;
        if (b.status === "DNS") return -1;
        return a.lastLapTime - b.lastLapTime;
    });

    const winnerTime = classification[0].lastLapTime;

    // Render rows
    classification.forEach((driver, index) => {
        const row = document.createElement('div');
        row.className = 'standings-row';

        // Format Gap/Time
        let gapText = "";
        let detailText = `Laps: ${driver.lapsCompleted}`;

        if (driver.status === "DNS") {
            gapText = "DNS";
            detailText = "Did Not Start";
        } else if (driver.status === "DNF") {
            gapText = "DNF";
            detailText = `Retired - Lap ${driver.lapsCompleted}`;
        } else if (index === 0) {
            // Format winner total time: hh:mm:ss.sss
            const hrs = Math.floor(winnerTime / 3600);
            const mins = Math.floor((winnerTime % 3600) / 60);
            const secs = (winnerTime % 60).toFixed(3);
            gapText = hrs > 0 
                ? `${hrs}:${mins.toString().padStart(2, '0')}:${secs.padStart(6, '0')}`
                : `${mins}:${secs.padStart(6, '0')}`;
            detailText = "Winner";
        } else if (driver.status === "LAPPED") {
            const lapsBehind = maxLap - driver.lapsCompleted;
            gapText = `+${lapsBehind} ${lapsBehind === 1 ? 'Lap' : 'Laps'}`;
        } else {
            const gap = driver.lastLapTime - winnerTime;
            gapText = `+${gap.toFixed(3)}s`;
        }

        row.innerHTML = `
            <div class="standings-row-left">
                <div class="standings-pos">P${index + 1}</div>
                <div class="standings-color-bar" style="background-color: ${driver.color}"></div>
                <div class="standings-driver-info">
                    <span class="standings-code-team">${driver.code} <span style="font-size: 0.75rem; font-weight: normal; color: var(--text-muted); font-family: 'Titillium Web', sans-serif;">${driver.name}</span></span>
                    <span class="standings-team-name">${driver.team}</span>
                </div>
            </div>
            <div class="standings-row-right">
                <div class="standings-gap">${gapText}</div>
                <div class="standings-laps-dnf">${detailText}</div>
            </div>
        `;

        // Unified cross-dashboard focus state on hover
        row.addEventListener('mouseover', () => {
            // Dim points in Beeswarm Chart
            d3.selectAll('circle.data-point')
                .style('opacity', c => c.driver === driver.code ? 1 : 0.05);

            // Dim lines and nodes in Position Bump Chart
            d3.selectAll('.bump-line')
                .attr('opacity', p => p[0] === driver.code ? 1 : 0.05)
                .attr('stroke-width', p => p[0] === driver.code ? 3.5 : 1);
            
            d3.selectAll('.end-label, .end-node, .start-node')
                .attr('opacity', p => p[0] === driver.code ? 1 : 0.05);
        });

        row.addEventListener('mouseout', () => {
            // Restore Beeswarm Chart Opacities
            d3.selectAll('circle.data-point')
                .style('opacity', 1);

            // Restore Position Bump Chart Opacities & stroke widths
            d3.selectAll('.bump-line')
                .attr('opacity', p => {
                    const laps = p[1];
                    const isDns = laps[0].isDns;
                    const isDnf = laps[laps.length - 1].isDnf;
                    if (isDns) return 0.25;
                    if (isDnf) return 0.5;
                    return 1;
                })
                .attr('stroke-width', 2);

            d3.selectAll('.end-label, .end-node, .start-node')
                .attr('opacity', 1);
        });

        container.appendChild(row);
    });
}
