/**
 * i18n — applies locale translations on page load and on language switch.
 * Translations are stored in /pug_style/locales/{lang}.json.
 * Usage in HTML: data-i18n="key"  |  data-i18n-ph="key"  |  data-i18n-dp="key"
 */
(function () {
    let _t = {};

    const RTL_LANGS = new Set(['ar', 'he', 'fa', 'ur']);

    async function loadLocale(lang) {
        if (lang === 'en') { _t = {}; return; }
        try {
            const res = await fetch(`/pug_style/locales/${lang}.json`);
            if (!res.ok) { _t = {}; return; }
            _t = await res.json();
        } catch (_) {
            _t = {};
        }
    }

    function applyAll() {
        // text content — store original English on first pass so we can restore it
        document.querySelectorAll('[data-i18n]').forEach(el => {
            if (!('i18nEn' in el.dataset)) el.dataset.i18nEn = el.textContent;
            const v = _t[el.dataset.i18n];
            el.textContent = (v !== undefined) ? v : el.dataset.i18nEn;
        });
        document.querySelectorAll('[data-i18n-ph]').forEach(el => {
            if (!('i18nEnPh' in el.dataset)) el.dataset.i18nEnPh = el.placeholder;
            const v = _t[el.dataset.i18nPh];
            el.placeholder = (v !== undefined) ? v : el.dataset.i18nEnPh;
        });
        document.querySelectorAll('[data-i18n-dp]').forEach(el => {
            if (!('i18nEnDp' in el.dataset)) el.dataset.i18nEnDp = el.dataset.placeholder || '';
            const v = _t[el.dataset.i18nDp];
            el.dataset.placeholder = (v !== undefined) ? v : el.dataset.i18nEnDp;
        });
    }

    // Public: get a single translated string (fallback to key)
    window.i18nGet = function (key) { return _t[key] !== undefined ? _t[key] : null; };

    // Public: call when language changes without page reload
    window.applyI18n = async function (lang) {
        await loadLocale(lang);
        applyAll();
        // RTL support
        document.documentElement.dir = RTL_LANGS.has(lang) ? 'rtl' : 'ltr';
        window.dispatchEvent(new Event('langChanged'));
    };

    // Auto-run on DOMContentLoaded
    document.addEventListener('DOMContentLoaded', () => {
        const lang = localStorage.getItem('pug_app_lang') || 'en';
        if (lang !== 'en') {
            window.applyI18n(lang);
        }
    });
})();
