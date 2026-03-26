

const UI = {
   
    popCheck: (el) => {
        el.style.transition = "transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)";
        el.style.transform = "scale(0.8)";
        setTimeout(() => {
            el.style.transform = "scale(1.2)";
            setTimeout(() => el.style.transform = "scale(1)", 150);
        }, 50);
    },

    
    switchTab: (activeTab, allTabs) => {
        allTabs.forEach(tab => {
            const section = document.getElementById(`section-${tab}`);
            const btn = document.getElementById(`tab-${tab}`);
            
            if (tab === activeTab) {
                section.style.display = 'block';
                section.style.opacity = '0';
                section.style.transform = 'translateY(15px)';
                btn.classList.add('active');
                
                
                setTimeout(() => {
                    section.style.transition = "all 0.4s ease-out";
                    section.style.opacity = '1';
                    section.style.transform = 'translateY(0)';
                }, 10);
            } else {
                section.style.display = 'none';
                btn.classList.remove('active');
            }
        });
    },

    
    staggerLoad: (selector, delay = 80) => {
        const elements = document.querySelectorAll(selector);
        elements.forEach((el, i) => {
            el.style.opacity = "0";
            el.style.transform = "translateY(20px)";
            el.style.transition = "all 0.5s ease-out";
            setTimeout(() => {
                el.style.opacity = "1";
                el.style.transform = "translateY(0)";
            }, i * delay);
        });
    },

    
    toggleAuth: (loginId, signupId, containerId) => {
        const container = document.getElementById(containerId);
        container.style.transition = "all 0.4s ease";
        container.style.opacity = "0.5";
        container.style.transform = "scale(0.95) translateY(10px)";
        
        setTimeout(() => {
            document.getElementById(loginId).classList.toggle('hidden');
            document.getElementById(signupId).classList.toggle('hidden');
            container.style.opacity = "1";
            container.style.transform = "scale(1) translateY(0)";
        }, 200);
    },

    
    shake: (el) => {
        el.animate([
            { transform: 'translateX(0)' },
            { transform: 'translateX(-5px)' },
            { transform: 'translateX(5px)' },
            { transform: 'translateX(0)' }
        ], { duration: 200, iterations: 2 });
    }
};


window.UI = UI;