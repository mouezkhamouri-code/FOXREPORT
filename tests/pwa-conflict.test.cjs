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
    const buttons=Object.fromEntries(['#conflict-copy','#conflict-server','.report-preview'].map(name=>[name,{disabled:false,addEventListener:(_,fn)=>{handlers[name]=fn;}}]));
    const pending={after:()=>{},setAttribute:()=>{}};
    const selectors={'#report-form':form,'#sync-conflict':conflict,'#sync-state':state,'#local-sync-status':pending,'#active-section':elements.active_section,...buttons};
    const original=record || {key:'test:7',id:'7',serverId:7,user:'test',revision:3,version:1,entries:controls.map(control=>[control.name,control.value]),
        photos:[],savedPhotos:[],dirty:true,conflict:true,error:'Old conflict',title:'Synthetic',section:1};
    records.set(original.key,structuredClone(original));
    const context={
        window:{addEventListener:()=>{},open:()=>null},URL,document:{body:{dataset:{user:'test',localSnapshot:snapshot?'true':''}},
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
    context.window.FoxAppMode={usesLocalReports:()=>true};
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

test('A local snapshot with a legacy string revision is not treated as a fresh server conflict',async()=>{
    const page=await fixture({record:{key:'test:7',id:'7',serverId:7,user:'test',revision:'0',version:1,
        entries:[['report_id','7'],['revision','0'],['establishment','Synthetic'],['active_section','1']],
        photos:[],savedPhotos:[],dirty:false,title:'Synthetic',section:1}});
    assert.equal(page.conflict.hidden,true);
    assert.equal(page.records.get('test:7').conflict,undefined);
});
test('An old editor cannot recreate a locally removed draft during photo/input callbacks',async()=>{
    const page=await fixture();
    page.records.set('test:7',{key:'test:7',id:'7',user:'test',version:2,localDeleted:true,conflictResolved:true,dirty:false,photos:[],entries:[]});
    page.events['fox-photos-cached']();
    await new Promise(resolve=>setImmediate(resolve));
    page.handlers.input();
    await page.context.window.FoxBeforeUpdate();
    assert.equal(page.records.size,1);
    assert.equal(page.records.get('test:7').localDeleted,true);
    assert.equal(page.records.get('test:7').entries.length,0);
});
test('Preview syncs pending photos first, then opens the PDF of the synchronized revision',async()=>{
    const page=await fixture({record:{key:'test:7',id:'7',serverId:7,user:'test',revision:3,version:1,
        entries:[['report_id','7'],['revision','3'],['establishment','Synthetic'],['active_section','1']],
        photos:[{id:'pending-photo'}],savedPhotos:[],dirty:true,title:'Synthetic',section:1}});
    const calls=[];
    const viewer={document:{body:{}},location:{},close:()=>calls.push('close')};
    page.context.location.href='https://fox.test/index.php?id=7';
    page.context.window.open=()=>{calls.push('open');return viewer;};
    page.context.FoxSync.syncRecord=async key=>{
        calls.push('sync');
        const record=page.records.get(key);
        page.records.set(key,{...record,dirty:false,operation:undefined,revision:4,photos:[],savedPhotos:[{id:'pending-photo'}]});
    };
    let prevented=false;
    await page.handlers['.report-preview']({preventDefault:()=>{prevented=true;},currentTarget:{getAttribute:()=>null}});
    assert.equal(prevented,true);
    assert.deepEqual(calls,['open','sync']);
    assert.equal(viewer.location.href,'https://fox.test/rapport.php?id=7&revision=4');
});
test('Preview offline with pending changes keeps the form and does not open a stale PDF',async()=>{
    const page=await fixture({record:{key:'test:7',id:'7',serverId:7,user:'test',revision:3,version:1,
        entries:[['report_id','7'],['revision','3'],['establishment','Synthetic'],['active_section','1']],
        photos:[{id:'pending-photo'}],savedPhotos:[],dirty:true,title:'Synthetic',section:1}});
    const calls=[];
    const viewer={document:{body:{}},location:{},close:()=>calls.push('close')};
    page.context.navigator.onLine=false;
    page.context.window.open=()=>{calls.push('open');return viewer;};
    await page.handlers['.report-preview']({preventDefault:()=>{},currentTarget:{getAttribute:()=>null}});
    assert.deepEqual(calls,['open','close']);
    assert.equal(viewer.location.href,undefined);
    assert.match(page.state.textContent,/Hors ligne — prévisualisation/);
});
test('Installed desktop editor syncs before loading the inline PDF viewer and never opens an app window',async()=>{
    const page=await fixture({record:{key:'test:7',id:'7',serverId:7,user:'test',revision:3,version:1,
        entries:[['report_id','7'],['revision','3'],['establishment','Synthetic'],['active_section','1']],
        photos:[],savedPhotos:[],dirty:true,title:'Synthetic',section:1}});
    const calls=[];
    page.context.location.href='https://fox.test/index.php?id=7';
    page.context.window.open=()=>{throw new Error('Unexpected application window');};
    page.context.window.FoxReportPreview={isDesktop:()=>true,open:()=>{
        calls.push('viewer');return {load:async url=>calls.push(url),close:()=>calls.push('close')};
    }};
    page.context.FoxSync.syncRecord=async key=>{
        calls.push('sync');page.records.set(key,{...page.records.get(key),dirty:false,operation:undefined,revision:4});
    };
    await page.handlers['.report-preview']({preventDefault:()=>{},currentTarget:{getAttribute:()=>null}});
    assert.deepEqual(calls,['viewer','sync','https://fox.test/rapport.php?id=7&revision=4']);
});
