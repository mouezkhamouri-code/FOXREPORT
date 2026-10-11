const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto,createHash}=require('node:crypto');
const {execFileSync}=require('node:child_process');

test('Brand database rules preserve history and reject deletion or stale offline resurrection',()=>{
    assert.match(execFileSync('php',['tests/device-brands.php'],{encoding:'utf8'}),/PASS: Brand validation/);
});

test('Offline brand catalogue merges archive revisions, tombstones and newly created brands',async()=>{
    const source=fs.readFileSync('assets/device-catalogue.js','utf8');
    const merge=source.slice(source.indexOf('    function merge('),source.indexOf('    function populate('));
    const additions=source.slice(source.indexOf('    async function hash('),source.indexOf('    function mount('));
    const context={crypto:webcrypto,TextEncoder,structuredClone,form:{dispatchEvent(){}},Event:class{}};
    vm.createContext(context);
    vm.runInContext(`let data={types:[],models:[],brands:[],deleted_brands:[]}; const update=()=>{}; const cache=async()=>{}; ${merge} ${additions}; globalThis.api={merge,addEntry,snapshot:()=>JSON.parse(JSON.stringify(data))};`,context);
    const key=createHash('sha256').update('epson').digest('hex');
    const base={brand_key:key,name:'EPSON',archived:0,revision:1};
    const incoming=brands=>({types:[],models:[],brands});
    context.api.merge(incoming([base]));
    context.api.merge(incoming([{...base,archived:1,revision:2}]));
    context.api.merge(incoming([base]));
    assert.equal(context.api.snapshot().brands[0].archived,1,'An older cached catalogue cannot unarchive a server brand');
    await assert.rejects(context.api.addEntry('brand','epson'),/archivée/);
    context.api.merge(incoming([{...base,revision:3}]));
    assert.equal(await context.api.addEntry('brand','epson'),'EPSON');
    assert.equal(context.api.snapshot().brands.length,1);
    assert.equal(await context.api.addEntry('brand','Nouvelle marque'),'Nouvelle marque');
    assert.equal(context.api.snapshot().brands.length,2);
    context.api.merge({...incoming([]),deleted_brands:[key]});
    context.api.merge(incoming([{...base,revision:99}]));
    assert.ok(!context.api.snapshot().brands.some(brand=>brand.brand_key===key),'An old offline draft cannot recreate a deleted brand');
    await assert.rejects(context.api.addEntry('brand','EPSON'),/supprimée/);
});
