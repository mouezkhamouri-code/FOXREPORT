(() => {
    'use strict';
    const opener=document.querySelector('#sync-log-open');
    if (!window.FoxSync?.getSyncLogs) {
        opener?.remove();
        return;
    }
    if (!opener) return;
    const dialog=document.createElement('dialog');
    dialog.className='sync-log-dialog';
    dialog.innerHTML='<form method="dialog"><div class="sync-log-heading"><div><p class="eyebrow">DIAGNOSTIC</p><h2>Journal des synchronisations</h2></div><button class="button button-secondary" value="close">Fermer</button></div><p class="sync-log-intro">Les 15 dernières tentatives sont affichées. Ouvrez une entrée pour voir le détail et relancer une synchronisation en erreur.</p><div data-sync-log-list></div></form>';
    document.body.append(dialog);
    const list=dialog.querySelector('[data-sync-log-list]');
    const user=document.body.dataset.user || localStorage.getItem('foxreport-user');
    const formatDate=timestamp=>new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'medium'}).format(new Date(timestamp));
    const render=async()=>{
        list.replaceChildren();
        try {
            const entries=await FoxSync.getSyncLogs(user);
            if (!entries.length) {
                const empty=document.createElement('p');
                empty.className='sync-log-empty';
                empty.textContent='Aucune tentative de synchronisation n’a encore été enregistrée.';
                list.append(empty);
                return;
            }
            for (const entry of entries) {
                const details=document.createElement('details');
                details.className=`sync-log-entry sync-log-${entry.status}`;
                const summary=document.createElement('summary');
                const title=document.createElement('strong');
                title.textContent=entry.title;
                const state=document.createElement('span');
                state.className='sync-log-state';
                state.textContent=entry.status==='success'?'Synchronisée':'Échec';
                const date=document.createElement('time');
                date.dateTime=new Date(entry.timestamp).toISOString();
                date.textContent=formatDate(entry.timestamp);
                summary.append(title,state,date);
                details.append(summary);
                const message=document.createElement('p');
                message.textContent=entry.message;
                details.append(message);
                if (entry.status==='error' && entry.retryable) {
                    const retry=document.createElement('button');
                    retry.type='button';retry.className='button button-primary button-small';
                    retry.textContent='Réessayer maintenant';
                    retry.addEventListener('click',async()=>{
                        retry.disabled=true;
                        retry.textContent='Synchronisation…';
                        try { await FoxSync.syncRecord(entry.key); await render(); }
                        catch (error) { retry.disabled=false; retry.textContent='Réessayer maintenant'; message.textContent=error.message; }
                    });
                    details.append(retry);
                }
                if (entry.status==='error' && entry.recordId) {
                    const localRecord = await FoxLocal.get(entry.key);
                    const open=document.createElement('a');
                    open.className='button button-secondary button-small';
                    open.href=`offline.html?id=${encodeURIComponent(localRecord?.id || entry.recordId)}`;
                    open.textContent='Ouvrir le brouillon';
                    details.append(open);
                }
                list.append(details);
            }
        } catch (error) {
            const failure=document.createElement('p');
            failure.className='alert alert-error';
            failure.textContent=`Journal indisponible : ${error.message}`;
            list.append(failure);
        }
    };
    opener.addEventListener('click',async()=>{
        dialog.showModal();
        list.replaceChildren();
        const loading=document.createElement('p');
        loading.className='sync-log-empty';
        loading.textContent='Chargement du journal…';
        list.append(loading);
        await render();
    });
    dialog.addEventListener('close',()=>opener.focus());
})();
