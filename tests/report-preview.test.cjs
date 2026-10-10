const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function fixture({desktop=true,local=false,pdf=true}={}) {
    const nodes=[],events={},revoked=[],requests=[];
    class Element {
        constructor(tag){this.tag=tag;this.events={};this.children=[];this.hidden=false;nodes.push(this);}
        setAttribute(name,value){this[name]=value;}
        removeAttribute(name){delete this[name];}
        append(...items){this.children.push(...items);}
        addEventListener(name,fn){this.events[name]=fn;}
        showModal(){this.open=true;}
        close(){this.open=false;this.events.close?.();}
        remove(){this.removed=true;}
    }
    class PreviewURL extends URL {static createObjectURL(){return 'blob:https://fox.test/pdf';}static revokeObjectURL(url){revoked.push(url);}}
    const context={window:{matchMedia:()=>({matches:desktop}),FoxAppMode:{usesLocalReports:()=>local}},
        document:{createElement:tag=>new Element(tag),body:new Element('body'),addEventListener:(name,fn)=>{events[name]=fn;},querySelector:()=>local?{}:null},
        location:{href:'https://fox.test/index.php',origin:'https://fox.test'},URL:PreviewURL,AbortController,
        fetch:async(url,options)=>{requests.push({url,options});return {ok:true,headers:{get:()=>pdf?'application/pdf':'text/html'},blob:async()=>new Blob(['%PDF'])};}};
    vm.runInNewContext(fs.readFileSync('assets/report-preview.js','utf8'),context);
    const click=()=>{let prevented=false;const link={href:'https://fox.test/rapport.php?id=7',classList:{contains:()=>local},closest:()=>null};
        events.click({button:0,preventDefault:()=>{prevented=true;},target:{closest:()=>link}});return prevented;};
    return {context,nodes,requests,revoked,click};
}
test('Desktop PDF preview loads a private blob without navigating into the PWA and releases it on close',async()=>{
    const page=fixture();assert.equal(page.click(),true);await new Promise(resolve=>setImmediate(resolve));
    assert.equal(page.requests[0].options.cache,'no-store');
    assert.equal(page.nodes.find(n=>n.tag==='iframe').src,'blob:https://fox.test/pdf');
    assert.equal(page.nodes.find(n=>n.tag==='a').download,'foxreport-7.pdf');
    const dialog=page.nodes.find(n=>n.tag==='dialog');dialog.close();
    assert.deepEqual(page.revoked,['blob:https://fox.test/pdf']);assert.equal(dialog.removed,true);
});
test('Desktop preview rejects sign-in HTML instead of embedding it as a PDF',async()=>{
    const page=fixture({pdf:false});page.click();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(page.nodes.find(n=>n.tag==='iframe').hidden,true);
    assert.match(page.nodes.find(n=>n.tag==='p').textContent,/PDF est indisponible/);
});
test('Mobile and local editor previews keep their existing navigation and synchronization handlers',()=>{
    for(const options of [{desktop:false},{local:true}]){const page=fixture(options);assert.equal(page.click(),false);assert.equal(page.requests.length,0);}
});
