const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

test('Saved and pending photos can be reordered and removed offline with confirmation, and finalized reports have no actions',async()=>{
    class Element {
        constructor(tag) {this.tag=tag;this.children=[];this.dataset={};}
        append(...children) {this.children.push(...children);}
        replaceChildren(...children) {this.children=children;}
        setAttribute(name,value) {this[name]=value;}
    }
    const grid=new Element('div');
    const block={querySelector:()=>grid,closest:()=>({dataset:{sectionPanel:'12'}})};
    const order={value:'[]'},deleted={value:'[]'},fieldset={disabled:false};
    let changes=0,confirmed=true;
    const form={dispatchEvent:()=>{changes++;}};
    const nodes={'#photo-order':order,'#photo-deleted':deleted,'#report-form':form,'#report-form fieldset':fieldset,'[data-photo-section="1"]':block};
    const context={
        document:{
            createElement:tag=>new Element(tag),body:{append:()=>{}},
            querySelector:selector=>nodes[selector] || null,
            querySelectorAll:selector=>selector==='.photo-grid'?[grid]:[],
        },
        navigator:{onLine:false},window:{},URL,Blob,
        CustomEvent:class {},confirm:()=>confirmed,
    };
    vm.runInNewContext(fs.readFileSync('assets/photos.js','utf8'),context);
    const photo=(id)=>({id,section:1,format:'landscape',caption:id,blob:new Blob(['synthetic'],{type:'image/jpeg'})});
    context.window.FoxPhotos.restoreSaved([photo('saved-a'),photo('saved-b')]);
    await context.window.FoxPhotos.restore([photo('pending-c')]);
    const keys=()=>grid.children.map(figure=>figure.dataset.photoKey);
    const button=(id,label)=>grid.children.find(figure=>figure.dataset.photoKey===id).children[2].children.find(item=>item.textContent===label);
    assert.deepEqual(keys(),['saved-a','saved-b','pending-c']);
    button('pending-c','Avant').onclick();
    assert.deepEqual(keys(),['saved-a','pending-c','saved-b']);
    assert.deepEqual(JSON.parse(order.value),keys());
    confirmed=false;button('saved-a','Supprimer').onclick();
    assert.equal(keys().length,3);
    confirmed=true;button('saved-a','Supprimer').onclick();
    assert.deepEqual(keys(),['pending-c','saved-b']);
    assert.deepEqual(JSON.parse(deleted.value),['saved-a']);
    assert.equal(context.window.FoxPhotos.getSaved().length,1);
    context.window.FoxPhotos.restoreSaved([photo('saved-a'),photo('saved-b')]);
    assert.deepEqual(keys(),['pending-c','saved-b'],'A stale saved cache never revives a deleted photo');
    button('pending-c','Supprimer').onclick();
    assert.equal(context.window.FoxPhotos.get().length,0);
    assert.deepEqual(keys(),['saved-b']);
    assert.ok(changes>=3);
    fieldset.disabled=true;
    context.window.FoxPhotos.restoreSaved([photo('saved-b')]);
    assert.equal(grid.children[0].children.length,2);
});
