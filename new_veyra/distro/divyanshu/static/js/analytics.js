/**
 * Analytics Module
 * Weekly vs Monthly performance comparison using Chart.js.
 * Replaces / extends the basic Stats module chart.
 */

const Analytics = {
    data: null,
    chart: null,
    mode: 'weekly',   // 'weekly' | 'monthly'

    init(habitData) {
        this.data = habitData;
        this.attachEvents();
        this.render();
    },

    attachEvents() {
        document.getElementById('weeklyBtn')?.addEventListener('click', () => {
            this.setMode('weekly');
        });
        document.getElementById('monthlyBtn')?.addEventListener('click', () => {
            this.setMode('monthly');
        });
    },

    setMode(mode) {
        this.mode = mode;

        // Toggle button styles
        const wBtn = document.getElementById('weeklyBtn');
        const mBtn = document.getElementById('monthlyBtn');
        if (wBtn) wBtn.classList.toggle('active', mode === 'weekly');
        if (mBtn) mBtn.classList.toggle('active', mode === 'monthly');

        this.render();
    },

    // ── Build dataset ────────────────────────────────────────────────────
    getDataset() {
        const currentMonth = Utils.getCurrentMonth();
        const monthData    = this.data.monthlyData[currentMonth] || { days: {} };
        const days         = this.mode === 'weekly' ? 7 : 30;
        const result       = [];

        for (let i = days - 1; i >= 0; i--) {
            const d    = new Date();
            d.setDate(d.getDate() - i);
            const key  = d.toISOString().slice(0, 10);
            const day  = monthData.days[key] || { completed: 0, total: 0 };
            const rate = day.total > 0 ? Math.round((day.completed / day.total) * 100) : 0;

            result.push({
                label:     this.mode === 'weekly'
                           ? d.toLocaleDateString('en-US', { weekday: 'short' })
                           : d.getDate(),
                completed: day.completed,
                total:     day.total,
                rate
            });
        }
        return result;
    },

    // ── Summary stats ────────────────────────────────────────────────────
    getSummary(dataset) {
        const activeDays = dataset.filter(d => d.total > 0);
        const totalComp  = dataset.reduce((a, d) => a + d.completed, 0);
        const totalGoals = dataset.reduce((a, d) => a + d.total, 0);
        const avgRate    = activeDays.length
            ? Math.round(activeDays.reduce((a, d) => a + d.rate, 0) / activeDays.length)
            : 0;
        const bestDay    = dataset.reduce((best, d) =>
            d.completed > best.completed ? d : best, { completed: 0, label: '--' });

        return { totalComp, totalGoals, avgRate, bestDay, activeDays: activeDays.length };
    },

    // ── Render ────────────────────────────────────────────────────────────
    render() {
        const dataset = this.getDataset();
        const summary = this.getSummary(dataset);

        // Update summary cards
        const set = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };

        set('analyticsCompleted', summary.totalComp);
        set('analyticsTotal',     summary.totalGoals);
        set('analyticsRate',      summary.avgRate + '%');
        set('analyticsBestDay',   summary.bestDay.label);
        set('analyticsActiveDays',summary.activeDays);
        set('analyticsPeriod',
            this.mode === 'weekly' ? 'Last 7 days' : 'Last 30 days');

        this.renderChart(dataset);
    },

    renderChart(dataset) {
        const canvas = document.getElementById('analyticsChart');
        if (!canvas) return;

        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
        }

        const labels    = dataset.map(d => d.label);
        const completed = dataset.map(d => d.completed);
        const total     = dataset.map(d => d.total);
        const rates     = dataset.map(d => d.rate);

        const textColor   = getComputedStyle(document.documentElement).getPropertyValue('--text-dim').trim();
        const borderColor = getComputedStyle(document.documentElement).getPropertyValue('--border').trim();

        this.chart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Completed',
                        data: completed,
                        backgroundColor: 'rgba(88, 166, 255, 0.75)',
                        borderColor:     'rgba(88, 166, 255, 1)',
                        borderWidth: 1,
                        borderRadius: 4,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Total Goals',
                        data: total,
                        backgroundColor: 'rgba(139, 148, 158, 0.25)',
                        borderColor:     'rgba(139, 148, 158, 0.5)',
                        borderWidth: 1,
                        borderRadius: 4,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Success Rate %',
                        data: rates,
                        type: 'line',
                        borderColor:     'rgba(63, 185, 80, 1)',
                        backgroundColor: 'rgba(63, 185, 80, 0.1)',
                        borderWidth: 2,
                        pointRadius: 3,
                        fill: true,
                        tension: 0.4,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    y: {
                        beginAtZero: true,
                        position: 'left',
                        ticks:  { color: textColor, stepSize: 1 },
                        grid:   { color: borderColor }
                    },
                    y1: {
                        beginAtZero: true,
                        max: 100,
                        position: 'right',
                        ticks:  { color: textColor, callback: v => v + '%' },
                        grid:   { drawOnChartArea: false }
                    },
                    x: {
                        ticks: { color: textColor, maxRotation: 0 },
                        grid:  { color: borderColor }
                    }
                },
                plugins: {
                    legend: {
                        labels: { color: textColor, boxWidth: 12 }
                    },
                    tooltip: {
                        callbacks: {
                            label: ctx => {
                                if (ctx.dataset.label === 'Success Rate %') {
                                    return ` ${ctx.raw}% success rate`;
                                }
                                return ` ${ctx.dataset.label}: ${ctx.raw}`;
                            }
                        }
                    }
                }
            }
        });
    },

    /**
     * Call this after any goals change so the chart stays current.
     */
    updateStats() {
        this.render();
    },

    destroy() {
        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
        }
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Analytics;
}