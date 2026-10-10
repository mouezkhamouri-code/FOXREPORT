const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

test('Stacked accordions explicitly complete empty sections, retain data and restore saved states', () => {
    const handlers = {};
    const active = {value:'1'};
    const completed = {value:'[]'};
    const form = {
        elements:{completed_sections:completed},querySelector:()=>null,
        addEventListener:(name,callback)=>{handlers[name]=callback;},
        dispatchEvent:event=>{if (event.type==='fox-change') changes++;},
    };
    let changes=0;
    const previous = {addEventListener:(name,callback)=>{handlers.previous=callback;}};
    const next = {addEventListener:(name,callback)=>{handlers.next=callback;}};
    const progress = {};
    const accordions = Array.from({length:11}, (_,i)=>{
        const classes = new Set();
        const button = {dataset:{completeSection:String(i+1)},setAttribute:()=>{},closest:()=>accordions[i]};
        const state = {};
        const fields = {comment:'',photo:'synthetic local photo'};
        return {
            dataset:{sectionAccordion:String(i+1)},open:false,classes,button,state,fields,
            classList:{toggle:(name,on)=>on?classes.add(name):classes.delete(name)},
            querySelector:name=>name==='.section-state'?state:button,
            addEventListener:(name,callback)=>{handlers[`toggle-${i+1}`]=callback;},
        };
    });
    const date = {value:'2024-12-31',addEventListener:(name,callback)=>{handlers[`date-${name}`]=callback;}};
    const day = {};
    const emptyControls = ['', '   ', '0', '1', 'Synthetic', ''].map((value,index)=>{
        const classes = new Set();
        return {value,type:index===2?'select-one':'text',readOnly:index===5,classes,
            classList:{toggle:(name,on)=>on?classes.add(name):classes.delete(name)}};
    });
    const nodes = {'#report-form':form,'#active-section':active,'#previous-step':previous,'#next-step':next,'#step-progress':progress,'[name="report_date"]':date,'#report-day-number':day};
    const context = {
        document:{
            querySelector:name=>nodes[name]||null,
            querySelectorAll:name=>name==='[data-section-accordion]'?accordions:name.startsWith('.report-form .field input')?emptyControls:[],
        },
        Event:class {constructor(type) {this.type=type;}},
    };
    vm.runInNewContext(fs.readFileSync('assets/app.js','utf8'),context);
    assert.deepEqual(emptyControls.map(control=>control.classes.has('is-empty')),[true,true,false,false,false,false]);
    emptyControls[0].value='Completed';
    emptyControls[4].value='';
    handlers.input({target:{closest:()=>null}});
    assert.equal(emptyControls[0].classes.has('is-empty'),false);
    assert.equal(emptyControls[4].classes.has('is-empty'),true);
    emptyControls[0].value='';
    emptyControls[4].value='Restored';
    handlers['fox-sections-restored']();
    assert.equal(emptyControls[0].classes.has('is-empty'),true);
    assert.equal(emptyControls[4].classes.has('is-empty'),false);
    assert.equal(day.value,'366');
    date.value='2025-12-31';handlers['date-input']();assert.equal(day.value,'365');
    date.value='2024-03-01';handlers['date-change']();assert.equal(day.value,'61');
    date.value='2025-02-29';handlers['date-change']();assert.equal(day.value,'');
    date.value='';handlers['date-input']();assert.equal(day.value,'');
    date.value='2026-01-01';handlers['fox-sections-restored']();assert.equal(day.value,'1');
    assert.equal(accordions[0].open,true);
    assert.equal(previous.disabled,true);
    assert.equal(accordions.length,11);
    handlers.click({target:{closest:()=>accordions[5].button}});
    assert.equal(completed.value,'[6]');
    assert.equal(accordions[5].classes.has('is-complete'),true);
    assert.equal(accordions[5].state.textContent,'✓ Terminée');
    assert.equal(accordions[5].fields.comment,'');
    assert.equal(accordions[5].fields.photo,'synthetic local photo');
    assert.ok(changes>0);
    handlers.next();
    assert.equal(active.value,'2');
    assert.equal(accordions[1].open,true);
    assert.equal(completed.value,'[6]');
    completed.value='[3,11]';active.value='11';handlers['fox-sections-restored']();
    assert.equal(accordions[10].open,false);
    assert.equal(accordions[10].classes.has('is-complete'),true);
    assert.equal(accordions[5].classes.has('is-complete'),false);
    assert.equal(next.disabled,true);
    handlers.click({target:{closest:()=>accordions[10].button}});
    assert.equal(completed.value,'[3]');
    assert.equal(accordions[10].classes.has('is-complete'),false);
    completed.value='[3,6]';
    handlers['fox-sections-restored']();
    handlers.input({target:{closest:()=>({dataset:{sectionPanel:'6'}})}});
    assert.equal(completed.value,'[3]','Later field edit invalidates only its section');
    handlers['fox-section-edit']({detail:{sections:[3,6]}});
    assert.equal(completed.value,'[]','Photo/programmatic edits invalidate validation');
    const site={...accordions[0],dataset:{sectionAccordion:'12'},open:false};
    const organisation={...accordions[0],dataset:{sectionAccordion:'13'},open:false};
    accordions.splice(1,0,organisation,site);
    // Reload with the actual new DOM order while retaining legacy section identities.
    vm.runInNewContext(fs.readFileSync('assets/app.js','utf8'),context);
    active.value='1';handlers['fox-sections-restored']();
    handlers.next();
    assert.equal(active.value,'13','Organisation follows Informations with a stable identity');
    handlers.next();
    assert.equal(active.value,'12','Next opens SITE immediately after Informations');
    handlers.next();
    assert.equal(active.value,'2','Next from SITE preserves the existing Evaluation identity');
    handlers.previous();
    assert.equal(active.value,'12');
    completed.value='[1,12]';
    handlers['fox-section-edit']({detail:{sections:[12]}});
    assert.equal(completed.value,'[1]','Editing SITE leaves Informations complete');
});
