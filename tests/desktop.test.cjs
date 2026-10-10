const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

test('Local reports are reserved for standalone PWA and explicitly opened local workspaces',()=>{
    const context={window:{matchMedia:()=>({matches:false})},navigator:{},document:{body:{dataset:{}}}};
    vm.runInNewContext(fs.readFileSync('assets/app-mode.js','utf8'),context);
    const usesLocal=()=>context.window.FoxAppMode.usesLocalReports();
    assert.equal(usesLocal(),false);
    context.navigator.standalone=true;
    assert.equal(usesLocal(),true);
    context.navigator.standalone=false;
    context.window.matchMedia=()=>({matches:true});
    assert.equal(usesLocal(),true);
    context.window.matchMedia=()=>({matches:false});
    context.document.body.dataset.localWorkspace='true';
    assert.equal(usesLocal(),true);
    context.document.body.dataset={localSnapshot:'true'};
    assert.equal(usesLocal(),true);
});

test('Browser mode does not restore, sync, delete local data or intercept logout',async()=>{
    const context={window:{FoxAppMode:{usesLocalReports:()=>false}},
        document:{querySelector:()=>{throw new Error('Desktop must not initialize local UI');}}};
    await vm.runInNewContext(fs.readFileSync('assets/pwa.js','utf8'),context);
    vm.runInNewContext(fs.readFileSync('assets/connection.js','utf8'),context);
    assert.equal(context.window.FoxBeforeUpdate,undefined);
    vm.runInNewContext(fs.readFileSync('assets/local-store.js','utf8'),context);
    assert.equal(typeof context.window.FoxLocal.get,'function','IndexedDB is not opened until local data is requested');
});

function fixture({local=false,finalized=false}={}) {
    const handlers={},events={},state={textContent:'Enregistré'};
    const fields=[['establishment','Synthetic'],['active_section','1']];
    let valid=true,photos=[],ready=Promise.resolve(),submitted=0,submittedBy;
    class FormDataFixture {
        constructor(form) {
            this.values=fields.map(entry=>[...entry]);
            this.values.push(['photos_1[]',new Blob([])],['photos_1[]',new Blob([])]);
            if(form) handlers.formdata?.({formData:this});
        }
        append(...entry) {this.values.push(entry);}
        keys() {return this.values.map(([name])=>name)[Symbol.iterator]();}
        delete(name) {this.values=this.values.filter(([key])=>key!==name);}
        entries() {return this.values[Symbol.iterator]();}
    }
    const form={querySelector:()=>({disabled:finalized}),addEventListener:(name,fn)=>{handlers[name]=fn;},
        checkValidity:()=>valid,requestSubmit:button=>{
            if(!valid)return;
            let prevented=false;
            handlers.submit({submitter:button,preventDefault:()=>{prevented=true;}});
            if(!prevented){submitted++;submittedBy=button;}
        }};
    const context={window:{FoxAppMode:{usesLocalReports:()=>local},
        FoxPhotos:{get:()=>photos,whenReady:()=>ready},addEventListener:(name,fn)=>{events[name]=fn;}},
        document:{querySelector:selector=>selector==='#report-form'?form:state},FormData:FormDataFixture,setTimeout};
    vm.runInNewContext(fs.readFileSync('assets/desktop.js','utf8'),context);
    return {context,handlers,events,fields,state,form,FormDataFixture,setPhotos:value=>{photos=value;},
        setReady:value=>{ready=value;},setValid:value=>{valid=value;},submitted:()=>submitted,submittedBy:()=>submittedBy};
}

test('Desktop keeps server values, submits all cropped photos and preserves draft/finalize submitter',async()=>{
    const page=fixture();
    const blob=new Blob(['synthetic'],{type:'image/jpeg'});
    page.setPhotos([{id:'photo-a',section:1,blob,caption:'Outside',format:'landscape'},
        {id:'photo-b',section:2,blob,caption:'Inside',format:'square'}]);
    const data=new page.FormDataFixture(page.form);
    assert.deepEqual(data.values.filter(([name])=>name.startsWith('photos_')).map(([name,value,file])=>[name,value===blob,file]),
        [['photos_1[]',true,'photo.jpg'],['photos_2[]',true,'photo.jpg']]);
    assert.ok(data.values.some(([name,value])=>name==='captions_1[]' && value==='Outside'));
    assert.ok(data.values.some(([name,value])=>name==='formats_2[]' && value==='square'));
    assert.ok(data.values.some(([name,value])=>name==='photo_uids_1[]' && value==='photo-a'));
    for(const value of ['draft','finalized']) {
        const current=fixture(),button={name:'save_status',value};
        let release;
        current.setReady(new Promise(resolve=>{release=resolve;}));
        let prevented=false;
        const saving=current.handlers.submit({submitter:button,preventDefault:()=>{prevented=true;}});
        assert.equal(prevented,true);
        assert.equal(current.submitted(),0);
        release();await saving;
        assert.equal(current.submitted(),1);
        assert.equal(current.submittedBy(),button);
    }
});

test('Desktop warns for unsaved data but not section navigation; invalid or failed preparation never submits',async()=>{
    const page=fixture();
    page.fields[1][1]='12';page.handlers['fox-change']();
    let prevented=false;
    const event={preventDefault:()=>{prevented=true;}};
    page.events.beforeunload(event);
    assert.equal(prevented,false);
    page.fields[0][1]='Changed';page.handlers.input();
    assert.match(page.state.textContent,/non enregistrées/);
    page.events.beforeunload(event);
    assert.equal(prevented,true);
    await assert.rejects(page.context.window.FoxBeforeUpdate(),/Enregistrez/);
    page.setValid(false);
    await page.handlers.submit({preventDefault:()=>{}});
    assert.equal(page.submitted(),0);
    page.setValid(true);
    page.setReady(Promise.reject(new Error('Photo preparation failed')));
    await page.handlers.submit({preventDefault:()=>{}});
    assert.equal(page.submitted(),0);
    assert.match(page.state.textContent,/Photo preparation failed/);
});

test('Desktop handler does not replace PWA persistence or reopen finalized reports',()=>{
    assert.deepEqual(Object.keys(fixture({local:true}).handlers),[]);
    assert.deepEqual(Object.keys(fixture({finalized:true}).handlers),[]);
    for(const file of ['index.php','offline.html','sw.js']) assert.match(fs.readFileSync(file,'utf8'),/assets\/app-mode.js/);
    assert.match(fs.readFileSync('index.php','utf8'),/id="local-sync-status" role="status" hidden/);
});
test('Desktop preview refuses stale server data when the current form contains unsaved changes',async()=>{
    const page=fixture();
    await page.context.window.FoxBeforePreview();
    page.fields[0][1]='Changed';
    await assert.rejects(page.context.window.FoxBeforePreview(),/Enregistrez le brouillon avant de prévisualiser/);
});
