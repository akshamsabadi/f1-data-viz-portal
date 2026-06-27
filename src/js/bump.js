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

    const driverLaps = d3.group(validLaps, d => d.driver);
    const driverColors = Object.fromEntries(data.drivers.map(d => [d.code, d.color]));

    const linesGroup = svg.append('g').attr('class', 'lines-group');

    // Draw lines
    const paths = linesGroup.selectAll('.bump-line')
        .data(driverLaps)
        .enter()
        .append('path')
        .attr('class', 'bump-line')
        .attr('fill', 'none')
        .attr('stroke', d => driverColors[d[0]] || '#ccc')
        .attr('stroke-width', 2)
        .attr('opacity', d => {
            const laps = d[1];
            const isDnf = laps[laps.length - 1].lap < maxLap;
            return isDnf ? 0.35 : 1;
        })
        .attr('stroke-dasharray', d => {
            const laps = d[1];
            const isDnf = laps[laps.length - 1].lap < maxLap;
            return isDnf ? '3,3' : 'none';
        })
        .attr('d', d => line(d[1]));

    // Start Nodes
    const startNodesGroup = svg.append('g').attr('class', 'start-nodes');
    const startNodes = startNodesGroup.selectAll('.start-node')
        .data(driverLaps)
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
        .data(driverLaps)
        .enter()
        .append('circle')
        .attr('class', 'end-node')
        .attr('cx', d => xScale(d[1][d[1].length - 1].lap))
        .attr('cy', d => yScale(d[1][d[1].length - 1].position))
        .attr('r', d => {
            const laps = d[1];
            const isDnf = laps[laps.length - 1].lap < maxLap;
            return isDnf ? 3 : 4;
        })
        .attr('fill', d => {
            const laps = d[1];
            const isDnf = laps[laps.length - 1].lap < maxLap;
            return isDnf ? '#ef4444' : (driverColors[d[0]] || '#ccc');
        })
        .attr('stroke', d => {
            const laps = d[1];
            const isDnf = laps[laps.length - 1].lap < maxLap;
            return isDnf ? '#ffffff' : 'var(--bg-dark)';
        })
        .attr('stroke-width', 1);

    const endLabels = endNodesGroup.selectAll('.end-label')
        .data(driverLaps)
        .enter()
        .append('text')
        .attr('class', 'end-label')
        .attr('x', d => xScale(d[1][d[1].length - 1].lap) + 8)
        .attr('y', d => yScale(d[1][d[1].length - 1].position))
        .attr('dy', '0.35em')
        .attr('fill', d => {
            const laps = d[1];
            const isDnf = laps[laps.length - 1].lap < maxLap;
            return isDnf ? '#ef4444' : (driverColors[d[0]] || '#ccc');
        })
        .style('font-family', 'Titillium Web, sans-serif')
        .style('font-size', '11px')
        .style('font-weight', '700')
        .text(d => {
            const laps = d[1];
            const isDnf = laps[laps.length - 1].lap < maxLap;
            return isDnf ? `${d[0]} (DNF)` : d[0];
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
        paths.attr('opacity', 1).attr('stroke-width', 2);
        startNodes.attr('opacity', 1);
        endNodes.attr('opacity', 1);
        endLabels.attr('opacity', 1);
    };

    paths.on('mouseover', handleMouseOver).on('mouseout', handleMouseOut);
}