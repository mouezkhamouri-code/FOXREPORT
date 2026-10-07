const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

test('Desktop list receives insert/update, retains data on error and retries after reconnect', async () => {
    const elements = {
        '#live-report-list': {innerHTML:'original',querySelector:()=>null,addEventListener:(name,callback)=>{events[`list-${name}`]=callback;}},
        '#report-list-state': {textContent:''},
        '#report-list-error': {textContent:'',hidden:true},
    };
    const events = {};
    let scheduled;
    let next = {ok:true,status:200,html:'report from PWA'};
    let calls=0;
    const context = {
        document:{hidden:false,querySelector:selector=>elements[selector],addEventListener:(name,callback)=>{events[name]=callback;}},
        navigator:{onLine:true},
        window:{addEventListener:(name,callback)=>{events[name]=callback;}},
        setTimeout:(callback,ms)=>{if(ms===3000)scheduled=callback;return ms;},
        clearTimeout:()=>{},
        AbortController, Date, Error,
        fetch:async(url,options)=>{
            calls++;
            assert.equal(url,'index.php?api=reports&filter=open');
            assert.equal(options.cache,'no-store');
            return {ok:next.ok,status:next.status,json:async()=>next};
        },
    };
    const flush=()=>new Promise(resolve=>setImmediate(resolve));
    vm.runInNewContext(fs.readFileSync('assets/report-list.js','utf8'),context);
    await flush();
    assert.equal(elements['#live-report-list'].innerHTML,'report from PWA');
    next={ok:true,status:200,html:'updated PWA report'};
    await scheduled();
    assert.equal(elements['#live-report-list'].innerHTML,'updated PWA report');
    next={ok:false,status:503,error:'Missing migration'};
    await scheduled();
    assert.equal(elements['#live-report-list'].innerHTML,'updated PWA report');
    assert.equal(elements['#report-list-error'].textContent,'Missing migration');
    context.navigator.onLine=false; events.offline();
    const before=calls; await scheduled(); assert.equal(calls,before);
    context.navigator.onLine=true;next={ok:true,status:200,html:'reconnected report'};
    await events.online();assert.equal(elements['#live-report-list'].innerHTML,'reconnected report');
    context.document.hidden=true;await scheduled();assert.equal(calls,before+1);
    context.document.hidden=false;events.visibilitychange();await flush();
    next={ok:false,status:401,error:'Unauthorized'};await scheduled();
    const after=calls;await events.online();assert.equal(calls,after);
    assert.match(elements['#report-list-error'].textContent,/Session expirée/);
});

test('Delete command requires confirmation, handles conflicts and removes the local copy only after success', async () => {
    const events = {};
    const notices = [];
    const removed = [];
    let confirmed = false;
    let deletes = 0;
    let result = {ok:false, error:'Version modifiée ailleurs'};
    const button = {disabled:false};
    const form = {querySelector:()=>button,closest:()=>null};
    const body = new Map([['report_id','7'],['revision','3'],['confirm_delete','1'],['csrf_token','test']]);
    class FakeFormData {
        constructor() { this.get = name => body.get(name); }
    }
    const elements = {
        '#live-report-list': {innerHTML:'original',querySelector:()=>null,addEventListener:(name,callback)=>{events[name]=callback;}},
        '#report-list-state': {textContent:''},
        '#report-list-error': {textContent:'',hidden:true},
    };
    const context = {
        document:{hidden:false,body:{dataset:{user:'test-user'}},querySelector:name=>elements[name],addEventListener:()=>{}},
        window:{addEventListener:()=>{},FoxLocal:{get:async()=>null,remove:async key=>removed.push(key)}},
        navigator:{onLine:true}, AbortController, Date, Error, FormData:FakeFormData,
        confirm:()=>confirmed, alert:text=>notices.push(text),
        setTimeout:()=>1,clearTimeout:()=>{},
        fetch:async(url,options)=>{
            if (url === 'index.php?api=delete') {
                deletes++;
                assert.equal(options.method,'POST');
                assert.equal(options.body.get('csrf_token'),'test');
                return {ok:result.ok,json:async()=>result};
            }
            return {ok:true,status:200,json:async()=>({html:'fresh list'})};
        },
    };
    vm.runInNewContext(fs.readFileSync('assets/report-list.js','utf8'),context);
    await new Promise(resolve=>setImmediate(resolve));
    const event = {target:{closest:()=>form},preventDefault:()=>{}};
    await events.submit(event);
    assert.equal(deletes,0);
    confirmed=true;
    context.navigator.onLine=false;
    await events.submit(event);
    assert.equal(deletes,0);
    context.navigator.onLine=true;
    await events.submit(event);
    assert.equal(deletes,1);
    assert.equal(removed.length,0);
    assert.match(notices[0],/Version modifiée/);
    result={ok:true,deleted:7,warning:null};
    await events.submit(event);
    assert.deepEqual(removed,['test-user:7']);
    assert.equal(button.disabled,false);
    context.window.FoxLocal.get=async()=>({conflictResolved:true});
    await events.submit(event);
    assert.deepEqual(removed,['test-user:7'],'Deleting server report preserves the resolved local archive');
});
test('Actions opens and closes native popup without navigating; polling preserves open popup and focused card',async()=>{
    const events={};
    let scheduled,open=false,focused=false,shows=0,closes=0;
    const dialog={showModal:()=>{open=true;shows++;},close:()=>{open=false;closes++;}};
    const list={innerHTML:'original',dataset:{filter:'all'},querySelector:selector=>selector==='dialog[open]' && open?dialog:null,
        contains:()=>focused,addEventListener:(name,fn)=>{events[name]=fn;}};
    const elements={'#live-report-list':list,'#report-list-state':{},'#report-list-error':{}};
    const context={document:{hidden:false,querySelector:selector=>elements[selector],getElementById:id=>{assert.equal(id,'report-actions-7');return dialog;},addEventListener:()=>{}},
        window:{addEventListener:()=>{}},navigator:{onLine:true},AbortController,Date,
        setTimeout:(fn,ms)=>{if(ms===3000)scheduled=fn;return 1;},clearTimeout:()=>{},
        fetch:async()=>({ok:true,status:200,json:async()=>({html:'updated'})})};
    vm.runInNewContext(fs.readFileSync('assets/report-list.js','utf8'),context);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(list.innerHTML,'updated');
    events.click({target:{closest:selector=>selector==='.report-actions-open'?{dataset:{dialog:'report-actions-7'}}:null}});
    assert.equal(shows,1);
    list.innerHTML='preserved popup';
    await scheduled();assert.equal(list.innerHTML,'preserved popup');
    events.click({target:{closest:selector=>selector==='.report-actions-close'?{closest:()=>dialog}:null}});
    assert.equal(closes,1);
    focused=true;await scheduled();assert.equal(list.innerHTML,'preserved popup');
    focused=false;await scheduled();assert.equal(list.innerHTML,'updated');
});
test('Card layout uses exact requested spacing and keeps refresh status off the visual layout',()=>{
    const css=fs.readFileSync('assets/app.css','utf8');
    assert.match(css,/\.report-cards \{[^}]*gap: 20px;/);
    assert.match(css,/\.report-card \{[^}]*padding: 20px;/);
    assert.match(css,/\.page-shell \{ width: calc\(100% - 32px\);/);
    assert.match(css,/\.report-card-open \{ flex: 1;/);
    assert.doesNotMatch(css,/\.report-card-open \{[^}]*position: absolute/);
    assert.match(fs.readFileSync('index.php','utf8'),/id="report-list-state" class="sr-only"/);
    assert.doesNotMatch(fs.readFileSync('index.php','utf8'),/Remplissage calculé sur les/);
});
