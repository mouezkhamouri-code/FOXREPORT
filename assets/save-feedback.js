(() => {
    'use strict';
    let notice;
    let dismissTimer;
    function show(text, kind = 'success') {
        if (!notice) {
            notice = document.createElement('div');
            notice.className = 'save-feedback';
            notice.setAttribute('aria-live', 'polite');
            document.body.append(notice);
        }
        clearTimeout(dismissTimer);
        notice.hidden = false;
        notice.dataset.state = kind;
        notice.setAttribute('role', kind === 'error' ? 'alert' : 'status');
        notice.textContent = text;
        if (kind === 'success' || kind === 'info') dismissTimer = setTimeout(() => { notice.hidden = true; }, 7000);
    }
    window.FoxSaveFeedback = {
        show,
        begin(button) {
            const label = button?.textContent;
            if (button) {
                button.textContent = 'Enregistrement…';
                button.classList.add('is-saving');
                button.setAttribute('aria-busy', 'true');
                // Keep the native submitter enabled so its name/value is sent to PHP.
                button.setAttribute('aria-disabled', 'true');
            }
            show('Enregistrement du brouillon…', 'pending');
            return {
                finish(text, kind = 'success') {
                    if (button) {
                        button.textContent = label;
                        button.classList.remove('is-saving');
                        button.removeAttribute('aria-busy');
                        button.removeAttribute('aria-disabled');
                    }
                    show(text, kind);
                },
            };
        },
    };
    if (document.body.dataset.saveConfirmed === 'true' && document.body.dataset.localSnapshot !== 'true') show('✓ Brouillon enregistré avec succès sur le serveur.');
})();
