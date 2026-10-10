const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const crypto = require('node:crypto');
const RELEASE_VERSION = '1.01';

async function build() {
    await esbuild.build({
        entryPoints: ['assets/scanner-source.js'], bundle: true,
        outfile: 'assets/scanner.js', format: 'iife', target: ['safari15', 'chrome100'],
        legalComments: 'eof',
    });
    const target = path.join('assets', 'ocr');
    fs.mkdirSync(target, {recursive: true});
    const licenses = path.join('assets', 'licenses');
    fs.mkdirSync(licenses, {recursive:true});
    for (const dependency of ['tesseract.js','tesseract.js-core','@zxing/browser','@zxing/library']) {
        const directory = path.join('node_modules', ...dependency.split('/'));
        const name = fs.readdirSync(directory).find(file => /^licen[sc]e(?:\.|$)/i.test(file));
        if (name) fs.copyFileSync(path.join(directory,name),path.join(licenses,dependency.replace(/[\/@]/g,'_')+'-LICENSE'));
    }
    fs.copyFileSync(require.resolve('tesseract.js/dist/worker.min.js'), path.join(target, 'worker.min.js'));
    for (const name of fs.readdirSync(path.join('node_modules','tesseract.js-core'))) {
        if (/\.wasm(?:\.js)?$/.test(name)) {
            fs.copyFileSync(path.join('node_modules', 'tesseract.js-core', name), path.join(target, name));
        }
    }
    const language = path.join(target, 'eng.traineddata.gz');
    if (!fs.existsSync(language)) {
        const response = await fetch('https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz');
        if (!response.ok) throw new Error(`OCR language download failed: ${response.status}`);
        fs.writeFileSync(language, Buffer.from(await response.arrayBuffer()));
    }
    const files = ['offline.html','manifest.webmanifest','index.php','auth.php','salespeople.php','report-settings.php','scripts/build.cjs'];
    function addAssets(directory) {
        for (const entry of fs.readdirSync(directory,{withFileTypes:true})) {
            const filename = path.join(directory,entry.name);
            if(entry.isDirectory())addAssets(filename);else files.push(filename);
        }
    }
    addAssets('assets');
    for(const name of fs.readdirSync('app')) {
        if(name.endsWith('.php') && name!=='build-version.php')files.push(path.join('app',name));
    }
    const hash=crypto.createHash('sha256');
    for(const file of files.sort()) {
        const data=file==='offline.html'
            ? fs.readFileSync(file,'utf8').replace(/\?v=[a-z0-9-]+/g,'').replace(/data-app-version="[^"]*"/,'data-app-version=""')
            :fs.readFileSync(file);
        hash.update(file.split(path.sep).join('/')).update(data);
    }
    hash.update(fs.readFileSync('sw.js','utf8').replace(/const VERSION = '[^']+';/,"const VERSION = '';"));
    const version='foxreport-shell-'+hash.digest('hex').slice(0,16);
    const worker=fs.readFileSync('sw.js','utf8').replace(/const VERSION = '[^']+';/,`const VERSION = '${version}';`);
    fs.writeFileSync('sw.js',worker);
    fs.writeFileSync(path.join('app','build-version.php'),`<?php\ndeclare(strict_types=1);\nconst FOXREPORT_VERSION = '${version}';\nconst FOXREPORT_RELEASE_VERSION = '${RELEASE_VERSION}';\n`);
    fs.writeFileSync('version.json',JSON.stringify({version})+'\n');
    const offline=fs.readFileSync('offline.html','utf8')
        .replace(/data-app-version="[^"]*"/,`data-app-version="${version}"`)
        .replace(/data-release-version="[^"]*"/,`data-release-version="${RELEASE_VERSION}"`)
        .replace(/((?:src|href)="assets\/[^"?]+)(?:\?v=[a-z0-9-]+)?"/g,`$1?v=${version}"`);
    fs.writeFileSync('offline.html',offline);
    console.log(`FoxReport version: ${version}`);
}
build().catch(error => { console.error(error); process.exitCode = 1; });
