document.addEventListener('DOMContentLoaded', () => {
    const timeEl = document.getElementById('cwTime');
    const dateEl = document.getElementById('cwDate');
    const weatherEl = document.getElementById('cwWeather');

    // --- 1. REAL-TIME CLOCK (12-Hour Local Time) ---
    function updateClock() {
        const now = new Date();
        
        timeEl.textContent = now.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit',
            hour12: true 
        });
        
        dateEl.textContent = now.toLocaleDateString('en-US', { 
            weekday: 'short', 
            month: 'short', 
            day: 'numeric' 
        });
    }
    
    updateClock();
    setInterval(updateClock, 1000);

    // --- 2. DYNAMIC WEATHER FETCHING ---
    function fetchWeather(lat, lon) {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;

        fetch(url)
            .then(res => res.json())
            .then(data => {
                if (!data || !data.current_weather) throw new Error("Invalid weather data");
                
                const temp = Math.round(data.current_weather.temperature);
                const code = data.current_weather.weathercode;
                
                // WMO Weather interpretation codes
                let icon = '☀️'; 
                if (code >= 1 && code <= 3) icon = '⛅'; 
                else if (code >= 45 && code <= 48) icon = '🌫️'; 
                else if (code >= 51 && code <= 67) icon = '🌧️'; 
                else if (code >= 71 && code <= 77) icon = '❄️'; 
                else if (code >= 95) icon = '⛈️'; 

                if (weatherEl) {
                    weatherEl.textContent = `${icon} ${temp}°`;
                }
            })
            .catch(err => {
                console.error("Weather fetch failed:", err);
                if (weatherEl) weatherEl.textContent = "☀️ --°";
            });
    }

    // --- 3. BULLETPROOF GEOLOCATION ---
    function getLocationAndWeather() {
        // Fallback coordinates (Chandigarh / Punjab area)
        const fallbackLat = 30.7333;
        const fallbackLon = 76.7794;

        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    // Success! 
                    fetchWeather(position.coords.latitude, position.coords.longitude);
                },
                (error) => {
                    // Denied or Failed -> Use Fallback
                    console.warn("Location issue (denied or timeout). Using fallback coords.");
                    fetchWeather(fallbackLat, fallbackLon);
                },
                { timeout: 5000 } // Don't wait more than 5 seconds for the GPS
            );
        } else {
            // Browser too old -> Use Fallback
            fetchWeather(fallbackLat, fallbackLon);
        }
    }

    getLocationAndWeather();
    setInterval(getLocationAndWeather, 30 * 60 * 1000); // Check every 30 mins
});