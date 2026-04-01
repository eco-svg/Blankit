document.addEventListener('DOMContentLoaded', () => {
    const ctx = document.getElementById('consistencyChart').getContext('2d');
    let consistencyChart;

    function renderChart() {
        fetch('/api/consistency')
            .then(res => res.json())
            .then(data => {
                const labels = data.map(d => d.day);
                const addedData = data.map(d => d.added);
                const finishedData = data.map(d => d.finished);

                // If the chart already exists, destroy it before redrawing
                if (consistencyChart) {
                    consistencyChart.destroy();
                }

                consistencyChart = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: [
                            {
                                label: 'Goals Set',
                                data: addedData,
                                borderColor: '#e8a020', // var(--accent)
                                backgroundColor: 'rgba(232, 160, 32, 0.1)',
                                borderWidth: 3,
                                pointBackgroundColor: '#e8a020',
                                pointBorderColor: '#1c1915',
                                pointBorderWidth: 2,
                                pointRadius: 5,
                                tension: 0.4, // Makes the line smoothly curved
                                fill: true
                            },
                            {
                                label: 'Goals Crushed',
                                data: finishedData,
                                borderColor: '#78b878', // var(--green)
                                backgroundColor: 'rgba(120, 184, 120, 0.1)',
                                borderWidth: 3,
                                pointBackgroundColor: '#78b878',
                                pointBorderColor: '#1c1915',
                                pointBorderWidth: 2,
                                pointRadius: 5,
                                tension: 0.4,
                                fill: true
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        interaction: {
                            mode: 'index',
                            intersect: false,
                        },
                        plugins: {
                            legend: {
                                position: 'top',
                                align: 'end',
                                labels: {
                                    color: '#857a68', // var(--text-muted)
                                    font: { family: "'DM Mono', monospace", size: 11 },
                                    usePointStyle: true,
                                    boxWidth: 8
                                }
                            },
                            tooltip: {
                                backgroundColor: 'rgba(28, 25, 21, 0.9)', // var(--bg-card)
                                titleColor: '#ede7d4',
                                bodyColor: '#ede7d4',
                                borderColor: '#2c2720',
                                borderWidth: 1,
                                padding: 12,
                                boxPadding: 6
                            }
                        },
                        scales: {
                            x: {
                                grid: { display: false, drawBorder: false },
                                ticks: { color: '#857a68', font: { family: "'DM Mono', monospace" } }
                            },
                            y: {
                                beginAtZero: true,
                                suggestedMax: 5, // Keeps the graph looking nice even if empty
                                grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false },
                                ticks: { 
                                    color: '#857a68', 
                                    font: { family: "'DM Mono', monospace" },
                                    stepSize: 1 // Only show whole numbers (you can't finish 1.5 goals)
                                }
                            }
                        }
                    }
                });
            })
            .catch(err => console.error("Error loading consistency data:", err));
    }

    // Render on load
    renderChart();

    // OPTIONAL PRO-MOVE: 
    // Listen for a custom event so the chart updates instantly when you add/finish a goal!
    window.addEventListener('goalUpdated', renderChart);
});