export function renderBump(data) {
    const container = document.getElementById('bump-chart');
    container.innerHTML = '';

    const validLaps = data.laps.filter(d => d.position !== null);

    if (!validLaps || validLaps.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding-top: 2rem;">No position data available.</p>';
        return;
    }

    const margin = { top: 20, right: 30, bottom: 40, left: 40 };
    const width = container.clientWidth - margin.left - margin.right;
    const height = 400 - margin.top - margin.bottom;

    const svg = d3.select('#bump-chart')
        .append('svg')
        .attr('width', width + margin.left + margin.right)
        .attr('height', height + margin.top + margin.bottom)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    const maxLap = d3.max(validLaps, d => d.lap);
    const maxPos = d3.max(validLaps, d => d.position) || 20;

    const xScale = d3.scaleLinear()
        .domain([1, maxLap])
        .range([0, width]);

    const yScale = d3.scaleLinear()
        .domain([1, maxPos])
        .range([0, height]); // inverted because 1st is at top

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
        .call(d3.axisLeft(yScale).ticks(maxPos))
        .append('text')
        .attr('transform', 'rotate(-90)')
        .attr('y', -30)
        .attr('x', -height/2)
        .attr('fill', 'currentColor')
        .attr('text-anchor', 'middle')
        .text('Position');

    const line = d3.line()
        .x(d => xScale(d.lap))
        .y(d => yScale(d.position))
        .curve(d3.curveMonotoneX);

    const driverLaps = d3.group(validLaps, d => d.driver);
    const driverColors = Object.fromEntries(data.drivers.map(d => [d.code, d.color]));

    svg.selectAll('.line')
        .data(driverLaps)
        .enter()
        .append('path')
        .attr('class', 'line')
        .attr('fill', 'none')
        .attr('stroke', d => driverColors[d[0]] || '#ccc')
        .attr('stroke-width', 2)
        .attr('opacity', 0.8)
        .attr('d', d => line(d[1]))
        .on('mouseover', function(event, d) {
            d3.select(this).attr('stroke-width', 4).attr('opacity', 1);
        })
        .on('mouseout', function(event, d) {
            d3.select(this).attr('stroke-width', 2).attr('opacity', 0.8);
        });
}