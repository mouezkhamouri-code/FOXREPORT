const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');

function fixture() {
    const records=new Map();
    let behavior=async(url,options)=>{
        if(url.includes('session'))return {ok:true,json:async()=>({user:'test',csrf:'csrf'})};
        if(url.includes('create'))return {ok:true,json:async()=>({id:5,revision:1,status:'draft'})};
        return {ok:true,json:async()=>({id:5,revision:2,status:'draft',photos:[]})};
    };
    const calls=[];
    const context={
        window:{},navigator:{onLine:true},crypto,Blob,FormData:class extends FormData { constructor(){super();} },File:globalThis.File,
        DOMParser:class {parseFromString(){return {querySelector:()=>({elements:{report_id:{value:''}}})};}},
        AbortController,setTimeout,clearTimeout,
        document:{dispatchEvent:()=>{}},CustomEvent:class {},
        FoxLocal:{
            get:async key=>structuredClone(records.get(key)),
            put:async record=>{records.set(record.key,structuredClone(record));},
            getTemplate:async()=>({html:'synthetic template'}),
            resolveConflict:async(key,copyKey,verify)=>{
                const result=verify(structuredClone(records.get(key)),structuredClone(records.get(copyKey)));
                records.set(key,structuredClone(result.source));records.set(copyKey,structuredClone(result.copy));
            },
            update:async(key,operation)=>{
                const value=operation(structuredClone(records.get(key)));
                records.set(key,structuredClone(value));return structuredClone(value);
            },
            all:async()=>[...records.values()].map(value=>structuredClone(value)),
        },
        fetch:async(url,options)=>{calls.push({url,options});return behavior(url,options);},
    };
    vm.runInNewContext(fs.readFileSync('assets/sync-client.js','utf8'),context);
    return {api:context.window.FoxSync,context,records,calls,setBehavior:fn=>{behavior=fn;}};
}
function draft() {
    return {
        key:'test:local-uuid',id:'local-uuid',clientUid:'a'.repeat(32),user:'test',title:'Synthetic',
        entries:[['report_id','local-uuid'],['completed_sections','[6]'],['revision','1']],
        photos:[{id:'photo1',section:6,format:'square',caption:'local',blob:new Blob(['test'],{type:'image/jpeg'})}],
        savedPhotos:[],revision:1,dirty:true,version:2,pendingChanges:2,
    };
}
test('Malformed or empty server responses expose the HTTP status instead of a JSON parser error',async()=>{
    const page=fixture(),record=draft();
    page.records.set(record.key,record);
    page.setBehavior(async url=>{
        if(url.includes('session'))return {ok:true,json:async()=>({user:'test',csrf:'csrf'})};
        if(url.includes('create'))return {ok:true,json:async()=>({id:5,revision:1,status:'draft'})};
        return {ok:false,status:500,text:async()=>''};
    });
    await assert.rejects(page.api.syncRecord(record.key),/Réponse serveur invalide|Requête refusée \(500\).*réponse vide/);
});
test('Deleting a photo while its upload is in flight keeps the removal pending and never revives its local cache',async()=>{
    const page=fixture(),record=draft();
    record.entries.push(['photo_order',JSON.stringify(['photo1'])],['photo_deleted','[]']);
    page.records.set(record.key,record);
    page.setBehavior(async(url,options)=>{
        if(url.includes('session'))return {ok:true,json:async()=>({user:'test',csrf:'csrf'})};
        if(url.includes('create'))return {ok:true,json:async()=>({id:5,revision:1,status:'draft'})};
        assert.equal(options.body.get('photo_uids_6[]'),'photo1');
        const current=page.records.get(record.key);
        current.photos=[];
        current.entries=current.entries.map(([name,value])=>[name,name==='photo_order'?'[]':name==='photo_deleted'?'["photo1"]':value]);
        current.version++;
        return {ok:true,json:async()=>({id:5,revision:2,status:'draft'})};
    });
    await page.api.syncRecord(record.key);
    const saved=page.records.get(record.key);
    assert.equal(saved.savedPhotos.length,0);
    assert.equal(saved.dirty,true);
    assert.equal(saved.entries.find(([name])=>name==='photo_deleted')[1],'["photo1"]');
});

test('A conflict copy remaps photo order to new local IDs and does not delete photos in the new report',async()=>{
    const page=fixture(),record=draft();
    record.conflict=true;
    record.savedPhotos=[{...record.photos[0],id:'saved-photo'}];
    record.entries.push(['photo_order','["saved-photo","photo1"]'],['photo_deleted','["removed-photo"]'],['photo_captions','{"saved-photo":"Nouvelle légende"}']);
    page.records.set(record.key,record);
    const copy=await page.api.copyConflict(record.key);
    const order=JSON.parse(copy.entries.find(([name])=>name==='photo_order')[1]);
    assert.deepEqual(order,[copy.photos[1].id,copy.photos[0].id]);
    assert.equal(copy.entries.find(([name])=>name==='photo_deleted')[1],'[]');
    assert.equal(copy.entries.find(([name])=>name==='photo_captions')[1],'{}');
    assert.equal(copy.photos[1].caption,'Nouvelle légende');
});
test('Offline synchronization never sends or removes local drafts and photos',async()=>{
    const page=fixture();page.context.navigator.onLine=false;
    const record=draft();page.records.set(record.key,record);
    await page.api.syncRecord(record.key);
    assert.equal(page.calls.length,0);
    assert.equal(page.records.get(record.key).photos.length,1);
    const pending=await page.api.pendingState('test');
    assert.equal(pending.changes,2);assert.equal(pending.drafts,1);assert.equal(pending.photos,1);
});
test('Lost create/save responses keep the stable UID and operation; retries acknowledge photos once',async()=>{
    const page=fixture();const record=draft();page.records.set(record.key,record);
    let creates=0,saves=0;const uids=[],requestIds=[];
    page.setBehavior(async(url,options)=>{
        if(url.includes('session'))return {ok:true,json:async()=>({user:'test',csrf:'csrf'})};
        if(url.includes('create')){
            creates++;uids.push(options.body.get('client_uid'));
            if(creates===1)throw new Error('Lost creation response');
            return {ok:true,json:async()=>({id:5,revision:1,status:'draft'})};
        }
        saves++;requestIds.push(options.body.get('request_id'));
        if(saves===1)throw new Error('Lost saved response');
        return {ok:true,json:async()=>({id:5,revision:2,status:'draft'})};
    });
    await assert.rejects(page.api.syncRecord(record.key),/Lost creation/);
    assert.equal(page.records.get(record.key).photos.length,1);
    await assert.rejects(page.api.syncRecord(record.key),/Lost saved/);
    assert.ok(page.records.get(record.key).operation);
    assert.equal(page.records.get(record.key).photos.length,1);
    await page.api.syncRecord(record.key);
    assert.equal(uids[0],uids[1]);
    assert.equal(creates,2);
    assert.equal(requestIds[0],requestIds[1]);
    const saved=page.records.get(record.key);
    assert.equal(saved.dirty,false);assert.equal(saved.photos.length,0);
    assert.equal(saved.savedPhotos.length,1);assert.equal(saved.pendingChanges,0);
    assert.equal(saved.entries.find(([name])=>name==='completed_sections')[1],'[6]');
});
test('Edits and photos arriving during synchronization remain pending after the older snapshot is acknowledged',async()=>{
    const page=fixture();const record=draft();record.serverId=5;page.records.set(record.key,record);
    page.setBehavior(async(url)=>{
        if(url.includes('session'))return {ok:true,json:async()=>({user:'test',csrf:'csrf'})};
        const current=page.records.get(record.key);
        current.version++;current.pendingChanges++;
        current.entries=[['completed_sections','[]'],['revision','1']];
        current.photos.push({id:'photo2',section:3,format:'square',caption:'new',blob:new Blob(['new'])});
        return {ok:true,json:async()=>({id:5,revision:2,status:'draft'})};
    });
    const saved=await page.api.syncRecord(record.key);
    assert.equal(saved.dirty,true);
    assert.equal(saved.pendingChanges,1);
    assert.equal(saved.photos.length,1);assert.equal(saved.photos[0].id,'photo2');
    assert.equal(saved.entries.find(([name])=>name==='completed_sections')[1],'[]');
    assert.equal(saved.savedPhotos.length,1);
});
test('A server revision conflict preserves fields, validation and photos and blocks automatic retries',async()=>{
    const page=fixture();const record=draft();record.serverId=5;page.records.set(record.key,record);
    page.setBehavior(async url=>url.includes('session')
        ?{ok:true,json:async()=>({user:'test',csrf:'csrf'})}
        :{ok:false,status:409,json:async()=>({error:'Changed on another device'})});
    await assert.rejects(page.api.syncRecord(record.key),/Changed on another/);
    const saved=page.records.get(record.key);
    assert.equal(saved.conflict,true);assert.equal(saved.photos.length,1);
    assert.equal(saved.entries.find(([name])=>name==='completed_sections')[1],'[6]');
    const count=page.calls.length;
    await assert.rejects(page.api.syncRecord(record.key),/Changed on another/);
    assert.equal(page.calls.length,count);
});
test('Legacy saved photos without crop metadata preserve their proportions on conflict copy',async()=>{
    const page=fixture();const record=draft();
    delete record.photos[0].format;record.serverId=5;page.records.set(record.key,record);
    await page.api.syncRecord(record.key);
    const request=page.calls.find(call=>call.url.includes('api=save'));
    assert.equal(request.options.body.get('formats_6[]'),'original');
});
test('Automatic synchronization skips stored conflicts without presenting them as new server errors',async()=>{
    const page=fixture(),record=draft();record.conflict=true;record.error='Old 409';
    page.records.set(record.key,record);
    assert.equal((await page.api.syncAll('test')).length,0);
    assert.equal(page.calls.length,0);
    assert.equal((await page.api.pendingState('test')).drafts,1);
});
test('Verified conflict copy archives the complete original and synchronizes only the copy',async()=>{
    const page=fixture(),record=draft();record.conflict=true;record.serverId=5;record.error='Old conflict';
    record.operation={requestId:'old-operation',entries:record.entries,photos:record.photos};
    record.savedPhotos=[{id:'saved',section:2,caption:'already saved',blob:new Blob(['saved'],{type:'image/png'})}];
    page.records.set(record.key,record);
    const copy=await page.api.copyConflict(record.key);
    const archived=page.records.get(record.key);
    assert.equal(archived.conflictResolved,true);assert.equal(archived.resolvedCopyKey,copy.key);
    assert.equal(archived.operation.requestId,'old-operation');
    assert.deepEqual(archived.entries,record.entries);assert.equal(archived.photos.length,1);assert.equal(archived.savedPhotos.length,1);
    assert.equal(copy.photos.length,2);assert.equal(copy.serverId,undefined);assert.equal(copy.resolutionPending,undefined);
    assert.equal(copy.conflict,undefined);
    assert.equal(await copy.photos[1].blob.text(),'saved');
    assert.equal(copy.entries.find(([name])=>name==='completed_sections')[1],'[6]');
    assert.equal((await page.api.pendingState('test')).drafts,1);
    await page.api.syncRecord(record.key,'finalized');assert.equal(page.calls.length,0);
    assert.equal((await page.api.syncAll('test')).length,0);
    assert.equal(page.calls.filter(call=>call.url.includes('api=save')).length,1);
    assert.equal(page.records.get(copy.key).dirty,false);
});
test('Same-size damaged photo prevents archiving and leaves the original active',async()=>{
    const page=fixture(),record=draft();record.conflict=true;page.records.set(record.key,record);
    const put=page.context.FoxLocal.put;
    page.context.FoxLocal.put=async copy=>{
        await put(copy);
        if(copy.resolutionPending)page.records.get(copy.key).photos[0].blob=new Blob(['xxxx'],{type:'image/jpeg'});
    };
    await assert.rejects(page.api.copyConflict(record.key),/Photo locale incomplète/);
    assert.equal(page.records.get(record.key).conflictResolved,undefined);
    assert.equal(await page.records.get(record.key).photos[0].blob.text(),'test');
    assert.equal((await page.api.syncAll('test')).length,0);assert.equal(page.calls.length,0);
});
test('Concurrent original edits prevent archiving; incomplete copy is never automatically sent',async()=>{
    const page=fixture(),record=draft();record.conflict=true;page.records.set(record.key,record);
    const resolve=page.context.FoxLocal.resolveConflict;
    page.context.FoxLocal.resolveConflict=async(...args)=>{
        await page.api.syncAll('test');assert.equal(page.calls.length,0);
        page.records.get(record.key).version++;
        return resolve(...args);
    };
    await assert.rejects(page.api.copyConflict(record.key),/original a changé/);
    assert.equal(page.records.get(record.key).conflictResolved,undefined);
    assert.equal(page.records.get(record.key).version,3);
});
test('Home conflict list offers Resolve only for active conflicts in the current account',async()=>{
    const page=fixture();
    const node=()=>({children:[],append(...children){this.children.push(...children);},replaceChildren(){this.children=[];}});
    page.context.document.createElement=node;
    const record=draft();record.conflict=true;
    page.records.set(record.key,record);
    page.records.set('archived',{...record,key:'archived',conflictResolved:true});
    page.records.set('other',{...record,key:'other',user:'other'});
    const panel=node();await page.api.renderConflicts(panel,'test');
    assert.equal(panel.hidden,false);assert.equal(panel.children.length,2);
    assert.equal(panel.children[1].children[1].textContent,'Résoudre');
    assert.match(panel.children[1].children[1].href,/offline.html\?id=local-uuid/);
    record.conflictResolved=true;
    await page.api.renderConflicts(panel,'test');
    assert.equal(panel.hidden,true);assert.equal(panel.children.length,0);
});
test('Archive transaction failure keeps the original active and the unconfirmed copy visibly blocked',async()=>{
    const page=fixture(),record=draft();record.conflict=true;page.records.set(record.key,record);
    page.context.FoxLocal.resolveConflict=async()=>{throw new Error('Storage transaction aborted');};
    await assert.rejects(page.api.copyConflict(record.key),/transaction aborted/);
    assert.equal(page.records.get(record.key).conflictResolved,undefined);
    const copy=[...page.records.values()].find(item=>item.key!==record.key);
    assert.equal(copy.conflict,true);assert.match(copy.error,/transaction aborted/);
    assert.equal(await copy.photos[0].blob.text(),'test');
    await page.api.syncAll('test');assert.equal(page.calls.length,0);
});
test('Choosing the server archives rather than deletes local data and stops the active conflict notice',async()=>{
    const page=fixture(),record=draft();record.conflict=true;record.operation={requestId:'original'};
    page.records.set(record.key,record);
    await page.api.resolveServer(record.key);
    const archive=page.records.get(record.key);
    assert.equal(archive.conflictResolved,true);assert.equal(archive.resolution,'server');
    assert.deepEqual(archive.entries,record.entries);
    assert.equal(archive.operation.requestId,'original');
    assert.equal(await archive.photos[0].blob.text(),'test');
    assert.equal((await page.api.pendingState('test')).drafts,0);
    await page.api.syncAll('test');assert.equal(page.calls.length,0);
});

test('Explicit local removal discards a conflicted snapshot without a server request',async()=>{
    const page=fixture(),record=draft();record.conflict=true;record.serverId=5;
    page.records.set(record.key,record);
    await page.api.discardLocal(record.key);
    const removed=page.records.get(record.key);
    assert.equal(removed.localDeleted,true);
    assert.equal(removed.conflictResolved,true);
    assert.equal(removed.operation,undefined);
    assert.equal(removed.html,undefined);
    assert.equal(removed.entries.length,0);
    assert.equal(removed.photos.length,0);
    assert.equal(removed.savedPhotos.length,0);
    assert.equal(removed.serverId,5);
    assert.equal((await page.api.pendingState('test')).drafts,0);
    await page.api.syncAll('test');
    assert.equal(page.calls.length,0);
});

test('Server-choice verifies the real report before archiving, and refuses a login response',async()=>{
    const page=fixture(),record=draft();record.serverId=5;record.conflict=true;page.records.set(record.key,record);
    page.context.DOMParser=class {parseFromString(){return {querySelector:()=>null};}};
    page.setBehavior(async()=>({ok:true,text:async()=>'<login>'}));
    await assert.rejects(page.api.serverConflictPage(record.key),/non confirmé/);
    assert.equal(page.records.get(record.key).conflictResolved,undefined);
    page.context.DOMParser=class {parseFromString(){return {querySelector:()=>({value:'5'})};}};
    assert.equal(await page.api.serverConflictPage(record.key),'index.php?id=5');
    await page.api.resolveServer(record.key);
    assert.equal(page.records.get(record.key).conflictResolved,true);
    assert.equal(await page.records.get(record.key).photos[0].blob.text(),'test');
});
test('Legacy string revision receives a numeric acknowledgement instead of expecting string concatenation',async()=>{
    const page=fixture(),record=draft();record.serverId=5;record.revision='1';page.records.set(record.key,record);
    const saved=await page.api.syncRecord(record.key);
    assert.equal(saved.revision,2);
    assert.equal(saved.dirty,false);
});
