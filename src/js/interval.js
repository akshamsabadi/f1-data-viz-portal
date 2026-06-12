export function renderInterval(data) {
    const container = document.getElementById('interval-chart');
    container.innerHTML = '';

    if (!data.laps || data.laps.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding-top: 2rem; font-family: Montserrat, sans-serif; text-transform: uppercase;">No lap data available.</p>';
        return;
    }

    const margin = { top: 20, right: 30, bottom: 40, left: 60 };
    const width = container.clientWidth - margin.left - margin.right;
    const height = 400 - margin.top - margin.bottom;

    // Filter valid laps
    const validLaps = data.laps.filter(d => d.session_time != null && d.lap > 0);

    // Calculate gap to leader per lap
    const lapsByLapNum = d3.group(validLaps, d => d.lap);
    const gapData = [];

    lapsByLapNum.forEach((laps, lapNum) => {
        const leaderTime = d3.min(laps, d => d.session_time);
        laps.forEach(lap => {
            gapData.push({
                ...lap,
                gap: lap.session_time - leaderTime
            });
        });
    });

    const svg = d3.select('#interval-chart')
        .append('svg')
        .attr('width', width + margin.left + margin.right)
        .attr('height', height + margin.top + margin.bottom)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    const maxLap = d3.max(gapData, d => d.lap);
    
    const xScale = d3.scaleLinear()
        .domain([1, maxLap])
        .range([0, width]);

    // For gaps, 0 is at the top (leader), larger gap goes down
    const yMax = d3.max(gapData, d => d.gap) || 100;
    // Cap yMax at 120 seconds to prevent massive outliers from squishing the chart
    const cappedYMax = Math.min(yMax, 120);

    const yScale = d3.scaleLinear()
        .domain([0, cappedYMax])
        .range([0, height]); // Inverted range: 0 gap is at the top (y=0)

    // Gridlines
    svg.append('g')
        .attr('class', 'gridline')
        .call(d3.axisLeft(yScale)
            .tickSize(-width)
            .tickFormat('')
            .ticks(10)
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
        .call(d3.axisLeft(yScale).ticks(10))
        .append('text')
        .attr('transform', 'rotate(-90)')
        .attr('y', -45)
        .attr('x', 0)
        .attr('fill', 'var(--text-muted)')
        .attr('text-anchor', 'end')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-weight', '600')
        .text('GAP TO LEADER (S)');

    // Zero-Line
    svg.append('line')
        .attr('x1', 0)
        .attr('y1', yScale(0))
        .attr('x2', width)
        .attr('y2', yScale(0))
        .attr('stroke', 'var(--text-primary)')
        .attr('stroke-width', 2);

    const line = d3.line()
        .x(d => xScale(d.lap))
        .y(d => yScale(d.gap))
        .curve(d3.curveMonotoneX);

    const driverGaps = d3.group(gapData, d => d.driver);
    const driverColors = Object.fromEntries(data.drivers.map(d => [d.code, d.color]));

    // Draw lines
    const pathGroup = svg.append('g');
    
    pathGroup.selectAll('.line')
        .data(driverGaps)
        .enter()
        .append('path')
        .attr('class', 'line')
        .attr('fill', 'none')
        .attr('stroke', d => driverColors[d[0]] || '#ccc')
        .attr('stroke-width', 2) // Thicker solid lines
        .attr('opacity', 1) // 100% opaque
        .attr('d', d => line(d[1]));

    // Crosshair
    const crosshair = svg.append('line')
        .attr('y1', 0)
        .attr('y2', height)
        .attr('stroke', 'var(--text-muted)')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '4 4')
        .style('opacity', 0);

    const tooltip = d3.select('#tooltip');
    
    // Create an overlay for capturing mouse events
    svg.append('rect')
        .attr('width', width)
        .attr('height', height)
        .attr('fill', 'transparent')
        .on('mousemove', (event) => {
            const [mouseX] = d3.pointer(event);
            const hoveredLap = Math.round(xScale.invert(mouseX));
            
            if (hoveredLap >= 1 && hoveredLap <= maxLap) {
                // Snap crosshair
                const snappedX = xScale(hoveredLap);
                crosshair.attr('x1', snappedX).attr('x2', snappedX).style('opacity', 1);

                // Get data for this lap
                const lapData = gapData.filter(d => d.lap === hoveredLap);
                if (lapData.length > 0) {
                    lapData.sort((a, b) => a.gap - b.gap);
                    const leader = lapData[0];
                    
                    let tooltipHtml = `
                        <div style="font-family: Montserrat, sans-serif; font-weight: 700; margin-bottom: 8px; text-transform: uppercase;">
                            LAP ${hoveredLap}
                        </div>
                    `;
                    
                    // Show top 5 drivers on this lap to prevent massive tooltip
                    const displayData = lapData.slice(0, 5);
                    displayData.forEach(d => {
                        const teamColor = driverColors[d.driver] || 'var(--text-muted)';
                        const gapStr = d.gap === 0 ? 'Leader' : `+${d.gap.toFixed(3)}s`;
                        tooltipHtml += `
                            <div style="display: flex; justify-content: space-between; gap: 1rem; margin-bottom: 2px;">
                                <span style="font-weight: 700; color: ${teamColor};">${d.driver}</span>
                                <span>${gapStr}</span>
                            </div>
                        `;
                    });

                    tooltip.classed('hidden', false)
                        .style('border-left-color', 'var(--text-primary)')
                        .html(tooltipHtml)
                        .style('left', (event.pageX + 15) + 'px')
                        .style('top', (event.pageY - 30) + 'px');
                }
            }
        })
        .on('mouseout', () => {
            crosshair.style('opacity', 0);
            tooltip.classed('hidden', true);
        });
}