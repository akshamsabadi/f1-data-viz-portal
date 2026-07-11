export function renderBeeswarm(data) {
    const container = document.getElementById('beeswarm-plot');
    const legendContainer = document.getElementById('beeswarm-legend');
    const outlierToggle = document.getElementById('outlier-toggle');
    
    container.innerHTML = ''; // Clear previous
    if (legendContainer) legendContainer.innerHTML = '';

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

    const tooltip = d3.select('#tooltip');

    const colorScale = d3.scaleOrdinal()
        .domain(['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET', 'UNKNOWN'])
        .range(['#ef4444', '#eab308', '#fafafa', '#22c55e', '#3b82f6', '#a1a1aa']);

    let activeCompounds = new Set(['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET', 'UNKNOWN']);
    let focusedDriver = null;
    let showOutliers = outlierToggle ? outlierToggle.checked : false;

    // Build Interactive Legend
    if (legendContainer) {
        const predefinedOrder = ['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET', 'UNKNOWN'];
        const compoundsInRace = Array.from(new Set(data.laps.map(d => d.compound.toUpperCase())))
            .sort((a, b) => {
                let idxA = predefinedOrder.indexOf(a);
                let idxB = predefinedOrder.indexOf(b);
                if (idxA === -1) idxA = 99;
                if (idxB === -1) idxB = 99;
                return idxA - idxB;
            });

        compoundsInRace.forEach(comp => {
            const item = document.createElement('div');
            item.className = 'legend-item';
            item.innerHTML = `<div class="legend-color" style="background-color: ${colorScale(comp)}"></div>${comp}`;
            item.addEventListener('click', () => {
                if (activeCompounds.has(comp)) {
                    if (activeCompounds.size > 1) {
                        activeCompounds.delete(comp);
                    }
                } else {
                    activeCompounds.add(comp);
                }
                updateLegendUI();
                updateStyles();
            });
            legendContainer.appendChild(item);
        });
        
        function updateLegendUI() {
            Array.from(legendContainer.children).forEach(child => {
                const comp = child.textContent.trim();
                if (activeCompounds.has(comp)) {
                    child.classList.remove('inactive');
                } else {
                    child.classList.add('inactive');
                }
            });
        }
        updateLegendUI();
    }

    if (outlierToggle) {
        outlierToggle.onchange = (e) => {
            showOutliers = e.target.checked;
            drawChart();
        };
    }

    const svg = d3.select('#beeswarm-plot')
        .append('svg')
        .attr('width', width + margin.left + margin.right)
        .attr('height', height + margin.top + margin.bottom);

    const mainGroup = svg.append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);
    
    // Groups for layering (order matters: items appended later appear on top)
    const gridGroup = mainGroup.append('g').attr('class', 'gridline');
    const axesGroup = mainGroup.append('g').attr('class', 'axes');
    const pointsGroup = mainGroup.append('g').attr('class', 'points');
    const mediansGroup = mainGroup.append('g').attr('class', 'medians');

    let updateStyles;

    function drawChart() {
        // Clear previous chart content
        gridGroup.selectAll('*').remove();
        mediansGroup.selectAll('*').remove();
        pointsGroup.selectAll('*').remove();
        axesGroup.selectAll('*').remove();

        const q1 = d3.quantile(data.laps.map(d => d.time).sort(d3.ascending), 0.25);
        const q3 = d3.quantile(data.laps.map(d => d.time).sort(d3.ascending), 0.75);
        const iqr = q3 - q1;
        const maxAllowedTime = q3 + 1.5 * iqr;
        
        const lapsToUse = showOutliers ? data.laps : data.laps.filter(d => d.time <= maxAllowedTime);

        const xScale = d3.scalePoint()
            .domain(orderedDrivers)
            .range([0, width])
            .padding(1);

        const timeExtent = d3.extent(lapsToUse, d => d.time);
        const timePadding = (timeExtent[1] - timeExtent[0]) * 0.05;

        const yScale = d3.scaleLinear()
            .domain([timeExtent[0] - timePadding, timeExtent[1] + timePadding])
            .range([height, 0]);

        // Gridlines
        gridGroup.call(d3.axisLeft(yScale)
            .tickSize(-width)
            .tickFormat('')
            .ticks(10)
        );

        // X Axis
        const xAxisGroup = axesGroup.append('g')
            .attr('transform', `translate(0,${height})`)
            .call(d3.axisBottom(xScale).tickSize(0))
            .call(g => g.select(".domain").remove());

        xAxisGroup.selectAll('.tick text')
            .attr('class', 'driver-label')
            .style('fill', d => driverColorMap[d] || 'var(--text-muted)')
            .style('font-family', 'Montserrat, sans-serif')
            .style('font-weight', '700')
            .style('font-size', '12px')
            .on('click', (event, d) => {
                if (focusedDriver === d) {
                    focusedDriver = null;
                } else {
                    focusedDriver = d;
                }
                updateStyles();
            });

        xAxisGroup.append('text')
            .attr('x', width)
            .attr('y', 40)
            .attr('fill', 'var(--text-muted)')
            .attr('text-anchor', 'end')
            .style('font-family', 'Montserrat, sans-serif')
            .style('font-weight', '600')
            .style('pointer-events', 'none')
            .text('DRIVER (FINISHING ORDER)');

        // Y Axis
        const yAxisGroup = axesGroup.append('g')
            .call(d3.axisLeft(yScale).ticks(10).tickSize(0))
            .call(g => g.select(".domain").remove());
            
        yAxisGroup.append('text')
            .attr('transform', 'rotate(-90)')
            .attr('y', -45)
            .attr('x', 0)
            .attr('fill', 'var(--text-muted)')
            .attr('text-anchor', 'end')
            .style('font-family', 'Montserrat, sans-serif')
            .style('font-weight', '600')
            .text('LAP TIME (S)');
            
        // Medians (calculated now, rendered to mediansGroup which is ABOVE pointsGroup)
        const medians = orderedDrivers.map(driver => {
            const driverLaps = lapsToUse.filter(d => d.driver === driver).map(d => d.time).sort(d3.ascending);
            if (driverLaps.length === 0) return null;
            return {
                driver: driver,
                median: d3.quantile(driverLaps, 0.5)
            };
        }).filter(d => d !== null);

        const medianLines = mediansGroup.selectAll('line.median-line')
            .data(medians)
            .enter()
            .append('line')
            .attr('class', 'median-line')
            .attr('x1', d => xScale(d.driver) - 20)
            .attr('x2', d => xScale(d.driver) + 20)
            .attr('y1', d => yScale(d.median))
            .attr('y2', d => yScale(d.median))
            .attr('stroke', d => driverColorMap[d.driver] || 'var(--text-muted)');

        // Run simulation
        const simulation = d3.forceSimulation(lapsToUse)
            .force('x', d3.forceX(d => xScale(d.driver)).strength(0.2))
            .force('y', d3.forceY(d => yScale(d.time)).strength(1))
            .force('collide', d3.forceCollide(4))
            .stop();

        for (let i = 0; i < 120; ++i) simulation.tick();

        const points = pointsGroup.selectAll('circle.data-point')
            .data(lapsToUse)
            .enter()
            .append('circle')
            .attr('class', 'data-point')
            .attr('cx', d => d.x)
            .attr('cy', d => d.y)
            .attr('r', 0)
            .attr('fill', d => colorScale(d.compound.toUpperCase()))
            .attr('stroke', 'var(--bg-dark)')
            .attr('stroke-width', 1)
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
            
        points.transition()
            .duration(500)
            .delay(d => orderedDrivers.indexOf(d.driver) * 30)
            .ease(d3.easeCubicOut)
            .attr('r', 3.5);
            
        updateStyles = () => {
            points.style('opacity', d => {
                const isCompoundActive = activeCompounds.has(d.compound.toUpperCase());
                const isDriverFocused = focusedDriver === null || focusedDriver === d.driver;
                return (isCompoundActive && isDriverFocused) ? 1 : 0.1;
            });
    
            xAxisGroup.selectAll('.driver-label').style('opacity', d => {
                return (focusedDriver === null || focusedDriver === d) ? 1 : 0.4;
            });
            
            medianLines.style('opacity', d => {
                return (focusedDriver === null || focusedDriver === d.driver) ? 1 : 0.1;
            });
        };
        
        updateStyles();
    }
    
    // Initial draw
    drawChart();
}