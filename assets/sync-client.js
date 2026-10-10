(() => {
    'use strict';
    const inFlight = new Map();
    function writeLog(entry) {
        if (typeof FoxLocal.addSyncLog !== 'function') return;
        FoxLocal.addSyncLog(entry).catch(error=>console.error('Journal de synchronisation indisponible.',error));
    }
    async function jsonRequest(url, options = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30000);
        try {
            const response = await fetch(url, {...options, cache:'no-store', signal:controller.signal});
            let result = {};
            let raw = '';
            if (typeof response.text === 'function') {
                raw = await response.text();
                if (!raw.trim()) {
                    const error = new Error(response.ok
                        ? `Réponse serveur vide (${response.status}) : le serveur n’a retourné aucune donnée JSON.`
                        : `Requête refusée (${response.status}) : réponse vide du serveur.`);
                    error.status = response.status;
                    throw error;
                }
                try { result = JSON.parse(raw); }
                catch (parseError) {
                    const error = new Error(`Réponse serveur invalide (${response.status}) : ${describeResponse(raw)}`);
                    error.status = response.status;
                    error.cause = parseError;
                    throw error;
                }
            } else {
                result = await response.json();
            }
            if (!response.ok) {
                const error = new Error(result.error || `Requête refusée (${response.status})${raw.trim() ? ` : ${describeResponse(raw)}` : ' : réponse vide du serveur.'}`);
                error.status = response.status;
                throw error;
            }
            return result;
        } finally { clearTimeout(timer); }
    }
    function describeResponse(raw) {
        const compact=raw.replace(/\s+/g,' ').trim();
        if (!compact) return 'réponse vide du serveur';
        return compact.length>240 ? `${compact.slice(0,240)}…` : compact;
    }
    async function identity(user) {
        const session = await jsonRequest('index.php?api=session');
        if (session.user !== user) throw new Error('Reconnectez le même compte Google pour synchroniser ces brouillons.');
        return session;
    }
    async function send(key, status) {
        let record = await FoxLocal.get(key);
        if (!record || record.conflictResolved || record.resolutionPending || (!record.dirty && !record.operation && status==='draft')) return record;
        if (record.conflict) throw new Error(record.error || 'Conflit de versions : copie locale conservée. Choisissez la version serveur ou créez une copie.');
        if (!navigator.onLine) return record;
        const session = await identity(record.user);
        if (!record.serverId && String(record.id).startsWith('local-')) {
            const body = new FormData();
            body.set('action','create'); body.set('csrf_token',session.csrf); body.set('client_uid',record.clientUid);
            const created = await jsonRequest('index.php?api=create',{method:'POST',body});
            if (!Number.isInteger(Number(created.id)) || Number(created.id)<1) throw new Error('Réponse de création invalide.');
            record = await FoxLocal.update(key, current => ({...current, serverId:Number(created.id), revision:1}));
        }
        const serverId = record.serverId || Number(record.id);
        if (!Number.isInteger(serverId) || serverId<1) throw new Error('Identifiant serveur du rapport invalide.');
        record = await FoxLocal.update(key, current => {
            if (current.operation) return current;
            return {...current, operation:{
                requestId:crypto.randomUUID(), entries:current.entries.map(entry=>[...entry]),
                photos:(current.photos || []).map(photo=>({...photo})), revision:Number(current.revision),
                status, version:current.version || 0,
                pendingChanges:current.pendingChanges || 0,
            }};
        });
        const operation = record.operation;
        const body = new FormData();
        operation.entries.forEach(([name,value])=>body.append(name,value));
        body.set('action','save'); body.set('report_id',String(serverId));
        body.set('csrf_token',session.csrf); body.set('revision',String(operation.revision));
        body.set('request_id',operation.requestId); body.set('save_status',operation.status);
        operation.photos.forEach(photo=>{
            body.append(`photos_${photo.section}[]`,photo.blob,'photo.jpg');
            body.append(`captions_${photo.section}[]`,photo.caption);
            body.append(`formats_${photo.section}[]`,photo.format ?? 'original');
            body.append(`photo_uids_${photo.section}[]`,photo.id);
        });
        let result;
        try {
            result = await jsonRequest(`index.php?api=save&id=${serverId}`,{method:'POST',body});
        } catch (error) {
            await FoxLocal.update(key, current => {
                if (current.operation?.requestId !== operation.requestId) return current;
                if (error.status === 409) return {...current,conflict:true,error:error.message};
                if ([400,403,422].includes(error.status)) {
                    const copy={...current,error:error.message}; delete copy.operation; return copy;
                }
                return {...current,error:error.message};
            });
            throw error;
        }
        if (Number(result.id)!==serverId || Number(result.revision)!==operation.revision+1
            || !['draft','finalized'].includes(result.status)) throw new Error('Confirmation serveur invalide : données locales conservées.');
        record = await FoxLocal.update(key, current => {
            if (current.operation?.requestId !== operation.requestId) return current;
            const sentIds = new Set(operation.photos.map(photo=>photo.id));
            const remaining = (current.photos || []).filter(photo=>!sentIds.has(photo.id));
            const saved = new Map((current.savedPhotos || []).map(photo=>[photo.id,photo]));
            operation.photos.forEach(photo=>saved.set(photo.id,{...photo}));
            const deleted = new Set(JSON.parse(current.entries.find(([name])=>name==='photo_deleted')?.[1] || '[]'));
            deleted.forEach(id=>saved.delete(id));
            const updated = {
                ...current, serverId, revision:Number(result.revision), status:result.status,
                entries:current.entries.map(([name,value])=>[name,name==='revision'?String(result.revision):value]),
                photos:remaining, savedPhotos:[...saved.values()],
                dirty:(current.version || 0)!==operation.version || remaining.length>0,
                pendingChanges:Math.max(0,(current.pendingChanges || 0)-operation.pendingChanges),
            };
            delete updated.operation; delete updated.error;
            if (result.status==='finalized' && updated.dirty) {
                updated.conflict=true; updated.error='Rapport finalisé pendant la saisie : modifications locales conservées.';
            }
            return updated;
        });
        document.dispatchEvent(new CustomEvent('fox-synced',{detail:{record}}));
        writeLog({
            user:record.user, key, recordId:record.serverId || record.id, title:record.title || 'Rapport sans titre',
            timestamp:Date.now(), status:'success', message:`Synchronisation réussie · révision ${record.revision}.`, retryable:false,
        });
        return record;
    }
    async function syncRecord(key, status = 'draft') {
        if (inFlight.has(key)) return inFlight.get(key);
        const operation = navigator.locks
            ? navigator.locks.request(`foxreport-sync:${key}`,()=>send(key,status))
            : send(key,status);
        inFlight.set(key,operation);
        try { return await operation; }
        catch (error) {
            const record = await FoxLocal.get(key);
            writeLog({
                user:record?.user, key, recordId:record?.serverId || record?.id, title:record?.title || 'Rapport sans titre',
                timestamp:Date.now(), status:'error', message:error.message, retryable:!([400,403,409,422].includes(error.status)),
            });
            throw error;
        } finally { inFlight.delete(key); }
    }
    async function syncAll(user, excludeKey) {
        const errors = [];
        for (const record of await FoxLocal.all()) {
            if (record.user!==user || record.key===excludeKey || record.conflict || record.conflictResolved || record.resolutionPending || (!record.dirty && !record.operation)) continue;
            try { await syncRecord(record.key); }
            catch (error) { errors.push(`${record.title} : ${error.message}`); }
        }
        return errors;
    }
    async function cacheTemplate(user) {
        const result = await jsonRequest('index.php?api=template');
        if (typeof result.html !== 'string') throw new Error('Modèle hors ligne invalide.');
        await FoxLocal.putTemplate({key:user,html:result.html});
    }
    async function createDraft(user, initialize = record => record) {
        let template = await FoxLocal.getTemplate(user);
        if (!template && navigator.onLine) {
            await cacheTemplate(user);
            template = await FoxLocal.getTemplate(user);
        }
        if (!template) throw new Error('Modèle hors ligne absent : ouvrez FoxReport en ligne une première fois et attendez la préparation hors ligne.');
        const uuid = crypto.randomUUID();
        const id = `local-${uuid}`;
        const page = new DOMParser().parseFromString(template.html,'text/html');
        const form = page.querySelector('#report-form');
        if (!form) throw new Error('Formulaire hors ligne absent du modèle.');
        form.elements.report_id.value=id;
        const entries=[...new FormData(form).entries()].filter(([name,value])=>name!=='csrf_token' && !(value instanceof File));
        const record = {
            key:`${user}:${id}`,id,user,clientUid:uuid.replaceAll('-',''),html:template.html,
            entries,revision:1,title:'Nouveau rapport',photos:[],savedPhotos:[],
            dirty:true,version:1,modified:Date.now(),section:1,status:'draft',
        };
        const initialized=initialize(record);
        await FoxLocal.put(initialized);
        return initialized;
    }
    async function pendingState(user) {
        const records=(await FoxLocal.all()).filter(record=>record.user===user && !record.conflictResolved);
        return {
            drafts:records.filter(record=>record.dirty || record.operation).length,
            changes:records.reduce((sum,record)=>sum+(record.dirty || record.operation ? Math.max(1,record.pendingChanges || 0):0),0),
            photos:records.reduce((sum,record)=>sum+(record.photos || []).length,0),
        };
    }
    function snapshotSignature(record) {
        return JSON.stringify({...record,photos:(record.photos || []).map(photo=>({...photo,blob:{size:photo.blob?.size,type:photo.blob?.type}})),
            savedPhotos:(record.savedPhotos || []).map(photo=>({...photo,blob:{size:photo.blob?.size,type:photo.blob?.type}}))});
    }
    async function resolveServer(key) {
        return FoxLocal.update(key,current=>{
            if (!current?.conflict || current.conflictResolved) throw new Error('Ce conflit n’est plus actif. Rechargez les brouillons locaux.');
            return {...current,conflictResolved:true,resolution:'server',resolvedAt:Date.now(),version:(current.version || 0)+1};
        });
    }
    async function discardLocal(key) {
        // Wait for an already dispatched save before releasing its local snapshot.
        if (inFlight.has(key)) await inFlight.get(key).catch(()=>{});
        const discard=()=>FoxLocal.update(key,current=>{
            if (!current) return current;
            // A small tombstone prevents an editor still open in another tab from
            // recreating the deleted draft. No fields, photos or pending operation remain.
            return {key:current.key,user:current.user,id:current.id,serverId:current.serverId,
                localDeleted:true,conflictResolved:true,dirty:false,photos:[],savedPhotos:[],entries:[],
                version:(Number(current.version) || 0)+1,modified:Date.now()};
        });
        return navigator.locks
            ? navigator.locks.request(`foxreport-sync:${key}`,discard)
            : discard();
    }
    async function serverConflictPage(key) {
        const record=await FoxLocal.get(key);
        const serverId=Number(record?.serverId || record?.id);
        if (!navigator.onLine) throw new Error('Connexion requise pour consulter la version serveur.');
        if (!Number.isInteger(serverId) || serverId<1) throw new Error('Ce brouillon n’a pas de version serveur. Créez une copie ou retirez-le de cet appareil.');
        const url=`index.php?id=${serverId}`;
        const response=await fetch(url,{cache:'no-store'});
        if (!response.ok) throw new Error('Version serveur indisponible. Le brouillon local est conservé.');
        const page=new DOMParser().parseFromString(await response.text(),'text/html');
        if (page.querySelector('[name="report_id"]')?.value!==String(serverId)) {
            throw new Error('Rapport serveur non confirmé. Reconnectez-vous ou créez une copie du brouillon.');
        }
        return url;
    }
    async function copyConflict(key) {
        const source=await FoxLocal.get(key);
        if (!source?.conflict || source.conflictResolved) throw new Error('Ce conflit n’est plus actif. Rechargez les brouillons locaux.');
        const signature=snapshotSignature(source);
        const originals=[...(source.photos || []),...(source.savedPhotos || [])];
        const captions=JSON.parse(source.entries.find(([name])=>name==='photo_captions')?.[1] || '{}');
        const photos=originals.map(photo=>({...photo,id:crypto.randomUUID(),caption:Object.hasOwn(captions,photo.id)?captions[photo.id]:photo.caption}));
        const photoIds=new Map(originals.map((photo,index)=>[photo.id,photos[index].id]));
        const copy=await createDraft(source.user,record=>({...record,
            entries:source.entries.map(([name,value])=>[name,name==='report_id'?record.id:name==='revision'?'1':
                name==='photo_deleted'?'[]':name==='photo_captions'?'{}':name==='photo_order'?JSON.stringify(JSON.parse(value).filter(id=>photoIds.has(id)).map(id=>photoIds.get(id))):value]),
            photos,savedPhotos:[],title:source.title,section:source.section,resolutionPending:true,conflict:true,
            error:'Copie en attente de vérification. L’original est conservé ; résolvez cette copie si la vérification a été interrompue.'}));
        const entries=copy.entries;
        try {
            const stored=await FoxLocal.get(copy.key);
            if (!stored || JSON.stringify(stored.entries)!==JSON.stringify(entries) || stored.photos.length!==originals.length
                || stored.title!==source.title || stored.section!==source.section) {
                throw new Error('Copie locale non confirmée : le conflit original reste actif.');
            }
            for (let index=0;index<originals.length;index++) {
                const original=originals[index],expected=photos[index],saved=stored.photos[index];
                if (!(original.blob instanceof Blob) || !(saved.blob instanceof Blob)
                    || JSON.stringify({...saved,blob:null})!==JSON.stringify({...expected,blob:null})
                    || saved.blob.type!==original.blob.type) {
                    throw new Error('Photo locale non confirmée : le conflit original reste actif.');
                }
                const before=new Uint8Array(await original.blob.arrayBuffer()),after=new Uint8Array(await saved.blob.arrayBuffer());
                if (before.length!==after.length || before.some((value,i)=>value!==after[i])) {
                    throw new Error('Photo locale incomplète : le conflit original reste actif.');
                }
            }
            const copySignature=snapshotSignature(stored);
            await FoxLocal.resolveConflict(key,copy.key,(current,currentCopy)=>{
                if (!current || snapshotSignature(current)!==signature) {
                    throw new Error('L’original a changé pendant la copie. Il reste actif ; recommencez la résolution avec les dernières saisies.');
                }
                if (!currentCopy || snapshotSignature(currentCopy)!==copySignature) {
                    throw new Error('La copie a changé pendant la vérification. Le conflit original reste actif.');
                }
                const ready={...currentCopy};delete ready.resolutionPending;delete ready.conflict;delete ready.error;
                return {source:{...current,conflictResolved:true,resolvedCopyKey:copy.key,resolvedAt:Date.now(),version:(current.version || 0)+1},copy:ready};
            });
            delete stored.resolutionPending;
            delete stored.conflict;delete stored.error;
            return stored;
        } catch(error) {
            await FoxLocal.update(copy.key,current=>({...current,resolutionPending:false,conflict:true,error:`Vérification de copie interrompue : ${error.message}`}));
            throw error;
        }
    }
    async function renderConflicts(container,user) {
        const records=(await FoxLocal.all()).filter(record=>record.user===user && record.conflict && !record.conflictResolved);
        container.replaceChildren();
        container.hidden=!records.length;
        if (!records.length) return;
        const heading=document.createElement('h2');heading.textContent='Conflits à résoudre';container.append(heading);
        for (const record of records) {
            const row=document.createElement('p');
            const text=document.createElement('span');text.textContent=`${record.title} — ${record.error || 'Conflit conservé sur cet appareil'} `;
            const link=document.createElement('a');link.className='button button-secondary';
            link.href=`offline.html?id=${encodeURIComponent(record.id)}`;link.textContent='Résoudre';
            row.append(text,link);container.append(row);
        }
    }
    window.FoxSync = {syncRecord,syncAll,cacheTemplate,createDraft,pendingState,copyConflict,resolveServer,renderConflicts,discardLocal,serverConflictPage,
        getSyncLogs:user=>FoxLocal.syncLogs(user)};
})();
