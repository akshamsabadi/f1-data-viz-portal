export function renderBeeswarm(data) {
    const container = document.getElementById('beeswarm-plot');
    container.innerHTML = ''; // Clear previous

    if (!data.laps || data.laps.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding-top: 2rem; font-family: Montserrat, sans-serif; text-transform: uppercase;">No lap data available for this race.</p>';
        return;
    }

    const margin = { top: 20, right: 30, bottom: 60, left: 60 };
    const width = container.clientWidth - margin.left - margin.right;
    const height = 600 - margin.top - margin.bottom;
    
    const maxLap = d3.max(data.laps, d => d.lap);
    const finalLapData = data.laps.filter(d => d.lap === maxLap);
    finalLapData.sort((a, b) => a.position - b.position);
    
    const orderedDrivers = finalLapData.map(d => d.driver);
    data.drivers.forEach(d => {
        if (!orderedDrivers.includes(d.code)) {
            orderedDrivers.push(d.code);
        }
    });
    
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

    const q1 = d3.quantile(data.laps.map(d => d.time).sort(d3.ascending), 0.25);
    const q3 = d3.quantile(data.laps.map(d => d.time).sort(d3.ascending), 0.75);
    const iqr = q3 - q1;
    const maxAllowedTime = q3 + 1.5 * iqr;
    
    const filteredLaps = data.laps.filter(d => d.time <= maxAllowedTime);

    const xScale = d3.scalePoint()
        .domain(orderedDrivers)
        .range([0, width])
        .padding(1);

    const yScale = d3.scaleLinear()
        .domain(d3.extent(filteredLaps, d => d.time))
        .range([height, 0]);

    const colorScale = d3.scaleOrdinal()
        .domain(['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET', 'UNKNOWN'])
        .range(['#ef4444', '#eab308', '#fafafa', '#22c55e', '#3b82f6', '#a1a1aa']);

    // Gridlines
    svg.append('g')
        .attr('class', 'gridline')
        .call(d3.axisLeft(yScale)
            .tickSize(-width)
            .tickFormat('')
            .ticks(10)
        );

    // X Axis
    const xAxisGroup = svg.append('g')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(xScale));

    xAxisGroup.selectAll('.tick text')
        .style('fill', d => driverColorMap[d] || 'var(--text-muted)')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-weight', '700')
        .style('font-size', '12px');

    xAxisGroup.append('text')
        .attr('x', width)
        .attr('y', 40)
        .attr('fill', 'var(--text-muted)')
        .attr('text-anchor', 'end')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-weight', '600')
        .text('DRIVER (FINISHING ORDER)');

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
        .text('LAP TIME (S)');

    const simulation = d3.forceSimulation(filteredLaps)
        .force('x', d3.forceX(d => xScale(d.driver)).strength(0.2))
        .force('y', d3.forceY(d => yScale(d.time)).strength(1))
        .force('collide', d3.forceCollide(4))
        .stop();

    for (let i = 0; i < 120; ++i) simulation.tick();

    svg.selectAll('circle.data-point')
        .data(filteredLaps)
        .enter()
        .append('circle')
        .attr('class', 'data-point')
        .attr('cx', d => d.x)
        .attr('cy', d => d.y)
        .attr('r', 3.5)
        .attr('fill', d => colorScale(d.compound.toUpperCase()))
        .attr('stroke', 'var(--bg-dark)')
        .attr('stroke-width', 1)
        .attr('opacity', 1)
        .on('mouseover', (event, d) => {
            const compoundColor = colorScale(d.compound.toUpperCase());
            const teamColor = driverColorMap[d.driver] || 'var(--accent)';
            
            tooltip.classed('hidden', false)
                .style('border-left-color', teamColor)
                .html(`
                    <div style="font-family: Montserrat, sans-serif; font-weight: 700; margin-bottom: 4px; text-transform: uppercase;">
                        ${d.driver} <span style="color: var(--text-muted); font-weight: 600; font-size: 0.75rem;">LAP ${d.lap}</span>
                    </div>
                    <div style="font-size: 1rem; font-weight: 600; margin-bottom: 4px;">
                        ${d.time.toFixed(3)}s
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px; font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted);">
                        <div style="width: 10px; height: 10px; border-radius: 50%; background-color: ${compoundColor};"></div>
                        ${d.compound}
                    </div>
                `)
                .style('left', (event.pageX + 15) + 'px')
                .style('top', (event.pageY - 30) + 'px');
            
            d3.select(event.currentTarget)
                .attr('stroke', '#ffffff')
                .attr('stroke-width', 2)
                .attr('r', 6);
        })
        .on('mouseout', (event, d) => {
            tooltip.classed('hidden', true);
            d3.select(event.currentTarget)
                .attr('stroke', 'var(--bg-dark)')
                .attr('stroke-width', 1)
                .attr('r', 3.5);
        });
}