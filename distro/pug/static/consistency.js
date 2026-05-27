document.addEventListener('DOMContentLoaded', () => {
    const charts = {};

    function makeChartConfig(ctx, data) {
        if (!data.length) {
            charts[ctx.canvas.id] && charts[ctx.canvas.id].destroy();
            delete charts[ctx.canvas.id];
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            ctx.fillStyle = 'rgba(240,235,224,0.25)';
            ctx.font = "13px 'DM Mono', monospace";
            ctx.textAlign = 'center';
            ctx.fillText('No habits tracked yet.', ctx.canvas.width / 2, ctx.canvas.height / 2);
            return null;
        }
        const labels = data.map(d => {
            const dt = new Date(d.date);
            return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        });
        return {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Daily Completion %',
                    data: data.map(d => d.pct),
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
                            label: c => ` ${c.parsed.y}% habits done`,
                        },
                    },
                },
                scales: {
                    x: {
                        grid: { display: false, drawBorder: false },
                        ticks: { color: '#857a68', font: { family: "'DM Mono', monospace" }, maxTicksLimit: 10 },
                    },
                    y: {
                        min: 0, max: 100,
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
        };
    }

    function renderAll() {
        fetch('/pug/api/habits/history?days=30')
            .then(res => res.json())
            .then(data => {
                ['consistencyChart', 'consistencyChartMobile'].forEach(id => {
                    const canvas = document.getElementById(id);
                    if (!canvas) return;
                    const ctx = canvas.getContext('2d');
                    if (charts[id]) { charts[id].destroy(); delete charts[id]; }
                    const cfg = makeChartConfig(ctx, data);
                    if (cfg) charts[id] = new Chart(ctx, cfg);
                });
            })
            .catch(err => console.error('Habit consistency chart error:', err));
    }

    renderAll();
    window.addEventListener('habitUpdated', renderAll);
    window.addEventListener('langChanged',  renderAll);
    window.addEventListener('habitPulseFlipped', () => {
        ['consistencyChart', 'consistencyChartMobile'].forEach(id => {
            if (charts[id]) charts[id].resize();
        });
    });
});
