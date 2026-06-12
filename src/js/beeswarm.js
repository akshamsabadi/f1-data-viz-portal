export function renderBeeswarm(data) {
    const container = document.getElementById('beeswarm-plot');
    container.innerHTML = ''; // Clear previous

    if (!data.laps || data.laps.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding-top: 2rem;">No lap data available for this race.</p>';
        return;
    }

    const margin = { top: 20, right: 30, bottom: 40, left: 60 };
    const width = container.clientWidth - margin.left - margin.right;
    
    // Y-axis will be drivers. Get unique drivers sorted by position or original order.
    const drivers = data.drivers.map(d => d.code);
    const height = Math.max(400, drivers.length * 30); // Dynamic height based on driver count
    
    const svg = d3.select('#beeswarm-plot')
        .append('svg')
        .attr('width', width + margin.left + margin.right)
        .attr('height', height + margin.top + margin.bottom)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    const tooltip = d3.select('#tooltip');

    // Filter outliers (e.g. pit stops) for a cleaner scale
    const q1 = d3.quantile(data.laps.map(d => d.time).sort(d3.ascending), 0.25);
    const q3 = d3.quantile(data.laps.map(d => d.time).sort(d3.ascending), 0.75);
    const iqr = q3 - q1;
    const maxAllowedTime = q3 + 1.5 * iqr;
    
    const filteredLaps = data.laps.filter(d => d.time <= maxAllowedTime);

    const xScale = d3.scaleLinear()
        .domain(d3.extent(filteredLaps, d => d.time))
        .range([0, width]);

    const yScale = d3.scalePoint()
        .domain(drivers)
        .range([0, height])
        .padding(1);

    const colorScale = d3.scaleOrdinal()
        .domain(['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET', 'UNKNOWN'])
        .range(['#ef4444', '#eab308', '#fafafa', '#22c55e', '#3b82f6', '#a1a1aa']);

    svg.append('g')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(xScale).ticks(10))
        .append('text')
        .attr('x', width)
        .attr('y', 35)
        .attr('fill', 'currentColor')
        .attr('text-anchor', 'end')
        .text('Lap Time (s)');

    svg.append('g')
        .call(d3.axisLeft(yScale));

    const simulation = d3.forceSimulation(filteredLaps)
        .force('x', d3.forceX(d => xScale(d.time)).strength(1))
        .force('y', d3.forceY(d => yScale(d.driver)).strength(0.2))
        .force('collide', d3.forceCollide(4))
        .stop();

    // Run simulation statically for performance
    for (let i = 0; i < 120; ++i) simulation.tick();

    svg.selectAll('circle')
        .data(filteredLaps)
        .enter()
        .append('circle')
        .attr('cx', d => d.x)
        .attr('cy', d => d.y)
        .attr('r', 3)
        .attr('fill', d => colorScale(d.compound.toUpperCase()))
        .attr('stroke', 'var(--bg-dark)')
        .attr('stroke-width', 0.5)
        .attr('opacity', 0.8)
        .on('mouseover', (event, d) => {
            tooltip.classed('hidden', false)
                .html(`<strong>${d.driver}</strong> Lap ${d.lap}<br>Time: ${d.time}s<br>Tyre: ${d.compound}`)
                .style('left', (event.pageX + 10) + 'px')
                .style('top', (event.pageY - 28) + 'px');
            
            d3.select(event.currentTarget)
                .attr('stroke', '#fff')
                .attr('stroke-width', 2)
                .attr('opacity', 1)
                .attr('r', 5);
        })
        .on('mouseout', (event, d) => {
            tooltip.classed('hidden', true);
            d3.select(event.currentTarget)
                .attr('stroke', 'var(--bg-dark)')
                .attr('stroke-width', 0.5)
                .attr('opacity', 0.8)
                .attr('r', 3);
        });
}