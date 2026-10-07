const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');

async function fixture({snapshot=true,record}={}) {
    const events={},handlers={},records=new Map();
    const controls=['report_id','revision','establishment','active_section'].map(name=>({name,value:name==='report_id'?'7':name==='revision'?'3':name==='active_section'?'1':'Synthetic'}));
    const elements=Object.assign(controls,Object.fromEntries(controls.map(control=>[control.name,control])));
    const fieldset={disabled:false};
    const form={elements,querySelector:selector=>selector==='fieldset'?fieldset:null,querySelectorAll:()=>[],
        dispatchEvent:()=>{},addEventListener:(name,fn)=>{handlers[name]=fn;}};
    const conflict={hidden:true,querySelector:()=>({textContent:''})},state={textContent:''};
    const buttons=Object.fromEntries(['#conflict-copy','#conflict-server'].map(name=>[name,{disabled:false,addEventListener:(_,fn)=>{handlers[name]=fn;}}]));
    const pending={after:()=>{}};
    const selectors={'#report-form':form,'#sync-conflict':conflict,'#sync-state':state,'#local-sync-status':pending,'#active-section':elements.active_section,...buttons};
    const original=record || {key:'test:7',id:'7',serverId:7,user:'test',revision:3,version:1,entries:controls.map(control=>[control.name,control.value]),
        photos:[],savedPhotos:[],dirty:true,conflict:true,error:'Old conflict',title:'Synthetic',section:1};
    records.set(original.key,structuredClone(original));
    const context={
        window:{addEventListener:()=>{}},document:{body:{dataset:{user:'test',localSnapshot:snapshot?'true':''}},
            documentElement:{outerHTML:'synthetic'},querySelector:selector=>selectors[selector] || null,
            createElement:()=>({}),addEventListener:(name,fn)=>{events[name]=fn;}},
        location:{href:''},navigator:{onLine:true},crypto,Event,File:globalThis.File,
        FormData:class {entries(){return controls.map(control=>[control.name,control.value])[Symbol.iterator]();}},
        localStorage:{setItem:()=>{}},setTimeout:()=>1,clearTimeout:()=>{},confirm:()=>true,
        FoxLocal:{
            get:async key=>structuredClone(records.get(key)),
            all:async()=>[...records.values()].map(record=>structuredClone(record)),
            put:async value=>{records.set(value.key,structuredClone(value));},
            update:async(key,fn)=>{const value=fn(structuredClone(records.get(key)));records.set(key,structuredClone(value));return value;},
            remove:async key=>{records.delete(key);},
        },
        FoxSync:{pendingState:async()=>({drafts:0,photos:0,changes:0}),cacheTemplate:async()=>{},
            copyConflict:async key=>{records.get(key).conflictResolved=true;return {id:'local-copy'};},
            resolveServer:async key=>{records.get(key).conflictResolved=true;},
            syncRecord:async()=>{throw new Error('Unexpected sync');}},
        fetch:async()=>({ok:true,text:async()=>'<server>'}),
        DOMParser:class {parseFromString(){return {querySelector:()=>({value:'7'})};}},
    };
    context.window.FoxLocal=context.FoxLocal;context.window.FoxSync=context.FoxSync;
    context.window.FoxPhotos={get:()=>[],getSaved:()=>[],restore:async()=>{},restoreSaved:()=>{},whenReady:async()=>{}};
    await vm.runInNewContext(fs.readFileSync('assets/pwa.js','utf8'),context);
    return {context,records,events,handlers,buttons,conflict,state,fieldset};
}
for (const action of ['#conflict-copy','#conflict-server']) {
    test(`${action} hides resolved conflict and late photo/input/update callbacks never recreate it`,async()=>{
        const page=await fixture();
        assert.equal(page.conflict.hidden,false);
        await page.handlers[action]({currentTarget:page.buttons[action]});
        assert.equal(page.conflict.hidden,true);
        assert.equal(page.records.get('test:7').conflictResolved,true);
        page.events['fox-photos-cached']();
        page.handlers.input();
        await page.context.window.FoxBeforeUpdate();
        await new Promise(resolve=>setImmediate(resolve));
        assert.equal(page.records.size,1);
        assert.doesNotMatch(page.state.textContent,/Erreur/);
        assert.match(page.context.location.href,action==='#conflict-copy'?/local-copy/:/index.php\?id=7/);
    });
}
test('Fresh server page does not reopen the archived original as an active conflict',async()=>{
    const page=await fixture({snapshot:false,record:{key:'test:7',id:'7',serverId:7,user:'test',revision:2,version:2,
        entries:[],photos:[],savedPhotos:[],dirty:true,conflict:true,conflictResolved:true,title:'Archived'}});
    assert.equal(page.conflict.hidden,true);
    assert.equal(page.fieldset.disabled,false);
    assert.equal(page.records.get('test:7').conflictResolved,true);
    assert.equal(page.records.get('test:server-7').revision,3);
    assert.equal(page.records.get('test:server-7').dirty,false);
});
test('Late photo cache after another tab resolves the original does not create a new conflict',async()=>{
    const page=await fixture();
    page.records.get('test:7').conflictResolved=true;
    page.records.get('test:7').version++;
    page.events['fox-photos-cached']();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(page.records.size,1);
    assert.equal(page.conflict.hidden,true);
});
test('Failed copy leaves the conflict visible and reports the actual failure',async()=>{
    const page=await fixture();
    page.context.FoxSync.copyConflict=async()=>{throw new Error('Photo verification failed');};
    await page.handlers['#conflict-copy']({currentTarget:page.buttons['#conflict-copy']});
    assert.equal(page.conflict.hidden,false);
    assert.equal(page.records.get('test:7').conflictResolved,undefined);
    assert.match(page.state.textContent,/Photo verification failed/);
    assert.equal(page.context.location.href,'');
});
