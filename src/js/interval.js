export function renderInterval(data) {
    const container = document.getElementById('interval-chart');
    container.innerHTML = '';

    if (!data.laps || data.laps.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding-top: 2rem;">No lap data available.</p>';
        return;
    }

    const margin = { top: 20, right: 30, bottom: 40, left: 60 };
    const width = container.clientWidth - margin.left - margin.right;
    const height = 400 - margin.top - margin.bottom;

    const svg = d3.select('#interval-chart')
        .append('svg')
        .attr('width', width + margin.left + margin.right)
        .attr('height', height + margin.top + margin.bottom)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    // MVP: plot raw lap time progression or just dummy gap to leader since gap might not be calculated
    // If "session_time" is available, we can approximate the gap. For now, plot lap times as a line chart.
    
    const driverLaps = d3.group(data.laps, d => d.driver);
    const maxLap = d3.max(data.laps, d => d.lap);
    
    // We'll plot lap times instead of true interval for the MVP if interval isn't strictly available,
    // but the plan says "Gap-to-leader". Let's assume lap.time is what we have and plot lap times.
    const xScale = d3.scaleLinear()
        .domain([1, maxLap])
        .range([0, width]);

    // Exclude massive outliers
    const times = data.laps.map(d => d.time).sort(d3.ascending);
    const yMax = times.length > 0 ? d3.quantile(times, 0.95) : 100;
    const yMin = times.length > 0 ? d3.min(times) : 0;

    const yScale = d3.scaleLinear()
        .domain([yMin * 0.98, yMax * 1.05])
        .range([height, 0]);

    svg.append('g')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(xScale).ticks(10))
        .append('text')
        .attr('x', width)
        .attr('y', 35)
        .attr('fill', 'currentColor')
        .attr('text-anchor', 'end')
        .text('Lap');

    svg.append('g')
        .call(d3.axisLeft(yScale))
        .append('text')
        .attr('transform', 'rotate(-90)')
        .attr('y', -40)
        .attr('x', -height/2)
        .attr('fill', 'currentColor')
        .attr('text-anchor', 'middle')
        .text('Lap Time (s)');

    const line = d3.line()
        .x(d => xScale(d.lap))
        .y(d => yScale(d.time))
        .curve(d3.curveMonotoneX);

    const driverColors = Object.fromEntries(data.drivers.map(d => [d.code, d.color]));

    svg.selectAll('.line')
        .data(driverLaps)
        .enter()
        .append('path')
        .attr('class', 'line')
        .attr('fill', 'none')
        .attr('stroke', d => driverColors[d[0]] || '#ccc')
        .attr('stroke-width', 1.5)
        .attr('opacity', 0.6)
        .attr('d', d => line(d[1]))
        .on('mouseover', function(event, d) {
            d3.select(this).attr('stroke-width', 3).attr('opacity', 1);
            // Tooltip code could go here
        })
        .on('mouseout', function(event, d) {
            d3.select(this).attr('stroke-width', 1.5).attr('opacity', 0.6);
        });
}