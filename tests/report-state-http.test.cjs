const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const {spawn, execFileSync} = require('node:child_process');
const {randomUUID} = require('node:crypto');

test('Real report save and sync persist section validation, preserve legacy state and reject conflicts', async () => {
    const root=path.resolve(__dirname,'..');
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'foxreport-section-test-'));
    const port=await new Promise(resolve=>{
        const server=net.createServer().listen(0,'127.0.0.1',()=>{
            const port=server.address().port;server.close(()=>resolve(port));
        });
    });
    let child;
    let logs='';
    try {
        fs.mkdirSync(path.join(directory,'app'));
        fs.mkdirSync(path.join(directory,'SERVEUR'));
        fs.copyFileSync(path.join(root,'index.php'),path.join(directory,'index.php'));
        fs.copyFileSync(path.join(root,'salespeople.php'),path.join(directory,'salespeople.php'));
        fs.copyFileSync(path.join(root,'photo.php'),path.join(directory,'photo.php'));
        if(process.env.FOXREPORT_KEEP_FIXTURE==='1') {
            fs.cpSync(path.join(root,'assets'),path.join(directory,'assets'),{recursive:true});
            for(const name of ['offline.html','sw.js','manifest.webmanifest','version.json','photo.php'])fs.copyFileSync(path.join(root,name),path.join(directory,name));
        }
        for(const name of ['report-definition.php','images.php','completion.php','sync.php','maps.php','report-list.php','report-delete.php','section-state.php','salespeople.php','photo-state.php','intervention-followup.php','version.php','build-version.php']) {
            fs.copyFileSync(path.join(root,'app',name),path.join(directory,'app',name));
        }
        fs.writeFileSync(path.join(directory,'app','auth.php'),`<?php
            session_start(); $_SESSION['foxreport_csrf']='synthetic-csrf';
            function requireFoxAuth(bool $api): array {
                if(isset($_GET['test_denied'])){http_response_code(401);echo '{"error":"Unauthorized"}';exit;}
                return ['sub'=>'synthetic-user','email'=>'test@example.com'];
            }`);
        const schema=fs.readFileSync(path.join(root,'database','schema.sql'),'utf8');
        const statements=[];
        for(const match of schema.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]+?)\) ENGINE/g)) {
            const columns=[];
            for(const field of match[2].matchAll(/^    ([a-z_]+) .+$/gm)) {
                const name=field[1];
                if(name==='id') columns.push('id INTEGER PRIMARY KEY AUTOINCREMENT');
                else if(name==='request_id') columns.push('request_id TEXT PRIMARY KEY');
                else if(name==='revision') columns.push('revision INTEGER DEFAULT 1');
                else if(name==='intervention_uid') columns.push('intervention_uid TEXT UNIQUE');
                else if(name==='status') columns.push("status TEXT DEFAULT 'draft'");
                else if(name==='deleted_at' || name==='client_uid') columns.push(`${name} TEXT DEFAULT NULL`);
                else if(name==='sort_order') columns.push('sort_order INTEGER DEFAULT 0');
                else columns.push(`${name} TEXT DEFAULT ''`);
            }
            statements.push(`CREATE TABLE IF NOT EXISTS ${match[1]} (${columns.join(',')})`);
        }
        const schemaPhp=statements.map(sql=>`$pdo->exec(${JSON.stringify(sql)});`).join('\n');
        // Only the fixture adapts MySQL introspection/row locking to SQLite; production is unchanged.
        fs.writeFileSync(path.join(directory,'SERVEUR','db.php'),`<?php
            class FixturePDO extends PDO {
                public function query(string $query, ?int $fetchMode=null, mixed ...$args): PDOStatement|false {
                    if($query==='SELECT DATABASE()') $query="SELECT 'foxreport-synthetic'";
                    if(str_starts_with($query,'SHOW COLUMNS')) $query="SELECT name FROM pragma_table_info('foxreport_reports')";
                    return parent::query($query);
                }
                public function prepare(string $query, array $options=[]): PDOStatement|false {
                    $query=str_replace(' FOR UPDATE','',$query);
                    $query=str_replace('ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)','ON CONFLICT(intervention_uid) DO UPDATE SET id=id',$query);
                    return parent::prepare($query,$options);
                }
            }
            $pdo=new FixturePDO('sqlite:'.__DIR__.'/../fixture.sqlite');
            $pdo->setAttribute(PDO::ATTR_ERRMODE,PDO::ERRMODE_EXCEPTION);
            ${schemaPhp}`);
        child=spawn('php',['-d','extension=php_pdo_sqlite.dll','-d','extension=php_fileinfo.dll','-d','extension=php_gd.dll','-d','extension=php_exif.dll','-S',`127.0.0.1:${port}`,'-t',directory],{stdio:['ignore','pipe','pipe']});
        child.stdout.on('data',data=>{logs+=data;});
        child.stderr.on('data',data=>{logs+=data;});
        const base=`http://127.0.0.1:${port}/index.php`;
        let ready=false;
        for(let i=0;i<40;i++) {
            try {
                const response=await fetch(base);assert.equal(response.status,200,await response.text());
                ready=true;break;
            } catch(error) {
                if(child.exitCode!==null) throw new Error(logs);
                await new Promise(resolve=>setTimeout(resolve,50));
            }
        }
        assert.ok(ready,logs);
        const directoryUrl=base.replace('/index.php','/salespeople.php');
        const deniedCreate=await fetch(directoryUrl,{method:'POST',body:new URLSearchParams({csrf_token:'wrong',last_name:'Example',first_name:'Alice',email:'alice@example.com'})});
        assert.equal(deniedCreate.status,403);
        const invalidPerson=await fetch(directoryUrl,{method:'POST',body:new URLSearchParams({csrf_token:'synthetic-csrf',last_name:'Example',first_name:'Alice',email:'invalid'})});
        assert.equal(invalidPerson.status,422);
        const personCreated=await fetch(directoryUrl,{method:'POST',redirect:'manual',body:new URLSearchParams({csrf_token:'synthetic-csrf',last_name:'Example',first_name:'Alice',phone:'0600000000',email:'alice@example.com'})});
        assert.equal(personCreated.status,303,await personCreated.text());
        const directoryPage=await fetch(directoryUrl).then(response=>response.text());
        assert.match(directoryPage,/Example Alice/);
        assert.match(directoryPage,/alice@example.com/);
        assert.match(directoryPage,/0600000000/);
        assert.match(directoryPage,/href="tel:0600000000"[^>]*aria-label="Appeler Example Alice">06 00 00 00 00<\/a>/);
        assert.match(directoryPage,/assets\/salespeople.js/);
        const create=await fetch(base+'?api=create',{method:'POST',body:new URLSearchParams({action:'create',csrf_token:'synthetic-csrf'})});
        assert.equal(create.status,201,await create.clone().text());
        const report=await create.json();
        const clientUid='b'.repeat(32);
        const createLocal=()=>fetch(base+'?api=create',{method:'POST',body:new URLSearchParams({action:'create',csrf_token:'synthetic-csrf',client_uid:clientUid})}).then(response=>response.json());
        const localFirst=await createLocal(),localRetry=await createLocal();
        assert.equal(localFirst.id,localRetry.id,'Local UUID prevents duplicate creation');
        const template=await fetch(base+'?api=template');
        let photoRevision=1;
        let uploadedPhotos=[];
        for(const [width,height,expected] of [[1600,900,200],[1600,1200,200],[1600,1000,422]]) {
            const jpeg=execFileSync('php',['-d','extension=php_gd.dll','-r',`$image=imagecreatetruecolor(${width},${height}); imagejpeg($image);`]);
            const body=new FormData();
            for(const [key,value] of Object.entries({action:'save',csrf_token:'synthetic-csrf',report_id:String(localFirst.id),revision:String(photoRevision),request_id:randomUUID(),save_status:'draft'})) body.set(key,value);
            body.append('photos_1[]',new Blob([jpeg],{type:'image/jpeg'}),'synthetic.jpg');
            body.append('formats_1[]','landscape');
            const response=await fetch(base+`?api=save&id=${localFirst.id}`,{method:'POST',body});
            assert.equal(response.status,expected,await response.clone().text());
            if(expected===200) {
                const result=await response.json();photoRevision=result.revision;uploadedPhotos=result.photos;
            }
        }
        const photoKeys=uploadedPhotos.map(photo=>photo.client_uid || `photo.php?id=${photo.id}`);
        const managePhotos=(revision,order,deleted,extra={})=>fetch(base+`?api=save&id=${localFirst.id}`,{
            method:'POST',body:new URLSearchParams({action:'save',csrf_token:'synthetic-csrf',report_id:String(localFirst.id),revision:String(revision),
                request_id:randomUUID(),save_status:'draft',photo_order:JSON.stringify(order),photo_deleted:JSON.stringify(deleted),...extra}),
        });
        const reversed=[...photoKeys].reverse();
        const moved=await managePhotos(photoRevision,reversed,[]);
        assert.equal(moved.status,200,await moved.clone().text());
        const movedResult=await moved.json();photoRevision=movedResult.revision;
        assert.deepEqual(movedResult.photos.map(photo=>`photo.php?id=${photo.id}`),reversed);
        const deleteRequest=randomUUID();
        const deletedPhoto=await managePhotos(photoRevision,reversed.slice(1),[reversed[0]],{request_id:deleteRequest});
        assert.equal(deletedPhoto.status,200,await deletedPhoto.clone().text());
        const deleteResult=await deletedPhoto.json();assert.equal(deleteResult.photos.length,1);
        const deleteRetry=await managePhotos(photoRevision,reversed.slice(1),[reversed[0]],{request_id:deleteRequest});
        assert.equal(deleteRetry.status,200);
        assert.equal((await deleteRetry.json()).revision,deleteResult.revision);
        photoRevision=deleteResult.revision;
        assert.equal((await fetch(base.replace('/index.php','/'+reversed[0]))).status,404);
        const crossReport=await fetch(base+`?api=save&id=${report.id}`,{method:'POST',body:new URLSearchParams({
            action:'save',csrf_token:'synthetic-csrf',report_id:String(report.id),revision:'1',request_id:randomUUID(),
            photo_deleted:JSON.stringify([reversed[1]]),
        })});
        assert.equal(crossReport.status,422);
        const badOrder=await managePhotos(photoRevision,[reversed[1],reversed[1]],[]);
        assert.equal(badOrder.status,422);
        const missingPhoto=await managePhotos(photoRevision,['photo.php?id=999999'],[]);
        assert.equal(missingPhoto.status,422);
        const repeatedDelete=await managePhotos(photoRevision,reversed.slice(1),[reversed[0]]);
        assert.equal(repeatedDelete.status,200,await repeatedDelete.clone().text());
        assert.equal((await repeatedDelete.json()).photos.length,1);
        assert.equal(template.status,200,await template.clone().text());
        const templateHtml=(await template.json()).html;
        assert.match(templateHtml,/data-section-accordion="11"/);
        assert.match(templateHtml,/name="sales_rep_id"/);
        assert.match(templateHtml,/<option value="1">Example Alice<\/option>/);
        assert.doesNotMatch(templateHtml,/alice@example.com|0600000000/);
        assert.match(templateHtml,/INFORMATIONS COMMERCIALES/);
        assert.doesNotMatch(templateHtml,/class="section-title"|LE LIEU &amp; LES RÉFÉRENCES|Les repères essentiels/);
        const commercial=templateHtml.match(/data-section-panel="1"[\s\S]*?data-section-panel="13"/)[0];
        const commercialOrder=['establishment','address','contact_name','contact_phone','contact_email','sales_rep_id','order_reference','order_date','customer_id'];
        let lastPosition=-1;
        for(const field of commercialOrder) {
            const position=commercial.indexOf(field==='report-day-number'?`id="${field}"`:`name="${field}"`);
            assert.ok(position>lastPosition,`${field} follows the requested commercial order`);
            lastPosition=position;
        }
        assert.doesNotMatch(commercial,/name="report_date"|name="intervention_id"|name="gallery_url"/);
        const organisation=templateHtml.match(/data-section-panel="13"[\s\S]*?data-section-panel="12"/)[0];
        assert.match(organisation,/id="organisation-order-date"[^>]*readonly/);
        for(const name of ['report_date','intervention_id','author','intervention_followup']) assert.match(organisation,new RegExp(`name="${name}"`));
        assert.match(organisation,/id="add-followup"/);
        const siteTemplate=templateHtml.match(/data-section-panel="12"[\s\S]*?data-section-panel="2"/)[0];
        assert.match(siteTemplate,/Photo du restaurant extérieur \/ intérieur \/ terrasse/);
        assert.match(siteTemplate,/Image à prendre en mode large/);
        assert.doesNotMatch(siteTemplate,/Photos de cette section|8 Mo maximum/);
        assert.match(siteTemplate,/multiple data-photo-input="1"/);
        assert.match(siteTemplate,/name="gallery_url"/);
        const getPage=()=>fetch(base+`?id=${report.id}`).then(response=>response.text());
        const initial=await getPage();
        const heading=initial.match(/<section class="editor-heading">([\s\S]*?)<\/section>/)[1];
        assert.match(heading,/<h1>/);
        assert.match(heading,/Brouillon/);
        assert.doesNotMatch(heading,/eyebrow|rapport\.php|Modifié|class="intro"/);
        assert.ok(initial.indexOf('class="editor-footer panel"')>initial.indexOf('</fieldset>',initial.indexOf('id="report-form"')));
        assert.match(initial,/class="button button-primary report-preview"/);
        assert.match(initial,/<label class="field field-floating"><input placeholder=" " type="text" name="establishment"[^>]*><span class="field-title">Établissement<\/span>/);
        assert.match(initial,/<label class="field field-floating field-native"><input placeholder=" " type="date"/);
        assert.match(initial,/<textarea placeholder=" " name="context_notes"/);
        assert.equal((initial.match(/data-section-accordion=/g)||[]).length,13);
        const information=initial.match(/data-section-accordion="1"([\s\S]*?)<\/details>/)[1];
        const site=initial.match(/data-section-accordion="12"([\s\S]*?)<\/details>/)[1];
        assert.doesNotMatch(information,/location-block|photo-block/);
        assert.match(site,/location-block/);
        assert.match(site,/data-photo-section="1"/);
        assert.match(site,/data-complete-section="12"/);
        assert.match(initial,/name="completed_sections" value="\[\]"/);
        const save=async(revision,states,extra={})=>{
            const data={action:'save',csrf_token:'synthetic-csrf',report_id:String(report.id),revision:String(revision),active_section:'6',save_status:'draft',request_id:randomUUID(),...extra};
            if(states!==undefined)data.completed_sections=states;
            return fetch(base+`?api=save&id=${report.id}`,{method:'POST',body:new URLSearchParams(data)});
        };
        const requestId=randomUUID();
        const followup=JSON.stringify([{date:'2026-10-07',comment:'Synthetic follow-up <script>escaped</script>'}]);
        const first=await save(1,'[6,13]',{request_id:requestId,context_notes:'Synthetic saved content',sales_rep_id:'1',sales_rep:'Spoofed name',intervention_followup:followup});
        assert.equal(first.status,200,await first.clone().text());
        assert.equal((await first.json()).revision,2);
        const saved=await getPage();
        assert.match(saved,/report-accordion is-complete" data-section-accordion="6"/);
        assert.match(saved,/Synthetic saved content/);
        assert.match(saved,/name="sales_rep" value="Example Alice"/);
        assert.match(saved,/<option value="1" selected>Example Alice<\/option>/);
        const missingPerson=await save(2,'[6]',{sales_rep_id:'999999'});
        assert.equal(missingPerson.status,422);
        assert.match(saved,/name="completed_sections" value="\[6,13\]"/);
        const retry=await save(1,'[6]',{request_id:requestId});
        assert.equal(retry.status,200);
        assert.equal((await retry.json()).revision,2,'Retry is idempotent');
        const conflict=await save(1,'[7]');
        assert.equal(conflict.status,409);
        const conflictBody=await conflict.json();
        assert.equal(conflictBody.conflict,true);
        assert.match(conflictBody.error,/version locale 1, serveur 2/);
        assert.match(logs,/FoxReport revision conflict; report \d+; local 1; server 2/);
        assert.match(await getPage(),/name="completed_sections" value="\[6,13\]"/);
        const invalid=await save(2,'[14]');
        assert.equal(invalid.status,422);
        const legacy=await save(2,undefined);
        assert.equal(legacy.status,200,await legacy.clone().text());
        assert.match(await getPage(),/name="completed_sections" value="\[6,13\]"/,'Old clients preserve state');
        assert.match(await getPage(),/Synthetic follow-up &lt;script&gt;escaped/,'Old clients preserve follow-up');
        const badFollowup=await save(3,'[]',{intervention_followup:'[{"date":"2026-02-30","comment":"Invalid date"}]'});
        assert.equal(badFollowup.status,422);
        const unmark=await save(3,'[12]');
        assert.equal(unmark.status,200);
        assert.match(await getPage(),/name="completed_sections" value="\[12\]"/);
        assert.match(await getPage(),/report-accordion is-complete" data-section-accordion="12"/);
        const missingRevision=await save('', '[]');
        assert.equal(missingRevision.status,409);
        assert.match((await missingRevision.json()).error,/Version du rapport manquante/);
        const finalized=await save(4,'[]',{save_status:'finalized',establishment:'Synthetic',report_date:'2026-10-07'});
        assert.equal(finalized.status,200,await finalized.clone().text());
        const closed=await save(5,'[]');
        assert.equal(closed.status,409);
        assert.match((await closed.json()).error,/finalisé/);
        const missing=await save(1,'[]',{report_id:'999999'});
        assert.equal(missing.status,409);
        assert.match((await missing.json()).error,/introuvable/);
        assert.match(logs,/reason missing_revision/);
        assert.match(logs,/reason finalized/);
        assert.match(logs,/reason missing_report/);
        const csrf=await save(4,'[2]',{csrf_token:'wrong'});
        assert.equal(csrf.status,403);
        const denied=await fetch(base+'?api=reports&test_denied=1');
        assert.equal(denied.status,401);
        assert.doesNotMatch(logs,/PHP (?:Warning|Fatal|Parse)/);
    } finally {
        if(child && child.exitCode===null) await new Promise(resolve=>{child.once('exit',resolve);child.kill();});
        if(process.env.FOXREPORT_KEEP_FIXTURE==='1') console.log('BROWSER_FIXTURE='+directory);
        else fs.rmSync(directory,{recursive:true,force:true});
    }
});
