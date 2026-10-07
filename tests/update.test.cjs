const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function fixture({form=false,preserveFailure=false,controlled=true}={}) {
    const events={},nodes=new Map(),messages=[];
    let reloads=0,preserved=0;
    const registration={
        waiting:{postMessage:message=>messages.push(message)},update:async()=>{},addEventListener:()=>{},
    };
    const container={replaceChildren:()=>nodes.clear(),append:(...elements)=>elements.forEach(element=>nodes.set(element.id,element))};
    const context={
        window:{
            isSecureContext:true,
            addEventListener:(name,callback)=>{events[name]=callback;},
            FoxBeforeUpdate:async()=>{preserved++;if(preserveFailure)throw new Error('Local save failed');},
        },
        document:{
            body:{dataset:{appVersion:'foxreport-shell-1111111111111111'}},
            querySelector:selector=>selector==='[data-update-container]'?container:selector==='#report-form'&&form?{}:null,
            createElement:()=>({setAttribute:()=>{}}),
            addEventListener:(name,callback)=>{events[name]=callback;},
        },
        navigator:{
            onLine:true,
            serviceWorker:{
                getRegistration:async()=>registration,ready:Promise.resolve(registration),controller:controlled?{}:null,
                addEventListener:(name,callback)=>{events[name]=callback;},
            },
        },
        location:{reload:()=>{reloads++;}},
        fetch:async()=>({ok:true,json:async()=>({version:'foxreport-shell-2222222222222222'})}),
    };
    vm.runInNewContext(fs.readFileSync('assets/update.js','utf8'),context);
    return {
        context,events,nodes,messages,registration,
        reloads:()=>reloads,preserved:()=>preserved,
        click:()=>events.click({target:{closest:()=>({})}}),
    };
}
test('PWA update explicitly activates waiting worker only after preserving local report',async()=>{
    const page=fixture({form:true});
    await new Promise(resolve=>setImmediate(resolve));
    assert.match(page.nodes.get('update-app').textContent,/Mettre à jour/);
    await page.click();
    assert.equal(page.preserved(),1);
    assert.equal(page.messages[0].type,'FOXREPORT_ACTIVATE_UPDATE');
    assert.equal(page.reloads(),0);
    page.events.controllerchange();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(page.reloads(),1);
    assert.equal(page.preserved(),2);
});
test('A failed local write prevents update activation and forced reload',async()=>{
    const page=fixture({form:true,preserveFailure:true});
    await new Promise(resolve=>setImmediate(resolve));
    await page.click();
    assert.equal(page.messages.length,0);assert.equal(page.reloads(),0);
    assert.match(page.nodes.get('update-status').textContent,/Local save failed/);
    page.events.controllerchange();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(page.reloads(),0);
});
test('Offline update check does not fetch or clear local storage',async()=>{
    const page=fixture();page.context.navigator.onLine=false;
    await new Promise(resolve=>setImmediate(resolve));
    assert.match(page.nodes.get('update-status').textContent,/Hors ligne/);
    assert.equal(page.messages.length,0);
});
test('First worker activation does not reload an editor still being prepared',async()=>{
    const page=fixture({form:true,controlled:false});
    await new Promise(resolve=>setImmediate(resolve));
    page.events.controllerchange();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(page.reloads(),0);assert.equal(page.preserved(),0);
    page.events.controllerchange();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(page.reloads(),1);assert.equal(page.preserved(),1);
});
test('Generated release versions agree across PHP, offline HTML and service worker',()=>{
    const version=JSON.parse(fs.readFileSync('version.json','utf8')).version;
    assert.match(version,/^foxreport-shell-[a-f0-9]{16}$/);
    assert.ok(fs.readFileSync('app/build-version.php','utf8').includes(version));
    assert.ok(fs.readFileSync('sw.js','utf8').includes(`const VERSION = '${version}'`));
    assert.ok(fs.readFileSync('offline.html','utf8').includes(`data-app-version="${version}"`));
    assert.ok(fs.readFileSync('offline.html','utf8').includes(`assets/update.js?v=${version}`));
    const worker=fs.readFileSync('sw.js','utf8');
    assert.match(worker,/FOXREPORT_ACTIVATE_UPDATE/);
    assert.doesNotMatch(worker,/indexedDB\.deleteDatabase/);
});
