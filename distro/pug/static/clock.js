// clock.js
// Updated for the new 2-row clock widget format:
//   Row 1: time  | weather
//   Row 2: date  | day

document.addEventListener('DOMContentLoaded', () => {

    const timeEl    = document.getElementById('cwTime');
    const dateEl    = document.getElementById('cwDate');
    const dayEl     = document.getElementById('cwDay');     // NEW — the full day name
    const weatherEl = document.getElementById('cwWeather');

    // ── Clock ──
    function updateClock() {
        const now = new Date();

        // toLocaleTimeString formats time based on locale
        // hour12: true = 12-hour format with AM/PM
        if (timeEl) {
            timeEl.textContent = now.toLocaleTimeString('en-US', {
                hour:   'numeric',
                minute: '2-digit',
                hour12: true
            });
        }

        // Date: "Jan 4" — short and clean for the second row
        if (dateEl) {
            dateEl.textContent = now.toLocaleDateString('en-US', {
                month: 'short',
                day:   'numeric'
            });
        }

        // Day: "Monday" — full day name on the same row as date
        if (dayEl) {
            dayEl.textContent = now.toLocaleDateString('en-US', {
                weekday: 'long'
            });
        }
    }

    updateClock();
    setInterval(updateClock, 1000); // updates every second


    // ── Weather ──
    function fetchWeather(lat, lon) {
        const url = `/pug/api/weather?lat=${lat}&lon=${lon}`;

        fetch(url)
        .then(res => res.json())
        .then(data => {
            if (!data?.current_weather) throw new Error("No data");

            const temp = Math.round(data.current_weather.temperature);
            const code = data.current_weather.weathercode;

            // WMO weather interpretation codes → emoji
            // Full list: https://open-meteo.com/en/docs
            let icon = '☀️';
            if (code >= 1  && code <= 3)  icon = '⛅';
            if (code >= 45 && code <= 48) icon = '🌫️';
            if (code >= 51 && code <= 67) icon = '🌧️';
            if (code >= 71 && code <= 77) icon = '❄️';
            if (code >= 95)               icon = '⛈️';

            if (weatherEl) weatherEl.textContent = `${icon} ${temp}°C`;
        })
        .catch(() => {
            if (weatherEl) weatherEl.textContent = '☀️ --°';
        });
    }

    function getLocationAndWeather() {
        // Fallback: Chandigarh, India
        const fallbackLat = 30.7333;
        const fallbackLon = 76.7794;

        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                pos  => fetchWeather(pos.coords.latitude, pos.coords.longitude),
                ()   => fetchWeather(fallbackLat, fallbackLon), // denied → use fallback
                { timeout: 5000 }
            );
        } else {
            fetchWeather(fallbackLat, fallbackLon);
        }
    }

    getLocationAndWeather();
    setInterval(getLocationAndWeather, 30 * 60 * 1000); // refresh every 30 mins

});