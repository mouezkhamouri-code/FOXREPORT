(() => {
    'use strict';
    let generation=0;
    function display(state,message) {
        document.body.dataset.connectionState=state;
        const header=document.querySelector('.topbar');
        if (header) header.setAttribute('aria-label',message);
    }
    async function refresh() {
        const current=++generation;
        const user=document.body.dataset.user || localStorage.getItem('foxreport-user');
        if (!user || !window.FoxLocal) return;
        try {
            const records=(await FoxLocal.all()).filter(record=>record.user===user && !record.conflictResolved);
            if (current!==generation) return;
            if (!navigator.onLine) display('pending','Hors connexion');
            else if (records.some(record=>record.conflict || record.error)) display('error','Erreur de synchronisation ou conflit à résoudre');
            else if (records.some(record=>record.dirty || record.operation || record.resolutionPending || record.photos?.length)) {
                display('pending','Modifications en attente de synchronisation');
            } else display('synced','Connecté · tous les rapports locaux sont synchronisés');
        } catch(error) {
            if (current!==generation) return;
            display('error',`Erreur de stockage local : ${error.message}`);
            const status=document.querySelector('#local-sync-status');
            if (status) { status.setAttribute('role','alert');status.textContent=`Erreur de stockage local : ${error.message}`; }
        }
    }
    function edited(event) {
        if (!event.target?.closest('#report-form')) return;
        generation++;
        display('pending',navigator.onLine?'Saisie en attente de synchronisation':'Hors connexion');
    }
    document.addEventListener('input',edited);
    document.addEventListener('change',edited);
    document.addEventListener('fox-change',edited);
    for (const event of ['fox-local-change','fox-synced','fox-page-restored']) document.addEventListener(event,refresh);
    window.addEventListener('online',refresh);
    window.addEventListener('offline',()=>{
        generation++;display('pending','Hors connexion');
    });
    window.addEventListener('pageshow',refresh);
    display('pending','Vérification de la synchronisation');
    refresh();
})();
