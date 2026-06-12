export function renderCornerSpeed(data) {
    const container = document.getElementById('corner-speed-chart');
    container.innerHTML = '';

    if (!data.corners || data.corners.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding-top: 2rem; font-family: Montserrat, sans-serif; text-transform: uppercase;">No corner speed data available.</p>';
        return;
    }

    const margin = { top: 20, right: 30, bottom: 60, left: 60 };
    const width = container.clientWidth - margin.left - margin.right;
    
    // Dynamic height based on number of turns
    const maxTurn = d3.max(data.corners, d => d.turn);
    const height = Math.max(400, maxTurn * 30);

    const svg = d3.select('#corner-speed-chart')
        .append('svg')
        .attr('width', width + margin.left + margin.right)
        .attr('height', height + margin.top + margin.bottom)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    const tooltip = d3.select('#tooltip');

    const xScale = d3.scaleLinear()
        .domain(d3.extent(data.corners, d => d.speed))
        .range([0, width])
        .nice(); // give padding

    const yScale = d3.scaleLinear()
        .domain([1, maxTurn])
        .range([0, height]);

    // Gridlines for each turn
    svg.append('g')
        .attr('class', 'gridline')
        .call(d3.axisLeft(yScale)
            .tickSize(-width)
            .tickFormat('')
            .ticks(maxTurn)
        );

    // X Axis (Speed)
    svg.append('g')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(xScale).ticks(10))
        .append('text')
        .attr('x', width)
        .attr('y', 40)
        .attr('fill', 'var(--text-muted)')
        .attr('text-anchor', 'end')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-weight', '600')
        .text('AVERAGE APEX SPEED (KM/H)');

    // Y Axis (Turns)
    svg.append('g')
        .call(d3.axisLeft(yScale).ticks(maxTurn).tickFormat(d => `T${d}`))
        .selectAll('.tick text')
        .style('fill', 'var(--text-muted)')
        .style('font-family', 'Titillium Web, sans-serif')
        .style('font-weight', '700')
        .style('font-size', '12px');

    svg.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('y', -45)
        .attr('x', 0)
        .attr('fill', 'var(--text-muted)')
        .attr('text-anchor', 'end')
        .style('font-family', 'Montserrat, sans-serif')
        .style('font-weight', '600')
        .text('CORNER');

    // Draw the dots
    svg.selectAll('.corner-dot')
        .data(data.corners)
        .enter()
        .append('circle')
        .attr('class', 'corner-dot')
        .attr('cx', d => xScale(d.speed))
        .attr('cy', d => yScale(d.turn))
        .attr('r', 4)
        .attr('fill', d => d.color || 'var(--accent)')
        .attr('stroke', 'var(--bg-dark)')
        .attr('stroke-width', 1)
        .attr('opacity', 0.85)
        .on('mouseover', (event, d) => {
            const teamColor = d.color || 'var(--accent)';
            
            tooltip.classed('hidden', false)
                .style('border-left-color', teamColor)
                .html(`
                    <div style="font-family: Montserrat, sans-serif; font-weight: 700; margin-bottom: 4px; text-transform: uppercase;">
                        ${d.team} <span style="color: var(--text-muted); font-weight: 600; font-size: 0.75rem;">TURN ${d.turn}</span>
                    </div>
                    <div style="font-size: 1rem; font-weight: 600;">
                        ${d.speed.toFixed(1)} km/h
                    </div>
                `)
                .style('left', (event.pageX + 15) + 'px')
                .style('top', (event.pageY - 30) + 'px');
            
            d3.select(event.currentTarget)
                .attr('stroke', '#ffffff')
                .attr('stroke-width', 2)
                .attr('opacity', 1)
                .attr('r', 6);
        })
        .on('mouseout', (event, d) => {
            tooltip.classed('hidden', true);
            d3.select(event.currentTarget)
                .attr('stroke', 'var(--bg-dark)')
                .attr('stroke-width', 1)
                .attr('opacity', 0.85)
                .attr('r', 4);
        });
}