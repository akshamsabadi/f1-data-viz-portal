const TEAM_LOGOS = {
    "Mercedes": "assets/logos/mercedes.svg",
    "McLaren": "assets/logos/mclaren.svg",
    "Ferrari": "assets/logos/ferrari.svg",
    "Alpine F1 Team": "assets/logos/alpine.svg",
    "Red Bull": "assets/logos/redbull.svg",
    "RB F1 Team": "assets/logos/rbf1.svg",
    "Haas F1 Team": "assets/logos/haas.svg",
    "Audi": "assets/logos/audi.svg",
    "Williams": "assets/logos/williams.svg",
    "Cadillac F1 Team": "assets/logos/cadillac.svg",
    "Aston Martin": "assets/logos/astonmartin.svg"
};

export function renderCornerSpeed(data) {
    const container = document.getElementById('corner-speed-chart');
    container.innerHTML = '';

    if (!data.corners || data.corners.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding-top: 2rem; font-family: Montserrat, sans-serif; text-transform: uppercase;">No corner speed data available.</p>';
        return;
    }

    // Step 1: Calculate average speed for each turn
    const turnAverages = d3.rollups(
        data.corners,
        v => d3.mean(v, d => d.speed),
        d => d.turn
    );

    // Step 2: Categorize corners
    const categories = {
        'Slow': { title: 'Slow Corners (< 130 km/h)', turns: [], corners: [] },
        'Medium': { title: 'Medium Corners (130 - 200 km/h)', turns: [], corners: [] },
        'Fast': { title: 'Fast Corners (> 200 km/h)', turns: [], corners: [] }
    };

    turnAverages.forEach(([turn, avgSpeed]) => {
        let cat;
        if (avgSpeed < 130) cat = 'Slow';
        else if (avgSpeed <= 200) cat = 'Medium';
        else cat = 'Fast';
        
        categories[cat].turns.push(turn);
    });
    
    data.corners.forEach(d => {
        const turn = d.turn;
        if (categories['Slow'].turns.includes(turn)) categories['Slow'].corners.push(d);
        else if (categories['Medium'].turns.includes(turn)) categories['Medium'].corners.push(d);
        else if (categories['Fast'].turns.includes(turn)) categories['Fast'].corners.push(d);
    });

    // Step 3: Render Subplots
    const tooltip = d3.select('#tooltip');

    Object.keys(categories).forEach(catKey => {
        const catData = categories[catKey];
        if (catData.turns.length === 0) return; // Skip empty categories

        const subplotWrap = document.createElement('div');
        subplotWrap.className = 'subplot-container';
        
        const title = document.createElement('div');
        title.className = 'subplot-title';
        title.textContent = catData.title;
        subplotWrap.appendChild(title);
        
        const chartDiv = document.createElement('div');
        subplotWrap.appendChild(chartDiv);
        container.appendChild(subplotWrap);

        const margin = { top: 20, right: 30, bottom: 50, left: 50 };
        const width = chartDiv.clientWidth - margin.left - margin.right;
        const height = Math.max(300, catData.turns.length * 40);

        const svg = d3.select(chartDiv)
            .append('svg')
            .attr('width', width + margin.left + margin.right)
            .attr('height', height + margin.top + margin.bottom)
            .append('g')
            .attr('transform', `translate(${margin.left},${margin.top})`);

        const sortedTurns = catData.turns.sort((a, b) => a - b);

        const speedExtent = d3.extent(catData.corners, d => d.speed);
        
        const xScale = d3.scaleLinear()
            // Add a buffer to the domain so force simulation displacements don't fall off the chart
            .domain([speedExtent[0] - 10, speedExtent[1] + 10])
            .range([30, width - 30]) // extra padding for logos
            .nice();

        const yScale = d3.scalePoint()
            .domain(sortedTurns)
            .range([0, height])
            .padding(0.5);

        // Gridlines
        svg.append('g')
            .attr('class', 'gridline')
            .call(d3.axisLeft(yScale)
                .tickSize(-width)
                .tickFormat('')
            );

        // X Axis
        svg.append('g')
            .attr('transform', `translate(0,${height})`)
            .call(d3.axisBottom(xScale).ticks(5))
            .append('text')
            .attr('x', width / 2)
            .attr('y', 40)
            .attr('fill', 'var(--text-muted)')
            .attr('text-anchor', 'middle')
            .style('font-family', 'Montserrat, sans-serif')
            .style('font-weight', '600')
            .text('SPEED (KM/H)');

        // Y Axis
        svg.append('g')
            .call(d3.axisLeft(yScale).tickFormat(d => `T${d}`))
            .selectAll('.tick text')
            .style('fill', 'var(--text-muted)')
            .style('font-family', 'Titillium Web, sans-serif')
            .style('font-weight', '700')
            .style('font-size', '12px');

        const radius = 12;
        const logoSize = 16;

        // Strictly lock the Y-coordinate before simulation so they never bleed vertically
        catData.corners.forEach(d => {
            d.x = xScale(d.speed); // Pre-initialize X so they don't clump at the left edge
            d.fy = yScale(d.turn);
        });

        // Force Simulation to prevent logos overlapping
        const simulation = d3.forceSimulation(catData.corners)
            .force('x', d3.forceX(d => xScale(d.speed)).strength(1))
            .force('collide', d3.forceCollide(radius + 2))
            .stop();

        for (let i = 0; i < 120; ++i) simulation.tick();

        const nodes = svg.selectAll('.team-node')
            .data(catData.corners)
            .enter()
            .append('g')
            .attr('class', 'team-node')
            .attr('transform', d => {
                // Clamp X to ensure logos don't fall off the edges of the SVG canvas
                const clampedX = Math.max(logoSize, Math.min(width - logoSize, d.x));
                return `translate(${clampedX},${d.y})`;
            })
            .style('cursor', 'pointer')
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
                
                d3.select(event.currentTarget).select('circle')
                    .attr('stroke', '#ffffff')
                    .attr('stroke-width', 2)
                    .attr('r', radius + 2);
            })
            .on('mouseout', (event, d) => {
                tooltip.classed('hidden', true);
                d3.select(event.currentTarget).select('circle')
                    .attr('stroke', 'var(--bg-dark)')
                    .attr('stroke-width', 1)
                    .attr('r', radius);
            });

        nodes.append('circle')
            .attr('r', radius)
            .attr('fill', d => d.color || 'var(--accent)')
            .attr('stroke', 'var(--bg-dark)')
            .attr('stroke-width', 1);

        nodes.append('image')
            .attr('xlink:href', d => TEAM_LOGOS[d.team] || '')
            .attr('x', -logoSize / 2)
            .attr('y', -logoSize / 2)
            .attr('width', logoSize)
            .attr('height', logoSize)
            .on('error', function() {
                d3.select(this).style('display', 'none');
            });
    });
}