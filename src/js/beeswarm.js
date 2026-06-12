export function renderBeeswarm(data) {
    const container = document.getElementById('beeswarm-plot');
    container.innerHTML = ''; // Clear previous

    if (!data.laps || data.laps.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding-top: 2rem;">No lap data available for this race.</p>';
        return;
    }

    const margin = { top: 20, right: 30, bottom: 60, left: 60 };
    const width = container.clientWidth - margin.left - margin.right;
    const height = 600 - margin.top - margin.bottom;
    
    // Sort drivers by finishing position
    // Find the last lap of the race
    const maxLap = d3.max(data.laps, d => d.lap);
    const finalLapData = data.laps.filter(d => d.lap === maxLap);
    finalLapData.sort((a, b) => a.position - b.position);
    
    // Ordered list of driver codes
    const orderedDrivers = finalLapData.map(d => d.driver);
    // Add any drivers that didn't make it to the final lap at the end
    data.drivers.forEach(d => {
        if (!orderedDrivers.includes(d.code)) {
            orderedDrivers.push(d.code);
        }
    });
    
    // Create a map for driver colors
    const driverColorMap = {};
    data.drivers.forEach(d => {
        driverColorMap[d.code] = d.color;
    });

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

    // X axis is now Drivers
    const xScale = d3.scalePoint()
        .domain(orderedDrivers)
        .range([0, width])
        .padding(1);

    // Y axis is now Time
    const yScale = d3.scaleLinear()
        .domain(d3.extent(filteredLaps, d => d.time))
        .range([height, 0]);

    const colorScale = d3.scaleOrdinal()
        .domain(['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET', 'UNKNOWN'])
        .range(['#ef4444', '#eab308', '#fafafa', '#22c55e', '#3b82f6', '#a1a1aa']);

    // X Axis
    const xAxisGroup = svg.append('g')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(xScale));

    // Color the tick labels by driver team color
    xAxisGroup.selectAll('.tick text')
        .style('fill', d => driverColorMap[d] || 'var(--text-muted)')
        .style('font-weight', '600')
        .style('font-size', '12px');

    xAxisGroup.append('text')
        .attr('x', width)
        .attr('y', 40)
        .attr('fill', 'var(--text-muted)')
        .attr('text-anchor', 'end')
        .text('Driver (Finishing Order)');

    // Y Axis
    svg.append('g')
        .call(d3.axisLeft(yScale).ticks(10))
        .append('text')
        .attr('transform', 'rotate(-90)')
        .attr('y', -45)
        .attr('x', 0)
        .attr('fill', 'var(--text-muted)')
        .attr('text-anchor', 'end')
        .text('Lap Time (s)');

    const simulation = d3.forceSimulation(filteredLaps)
        .force('x', d3.forceX(d => xScale(d.driver)).strength(1))
        .force('y', d3.forceY(d => yScale(d.time)).strength(0.2)) // Give Y some flex for the beeswarm effect, or swap strengths depending on desired effect
        .force('collide', d3.forceCollide(4))
        .stop();

    // To ensure strict time representation, it's often better to strongly force Y and let X jitter for collision
    simulation.force('y', d3.forceY(d => yScale(d.time)).strength(1))
              .force('x', d3.forceX(d => xScale(d.driver)).strength(0.2));

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