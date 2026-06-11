/**
 * Weather & DateTime
 * Handles date, time display and weather information
 */

const Weather = {
    elements: {},
    data: null,
    updateInterval: null,
    weatherInterval: null,

    /**
     * Initialize weather module
     */
    init(habitData) {
        this.data = habitData;
        this.cacheElements();
        this.updateDateTime();
        this.updateWeather();
        this.updateGreeting();
        this.startUpdating();
    },

    /**
     * Cache DOM elements
     */
    cacheElements() {
        this.elements = {
            time: document.getElementById('timeDisplay'),
            date: document.getElementById('dateDisplay'),
            weatherIcon: document.getElementById('weatherIcon'),
            weatherTemp: document.getElementById('weatherTemp'),
            weatherDesc: document.getElementById('weatherDesc'),
            greeting: document.getElementById('greetingText')
        };
    },

    /**
     * Update date and time display
     */
    updateDateTime() {
        const now = new Date();

        // Update time
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        this.elements.time.textContent = `${hours}:${minutes}`;

        // Update date
        const options = { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        };
        this.elements.date.textContent = now.toLocaleDateString('en-US', options);

        // Update greeting
        this.updateGreeting();
    },

    /**
     * Update greeting message
     */
    updateGreeting() {
        const greeting = Utils.getCurrentGreeting();
        this.elements.greeting.textContent = `${greeting}, ${this.data.userName} 👋`;
    },

    /**
     * Update weather display
     */
    updateWeather() {
        // Simulated weather data
        // In production, integrate with OpenWeatherMap or similar API
        const weatherConditions = [
            { icon: '☀️', temp: 28, desc: 'Sunny' },
            { icon: '⛅', temp: 25, desc: 'Partly Cloudy' },
            { icon: '☁️', temp: 22, desc: 'Cloudy' },
            { icon: '🌤️', temp: 26, desc: 'Clear' }
        ];

        const weather = weatherConditions[Math.floor(Math.random() * weatherConditions.length)];

        this.elements.weatherIcon.textContent = weather.icon;
        this.elements.weatherTemp.textContent = `${weather.temp}°C`;
        this.elements.weatherDesc.textContent = weather.desc;
    },

    /**
     * Fetch real weather data
     * @param {number} lat - Latitude
     * @param {number} lon - Longitude
     * @param {string} apiKey - API key
     */
    async fetchWeatherData(lat, lon, apiKey) {
        try {
            const response = await fetch(
                `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`
            );
            const data = await response.json();

            if (data.main && data.weather) {
                this.elements.weatherTemp.textContent = `${Math.round(data.main.temp)}°C`;
                this.elements.weatherDesc.textContent = data.weather[0].description;
                this.elements.weatherIcon.textContent = this.getWeatherIcon(data.weather[0].main);
            }
        } catch (error) {
            console.error('Error fetching weather:', error);
        }
    },

    /**
     * Get weather icon emoji
     * @param {string} condition - Weather condition
     * @returns {string} Weather emoji
     */
    getWeatherIcon(condition) {
        const icons = {
            'Clear': '☀️',
            'Clouds': '☁️',
            'Rain': '🌧️',
            'Snow': '❄️',
            'Thunderstorm': '⛈️',
            'Drizzle': '🌦️',
            'Mist': '🌫️'
        };
        return icons[condition] || '🌤️';
    },

    /**
     * Start update intervals
     */
    startUpdating() {
        // Update time every second
        this.updateInterval = setInterval(() => {
            this.updateDateTime();
        }, 1000);

        // Update weather every 30 minutes
        this.weatherInterval = setInterval(() => {
            this.updateWeather();
        }, 1800000);
    },

    /**
     * Stop update intervals
     */
    stopUpdating() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        if (this.weatherInterval) {
            clearInterval(this.weatherInterval);
            this.weatherInterval = null;
        }
    },

    /**
     * Cleanup
     */
    destroy() {
        this.stopUpdating();
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Weather;
}