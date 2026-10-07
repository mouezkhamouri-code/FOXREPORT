const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function fixture() {
    const events={},body={dataset:{user:'test'}},header={setAttribute:(name,value)=>{header[name]=value;}},status={setAttribute:()=>{}};
    let records=[],failure;
    const context={window:{addEventListener:(name,fn)=>{events[name]=fn;}},navigator:{onLine:true},
        localStorage:{getItem:()=>null},
        document:{body,querySelector:selector=>selector==='.topbar'?header:status,addEventListener:(name,fn)=>{events[name]=fn;}},
        FoxLocal:{all:async()=>{if(failure)throw failure;return records;}}};
    context.window.FoxLocal=context.FoxLocal;
    vm.runInNewContext(fs.readFileSync('assets/connection.js','utf8'),context);
    return {body,header,status,events,context,setRecords:value=>{records=value;},fail:error=>{failure=error;}};
}
test('Header line follows offline, pending, synchronized and active error states without counting archives',async()=>{
    const page=fixture();await page.events.pageshow();
    assert.equal(page.body.dataset.connectionState,'synced');
    assert.equal(page.header['data-connection-label'],'Synchronisé');
    page.context.navigator.onLine=false;page.events.offline();
    assert.equal(page.body.dataset.connectionState,'pending');
    assert.equal(page.header['data-connection-label'],'Hors ligne');
    page.setRecords([{user:'test',dirty:true,photos:[{}]}]);
    page.context.navigator.onLine=true;await page.events.online();
    assert.equal(page.body.dataset.connectionState,'pending');
    assert.equal(page.header['data-connection-label'],'Synchro en attente');
    page.setRecords([{user:'test',conflict:true}]);await page.events['fox-local-change']();
    assert.equal(page.body.dataset.connectionState,'error');
    assert.equal(page.header['data-connection-label'],'Erreur de synchro');
    page.setRecords([{user:'test',conflict:true,dirty:true,conflictResolved:true},{user:'other',dirty:true}]);
    await page.events['fox-synced']();
    assert.equal(page.body.dataset.connectionState,'synced');
    page.events.input({target:{closest:()=>({})}});
    assert.equal(page.body.dataset.connectionState,'pending');
    page.fail(new Error('Storage unavailable'));await page.events.pageshow();
    assert.equal(page.body.dataset.connectionState,'error');
    assert.match(page.status.textContent,/Storage unavailable/);
});
test('Header indicator is exactly 2px and wired into online and offline pages and worker',()=>{
    assert.match(fs.readFileSync('assets/app.css','utf8'),/\.topbar::after \{[^}]*height: 2px;/);
    assert.match(fs.readFileSync('assets/app.css','utf8'),/\.topbar::before \{[^}]*font-size: 9px;/);
    for(const file of ['index.php','offline.html','sw.js'])assert.match(fs.readFileSync(file,'utf8'),/assets\/connection.js/);
    assert.match(fs.readFileSync('offline.html','utf8'),/<header class="topbar">/);
});
