const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const crypto=require('node:crypto');
async function fixture() {
    const records=new Map(),events={};
    const node=tag=>({tag,children:[],textContent:'',disabled:false,append(...items){this.children.push(...items);},replaceChildren(){this.children=[];}});
    const list=node('div'),error=node('p'),status=node('p'),newReport=node('button');
    const selectors={'#offline-reports':list,'#offline-error':error,'#local-sync-status':status,'#new-local-report':newReport};
    const source={key:'test:7',user:'test',id:'7',serverId:7,title:'Test',revision:'0',version:1,dirty:true,conflict:true,
        error:'Version locale 0, serveur 0',section:1,entries:[['report_id','7'],['revision','0'],['establishment','Test']],
        photos:[{id:'p',section:1,caption:'original',blob:new Blob(['original photo'],{type:'image/jpeg'})}],savedPhotos:[]};
    records.set(source.key,structuredClone(source));
    const form={elements:{report_id:{value:'0'}}};let confirm=true;
    const context={window:{addEventListener:()=>{}},navigator:{onLine:true},localStorage:{getItem:()=> 'test'},
        location:{search:'',href:''},document:{querySelector:q=>selectors[q],createElement:node,addEventListener:(name,fn)=>{events[name]=fn;},dispatchEvent:()=>{}},
        crypto,Blob,File:globalThis.File,CustomEvent:class {},FormData:class {entries(){return [['report_id',form.elements.report_id.value],['revision','1']][Symbol.iterator]();}},
        DOMParser:class {parseFromString(){return {querySelector:q=>q==='#report-form'?form:{value:'7'}};}},
        AbortController,setTimeout,clearTimeout,URLSearchParams,confirm:()=>confirm,
        fetch:async()=>({ok:true,text:async()=>'<server>'}),
        FoxLocal:{get:async key=>structuredClone(records.get(key)),all:async()=>[...records.values()].map(r=>structuredClone(r)),
            getTemplate:async()=>({html:'synthetic'}),put:async r=>{records.set(r.key,structuredClone(r));},
            update:async(key,fn)=>{const r=fn(structuredClone(records.get(key)));records.set(key,structuredClone(r));return r;},
            resolveConflict:async(key,copyKey,fn)=>{const r=fn(structuredClone(records.get(key)),structuredClone(records.get(copyKey)));records.set(key,structuredClone(r.source));records.set(copyKey,structuredClone(r.copy));}}
    };
    context.window.FoxLocal=context.FoxLocal;
    vm.runInNewContext(fs.readFileSync('assets/sync-client.js','utf8'),context);
    context.FoxSync=context.window.FoxSync;
    await vm.runInNewContext(fs.readFileSync('assets/offline.js','utf8'),context);
    const button=name=>list.children.flatMap(card=>card.children).find(child=>child.tag==='button'&&child.textContent===name);
    return {context,records,list,error,events,button,setConfirm:value=>{confirm=value;}};
}
test('Offline list resolves a legacy conflict directly and copies real photo bytes without opening the editor',async()=>{
    const page=await fixture();
    await page.button('Conserver mes saisies dans une copie').onclick();
    assert.equal(page.error.textContent,'');
    const source=page.records.get('test:7'),copy=page.records.get(source.resolvedCopyKey);
    assert.equal(source.conflictResolved,true);
    assert.equal(copy.revision,1);
    assert.equal(await copy.photos[0].blob.text(),'original photo');
    assert.equal(copy.entries.find(([name])=>name==='establishment')[1],'Test');
    assert.match(page.context.location.href,/offline.html\?id=local-/);
});
test('Offline list can discard an unsynchronized conflict; cancellation preserves every photo',async()=>{
    const page=await fixture();page.setConfirm(false);
    await page.button('Retirer la copie de cet appareil').onclick();
    assert.equal(page.records.get('test:7').localDeleted,undefined);
    assert.equal(await page.records.get('test:7').photos[0].blob.text(),'original photo');
    page.setConfirm(true);await page.button('Retirer la copie de cet appareil').onclick();
    assert.equal(page.records.get('test:7').localDeleted,true);
    assert.equal(page.records.get('test:7').photos.length,0);
    assert.equal(page.list.children.length,0);
    assert.equal(page.error.textContent,'');
});
test('Offline list chooses a verified server version without persisting an obsolete editor',async()=>{
    const page=await fixture();await page.button('Utiliser la version serveur').onclick();
    assert.equal(page.records.get('test:7').conflictResolved,true);
    assert.equal(await page.records.get('test:7').photos[0].blob.text(),'original photo');
    assert.equal(page.context.location.href,'index.php?id=7');
});
