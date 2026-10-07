const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture({ios=false, standalone=false, secure=true, registrationFailure=false} = {}) {
    const nodes = new Map();
    const events = {};
    const attributes = new Map();
    const container = {
        hidden:false,
        querySelector:selector=>nodes.get(selector),
        append:(...elements)=>elements.forEach(element=>nodes.set(`#${element.id}`,element)),
    };
    const display = {matches:standalone,addEventListener:(name,callback)=>{events.display=callback;}};
    const context = {
        window:{
            isSecureContext:secure,
            matchMedia:()=>display,
            addEventListener:(name,callback)=>{events[name]=callback;},
        },
        navigator:{
            userAgent:ios?'iPhone':'Chrome',
            serviceWorker:{register:async url=>{
                assert.equal(url,'sw.js');
                if (registrationFailure) throw new Error('Missing resource');
            }},
        },
        document:{
            querySelector:selector=>selector==='[data-install-container]'?container:nodes.get(selector),
            createElement:()=>({
                hidden:false,disabled:false,textContent:'',
                setAttribute:(name,value)=>attributes.set(name,value),
                append:(...elements)=>elements.forEach(element=>nodes.set(`#${element.id}`,element)),
            }),
            addEventListener:(name,callback)=>{events[name]=callback;},
        },
    };
    vm.runInNewContext(fs.readFileSync('assets/install.js','utf8'),context);
    return {
        nodes,events,container,display,attributes,
        click:()=>events.click({target:{closest:()=>nodes.get('#install-app')}}),
    };
}

test('iPhone always has installation instructions without a native prompt', async () => {
    const page=fixture({ios:true});
    assert.equal(page.container.hidden,false);
    assert.equal(page.nodes.get('#install-help').hidden,true);
    await page.click();
    assert.equal(page.nodes.get('#install-help').hidden,false);
    assert.match(page.nodes.get('#install-instructions').textContent,/Safari.*Partager.*écran d’accueil/);
    assert.match(page.nodes.get('#install-status').textContent,/depuis son icône/);
});

test('Android fallback stays accessible, native prompt is user-initiated and dismissal does not hide help', async () => {
    const page=fixture();
    await page.click();
    assert.match(page.nodes.get('#install-instructions').textContent,/Chrome ou Edge/);
    let prompted=0;
    let prevented=false;
    page.events.beforeinstallprompt({
        preventDefault:()=>{prevented=true;},
        prompt:async()=>{prompted++;},
        userChoice:Promise.resolve({outcome:'dismissed'}),
    });
    assert.equal(prevented,true);
    assert.equal(prompted,0);
    await page.click();
    assert.equal(prompted,1);
    assert.equal(page.container.hidden,false);
    assert.match(page.nodes.get('#install-status').textContent,/annulée/);
    assert.equal(page.nodes.get('#install-app').disabled,false);
});

test('Standalone launch and completed installation hide the installation command', () => {
    assert.equal(fixture({standalone:true}).container.hidden,true);
    const page=fixture();
    page.events.appinstalled();
    assert.equal(page.container.hidden,true);
});

test('HTTP and service worker failures explain the installation blocker', async () => {
    const http=fixture({secure:false});
    await http.click();
    assert.match(http.nodes.get('#install-instructions').textContent,/HTTPS/);
    const broken=fixture({registrationFailure:true});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(broken.nodes.get('#install-help').hidden,false);
    assert.match(broken.nodes.get('#install-status').textContent,/Missing resource/);
});

test('Application entry pages expose the manifest, Apple standalone metadata and installation controller', () => {
    for(const file of ['index.php','auth.php','offline.html']) {
        const html=fs.readFileSync(file,'utf8');
        assert.match(html,/rel="manifest" href="manifest.webmanifest"/);
        assert.match(html,/apple-mobile-web-app-capable" content="yes"/);
        assert.match(html,/assets\/install.js/);
        assert.match(html,/data-install-container/);
    }
    const manifest=JSON.parse(fs.readFileSync('manifest.webmanifest','utf8'));
    assert.equal(manifest.display,'standalone');
    assert.equal(manifest.start_url,'./index.php');
    for(const icon of manifest.icons) assert.ok(fs.existsSync(icon.src));
    assert.match(fs.readFileSync('sw.js','utf8'),/'assets\/install.js'/);
});
