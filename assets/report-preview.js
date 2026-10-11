(() => {
    'use strict';
    const isDesktop = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    function open() {
        // Reserve the external page during the click so async preparation does not lose the user gesture.
        const viewer = window.open('', '_blank');
        if (viewer) {
            viewer.opener = null;
            viewer.document.title = 'Prévisualisation du rapport';
            viewer.document.body.textContent = 'Préparation du rapport…';
        }
        return {
            close: () => viewer?.close(),
            async load(url, prepare) {
                try {
                    if (!viewer) throw new Error('Autorisez les fenêtres contextuelles pour ouvrir la prévisualisation du rapport.');
                    await prepare?.();
                    if (viewer.closed) return;
                    // The browser PDF reader opens as a top-level page, without iframe restrictions.
                    viewer.location.href = url;
                } catch (error) {
                    viewer?.close();
                    throw error;
                }
            },
        };
    }
    function showError(error) {
        if (window.FoxSaveFeedback) window.FoxSaveFeedback.show(error.message, 'error');
        else {
            const state = document.querySelector('#sync-state');
            if (state) { state.textContent = error.message; state.setAttribute('role', 'alert'); }
            else window.alert(error.message);
        }
    }
    window.FoxReportPreview = {isDesktop, open};
    document.addEventListener('click', event => {
        if (!isDesktop() || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        const link = event.target.closest('a[href]');
        if (!link) return;
        const url = new URL(link.href, location.href);
        if (url.origin !== location.origin || !url.pathname.endsWith('/rapport.php')) return;
        // The local editor synchronizes its changes before loading the external PDF page.
        if (link.classList.contains('report-preview') && window.FoxAppMode?.usesLocalReports() && document.querySelector('#report-form')) return;
        event.preventDefault();
        link.closest('dialog')?.close();
        open().load(url.href, link.classList.contains('report-preview') ? window.FoxBeforePreview : undefined).catch(showError);
    });
})();
