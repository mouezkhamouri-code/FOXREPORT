(() => {
    'use strict';
    // A PDF blob is displayed locally: no navigation into the installed app's scope.
    const isDesktop = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    function open() {
        const dialog = document.createElement('dialog');
        dialog.className = 'report-preview-dialog';
        dialog.setAttribute('aria-label', 'Prévisualisation du rapport PDF');
        const header = document.createElement('div');
        header.className = 'report-preview-toolbar';
        const title = document.createElement('strong');
        title.textContent = 'Prévisualisation du rapport';
        const download = document.createElement('a');
        download.className = 'button button-secondary';
        download.textContent = 'Télécharger le PDF';
        download.hidden = true;
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'button button-secondary';
        close.textContent = 'Fermer';
        const status = document.createElement('p');
        status.className = 'report-preview-status';
        status.setAttribute('role', 'status');
        status.textContent = 'Préparation du rapport…';
        const frame = document.createElement('iframe');
        frame.title = 'Rapport PDF';
        frame.hidden = true;
        header.append(title, download, close);
        dialog.append(header, status, frame);
        document.body.append(dialog);
        const controller = new AbortController();
        let objectUrl;
        let closed = false;
        dialog.addEventListener('close', () => {
            closed = true;
            controller.abort();
            frame.removeAttribute('src');
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            dialog.remove();
        }, {once: true});
        close.addEventListener('click', () => dialog.close());
        dialog.showModal();
        return {
            close: () => dialog.close(),
            async load(url, prepare) {
                if (closed) return;
                status.textContent = 'Chargement du PDF…';
                try {
                    await prepare?.();
                    if (closed) return;
                    const response = await fetch(url, {credentials: 'same-origin', cache: 'no-store', signal: controller.signal});
                    if (!response.ok || !response.headers.get('Content-Type')?.toLowerCase().startsWith('application/pdf')) {
                        throw new Error('Le PDF est indisponible. Vérifiez votre connexion et réessayez.');
                    }
                    const blob = await response.blob();
                    if (closed) return;
                    objectUrl = URL.createObjectURL(blob);
                    download.href = objectUrl;
                    const id = new URL(url, location.href).searchParams.get('id');
                    download.download = `foxreport-${/^\d+$/.test(id || '') ? id : 'modele'}.pdf`;
                    download.hidden = false;
                    frame.src = objectUrl;
                    frame.hidden = false;
                    status.hidden = true;
                } catch (error) {
                    if (closed) return;
                    status.textContent = error.message;
                    status.setAttribute('role', 'alert');
                }
            },
        };
    }
    window.FoxReportPreview = {isDesktop, open};
    document.addEventListener('click', event => {
        if (!isDesktop() || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        const link = event.target.closest('a[href]');
        if (!link) return;
        const url = new URL(link.href, location.href);
        if (url.origin !== location.origin || !url.pathname.endsWith('/rapport.php')) return;
        // The local editor must finish saving and synchronizing before loading its PDF.
        if (link.classList.contains('report-preview') && window.FoxAppMode?.usesLocalReports() && document.querySelector('#report-form')) return;
        event.preventDefault();
        link.closest('dialog')?.close();
        open().load(url.href, link.classList.contains('report-preview') ? window.FoxBeforePreview : undefined);
    });
})();
