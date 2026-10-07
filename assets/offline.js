(async () => {
    'use strict';
    try {
        const user=localStorage.getItem('foxreport-user');
        if(!user) throw new Error('Connectez-vous en ligne une première fois pour préparer FoxReport sur cet appareil.');
        const reports=(await FoxLocal.all()).filter(report=>report.user===user);
        const requested=new URLSearchParams(location.search).get('id');
        if(requested) {
            const report=reports.find(item=>String(item.id)===requested);
            if(!report) throw new Error('Ce rapport n’est pas disponible sur cet appareil.');
            const template=await FoxLocal.getTemplate(user);
            const page=new DOMParser().parseFromString(template?.html || report.html,'text/html');
            document.body.replaceWith(document.importNode(page.body,true));
            document.dispatchEvent(new Event('fox-page-restored'));
            document.body.dataset.user=user;
            document.body.dataset.localSnapshot='true';
            document.querySelector('[name="report_id"]').value=report.id;
            document.querySelector('[name="revision"]').value=String(report.revision);
            document.querySelector('#report-form').action=`index.php?id=${report.serverId || report.id}`;
            document.querySelector('.editor-heading h1').textContent=report.title;
            document.querySelector('.editor-heading .intro').textContent=report.serverId
                ? `Rapport #${report.serverId} · copie enregistrée sur cet appareil`
                : 'Brouillon local · enregistré sur cet appareil';
            if(report.status==='finalized') {
                document.querySelector('#report-form fieldset').disabled=true;
                const actions=document.querySelector('.form-actions');
                actions.replaceChildren();
                const link=document.createElement('a');link.className='button button-secondary';
                link.href=`index.php?id=${report.serverId || report.id}`;
                link.textContent='Rapport clôturé · rouvrir en ligne';
                actions.append(link);
            }
            document.querySelectorAll('.editor-tools a').forEach(link=>{
                link.href=report.serverId?`rapport.php?id=${report.serverId}`:'rapport.php';
            });
            for(const file of ['assets/app.js','assets/photos.js','assets/scanner.js','assets/location.js','assets/pwa.js']) {
                await new Promise((resolve,reject)=>{
                    const script=document.createElement('script');
                    const version=document.documentElement.dataset.appVersion;
                    script.src=version?`${file}?v=${encodeURIComponent(version)}`:file;
                    script.onload=resolve;script.onerror=()=>reject(new Error(`Ressource hors ligne absente : ${file}`));
                    document.head.append(script);
                });
            }
            return;
        }
        const container=document.querySelector('#offline-reports');
        const status=document.querySelector('#local-sync-status');
        const errorPanel=document.querySelector('#offline-error');
        async function render() {
            const records=(await FoxLocal.all()).filter(report=>report.user===user);
            container.replaceChildren();
            const pending=await FoxSync.pendingState(user);
            status.textContent=`${navigator.onLine?'Connecté':'Hors ligne — enregistré sur cet appareil'} · ${pending.changes} modification(s) en attente · ${pending.drafts} rapport(s) · ${pending.photos} photo(s)`;
            if(!records.length) container.textContent='Aucun rapport enregistré localement. Vous pouvez créer un brouillon avec « Nouveau rapport ».';
            records.sort((a,b)=>b.modified-a.modified).forEach(report=>{
                const panel=document.createElement('section');panel.className='panel local-report';
                const title=document.createElement('h2');title.textContent=report.title;
                const state=document.createElement('p');
                state.textContent=report.conflictResolved?'Conflit résolu · original archivé, données et photos conservées.':report.conflict?`Conflit actif · ${report.error || 'conflit de versions'}. Données locales conservées.`:report.dirty||report.operation?'À synchroniser':'Enregistré sur le serveur et cet appareil';
                const link=document.createElement('a');link.className='button button-primary';
                link.href=`offline.html?id=${encodeURIComponent(report.id)}`;link.textContent=report.conflictResolved?'Consulter l’archive':report.conflict?'Résoudre':'Reprendre ce rapport';
                const remove=document.createElement('button');remove.className='button button-secondary';
                remove.textContent='Retirer la copie de cet appareil';
                remove.onclick=async()=>{
                    try {
                        const current=await FoxLocal.get(report.key);
                        if(current.conflictResolved) throw new Error('Cette archive conserve les saisies et photos originales et ne peut pas être retirée ici.');
                        if(current.dirty || current.operation) throw new Error('Synchronisez les modifications et photos avant de retirer cette copie.');
                        if(!confirm('Retirer uniquement la copie locale déjà sauvegardée sur le serveur ?')) return;
                        await FoxLocal.remove(report.key);
                    } catch(error) { errorPanel.textContent=error.message; }
                };
                panel.append(title,state,link);
                if (report.conflictResolved && report.resolvedCopyKey) {
                    const copy=records.find(item=>item.key===report.resolvedCopyKey);
                    if(copy) {
                        const resume=document.createElement('a');resume.className='button button-secondary';
                        resume.href=`offline.html?id=${encodeURIComponent(copy.id)}`;resume.textContent='Ouvrir la copie';
                        panel.append(resume);
                    }
                }
                panel.append(remove);container.append(panel);
            });
        }
        document.querySelector('#new-local-report').onclick=async()=>{
            const button=document.querySelector('#new-local-report');button.disabled=true;
            try {
                const report=await FoxSync.createDraft(user);
                location.href=`offline.html?id=${encodeURIComponent(report.id)}`;
            } catch(error) { errorPanel.textContent=error.message; }
            finally { button.disabled=false; }
        };
        async function synchronize() {
            if(!navigator.onLine) { await render();return; }
            const errors=await FoxSync.syncAll(user);
            errorPanel.textContent=errors.length?`Erreur de synchronisation · ${errors.join(' ; ')}`:'';
            await render();
        }
        document.addEventListener('fox-local-change',()=>render().catch(error=>{errorPanel.textContent=error.message;}));
        window.addEventListener('offline',()=>render().catch(error=>{errorPanel.textContent=error.message;}));
        const resume=()=>synchronize().catch(error=>{errorPanel.textContent=error.message;});
        window.addEventListener('online',resume);
        window.addEventListener('pageshow',resume);
        document.addEventListener('visibilitychange',()=>{if(!document.hidden)resume();});
        await render();
        await synchronize();
    } catch(error) {
        (document.querySelector('#offline-error') || document.querySelector('#sync-state') || document.body).textContent=error.message;
    }
})();
