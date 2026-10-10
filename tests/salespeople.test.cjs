const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');

for (const [requested, section, expected, format] of [['landscape','1',[1600,615],'landscape'],['landscape','5',[1600,615],'landscape'],['portrait','5',[1125,1500],'portrait'],['square','6',[1200,1200],'square'],['landscape','6',[1200,1200],'square'],['portrait','7',[1200,1200],'square']]) {
test(`${requested} crop request in section ${section} produces ${expected.join(' by ')} JPEG with adjustable position and zoom`, async () => {
    const controls = {};
    for (const id of ['crop-format','crop-zoom','crop-x','crop-y','crop-caption','crop-error','crop-rotate','crop-cancel','crop-confirm','crop-preview']) controls[`#${id}`]={value:id==='crop-format'?requested:''};
    const drawing = {translate:()=>{},rotate:()=>{},drawImage:()=>{},fillRect:()=>{}};
    controls['#crop-preview'].getContext=()=>drawing;
    let resultSize;
    let opened;
    const dialog={querySelector:selector=>controls[selector],close:()=>{},showModal:()=>{opened();}};
    const handlers={};
    const input={dataset:{photoInput:section},files:[{type:'image/jpeg',size:1000}],addEventListener:(name,handler)=>{handlers[name]=handler;}};
    const context={
        document:{
            createElement:type=>type==='dialog'?dialog:{
                getContext:()=>drawing,
                toDataURL(){resultSize=[this.width,this.height];return 'data:image/jpeg;base64,YQ==';},
            },
            body:{append:()=>{}},
            querySelector:()=>null,
            querySelectorAll:selector=>selector==='[data-photo-input]'?[input]:[],
        },
        window:{},navigator:{onLine:false},
        createImageBitmap:async()=>({width:2400,height:1800,close:()=>{}}),
        crypto:{randomUUID:()=> 'synthetic-photo'}, Blob, Uint8Array, atob,
        alert:message=>{throw new Error(message);},
    };
    const ready=new Promise(resolve=>{opened=resolve;});
    vm.runInNewContext(fs.readFileSync('assets/photos.js','utf8'),context);
    handlers.change();
    await ready;
    assert.equal(controls['#crop-format'].value,format);
    assert.equal(controls['#crop-format'].disabled,['1','6','7'].includes(section));
    controls['#crop-x'].value='.8';controls['#crop-x'].oninput();
    controls['#crop-zoom'].value='1.2';controls['#crop-zoom'].oninput();
    await controls['#crop-confirm'].onclick();
    await context.window.FoxPhotos.whenReady();
    assert.deepEqual(resultSize,expected);
    assert.equal(context.window.FoxPhotos.get()[0].format,format);
});
}

test('SITE rejects portrait and square images in the browser before opening the crop dialog', async () => {
    const handlers = {};
    const alerts = [];
    const input = {dataset:{photoInput:'1'},value:'',files:[],addEventListener:(name,handler)=>{handlers[name]=handler;}};
    let width = 600;
    let height = 800;
    let closed = 0;
    const context = {
        document:{
            createElement:()=>({}),
            body:{append:()=>{}},
            querySelector:()=>null,
            querySelectorAll:selector=>selector==='[data-photo-input]'?[input]:[],
        },
        navigator:{onLine:false},
        window:{},
        createImageBitmap:async()=>({width,height,close:()=>{closed++;}}),
        alert:message=>alerts.push(message),
    };
    vm.runInNewContext(fs.readFileSync('assets/photos.js','utf8'), context);
    for (const dimensions of [[600,800],[600,600]]) {
        [width,height]=dimensions;
        input.files=[{type:'image/jpeg',size:1000}];
        handlers.change();
        await context.window.FoxPhotos.whenReady();
    }
    assert.equal(alerts.length,2);
    assert.ok(alerts.every(message=>/mode paysage/.test(message)));
    assert.equal(context.window.FoxPhotos.get().length,0);
    assert.equal(closed,2);
});

test('SITE server checks landscape dimensions after EXIF orientation, without affecting other image normalization', () => {
    const result=JSON.parse(execFileSync('php',['-d','extension=php_gd.dll','-d','extension=php_exif.dll','-r',`
        require 'app/images.php';
        $source = tempnam(sys_get_temp_dir(), 'fox-landscape-');
        $results = [];
        try {
            foreach ([[800,600,1],[600,800,1],[600,600,1],[800,600,6],[600,800,6]] as [$width,$height,$orientation]) {
                $image = imagecreatetruecolor($width,$height);
                imagejpeg($image,$source);
                unset($image);
                if ($orientation === 6) {
                    $exif = "Exif\\0\\0" . "II" . pack('vVv',42,8,1) . pack('vvVV',0x112,3,1,6) . pack('V',0);
                    $jpeg = file_get_contents($source);
                    file_put_contents($source, substr($jpeg,0,2) . "\\xff\\xe1" . pack('n',strlen($exif)+2) . $exif . substr($jpeg,2));
                }
                try { validateLandscapePhoto($source,validatePhotoSource($source)); $results[] = true; }
                catch (RuntimeException $error) { $results[] = false; }
            }
        } finally { unlink($source); }
        echo json_encode($results);
    `],{encoding:'utf8'}));
    assert.deepEqual(result,[true,false,false,false,true]);
});

test('Commercial phone input spaces national numbers without altering international numbers or losing the cursor', () => {
    const events = {};
    const input = {
        value: '', selectionStart: 0,
        addEventListener: (name, handler) => { events[name] = handler; },
        setSelectionRange: (start, end) => { input.selectionStart = start; input.selectionEnd = end; },
    };
    vm.runInNewContext(fs.readFileSync('assets/salespeople.js', 'utf8'), {
        document: {querySelector: () => input},
    });
    const format = (value, cursor = value.length) => {
        input.value = value;
        input.selectionStart = cursor;
        events.input();
        return input.value;
    };
    assert.equal(format('0612451245'), '06 12 45 12 45');
    assert.equal(input.selectionStart, 14);
    assert.equal(format('061'), '06 1');
    assert.equal(format('06.12-45(12)45'), '06 12 45 12 45');
    assert.equal(format('0612451245', 3), '06 12 45 12 45');
    assert.equal(input.selectionStart, 4);
    assert.equal(format('06 1 45 12 45', 3), '06 14 51 24 5');
    assert.equal(input.selectionStart, 2);
    assert.equal(format(''), '');
    assert.equal(format('+33 6 12 45 12 45'), '+33 6 12 45 12 45');
    assert.equal(format('06124512456'), '06124512456');
    assert.equal(format('06abc'), '06abc');
});

test('Commercial phone server formatting covers old records and produces safe call targets', () => {
    const result = JSON.parse(execFileSync('php', ['-r', `
        require 'app/salespeople.php';
        $phones = ['0612451245', '06.12.45.12.45', '+33 (0)6 12 45 12 45', '', 'javascript:alert(1)'];
        echo json_encode(array_map(fn($phone) => [salespersonPhone($phone), salespersonDial($phone)], $phones));
    `], {encoding: 'utf8'}));
    assert.deepEqual(result, [
        ['06 12 45 12 45', '0612451245'],
        ['06 12 45 12 45', '0612451245'],
        ['+33 (0)6 12 45 12 45', '+33612451245'],
        ['', null],
        ['javascript:alert(1)', null],
    ]);
});
