document.addEventListener('DOMContentLoaded', () => {
    const ctx = document.getElementById('consistencyChart').getContext('2d');
    let consistencyChart;

    function renderChart() {
        fetch('/pug/api/consistency')
            .then(res => res.json())
            .then(data => {
                const labels      = data.map(d => d.day);
                const addedData   = data.map(d => d.added);
                const finishedData = data.map(d => d.finished);
                const droppedData = data.map(d => d.dropped || 0);

                if (consistencyChart) consistencyChart.destroy();

                consistencyChart = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels,
                        datasets: [
                            {
                                label: 'Goals Set',
                                data: addedData,
                                borderColor: '#e8a020',
                                backgroundColor: 'rgba(232,160,32,0.08)',
                                borderWidth: 2.5,
                                pointBackgroundColor: '#e8a020',
                                pointBorderColor: '#1c1915',
                                pointBorderWidth: 2,
                                pointRadius: 4,
                                tension: 0.4,
                                fill: true,
                            },
                            {
                                label: 'Crushed',
                                data: finishedData,
                                borderColor: '#78b878',
                                backgroundColor: 'rgba(120,184,120,0.08)',
                                borderWidth: 2.5,
                                pointBackgroundColor: '#78b878',
                                pointBorderColor: '#1c1915',
                                pointBorderWidth: 2,
                                pointRadius: 4,
                                tension: 0.4,
                                fill: true,
                            },
                            {
                                label: 'Dropped',
                                data: droppedData,
                                borderColor: '#c85a2a',
                                backgroundColor: 'rgba(200,90,42,0.06)',
                                borderWidth: 2,
                                borderDash: [5, 4],
                                pointBackgroundColor: '#c85a2a',
                                pointBorderColor: '#1c1915',
                                pointBorderWidth: 2,
                                pointRadius: 4,
                                tension: 0.4,
                                fill: false,
                            },
                        ],
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        interaction: { mode: 'index', intersect: false },
                        plugins: {
                            legend: {
                                position: 'top',
                                align: 'end',
                                labels: {
                                    color: '#857a68',
                                    font: { family: "'DM Mono', monospace", size: 11 },
                                    usePointStyle: true,
                                    boxWidth: 8,
                                },
                            },
                            tooltip: {
                                backgroundColor: 'rgba(28,25,21,0.92)',
                                titleColor: '#ede7d4',
                                bodyColor: '#ede7d4',
                                borderColor: '#2c2720',
                                borderWidth: 1,
                                padding: 12,
                                boxPadding: 6,
                            },
                        },
                        scales: {
                            x: {
                                grid: { display: false, drawBorder: false },
                                ticks: { color: '#857a68', font: { family: "'DM Mono', monospace" } },
                            },
                            y: {
                                beginAtZero: true,
                                suggestedMax: 5,
                                grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
                                ticks: {
                                    color: '#857a68',
                                    font: { family: "'DM Mono', monospace" },
                                    stepSize: 1,
                                },
                            },
                        },
                    },
                });
            })
            .catch(err => console.error('Consistency chart error:', err));
    }

    renderChart();
    window.addEventListener('goalUpdated', renderChart);
});
