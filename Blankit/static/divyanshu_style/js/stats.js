/**
 * Statistics & Charts
 * Handles monthly statistics and Chart.js visualizations
 */

const Stats = {
    elements: {},
    data: null,
    chart: null,

    /**
     * Initialize stats module
     */
    init(habitData) {
        this.data = habitData;
        this.cacheElements();
        this.updateStats();
        this.updateChart();
    },

    /**
     * Cache DOM elements
     */
    cacheElements() {
        this.elements = {
            totalGoals: document.getElementById('totalGoalsMonth'),
            completedGoals: document.getElementById('completedGoalsMonth'),
            completionRate: document.getElementById('completionRate'),
            chartCanvas: document.getElementById('monthlyChart')
        };
    },

    /**
     * Update statistics display
     */
    updateStats() {
        const currentMonth = Utils.getCurrentMonth();
        const monthData = this.data.monthlyData[currentMonth];

        if (!monthData) return;

        this.elements.totalGoals.textContent = monthData.totalGoals;
        this.elements.completedGoals.textContent = monthData.completedGoals;

        const rate = Utils.calculatePercentage(
            monthData.completedGoals,
            monthData.totalGoals
        );
        this.elements.completionRate.textContent = rate + '%';
    },

    /**
     * Update chart visualization
     */
    updateChart() {
        const currentMonth = Utils.getCurrentMonth();
        const monthData = this.data.monthlyData[currentMonth] || { days: {} };
        
        const chartData = DataManager.getLastNDays(monthData, 30);
        
        const labels = chartData.map(d => d.date);
        const completedData = chartData.map(d => d.completed);
        const totalData = chartData.map(d => d.total);

        if (this.chart) {
            this.chart.destroy();
        }

        this.chart = new Chart(this.elements.chartCanvas, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Completed Goals',
                        data: completedData,
                        backgroundColor: 'rgba(88, 166, 255, 0.7)',
                        borderColor: 'rgba(88, 166, 255, 1)',
                        borderWidth: 1
                    },
                    {
                        label: 'Total Goals',
                        data: totalData,
                        backgroundColor: 'rgba(139, 148, 158, 0.3)',
                        borderColor: 'rgba(139, 148, 158, 0.5)',
                        borderWidth: 1
                    }
                ]
            },
            options: this.getChartOptions()
        });
    },

    /**
     * Get chart configuration options
     * @returns {Object} Chart options
     */
    getChartOptions() {
        return {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { 
                        color: getComputedStyle(document.documentElement)
                            .getPropertyValue('--text-dim'),
                        stepSize: 1
                    },
                    grid: {
                        color: getComputedStyle(document.documentElement)
                            .getPropertyValue('--border')
                    }
                },
                x: {
                    ticks: { 
                        color: getComputedStyle(document.documentElement)
                            .getPropertyValue('--text-dim')
                    },
                    grid: {
                        color: getComputedStyle(document.documentElement)
                            .getPropertyValue('--border')
                    }
                }
            },
            plugins: {
                legend: {
                    labels: {
                        color: getComputedStyle(document.documentElement)
                            .getPropertyValue('--text')
                    }
                }
            }
        };
    },

    /**
     * Destroy chart instance
     */
    destroy() {
        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
        }
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Stats;
}