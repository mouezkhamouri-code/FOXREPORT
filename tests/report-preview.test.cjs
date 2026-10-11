const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function fixture({desktop=true,local=false,blocked=false}={}) {
    const events={},calls=[],errors=[];
    const viewer={document:{body:{}},location:{},close:()=>calls.push('close')};
    const context={window:{matchMedia:()=>({matches:desktop}),FoxAppMode:{usesLocalReports:()=>local},
        open:(url,target)=>{calls.push(['open',url,target]);return blocked?null:viewer;},
        FoxSaveFeedback:{show:(text,kind)=>errors.push([text,kind])}},
        document:{addEventListener:(name,fn)=>{events[name]=fn;},querySelector:()=>local?{}:null,
            createElement:()=>{throw new Error('PDF must not be embedded in a modal or iframe');}},
        location:{href:'https://fox.test/index.php',origin:'https://fox.test'},URL};
    vm.runInNewContext(fs.readFileSync('assets/report-preview.js','utf8'),context);
    const click=()=>{let prevented=false;const link={href:'https://fox.test/rapport.php?id=7',classList:{contains:()=>local},closest:()=>null};
        events.click({button:0,preventDefault:()=>{prevented=true;},target:{closest:()=>link}});return prevented;};
    return {context,viewer,calls,errors,click};
}
test('Desktop opens a top-level external PDF page synchronously, without iframe or modal',async()=>{
    const page=fixture();assert.equal(page.click(),true);assert.deepEqual(page.calls,[['open','','_blank']]);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(page.viewer.location.href,'https://fox.test/rapport.php?id=7');assert.equal(page.viewer.opener,null);
});
test('Unsaved desktop changes close the preview page and preserve the form without loading an old PDF',async()=>{
    const page=fixture();const viewer=page.context.window.FoxReportPreview.open();
    await assert.rejects(viewer.load('https://fox.test/rapport.php?id=7',async()=>{throw new Error('Enregistrez le brouillon');}),/Enregistrez le brouillon/);
    assert.equal(page.viewer.location.href,undefined);assert.equal(page.calls.at(-1),'close');
});
test('Blocked external pages show an actionable message without replacing the editor',async()=>{
    const page=fixture({blocked:true});page.click();await new Promise(resolve=>setImmediate(resolve));
    assert.match(page.errors[0][0],/Autorisez les fenêtres contextuelles/);assert.equal(page.errors[0][1],'error');
    assert.equal(page.context.location.href,'https://fox.test/index.php');
});
test('Mobile and local editor previews retain their own navigation and synchronization handlers',()=>{
    for(const options of [{desktop:false},{local:true}]){const page=fixture(options);assert.equal(page.click(),false);assert.equal(page.calls.length,0);}
});
