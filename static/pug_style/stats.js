document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('statsModal');
    const btn = document.getElementById('statsBtn');
    const close = document.querySelector('.close-modal');

    btn.onclick = () => {
        modal.classList.remove('hidden');
        fetchStats();
    };

    close.onclick = () => modal.classList.add('hidden');
    
    window.onclick = (e) => {
        if (e.target == modal) modal.classList.add('hidden');
    };

    function fetchStats() {
        // We'll write the /api/stats route in Flask next.
        // For now, it just shows you're live.
        document.getElementById('stat-notes').innerText = "12"; 
        document.getElementById('stat-streak').innerText = "5 🔥";
    }
});