const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');

test('Follow-up modal adds, edits, cancels, removes and restores compact rows offline',()=>{
    class Element {
        constructor(tag) {this.tag=tag;this.children=[];this.handlers={};this.value='';this.classList={toggle:()=>{}};}
        append(...children) {this.children.push(...children);}
        replaceChildren() {this.children=[];}
        addEventListener(name,handler) {this.handlers[name]=handler;}
        setAttribute(name,value) {this[name]=value;}
        querySelector() {return this.children[0].children[0];}
        focus() {}
        get lastElementChild() {return this.children.at(-1);}
    }
    const handlers={};
    let edits=0;
    const field={value:'[]'},rows=new Element('div'),add=new Element('button'),message={};
    const order=new Element('input');order.value='2026-10-01';
    const copy={value:''};
    const editor={elements:{date:new Element('input'),comment:new Element('textarea')},handlers:{},
        addEventListener(name,handler){this.handlers[name]=handler;},reportValidity:()=>true};
    const dialogNodes={'#followup-editor':editor};
    for(const selector of ['#followup-cancel','#followup-delete','#followup-dialog-title','#followup-editor-error']) dialogNodes[selector]={};
    const dialog={setAttribute:()=>{},querySelector:selector=>dialogNodes[selector],showModal(){this.open=true;},close(){this.open=false;}};
    const nodes={
        '#report-form':{elements:{},addEventListener:(name,handler)=>{handlers[name]=handler;},dispatchEvent:()=>{edits++;},querySelector:()=>({disabled:false})},
        '#active-section':{value:'1'},'#previous-step':new Element('button'),'#next-step':new Element('button'),
        '#intervention-followup':field,'#followup-rows':rows,'#add-followup':add,'#followup-message':message,
        '[name="order_date"]':order,'#organisation-order-date':copy,
    };
    const context={
        document:{body:{append:()=>{}},querySelector:selector=>nodes[selector] || null,querySelectorAll:()=>[],createElement:tag=>tag==='dialog'?dialog:new Element(tag)},
        Event:class {},CustomEvent:class {},confirm:()=>true,
    };
    vm.runInNewContext(fs.readFileSync('assets/app.js','utf8'),context);
    assert.equal(copy.value,'2026-10-01');
    order.value='2026-10-02';order.handlers.input();assert.equal(copy.value,order.value);
    add.handlers.click();
    assert.equal(rows.children.length,0,'Adding does not persist an incomplete row');
    assert.equal(dialog.open,true);
    editor.elements.date.value='2026-10-07';
    editor.elements.comment.value='Synthetic follow-up';
    editor.handlers.submit({preventDefault:()=>{}});
    assert.equal(rows.children.length,1);
    assert.equal(rows.children[0].children[0].textContent,'07/10/2026');
    assert.deepEqual(JSON.parse(field.value),[{date:'2026-10-07',comment:'Synthetic follow-up'}]);
    rows.children[0].children[2].onclick();
    assert.equal(editor.elements.comment.value,'Synthetic follow-up');
    editor.elements.comment.value='Cancelled edit';
    dialogNodes['#followup-cancel'].onclick();
    assert.equal(JSON.parse(field.value)[0].comment,'Synthetic follow-up');
    rows.children[0].children[2].onclick();
    editor.elements.comment.value='Edited follow-up';
    editor.handlers.submit({preventDefault:()=>{}});
    assert.equal(JSON.parse(field.value)[0].comment,'Edited follow-up');
    field.value='[{"date":"2026-10-08","comment":"Restored follow-up"}]';
    handlers['fox-sections-restored']();
    assert.equal(rows.children[0].children[1].textContent,'Restored follow-up');
    rows.children[0].children[2].onclick();
    dialogNodes['#followup-delete'].onclick();
    assert.equal(field.value,'[]');
    assert.equal(rows.children.length,0);
    assert.ok(edits>=3);
});

test('Server validates follow-up dates, comments, list shape and limits',()=>{
    const result=JSON.parse(execFileSync('php',['-r',`
        require 'app/intervention-followup.php';
        $results=[];
        foreach ([null, '[]', '[{"date":"2024-02-29","comment":" valid "}]', '[{"date":"2025-02-29","comment":"Invalid"}]', '{}', '[{"date":"2026-10-07","comment":""}]', json_encode(array_fill(0,101,['date'=>'2026-10-07','comment'=>'test']))] as $value) {
            try {$results[]=interventionFollowup($value);}
            catch (RuntimeException $error) {$results[]='rejected';}
        }
        echo json_encode($results);
    `],{encoding:'utf8'}));
    assert.deepEqual(result,[[],[],[{date:'2024-02-29',comment:'valid'}],'rejected','rejected','rejected','rejected']);
});
