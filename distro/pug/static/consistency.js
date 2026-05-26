document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('consistencyChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let chart;

    function renderChart() {
        fetch('/pug/api/habits/history?days=30')
            .then(res => res.json())
            .then(data => {
                if (!data.length) {
                    if (chart) chart.destroy();
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.fillStyle = 'rgba(240,235,224,0.25)';
                    ctx.font = "13px 'DM Mono', monospace";
                    ctx.textAlign = 'center';
                    ctx.fillText('No habits tracked yet.', canvas.width / 2, canvas.height / 2);
                    return;
                }

                const labels = data.map(d => {
                    const dt = new Date(d.date);
                    return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                });
                const pcts = data.map(d => d.pct);

                if (chart) chart.destroy();

                chart = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels,
                        datasets: [{
                            label: 'Daily Completion %',
                            data: pcts,
                            borderColor: '#d4a574',
                            backgroundColor: 'rgba(212,165,116,0.08)',
                            borderWidth: 2.5,
                            pointBackgroundColor: '#d4a574',
                            pointBorderColor: '#1c1915',
                            pointBorderWidth: 2,
                            pointRadius: 4,
                            tension: 0.4,
                            fill: true,
                        }],
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
                                callbacks: {
                                    label: ctx => ` ${ctx.parsed.y}% habits done`,
                                },
                            },
                        },
                        scales: {
                            x: {
                                grid: { display: false, drawBorder: false },
                                ticks: { color: '#857a68', font: { family: "'DM Mono', monospace" }, maxTicksLimit: 10 },
                            },
                            y: {
                                min: 0,
                                max: 100,
                                grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
                                ticks: {
                                    color: '#857a68',
                                    font: { family: "'DM Mono', monospace" },
                                    stepSize: 25,
                                    callback: v => v + '%',
                                },
                            },
                        },
                    },
                });
            })
            .catch(err => console.error('Habit consistency chart error:', err));
    }

    renderChart();
    window.addEventListener('habitUpdated', renderChart);
    window.addEventListener('langChanged',  renderChart);
});
