document.addEventListener('DOMContentLoaded', () => {
    const cards = document.querySelectorAll('.route-card');

    // Adds a spotlight glow effect that tracks the mouse inside the card
    cards.forEach(card => {
        const glow = card.querySelector('.card-glow');
        
        card.addEventListener('mousemove', (e) => {
            const rect = card.getBoundingClientRect();
            
            // Calculate mouse position relative to the card
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            // Move the glowing orb directly under the cursor
            glow.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
        });

        // Reset glow position when mouse leaves
        card.addEventListener('mouseleave', () => {
            glow.style.transform = `translate(50%, 50%) translate(-50%, -50%)`;
        });
    });
});