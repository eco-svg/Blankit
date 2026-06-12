/**
 * i18n — applies locale translations on page load and on language switch.
 * Translations are stored in /pug_style/locales/{lang}.json.
 * Usage in HTML: data-i18n="key"  |  data-i18n-ph="key"  |  data-i18n-dp="key"
 */
(function () {
    /** @type {Record<string, string>} */
    let _t = {};

    const RTL_LANGS = new Set(['ar', 'he', 'fa', 'ur']);

    /** @param {string} lang */
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
        const textEls = /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-i18n]'));
        textEls.forEach(el => {
            if (!('i18nEn' in el.dataset)) el.dataset.i18nEn = el.textContent || '';
            const v = _t[el.dataset.i18n || ''];
            el.textContent = (v !== undefined) ? v : (el.dataset.i18nEn || '');
        });
        const phEls = /** @type {NodeListOf<HTMLInputElement>} */ (document.querySelectorAll('[data-i18n-ph]'));
        phEls.forEach(el => {
            if (!('i18nEnPh' in el.dataset)) el.dataset.i18nEnPh = el.placeholder;
            const v = _t[el.dataset.i18nPh || ''];
            el.placeholder = (v !== undefined) ? v : (el.dataset.i18nEnPh || '');
        });
        const dpEls = /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-i18n-dp]'));
        dpEls.forEach(el => {
            if (!('i18nEnDp' in el.dataset)) el.dataset.i18nEnDp = el.dataset.placeholder || '';
            const v = _t[el.dataset.i18nDp || ''];
            el.dataset.placeholder = (v !== undefined) ? v : (el.dataset.i18nEnDp || '');
        });
    }

    // Public: get a single translated string (fallback to key)
    /** @param {string} key */
    function i18nGet(key) { return _t[key] !== undefined ? _t[key] : null; }

    // Public: call when language changes without page reload
    /** @param {string} lang */
    async function applyI18n(lang) {
        await loadLocale(lang);
        applyAll();
        // RTL support
        document.documentElement.dir = RTL_LANGS.has(lang) ? 'rtl' : 'ltr';
        window.dispatchEvent(new Event('langChanged'));
    }

    Object.assign(window, { i18nGet, applyI18n });

    // Auto-run on DOMContentLoaded
    document.addEventListener('DOMContentLoaded', () => {
        const lang = localStorage.getItem('pug_app_lang') || 'en';
        if (lang !== 'en') {
            applyI18n(lang);
        }
    });
})();
