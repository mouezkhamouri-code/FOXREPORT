(async () => {
    'use strict';
    try {
        const user=localStorage.getItem('foxreport-user');
        if(!user) throw new Error('Connectez-vous en ligne une première fois pour préparer FoxReport sur cet appareil.');
        const reports=(await FoxLocal.all()).filter(report=>report.user===user && !report.localDeleted);
        const requested=new URLSearchParams(location.search).get('id');
        if(requested) {
            const shellVersion=document.body.dataset.appVersion;
            const report=reports.find(item=>String(item.id)===requested);
            if(!report) throw new Error('Ce rapport n’est pas disponible sur cet appareil.');
            const template=await FoxLocal.getTemplate(user);
            const page=new DOMParser().parseFromString(template?.html || report.html,'text/html');
            document.body.replaceWith(document.importNode(page.body,true));
            document.dispatchEvent(new Event('fox-page-restored'));
            document.body.dataset.user=user;
            document.body.dataset.localSnapshot='true';
            if (shellVersion) document.body.dataset.appVersion=shellVersion;
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
                    const version=document.body.dataset.appVersion;
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
            const records=(await FoxLocal.all()).filter(report=>report.user===user && !report.localDeleted);
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
                link.href=`offline.html?id=${encodeURIComponent(report.id)}`;link.textContent=report.conflictResolved?'Consulter l’archive':report.conflict?'Consulter le brouillon':'Reprendre ce rapport';
                const remove=document.createElement('button');remove.className='button button-secondary';
                remove.textContent='Retirer la copie de cet appareil';
                remove.onclick=async()=>{
                    try {
                        const current=await FoxLocal.get(report.key);
                        const unsaved=current?.dirty || current?.operation || current?.conflict;
                        if(!confirm(unsaved
                            ? 'Supprimer ce brouillon de cet appareil, y compris ses saisies et photos locales non synchronisées ? Cette suppression est définitive. Le rapport serveur ne sera pas supprimé.'
                            : 'Retirer cette copie et ses photos de cet appareil ? Le rapport serveur ne sera pas supprimé.')) return;
                        remove.disabled=true;
                        await FoxSync.discardLocal(report.key);
                        errorPanel.textContent='';
                        await render();
                    } catch(error) { errorPanel.textContent=error.message; }
                    finally { remove.disabled=false; }
                };
                panel.append(title,state,link);
                if (report.conflict && !report.conflictResolved) {
                    // Resolve the stored snapshot directly: opening an obsolete editor
                    // or saving its form is not a prerequisite for rescuing a conflict.
                    const copy=document.createElement('button');copy.type='button';copy.className='button button-primary';
                    copy.textContent='Conserver mes saisies dans une copie';
                    copy.onclick=async()=>{
                        copy.disabled=true;
                        try {
                            const saved=await FoxSync.copyConflict(report.key);
                            errorPanel.textContent='';
                            location.href=`offline.html?id=${encodeURIComponent(saved.id)}`;
                        } catch(error) { errorPanel.textContent=error.message; }
                        finally { copy.disabled=false; }
                    };
                    const server=document.createElement('button');server.type='button';server.className='button button-secondary';
                    server.textContent='Utiliser la version serveur';
                    server.onclick=async()=>{
                        server.disabled=true;
                        try {
                            const url=await FoxSync.serverConflictPage(report.key);
                            if(!confirm('Utiliser la version serveur ? Vos saisies et photos locales seront conservées dans une archive.')) return;
                            await FoxSync.resolveServer(report.key);
                            errorPanel.textContent='';location.href=url;
                        } catch(error) { errorPanel.textContent=error.message; }
                        finally { server.disabled=false; }
                    };
                    panel.append(copy,server);
                }
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
