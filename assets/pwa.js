(async () => {
    'use strict';
    const form = document.querySelector('#report-form');
    const user = document.body.dataset.user;
    if (!user || !window.FoxLocal || !window.FoxSync) return;
    localStorage.setItem('foxreport-user',user);
    const state = document.querySelector('#sync-state');
    const pendingPanel = document.querySelector('#local-sync-status');
    const conflictsPanel=document.createElement('section');
    conflictsPanel.className='panel';conflictsPanel.hidden=true;
    if (!form && pendingPanel) pendingPanel.after(conflictsPanel);
    let saving=Promise.resolve();
    const notify = text => { if (state) state.textContent=text; };
    function pendingError(message) {
        if (!pendingPanel) return;
        pendingPanel.setAttribute('role','alert');
        pendingPanel.textContent=message;
    }
    async function updatePending() {
        try {
            const pending=await FoxSync.pendingState(user);
            if (pendingPanel) {
                pendingPanel.setAttribute('role','status');
                pendingPanel.textContent=`${navigator.onLine?'Connecté':'Hors ligne — enregistré sur cet appareil'} · ${pending.changes} modification(s) en attente · ${pending.drafts} rapport(s) · ${pending.photos} photo(s)`;
            }
            if (!form) await FoxSync.renderConflicts(conflictsPanel,user);
        } catch (error) {
            pendingError(`Erreur de stockage local : ${error.message}`);
        }
    }
    document.addEventListener('fox-local-change',updatePending);
    window.addEventListener('online',updatePending);
    window.addEventListener('offline',updatePending);
    await updatePending();
    const logoutForm=document.querySelector('form[action="auth.php?action=logout"]');
    logoutForm?.addEventListener('submit',async event=>{
        event.preventDefault();
        try {
            await saving;
            const pending=await FoxSync.pendingState(user);
            if (pending.drafts) throw new Error('Synchronisez vos modifications et photos avant la déconnexion. Les données locales sont conservées.');
            if (!navigator.onLine) throw new Error('Reconnectez-vous au réseau avant de fermer la session Google.');
            if (!confirm('Déconnecter et retirer les copies locales déjà sauvegardées sur le serveur ?')) return;
            for (const record of await FoxLocal.all()) {
                if (record.user===user && !record.conflictResolved) await FoxLocal.remove(record.key);
            }
            await FoxLocal.removeTemplate(user);
            localStorage.removeItem('foxreport-user');
            logoutForm.submit();
        } catch (error) { alert(`Déconnexion : ${error.message}`); }
    });
    const newReport=document.querySelector('.new-report-form');
    newReport?.addEventListener('submit',async event=>{
        event.preventDefault();
        const button=newReport.querySelector('button');
        button.disabled=true;
        try {
            const record=await FoxSync.createDraft(user);
            location.href=`offline.html?id=${encodeURIComponent(record.id)}`;
        } catch (error) { alert(`Création impossible : ${error.message}`); }
        finally { button.disabled=false; }
    });
    if (navigator.onLine) {
        FoxSync.cacheTemplate(user).catch(error=>{
            pendingError(`Préparation hors ligne impossible : ${error.message}`);
        });
    }
    if (!form) {
        const synchronize=async()=>{
            if (!navigator.onLine) return;
            const errors=await FoxSync.syncAll(user);
            if (errors.length) pendingError(`Erreur de synchronisation · ${errors.join(' ; ')}`);
            else await updatePending();
        };
        window.addEventListener('online',synchronize);
        window.addEventListener('pageshow',synchronize);
        document.addEventListener('visibilitychange',()=>{if(!document.hidden)synchronize();});
        await synchronize();
        return;
    }
    const editable=!form.querySelector('fieldset')?.disabled;
    const conflict=document.querySelector('#sync-conflict');
    const id=form.elements.report_id.value;
    let key=`${user}:${id}`;
    let local;
    let timer;
    let syncing=false;
    let resolving=false;
    let resolutionFinished=false;
    let refreshedPhotoIds=new Set();
    let photoCacheReady=false;
    const pageHtml='<!doctype html>'+document.documentElement.outerHTML;
    const entriesFromForm=()=>[...new FormData(form).entries()].filter(([name,value])=>
        !name.startsWith('photos_') && !name.startsWith('captions_') && !name.startsWith('formats_')
        && !name.startsWith('photo_uids_')
        && name!=='csrf_token' && !(value instanceof File));
    async function persist(dirty=true) {
        saving=saving.then(async()=>{
            if (resolutionFinished) return;
            const previousVersion=local?.version || 0;
            const entries=entriesFromForm();
            const photos=window.FoxPhotos?.get() || [];
            const signature=values=>JSON.stringify(values.filter(([name])=>!['revision','active_section'].includes(name)));
            const photoSignature=values=>JSON.stringify(values.map(photo=>[photo.id,photo.caption,photo.format]));
            const contentChanged=dirty && (signature(entries)!==signature(local?.entries || [])
                || photoSignature(photos)!==photoSignature(local?.photos || []));
            const candidate={
                ...(local || {}),key,user,id:local?.id || id,html:pageHtml,
                title:form.elements.establishment?.value || 'Nouveau rapport',
                entries,photos,
                savedPhotos:window.FoxPhotos?.getSaved() || [],
                revision:Number(form.elements.revision.value),section:Number(document.querySelector('#active-section').value),
                dirty:contentChanged || local?.dirty || false,modified:Date.now(),
                version:previousVersion+(contentChanged?1:0),
                pendingChanges:(local?.pendingChanges || 0)+(contentChanged?1:0),
                status:local?.status || (editable?'draft':'finalized'),
            };
            try {
                local=await FoxLocal.update(key,current=>{
                    if (current?.localDeleted) return current;
                    if (current?.conflictResolved) {
                        if (!contentChanged) return current;
                        throw new Error('Ce conflit est archivé. Ouvrez sa copie depuis les brouillons locaux.');
                    }
                    if (contentChanged && current && (current.version || 0)!==previousVersion) {
                        throw new Error('Ce brouillon local a été modifié dans une autre fenêtre.');
                    }
                    if (!contentChanged && current && (current.version || 0)!==previousVersion) return current;
                    const revision=current?.revision || candidate.revision;
                    const deleted=new Set(JSON.parse(candidate.entries.find(([name])=>name==='photo_deleted')?.[1] || '[]'));
                    const retained=(current?.savedPhotos||[]).filter(photo=>!deleted.has(photo.id) && (!photoCacheReady || !refreshedPhotoIds.has(photo.id)));
                    const saved=new Map([...(candidate.savedPhotos||[]),...retained].map(photo=>[photo.id,photo]));
                    return {
                        ...candidate,revision,operation:current?.operation,dirty:contentChanged || current?.dirty || false,
                        pendingChanges:(current?.pendingChanges || 0)+(contentChanged?1:0),
                        entries:candidate.entries.map(([name,value])=>[name,name==='revision'?String(revision):value]),
                        savedPhotos:[...saved.values()],photos:candidate.photos.filter(photo=>!saved.has(photo.id)),
                    };
                });
            } catch (error) {
                const backupId=`conflict-${crypto.randomUUID()}`;
                key=`${user}:${backupId}`;
                local={...candidate,key,id:backupId,serverId:candidate.serverId || Number(id),conflict:true,error:error.message};
                await FoxLocal.put(local);
                conflict.hidden=false;
                throw new Error(`${error.message} Vos saisies sont conservées dans une copie locale en conflit.`);
            }
            if (local.localDeleted) {
                resolutionFinished=true;conflict.hidden=true;form.inert=true;
                notify('Ce brouillon a été retiré de cet appareil.');
                return;
            }
            if (local.conflictResolved) {
                resolutionFinished=true;conflict.hidden=true;
                notify('Conflit résolu dans une autre fenêtre · original archivé. Rechargez le rapport.');
            } else if (local.dirty) notify(navigator.onLine?'À synchroniser':'Hors ligne — enregistré sur cet appareil');
        });
        try { await saving; }
        catch (error) { saving=Promise.resolve(); notify(`Erreur · ${error.message}`); throw error; }
    }
    function restore(entries) {
        const deviceEntries=entries.filter(([name])=>name.startsWith('devices['));
        const rows=document.querySelector('#device-rows');
        if (rows) {
            rows.replaceChildren();
            const indexes=[...new Set(deviceEntries.map(([name])=>name.match(/^devices\[(\d+)]/)?.[1]).filter(Boolean))];
            indexes.forEach(index=>{
                const row=document.querySelector('#device-row-template').content.firstElementChild.cloneNode(true);
                row.querySelectorAll('[data-device-field]').forEach(control=>{control.name=`devices[${index}][${control.dataset.deviceField}]`;});
                rows.append(row);
            });
        }
        const grouped=new Map();
        entries.forEach(([name,value])=>grouped.set(name,[...(grouped.get(name)||[]),value]));
        for (const control of form.elements) {
            if (control.type==='file' || control.name==='csrf_token') continue;
            const values=grouped.get(control.name)||[];
            if (control.type==='checkbox') control.checked=values.includes(control.value);
            else if(grouped.has(control.name)) control.value=values[0];
        }
        form.dispatchEvent(new Event('fox-inventory-restored'));
        form.dispatchEvent(new Event('fox-sections-restored'));
    }
    async function sync(status='draft') {
        if (!editable || syncing || resolving || resolutionFinished) return;
        clearTimeout(timer);
        await saving;
        if (!navigator.onLine) { notify('Hors ligne — enregistré sur cet appareil'); return; }
        if (local?.conflict) { conflict.hidden=false; notify('Erreur · conflit de versions, données locales conservées'); return; }
        if (!local?.dirty && !local?.operation && status==='draft') return;
        syncing=true;
        notify('À synchroniser · envoi en cours');
        try {
            await FoxSync.syncRecord(key,status);
            await saving;
            local=await FoxLocal.get(key);
            form.elements.revision.value=String(local.revision);
            const preview=document.querySelector('.report-preview');
            if (preview && local.serverId) {
                preview.href=`rapport.php?id=${local.serverId}`;
                preview.removeAttribute('aria-disabled');
                preview.textContent='Prévisualiser le rapport';
            }
            const savedIds=new Set((local.savedPhotos||[]).map(photo=>photo.id));
            const acknowledged=(window.FoxPhotos?.get()||[]).filter(photo=>savedIds.has(photo.id));
            window.FoxPhotos?.acknowledge(acknowledged);
            window.FoxPhotos?.remove(new Set(acknowledged.map(photo=>photo.id)));
            if (local.conflict) { conflict.hidden=false; throw new Error(local.error); }
            notify(local.dirty?'À synchroniser':'Enregistré sur le serveur et cet appareil');
            if (local.status==='finalized') location.href=`index.php?id=${local.serverId || id}`;
            else if(local.dirty) timer=setTimeout(()=>sync().catch(showError),1500);
        } catch (error) {
            local=await FoxLocal.get(key);
            if(local?.conflict) conflict.hidden=false;
            notify(navigator.onLine?`Erreur · ${error.message}`:'Hors ligne — enregistré sur cet appareil');
        } finally { syncing=false; await updatePending(); }
    }
    function showError(error) { notify(`Erreur · ${error.message}`); }
    try {
        local=await FoxLocal.get(key);
        if (local?.localDeleted) {
            if (document.body.dataset.localSnapshot==='true') {
                resolutionFinished=true;location.href='offline.html';return;
            }
            // Removing an on-device copy must not prevent reopening its server report.
            local=(await FoxLocal.all()).find(record=>record.user===user && !record.conflictResolved && String(record.serverId)===id);
            key=local?.key || `${user}:server-${id}-${crypto.randomUUID()}`;
        }
        if (!local && !String(id).startsWith('local-')) {
            local=(await FoxLocal.all()).find(record=>record.user===user && !record.conflictResolved && String(record.serverId)===id);
            if(local) key=local.key;
        }
        if (local?.conflictResolved) {
            if (document.body.dataset.localSnapshot!=='true') {
                key=`${user}:server-${id}`;
                local=await FoxLocal.get(key);
            }
        }
        if (local?.conflictResolved) {
            conflict.hidden=true;
            restore(local.entries);
            await window.FoxPhotos?.restore(local.photos || []);
            window.FoxPhotos?.restoreSaved(local.savedPhotos || []);
            form.querySelector('fieldset').disabled=true;
            form.querySelectorAll('button').forEach(button=>{button.disabled=true;});
            notify('Conflit résolu · original archivé, saisies et photos conservées. Reprenez la copie depuis les brouillons locaux.');
            return;
        }
        if (document.body.dataset.localSnapshot==='true' || local?.dirty || local?.operation || String(id).startsWith('local-') || String(id).startsWith('conflict-')) {
            const serverRevision=Number(form.elements.revision.value);
            if (!local) throw new Error('Brouillon local introuvable.');
            restore(local.entries);
            await window.FoxPhotos?.restore(local.photos || []);
            window.FoxPhotos?.restoreSaved(local.savedPhotos || []);
            document.querySelector('#active-section').value=String(local.section || 1);
            form.dispatchEvent(new Event('fox-sections-restored'));
            form.elements.revision.value=String(local.revision);
            // A local snapshot does not contain a freshly fetched server revision.
            // Legacy IndexedDB records may store numeric revisions as strings.
            if (local.conflict || (document.body.dataset.localSnapshot!=='true' && !String(id).startsWith('local-') && serverRevision!==Number(local.revision) && !local.operation)) {
                local={...local,conflict:true,error:local.error || `Version locale ${local.revision}, serveur ${serverRevision}. Les données locales sont conservées.`};
                await FoxLocal.put(local);conflict.hidden=false;
                notify('Erreur · conflit de versions, données locales conservées');
            } else notify(navigator.onLine?(local.dirty||local.operation?'À synchroniser':'Enregistré sur le serveur et cet appareil'):'Hors ligne — enregistré sur cet appareil');
        } else {
            if(local) {
                const observedVersion=local.version || 0;
                refreshedPhotoIds=new Set((local.savedPhotos||[]).map(photo=>photo.id));
                photoCacheReady=!!window.FoxPhotos?.cacheReady();
                local=await FoxLocal.update(key,current=>{
                    if(!current) throw new Error('La copie locale a été retirée dans une autre fenêtre. Rechargez le rapport.');
                    if(current.dirty || current.operation || (current.version || 0)!==observedVersion) {
                        return {...current,conflict:true,error:'Ce brouillon local a changé dans une autre fenêtre. Les données locales sont conservées.'};
                    }
                    return {...current,entries:entriesFromForm(),revision:Number(form.elements.revision.value),html:pageHtml,status:editable?'draft':'finalized'};
                });
                if(local.conflict) {
                    refreshedPhotoIds.clear();
                    restore(local.entries);
                    await window.FoxPhotos?.restore(local.photos || []);
                    window.FoxPhotos?.restoreSaved(local.savedPhotos || []);
                    form.elements.revision.value=String(local.revision);
                    conflict.hidden=false;
                }
            }
            await persist(false);
            notify(local.conflict?'Erreur · conflit de versions, données locales conservées':navigator.onLine?'Enregistré':'Hors ligne — enregistré sur cet appareil');
        }
        if(editable) {
            if(local?.conflict && local.error) conflict.querySelector('p').textContent=local.error;
            const changed=()=>{
                if (resolving || resolutionFinished) return;
                clearTimeout(timer);
                persist().then(()=>{timer=setTimeout(()=>sync().catch(showError),1800);}).catch(showError);
            };
            form.addEventListener('input',changed);
            form.addEventListener('change',changed);
            form.addEventListener('fox-change',changed);
            form.addEventListener('submit',event=>{
                event.preventDefault();
                const status=event.submitter?.value==='finalized'?'finalized':'draft';
                if(status==='finalized' && !navigator.onLine) {
                    persist().then(()=>notify('Hors ligne — enregistré sur cet appareil. Finalisez le rapport après synchronisation.')).catch(showError);
                } else persist().then(()=>sync(status)).catch(showError);
            });
            window.addEventListener('online',()=>sync().catch(showError));
            window.addEventListener('pageshow',()=>{if(navigator.onLine)sync().catch(showError);});
            document.addEventListener('visibilitychange',()=>{if(!document.hidden && navigator.onLine)sync().catch(showError);});
            document.querySelector('#conflict-server')?.addEventListener('click',async event=>{
                if (resolving || resolutionFinished) return;
                if(!navigator.onLine) { notify('Réseau requis pour vérifier la version serveur.'); return; }
                resolving=true;form.inert=true;clearTimeout(timer);
                const button=event.currentTarget;button.disabled=true;
                try {
                    await window.FoxPhotos?.whenReady();
                    await persist();
                    await saving;
                    const response=await fetch(`index.php?id=${local.serverId || id}`,{cache:'no-store'});
                    if(!response.ok) throw new Error('Version serveur indisponible : copie locale conservée.');
                    const html=await response.text();
                    const page=new DOMParser().parseFromString(html,'text/html');
                    if(page.querySelector('[name="report_id"]')?.value!==String(local.serverId || id)) {
                        throw new Error('Rapport serveur non confirmé : copie locale conservée. Reconnectez-vous si nécessaire.');
                    }
                    if(!confirm('Utiliser la version serveur ? Les saisies et photos locales seront conservées dans une archive, sans synchronisation.')) return;
                    await FoxSync.resolveServer(key);
                    resolutionFinished=true;conflict.hidden=true;
                    notify('Conflit résolu · version serveur choisie, original archivé.');
                    location.href=`index.php?id=${local.serverId || id}`;
                } catch(error) { showError(error); }
                finally { resolving=false;button.disabled=false;form.inert=resolutionFinished; }
            });
            document.querySelector('#conflict-copy')?.addEventListener('click',async event=>{
                if (resolving || resolutionFinished) return;
                resolving=true;form.inert=true;
                const button=event.currentTarget;button.disabled=true;
                try {
                    clearTimeout(timer);
                    await window.FoxPhotos?.whenReady();
                    await persist();
                    const copy=await FoxSync.copyConflict(key);
                    resolutionFinished=true;conflict.hidden=true;
                    notify('Conflit résolu · original archivé, nouveau rapport prêt.');
                    location.href=`offline.html?id=${encodeURIComponent(copy.id)}`;
                } catch(error) { showError(error); }
                finally { resolving=false;button.disabled=false;form.inert=resolutionFinished; }
            });
            if(navigator.onLine) await sync();
        }
        document.addEventListener('fox-photos-cached',()=>{
            photoCacheReady=true;
            if (!resolving && !resolutionFinished) persist(false).catch(showError);
        });
        window.FoxBeforeUpdate=async()=>{
            if (resolving) throw new Error('Résolution du conflit en cours. Attendez sa confirmation avant la mise à jour.');
            if (resolutionFinished) return;
            await window.FoxPhotos?.whenReady();
            await persist(editable);
            await saving;
            if(navigator.onLine) await FoxSync.cacheTemplate(user);
        };
    } catch(error) { showError(error); }
})();
