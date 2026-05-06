document.addEventListener('DOMContentLoaded', () => {
    const daysContainer = document.getElementById('calendarDays');
    const monthDisplay = document.getElementById('monthDisplay');
    const prevBtn = document.getElementById('prevMonth');
    const nextBtn = document.getElementById('nextMonth');
    
    let currentDate = new Date();
    let events = [];

    // --- 1. THE DATA FETCH ---
    window.refreshNexusCalendar = async function() {
        try {
            const res = await fetch('/pug/api/events');
            if (res.ok) {
                events = await res.json();
            }
        } catch (err) {
            console.error("Nexus Sync Failed", err);
        }
        renderCalendar();
    };

    // --- 2. THE RENDER LOGIC ---
    function renderCalendar() {
        if (!daysContainer) return;
        daysContainer.innerHTML = '';
        
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();

        monthDisplay.textContent = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });

        const firstDay = new Date(year, month, 1).getDay();
        const lastDate = new Date(year, month + 1, 0).getDate();

        for (let i = 0; i < firstDay; i++) {
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'calendar-day empty';
            daysContainer.appendChild(emptyDiv);
        }

        for (let d = 1; d <= lastDate; d++) {
            const dayDiv = document.createElement('div');
            dayDiv.className = 'calendar-day';
            dayDiv.textContent = d;

            const checkDate = new Date(year, month, d);
            if (checkDate.toDateString() === new Date().toDateString()) {
                dayDiv.classList.add('today');
            }

            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            if (events.some(e => e.start_datetime && e.start_datetime.startsWith(dateStr))) {
                dayDiv.classList.add('has-event');
            }

            daysContainer.appendChild(dayDiv);
        }
    }

    // --- 3. CONTROLS ---
    if (prevBtn) {
        prevBtn.onclick = (e) => {
            e.preventDefault();
            currentDate.setMonth(currentDate.getMonth() - 1);
            renderCalendar();
        };
    }

    if (nextBtn) {
        nextBtn.onclick = (e) => {
            e.preventDefault();
            currentDate.setMonth(currentDate.getMonth() + 1);
            renderCalendar();
        };
    }

    // Start the engine
    window.refreshNexusCalendar();
});