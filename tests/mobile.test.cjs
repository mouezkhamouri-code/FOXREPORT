const test=require('node:test');
const assert=require('node:assert/strict');
const parse=require('../assets/scan-parser.js');
const fs=require('node:fs');
test('Bundled scanner uses the imported parser rather than an unavailable CommonJS global',()=>{
    assert.doesNotMatch(fs.readFileSync('assets/scanner-source.js','utf8'),/globalThis\.FoxParseScan/);
    assert.match(fs.readFileSync('assets/scanner-source.js','utf8'),/import parseScan from/);
});
test('PWA device cards are loaded online and offline; scanner adds directly without opening a second modal',()=>{
    for (const file of ['index.php','assets/offline.js','sw.js']) {
        assert.match(fs.readFileSync(file,'utf8'), /assets\/device-cards\.js/);
        assert.match(fs.readFileSync(file,'utf8'), /assets\/device-catalogue\.js/);
    }
    const scanner=fs.readFileSync('assets/scanner-source.js','utf8');
    assert.match(scanner,/const row=window\.FoxAddDevice\(\)/);
    assert.doesNotMatch(scanner, /querySelector\('#add-device'\)\.click/);
    assert.match(fs.readFileSync('assets/app.js','utf8'),/window\.FoxDeviceEditor\?\.isActive\(\)/);
});
test('Zyxel verified framing extracts serial and MAC, never an opaque model',()=>{
    const token=Buffer.from('TESTZSTEST12345678M001122334455','latin1').toString('base64');
    const result=parse(`https://app.nebula.zyxel.com/6RQi#zn=${encodeURIComponent(token)}`);
    assert.equal(result.fields.serial_number,'STEST12345678');
    assert.equal(result.fields.mac_address,'00:11:22:33:44:55');
    assert.equal(result.fields.brand,'Zyxel');
    assert.equal(result.fields.model,undefined);
});
test('iPhone OCR labels extract explicit values only',()=>{
    const result=parse('Nom du modèle\niPhone 15 Pro\nNuméro de série\nTESTSERIAL01\nAdresse Wi-Fi\n00:11:22:33:44:55');
    assert.equal(result.fields.model,'iPhone 15 Pro');
    assert.equal(result.fields.serial_number,'TESTSERIAL01');
    assert.equal(result.fields.brand,undefined);
});
test('OCR on single lines and password kept separate',()=>{
    const result=parse('Model: TEST phone\nSerial Number TESTSERIAL\nPassword: fictitious');
    assert.equal(result.fields.serial_number,'TESTSERIAL');
    assert.equal(result.fields.decoded_password,'fictitious');
    assert.equal(result.fields.comment,undefined);
});
test('unknown barcode never guessed as a serial or opened',()=>{
    assert.deepEqual(parse('1234567890123').fields,{});
    assert.deepEqual(parse('https://example.com/login').fields,{});
});
test('malformed Nebula token is not interpreted',()=>{
    assert.deepEqual(parse('https://app.nebula.zyxel.com/6RQi#zn=INVALID').fields,{});
});
