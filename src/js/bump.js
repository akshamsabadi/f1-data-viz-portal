export function renderBump(data) {
    const container = document.getElementById('bump-chart');
    container.innerHTML = '';

    const validLaps = data.laps.filter(d => d.position !== null);

    if (!validLaps || validLaps.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding-top: 2rem; font-family: Montserrat, sans-serif; text-transform: uppercase;">No position data available.</p>';
        return;
    }

    const margin = { top: 20, right: 50, bottom: 40, left: 40 };
    const width = container.clientWidth - margin.left - margin.right;
    const height = 400 - margin.top - margin.bottom;

    const svg = d3.select('#bump-chart')
        .append('svg')
        .attr('width', width + margin.left + margin.right)
        .attr('height', height + margin.top + margin.bottom)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    const maxLap = d3.max(validLaps, d => d.lap);
    const maxPos = data.drivers.length || 22;

    const xScale = d3.scaleLinear()
        .domain([1, maxLap])
        .range([0, width]);

    const yScale = d3.scaleLinear()
        .domain([1, maxPos])
        .range([0, height]); // inverted because 1st is at top

    // Gridlines
    svg.append('g')
        .attr('class', 'gridline')
        .call(d3.axisLeft(yScale)
            .tickSize(-width)
            .tickFormat('')
            .ticks(maxPos)
        );

    // X Axis
    svg.append('g')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(xScale).ticks(10).tickFormat(d3.format('d')))
        .append('text')
        .attr('x', width)
        .attr('y', 35)
        .attr('fill', 'var(--text-muted)')
        .attr('text-anchor', 'end')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-weight', '600')
        .text('LAP');

    // Y Axis
    svg.append('g')
        .call(d3.axisLeft(yScale).ticks(maxPos))
        .append('text')
        .attr('transform', 'rotate(-90)')
        .attr('y', -30)
        .attr('x', 0)
        .attr('fill', 'var(--text-muted)')
        .attr('text-anchor', 'end')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-weight', '600')
        .text('POSITION');

    const line = d3.line()
        .x(d => xScale(d.lap))
        .y(d => yScale(d.position))
        .curve(d3.curveMonotoneX);

    // 1. Calculate authentic final classification positions for all drivers (including DNS)
    const driverLapsMap = d3.group(validLaps, d => d.driver);
    const classificationList = data.drivers.map(driver => {
        const laps = driverLapsMap.get(driver.code) || [];
        const lapsCompleted = laps.length;
        const lastLapTime = lapsCompleted > 0 ? laps[lapsCompleted - 1].session_time : Infinity;
        return {
            code: driver.code,
            lapsCompleted,
            lastLapTime
        };
    });

    // Sort: completed more laps first, then faster last lap time, then DNS at the bottom
    classificationList.sort((a, b) => {
        if (b.lapsCompleted !== a.lapsCompleted) {
            return b.lapsCompleted - a.lapsCompleted;
        }
        return a.lastLapTime - b.lastLapTime;
    });

    const finalRanks = {};
    classificationList.forEach((item, index) => {
        finalRanks[item.code] = index + 1;
    });

    // 2. Preprocess driver laps to include DNS lines and DNF drop-offs
    const driverLapsProcessed = new Map();
    data.drivers.forEach(driver => {
        const realLaps = driverLapsMap.get(driver.code) || [];
        const realLapsCount = realLaps.length;
        const finalRank = finalRanks[driver.code];
        
        let processed = [];
        if (realLapsCount === 0) {
            // DNS: Create a single point on lap 1 at their classification rank
            processed.push({
                driver: driver.code,
                lap: 1,
                position: finalRank,
                isDns: true
            });
        } else if (realLapsCount < maxLap) {
            // DNF: Real running positions up to retirement lap - 1, and drop to finalRank on their last lap
            processed = realLaps.map((lapRecord, index) => {
                if (index === realLapsCount - 1) {
                    return {
                        ...lapRecord,
                        position: finalRank,
                        isDnf: true
                    };
                }
                return lapRecord;
            });
        } else {
            // Finisher: Use real laps unchanged
            processed = realLaps;
        }
        
        driverLapsProcessed.set(driver.code, processed);
    });

    const driverColors = Object.fromEntries(data.drivers.map(d => [d.code, d.color]));

    const linesGroup = svg.append('g').attr('class', 'lines-group');

    // Draw lines
    const paths = linesGroup.selectAll('.bump-line')
        .data(driverLapsProcessed)
        .enter()
        .append('path')
        .attr('class', 'bump-line')
        .attr('fill', 'none')
        .attr('stroke', d => driverColors[d[0]] || '#ccc')
        .attr('stroke-width', 2)
        .attr('opacity', d => {
            const laps = d[1];
            const isDns = laps[0].isDns;
            const isDnf = laps[laps.length - 1].isDnf;
            if (isDns) return 0.25;
            if (isDnf) return 0.5;
            return 1;
        })
        .attr('stroke-dasharray', d => {
            const laps = d[1];
            const isDns = laps[0].isDns;
            const isDnf = laps[laps.length - 1].isDnf;
            if (isDns) return '1,4';
            if (isDnf) return '3,3';
            return 'none';
        })
        .attr('d', d => line(d[1]));

    // Start Nodes (Only for drivers who actually started)
    const startNodesGroup = svg.append('g').attr('class', 'start-nodes');
    const startNodes = startNodesGroup.selectAll('.start-node')
        .data(Array.from(driverLapsProcessed).filter(d => !d[1][0].isDns))
        .enter()
        .append('circle')
        .attr('class', 'start-node')
        .attr('cx', d => xScale(d[1][0].lap))
        .attr('cy', d => yScale(d[1][0].position))
        .attr('r', 4)
        .attr('fill', d => driverColors[d[0]] || '#ccc')
        .attr('stroke', 'var(--bg-dark)')
        .attr('stroke-width', 1);

    // End Nodes
    const endNodesGroup = svg.append('g').attr('class', 'end-nodes');
    const endNodes = endNodesGroup.selectAll('.end-node')
        .data(driverLapsProcessed)
        .enter()
        .append('circle')
        .attr('class', 'end-node')
        .attr('cx', d => xScale(d[1][d[1].length - 1].lap))
        .attr('cy', d => yScale(d[1][d[1].length - 1].position))
        .attr('r', 4)
        .attr('fill', d => driverColors[d[0]] || '#ccc')
        .attr('stroke', 'var(--bg-dark)')
        .attr('stroke-width', 1);

    const endLabels = endNodesGroup.selectAll('.end-label')
        .data(driverLapsProcessed)
        .enter()
        .append('text')
        .attr('class', 'end-label')
        .attr('x', d => xScale(d[1][d[1].length - 1].lap) + 8)
        .attr('y', d => yScale(d[1][d[1].length - 1].position))
        .attr('dy', '0.35em')
        .attr('fill', d => driverColors[d[0]] || '#ccc')
        .style('font-family', 'Titillium Web, sans-serif')
        .style('font-size', '11px')
        .style('font-weight', '700')
        .text(d => {
            const laps = d[1];
            const isDns = laps[0].isDns;
            const isDnf = laps[laps.length - 1].isDnf;
            if (isDns) return `${d[0]} (DNS)`;
            if (isDnf) return `${d[0]} (DNF)`;
            return d[0];
        });

    // Focus state interaction
    const handleMouseOver = (event, d) => {
        paths.attr('opacity', p => p[0] === d[0] ? 1 : 0.1);
        startNodes.attr('opacity', p => p[0] === d[0] ? 1 : 0.1);
        endNodes.attr('opacity', p => p[0] === d[0] ? 1 : 0.1);
        endLabels.attr('opacity', p => p[0] === d[0] ? 1 : 0.1);
        d3.select(event.currentTarget).attr('stroke-width', 4);
    };

    const handleMouseOut = (event, d) => {
        paths.attr('opacity', p => {
            const laps = p[1];
            const isDns = laps[0].isDns;
            const isDnf = laps[laps.length - 1].isDnf;
            if (isDns) return 0.25;
            if (isDnf) return 0.5;
            return 1;
        }).attr('stroke-width', 2);
        startNodes.attr('opacity', 1);
        endNodes.attr('opacity', 1);
        endLabels.attr('opacity', 1);
    };

    paths.on('mouseover', handleMouseOver).on('mouseout', handleMouseOut);
}