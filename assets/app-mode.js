(() => {
    'use strict';
    window.FoxAppMode = {
        usesLocalReports: () => document.body.dataset.localSnapshot === 'true'
            || document.body.dataset.localWorkspace === 'true'
            || window.matchMedia('(display-mode: standalone)').matches
            || navigator.standalone === true,
    };
})();
