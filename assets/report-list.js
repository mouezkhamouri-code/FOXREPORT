(() => {
    'use strict';
    const list = document.querySelector('#live-report-list');
    if (!list) return;
    const state = document.querySelector('#report-list-state');
    const errorPanel = document.querySelector('#report-list-error');
    const filter = list.dataset?.filter || 'open';
    let timer;
    let busy = false;
    let expired = false;
    let deleting = false;
    let controller;
    async function refresh() {
        clearTimeout(timer);
        if (busy || deleting || expired || document.hidden) return;
        if (!navigator.onLine) {
            state.textContent = 'Hors ligne — liste serveur non actualisée. Ouvrez les brouillons locaux depuis le menu.';
            return;
        }
        busy = true;
        controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetch(`index.php?api=reports&filter=${encodeURIComponent(filter)}`, {cache:'no-store', signal:controller.signal});
            if (response.status === 401) {
                expired = true;
                throw new Error('Session expirée : reconnectez-vous avec Google pour actualiser les rapports.');
            }
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Actualisation des rapports refusée.');
            if (typeof result.html !== 'string') throw new Error('Réponse de liste invalide.');
            if (!list.querySelector('dialog[open]') && !list.contains?.(document.activeElement) && list.innerHTML !== result.html) list.innerHTML = result.html;
            errorPanel.hidden = true;
            errorPanel.textContent = '';
            state.textContent = `Liste à jour · ${new Date().toLocaleTimeString('fr-FR')} · actualisation toutes les 3 secondes`;
        } catch (error) {
            errorPanel.textContent = error.name === 'AbortError' ? 'Actualisation trop longue. Nouvelle tentative automatique.' : error.message;
            errorPanel.hidden = false;
            state.textContent = 'Liste non actualisée · les dernières données affichées sont conservées.';
        } finally {
            clearTimeout(timeout);
            busy = false;
            if (!expired && !document.hidden && navigator.onLine) timer = setTimeout(refresh, 3000);
        }
    }
    list.addEventListener('click', event=>{
        const opener=event.target.closest('.report-actions-open');
        if (opener) {
            const dialog=document.getElementById(opener.dataset.dialog);
            if (dialog) dialog.showModal();
            return;
        }
        const closer=event.target.closest('.report-actions-close');
        if (closer) closer.closest('dialog').close();
    });
    list.addEventListener('submit', async event => {
        const form = event.target.closest('.delete-report-form');
        if (!form) return;
        event.preventDefault();
        if (deleting) return;
        if (!navigator.onLine) {
            errorPanel.textContent = 'Connexion requise pour supprimer un rapport sur le serveur.';
            errorPanel.hidden = false;
            return;
        }
        if (!confirm('Supprimer définitivement ce rapport pour toute l’équipe, avec son matériel et ses photos ? Les modifications locales de cet appareil seront également supprimées.')) return;
        const body = new FormData(form);
        deleting = true;
        clearTimeout(timer);
        controller?.abort();
        const button = form.querySelector('button');
        button.disabled = true;
        try {
            const response = await fetch('index.php?api=delete', {method:'POST', body, cache:'no-store'});
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Suppression refusée.');
            if (Number(result.deleted) !== Number(body.get('report_id'))) throw new Error('Réponse de suppression invalide.');
            if (window.FoxLocal) {
                const key=`${document.body.dataset.user}:${result.deleted}`;
                const local=await window.FoxLocal.get(key);
                if (!local?.conflictResolved) await window.FoxLocal.remove(key);
            }
            if (result.warning) alert(result.warning);
            state.textContent = 'Rapport supprimé.';
            const dialog=form.closest('dialog');
            const card=form.closest('.report-card');
            dialog?.close();
            card?.querySelector('.report-card-open')?.focus();
            card?.remove();
        } catch (error) {
            alert(`Suppression : ${error.message}`);
        } finally {
            deleting = false;
            button.disabled = false;
            await refresh();
        }
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) clearTimeout(timer);
        else refresh();
    });
    window.addEventListener('online', refresh);
    window.addEventListener('offline', () => { clearTimeout(timer); state.textContent = 'Hors ligne — liste serveur non actualisée.'; });
    window.addEventListener('pageshow', refresh);
    window.addEventListener('pagehide', () => {clearTimeout(timer); controller?.abort();});
    refresh();
})();
