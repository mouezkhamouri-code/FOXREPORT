const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const {spawn} = require('node:child_process');

test('OAuth sessions: canonical start, cookies, independent attempts, replay and safe logs', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'foxreport-oauth-test-'));
    const root = path.resolve(__dirname, '..');
    const port = await new Promise(resolve => {
        const server = net.createServer().listen(0, '127.0.0.1', () => {
            const selected = server.address().port;
            server.close(() => resolve(selected));
        });
    });
    let child;
    let logs = '';
    try {
        fs.mkdirSync(path.join(directory, 'app'));
        fs.mkdirSync(path.join(directory, 'storage', 'private'), {recursive:true});
        fs.copyFileSync(path.join(root, 'auth.php'), path.join(directory, 'auth.php'));
        fs.copyFileSync(path.join(root, 'app', 'auth.php'), path.join(directory, 'app', 'auth.php'));
        for(const name of ['version.php','build-version.php'])fs.copyFileSync(path.join(root,'app',name),path.join(directory,'app',name));
        const callback = `https://127.0.0.1:${port}/auth.php?action=callback`;
        fs.writeFileSync(path.join(directory, 'storage', 'private', 'oauth.php'),
            `<?php return ['client_id'=>'SYNTHETIC_CLIENT','client_secret'=>'SYNTHETIC_SECRET','redirect_uri'=>'${callback}','allowed_emails'=>['test@example.com']];`);
        // TLS is simulated only in the isolated HTTP fixture; production never trusts a query parameter.
        fs.writeFileSync(path.join(directory,'router.php'),
            "<?php if(!isset($_GET['test_http'])){$_SERVER['HTTPS']='on';} return false;");
        child = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', directory, path.join(directory,'router.php')], {stdio:['ignore','pipe','pipe']});
        child.stdout.on('data', data => { logs += data; });
        child.stderr.on('data', data => { logs += data; });
        const base = `http://127.0.0.1:${port}/auth.php`;
        let ready = false;
        for (let index=0; index<40; index++) {
            try { await fetch(base); ready=true; break; } catch { await new Promise(resolve=>setTimeout(resolve,50)); }
        }
        assert.ok(ready, 'PHP fixture responsive');
        const http = await fetch(base+'?action=login&test_http=1', {redirect:'manual'});
        assert.equal(http.status,303);
        assert.equal(http.headers.get('location'),callback.replace('callback','login'));
        assert.equal(http.headers.get('set-cookie'),null, 'No cookie/state allocated on HTTP');
        const first = await fetch(base+'?action=login', {redirect:'manual'});
        assert.equal(first.status,302);
        const cookieHeader = first.headers.get('set-cookie');
        assert.match(cookieHeader,/secure/i); assert.match(cookieHeader,/HttpOnly/i);
        assert.match(cookieHeader,/SameSite=Lax/i); assert.match(cookieHeader,/path=\//i);
        assert.doesNotMatch(cookieHeader,/domain=/i);
        const cookie = cookieHeader.split(';')[0];
        const firstState = new URL(first.headers.get('location')).searchParams.get('state');
        const second = await fetch(base+'?action=login',{redirect:'manual',headers:{Cookie:cookie}});
        const secondState = new URL(second.headers.get('location')).searchParams.get('state');
        assert.notEqual(firstState,secondState);
        const callbackRequest = (state, extra='error=access_denied', sessionCookie=cookie) =>
            fetch(base+`?action=callback&state=${encodeURIComponent(state)}&${extra}`, {headers:{Cookie:sessionCookie}});
        const wrong = await callbackRequest('SYNTHETIC_WRONG_STATE');
        assert.equal(wrong.status,400);
        assert.match(await wrong.text(),/state du retour Google/);
        // A mismatched callback must not consume either valid pending attempt.
        const returnFirst = await callbackRequest(firstState);
        assert.match(await returnFirst.text(),/annulée ou refusée/);
        const returnSecond = await callbackRequest(secondState);
        assert.match(await returnSecond.text(),/annulée ou refusée/);
        const replay = await callbackRequest(firstState);
        assert.match(await replay.text(),/déjà été utilisée ou a expiré/);
        const missing = await callbackRequest(firstState, 'code=SYNTHETIC_CODE', '');
        assert.match(await missing.text(),/Session de connexion introuvable/);
        assert.match(logs,/"reason":"callback_state_mismatch"/);
        assert.match(logs,/"reason":"google_authorization_denied"/);
        assert.match(logs,/"reason":"pending_session_missing"/);
        // PHP's built-in access logger includes the URL. Test our application log lines separately.
        const applicationLogs = logs.split('\n').filter(line=>line.includes('FoxReport OAuth')).join('\n');
        for (const sensitive of [firstState,secondState,cookie.split('=')[1],'SYNTHETIC_CODE','SYNTHETIC_SECRET']) {
            assert.ok(!applicationLogs.includes(sensitive), 'Application logs omit sensitive values');
        }
    } finally {
        if (child && child.exitCode === null) {
            await new Promise(resolve => { child.once('exit',resolve); child.kill(); });
        }
        fs.rmSync(directory,{recursive:true,force:true});
    }
});
