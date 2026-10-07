const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');

test('Isolated mobile browser: offline create, scanner, photo, reopen, sync and version update', {
    skip:!process.env.FOXREPORT_BROWSER_URL,timeout:180000,
},async()=>{
    const base=process.env.FOXREPORT_BROWSER_URL;
    const title='SYNTHETIC OFFLINE '+Date.now();
    assert.match(base,/^http:\/\/127\.0\.0\.1:\d+\/index\.php$/,'Synthetic localhost fixture only');
    const fixture=process.env.FOXREPORT_BROWSER_FIXTURE;
    assert.ok(fixture && path.basename(fixture).startsWith('foxreport-section-test-'));
    const profile=fs.mkdtempSync(path.join(os.tmpdir(),'foxreport-edge-profile-'));
    const browser=spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',[
        '--headless','--disable-gpu','--no-first-run',`--user-data-dir=${profile}`,
        '--remote-debugging-port=0','about:blank',
    ],{stdio:'ignore'});
    let socket,session,workerSession;
    let nextId=0;
    const pending=new Map();
    const errors=[];
    async function send(method,params={},targetSession=session) {
        const id=++nextId;
        return new Promise((resolve,reject)=>{
            pending.set(id,{resolve,reject});
            socket.send(JSON.stringify({id,method,params,...(targetSession?{sessionId:targetSession}:{})}));
        });
    }
    const evaluate=async expression=>{
        const updated=expression.replaceAll("'SYNTHETIC OFFLINE'",JSON.stringify(title));
        const code=updated.startsWith('const ')?`(()=>{${updated}})()`:updated;
        const result=await send('Runtime.evaluate',{expression:code,awaitPromise:true,returnByValue:true});
        if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
    };
    const wait=async(expression,label,timeout=30000)=>{
        const deadline=Date.now()+timeout;
        while(Date.now()<deadline) {
            if(await evaluate(expression))return;
            await new Promise(resolve=>setTimeout(resolve,100));
        }
        const diagnostic=await evaluate("(async()=>({url:location.href,title:document.title,online:navigator.onLine,version:document.body.dataset.appVersion,trace:localStorage.getItem('synthetic-update-trace'),update:document.querySelector('#update-status')?.textContent,sync:document.querySelector('#sync-state')?.textContent,records:window.FoxLocal?(await FoxLocal.all()).map(r=>({id:r.id,serverId:r.serverId,dirty:r.dirty,revision:r.revision,error:r.error,photos:r.photos?.length,saved:r.savedPhotos?.length})):null,worker:(await navigator.serviceWorker.getRegistration())?.active?.scriptURL,text:document.body.innerText.slice(0,250)}))()");
        throw new Error(`Timeout: ${label}; state: ${JSON.stringify(diagnostic)}; browser errors: ${errors.join('; ')}`);
    };
    try {
        const active=path.join(profile,'DevToolsActivePort');
        for(let i=0;i<100 && !fs.existsSync(active);i++)await new Promise(resolve=>setTimeout(resolve,100));
        assert.ok(fs.existsSync(active),'Headless Edge started');
        const [port,endpoint]=fs.readFileSync(active,'utf8').trim().split('\n');
        socket=new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);
        await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
        socket.addEventListener('message',event=>{
            const message=JSON.parse(event.data);
            if(message.id) {
                const item=pending.get(message.id);pending.delete(message.id);
                if(message.error)item.reject(new Error(message.error.message));else item.resolve(message.result);
            } else if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
        });
        const target=await send('Target.createTarget',{url:'about:blank'},null);
        session=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
        await send('Runtime.enable');await send('Page.enable');await send('Network.enable');
        await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
        await send('Page.navigate',{url:base});
        await wait("!!window.FoxSync && !!document.querySelector('.new-report-form')",'Application loaded');
        await wait("navigator.serviceWorker.controller !== null",'Worker activated');
        await wait("(async()=>!!window.FoxLocal && !!await FoxLocal.getTemplate(document.body.dataset.user))()",'Empty editor cached');
        const cached=await evaluate("(async()=>{const keys=await caches.keys();const cache=await caches.open(keys.find(k=>k.startsWith('foxreport-shell-')));return !!await cache.match(new URL('assets/scanner.js',location.href).href);})()");
        assert.equal(cached,true,'Scanner available offline');
        assert.equal(await evaluate("getComputedStyle(document.body).backgroundColor"),'rgb(243, 247, 247)');
        const workers=await send('Target.getTargets',{},null);
        const worker=workers.targetInfos.find(info=>info.type==='service_worker' && info.url.startsWith(new URL(base).origin));
        assert.ok(worker,'Service worker target present');
        workerSession=(await send('Target.attachToTarget',{targetId:worker.targetId,flatten:true},null)).sessionId;
        await send('Network.enable',{},workerSession);
        await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0},workerSession);
        await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
        await send('Page.navigate',{url:base});
        await wait("typeof document.querySelector('#new-local-report')?.onclick==='function'",'Offline home fallback');
        await evaluate("document.querySelector('#new-local-report').click()");
        await wait("!!document.querySelector('#report-form') && !!window.FoxBeforeUpdate",'Offline editor ready');
        const localId=await evaluate("document.querySelector('[name=report_id]').value");
        assert.match(localId,/^local-/);
        await evaluate("const field=document.querySelector('[name=establishment]');field.value='SYNTHETIC OFFLINE';field.dispatchEvent(new Event('input',{bubbles:true}));");
        await evaluate("document.querySelector('[data-section-accordion=\"6\"]').open=true;document.querySelector('[data-complete-section=\"6\"]').click();");
        assert.equal(await evaluate("document.querySelector('[data-section-accordion=\"6\"]').open"),false);
        assert.equal(await evaluate("document.querySelector('#completed-sections').value"),'[6]');
        await evaluate("document.querySelector('[data-section-accordion=\"3\"]').open=true;document.querySelector('#scan-device').click();document.querySelector('#scan-raw').value='Model: SYNTHETIC\\nSerial Number: SYNTHETIC123';document.querySelector('#scan-review').click();");
        assert.equal(await evaluate("document.querySelector('#scan-serial_number').value"),'SYNTHETIC123','Offline scanner parser available');
        await evaluate("document.querySelector('#scan-close').click();document.querySelector('[data-section-accordion=\"6\"]').open=true;");
        const root=(await send('DOM.getDocument')).root.nodeId;
        const input=(await send('DOM.querySelector',{nodeId:root,selector:'input[data-photo-input="6"]'})).nodeId;
        assert.ok(input,'Section camera/gallery input present');
        await send('DOM.setFileInputFiles',{nodeId:input,files:[path.join(fixture,'assets','icons','apple-touch-icon.png')]});
        await wait("!!document.querySelector('#crop-confirm')?.closest('dialog').open",'Photo crop opened offline');
        await evaluate("document.querySelector('#crop-format').value='square';document.querySelector('#crop-format').dispatchEvent(new Event('input'));document.querySelector('#crop-confirm').click();");
        await wait("window.FoxPhotos.get().length===1",'Photo encoded offline');
        assert.equal(await evaluate("document.querySelector('#completed-sections').value"),'[]','Photo addition invalidates completion');
        await evaluate("document.querySelector('[data-complete-section=\"6\"]').click()");
        await wait("(async()=>{const record=(await FoxLocal.all()).find(r=>r.title==='SYNTHETIC OFFLINE');return record?.photos.length===1 && record.entries.some(([name,value])=>name==='completed_sections'&&value==='[6]');})()",'Photo and validation persisted');
        await send('Page.reload');
        await wait("!!window.FoxBeforeUpdate && document.querySelector('[name=establishment]')?.value==='SYNTHETIC OFFLINE'",'Offline draft restored');
        assert.equal(await evaluate("FoxPhotos.get().length"),1);
        assert.equal(await evaluate("document.querySelector('#completed-sections').value"),'[6]');
        assert.match(await evaluate("document.querySelector('#sync-state').textContent"),/Hors ligne/);
        await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
        await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1},workerSession);
        await send('Target.detachFromTarget',{sessionId:workerSession},null);
        workerSession=null;
        await wait("(async()=>{const record=(await FoxLocal.all()).find(r=>r.title==='SYNTHETIC OFFLINE');return record && !record.dirty && record.serverId && !record.operation;})()",'Draft and photo confirmed by server');
        const saved=await evaluate("(async()=>{const r=(await FoxLocal.all()).find(r=>r.title==='SYNTHETIC OFFLINE');return {id:r.serverId,saved:r.savedPhotos.length,pending:r.photos.length};})()");
        assert.equal(saved.saved,1);assert.equal(saved.pending,0);
        const list=await evaluate("(async()=>{const r=await fetch('index.php?api=reports&filter=all');return (await r.json()).html;})()");
        assert.equal((list.match(new RegExp(title,'g'))||[]).length,1,'Only one server report');

        // Simulate a deployment inside the synthetic fixture only.
        const old=JSON.parse(fs.readFileSync(path.join(fixture,'version.json'),'utf8')).version;
        const next='foxreport-shell-eeeeeeeeeeeeeeee';
        for(const file of ['sw.js','offline.html','app\\build-version.php']) {
            const filename=path.join(fixture,file);
            fs.writeFileSync(filename,fs.readFileSync(filename,'utf8').replaceAll(old,next));
        }
        fs.writeFileSync(path.join(fixture,'version.json'),JSON.stringify({version:next}));
        await send('Network.setBlockedURLs',{urls:['*api=save*']});
        await evaluate("const field=document.querySelector('[name=wifi_comment]');field.value='PENDING THROUGH UPDATE';field.dispatchEvent(new Event('input',{bubbles:true}));");
        await wait("(async()=>!!(await FoxLocal.all()).find(r=>r.title==='SYNTHETIC OFFLINE')?.dirty)()",'Pending update write stored');
        await evaluate("(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();})()");
        await wait("(async()=>!!(await navigator.serviceWorker.getRegistration()).waiting)()",'New worker fully cached');
        await evaluate("const trace=text=>localStorage.setItem('synthetic-update-trace',(localStorage.getItem('synthetic-update-trace')||'')+' '+text);const original=window.FoxBeforeUpdate;window.FoxBeforeUpdate=async()=>{trace('preserve-start');await original();trace('preserve-finish');};navigator.serviceWorker.addEventListener('controllerchange',()=>trace('controller-change'));document.addEventListener('click',event=>{if(event.target.closest('#update-app'))trace('update-click');});trace('controlled:'+!!navigator.serviceWorker.controller);");
        await evaluate("document.querySelector('.topbar .actions-menu').open=true;");
        await evaluate("document.querySelector('#update-app').click()");
        await wait(`document.body.dataset.appVersion==='${next}' && !!window.FoxBeforeUpdate`,'PWA safely reloaded new version');
        assert.equal(await evaluate("document.querySelector('[name=wifi_comment]').value"),'PENDING THROUGH UPDATE');
        assert.equal(await evaluate("document.querySelector('[name=report_id]').value"),localId);
        assert.equal(await evaluate("(async()=>!!(await FoxLocal.all()).find(r=>r.title==='SYNTHETIC OFFLINE')?.dirty)()"),true);
        await send('Network.setBlockedURLs',{urls:[]});
        await evaluate("window.dispatchEvent(new Event('online'))");
        await wait("(async()=>{const r=(await FoxLocal.all()).find(r=>r.title==='SYNTHETIC OFFLINE');return !r.dirty && !r.operation;})()",'Retried save confirmed after update');
        const remoteSave=()=>evaluate("(async()=>{const r=(await FoxLocal.all()).find(r=>r.title==='SYNTHETIC OFFLINE');const body=new FormData();r.entries.forEach(([name,value])=>body.append(name,value));body.set('report_id',String(r.serverId));body.set('revision',String(r.revision));body.set('request_id',crypto.randomUUID());body.set('csrf_token','synthetic-csrf');body.set('wifi_comment','SERVER EDIT');body.set('action','save');body.set('save_status','draft');const response=await fetch('index.php?api=save&id='+r.serverId,{method:'POST',body});return {ok:response.ok,result:await response.json()};})()");
        const remote=await remoteSave();
        assert.equal(remote.ok,true,'Other device saved another version');
        await send('Page.navigate',{url:new URL(`index.php?id=${remote.result.id}`,base).href});
        await wait(`document.querySelector('[name=report_id]')?.value==='${remote.result.id}' && !!window.FoxBeforeUpdate && window.FoxPhotos?.cacheReady()`,'Fresh server editor and photos loaded');
        await wait(`(async()=>{const r=(await FoxLocal.all()).find(r=>r.id==='${localId}');return r?.revision===${remote.result.revision} && r.savedPhotos.length===1;})()`,'Clean local copy adopts confirmed server version without duplicating photos');
        assert.equal(await evaluate("(async()=>{const r=(await FoxLocal.all()).find(r=>r.title==='SYNTHETIC OFFLINE');return r.savedPhotos[0].format;})()"),'square');
        await evaluate("const field=document.querySelector('[name=wifi_comment]');field.value='EDIT AFTER REFRESH';field.dispatchEvent(new Event('input',{bubbles:true}));");
        await wait("(async()=>{const r=(await FoxLocal.all()).find(r=>r.title==='SYNTHETIC OFFLINE');return !r.dirty && !r.operation && r.entries.find(([name])=>name==='wifi_comment')[1]==='EDIT AFTER REFRESH';})()",'Fresh server editing does not produce a false revision conflict');
        assert.equal((await remoteSave()).ok,true,'Other device changes the report after reopening');
        await evaluate("const field=document.querySelector('[name=wifi_comment]');field.value='LOCAL CONFLICT';field.dispatchEvent(new Event('input',{bubbles:true}));");
        await wait("(async()=>!!(await FoxLocal.all()).find(r=>r.title==='SYNTHETIC OFFLINE')?.conflict)()",'Version conflict detected');
        assert.equal(await evaluate("document.querySelector('#sync-conflict').hidden"),false);
        assert.equal(await evaluate("document.querySelector('[name=wifi_comment]').value"),'LOCAL CONFLICT');
        await evaluate("document.querySelector('#conflict-copy').click()");
        await wait(`document.querySelector('[name=report_id]')?.value!=='${localId}' && !!window.FoxBeforeUpdate && document.querySelector('[name=wifi_comment]')?.value==='LOCAL CONFLICT'`,'Conflict copied without dropping local data');
        await wait("(async()=>{const id=document.querySelector('[name=report_id]').value;const r=(await FoxLocal.all()).find(r=>r.id===id);return r && !r.dirty && r.serverId && r.savedPhotos.length===1;})()",'Explicit conflict copy and photos saved');
        const original=await evaluate(`(async()=>{const r=(await FoxLocal.all()).find(r=>r.id==='${localId}');return {conflict:r.conflict,photos:r.savedPhotos.length,value:r.entries.find(([name])=>name==='wifi_comment')[1]};})()`);
        assert.equal(original.conflict,true);assert.equal(original.photos,1);assert.equal(original.value,'LOCAL CONFLICT');
        assert.deepEqual(errors,[],'No browser exceptions');
        console.log('Verified: mobile layout, offline creation, scanner, crop/photo, validation, reload, unique sync, update preservation and conflict recovery.');
    } finally {
        if(socket?.readyState===1) { await send('Browser.close',{},null);socket.close(); }
        if(browser.exitCode===null) await new Promise(resolve=>{browser.once('exit',resolve);setTimeout(()=>{if(browser.exitCode===null)browser.kill();},3000);});
        fs.rmSync(profile,{recursive:true,force:true});
    }
});
