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
        fs.copyFileSync(path.join(root,'report-settings.php'),path.join(directory,'report-settings.php'));
        fs.mkdirSync(path.join(directory,'storage','private'),{recursive:true});
        if(process.env.FOXREPORT_KEEP_FIXTURE==='1') {
            fs.cpSync(path.join(root,'assets'),path.join(directory,'assets'),{recursive:true});
            for(const name of ['offline.html','sw.js','manifest.webmanifest','version.json','photo.php'])fs.copyFileSync(path.join(root,name),path.join(directory,name));
        }
        for(const name of ['report-definition.php','device-catalogue.php','training-catalogue.php','images.php','completion.php','sync.php','maps.php','report-list.php','report-delete.php','section-state.php','salespeople.php','photo-state.php','intervention-followup.php','report-branding.php','version.php','build-version.php']) {
            fs.copyFileSync(path.join(root,'app',name),path.join(directory,'app',name));
        }
        fs.writeFileSync(path.join(directory,'app','auth.php'),`<?php
            session_start(); $_SESSION['foxreport_csrf']='synthetic-csrf';
            function requireFoxAuth(bool $api): array {
                if(isset($_GET['test_error'])) throw new TypeError('Synthetic internal failure');
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
                else if(name==='model_key' || name==='item_key' || (name==='category' && match[1]==='foxreport_device_types')) columns.push(`${name} TEXT PRIMARY KEY`);
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
        child=spawn('php',['-d','extension=php_pdo_sqlite.dll','-d','extension=php_fileinfo.dll','-d','extension=php_mbstring.dll','-d','extension=php_gd.dll','-d','extension=php_exif.dll','-S',`127.0.0.1:${port}`,'-t',directory],{stdio:['ignore','pipe','pipe']});
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
        const catalogueUrl=base+'?api=device-catalogue';
        assert.deepEqual(await fetch(catalogueUrl).then(response=>response.json()),{types:[],models:[]});
        const category='custom_'+require('node:crypto').createHash('sha256').update('synthetic display').digest('hex').slice(0,32);
        const catalogue={types:[{category,label:'Synthetic Display'}],models:[{
            model_key:require('node:crypto').createHash('sha256').update(category+'\nsynthetic model').digest('hex'),
            category,name:'Synthetic Model',
        }]};
        const cataloguePost=async(data,csrf='synthetic-csrf')=>{
            const body=new FormData();body.set('csrf_token',csrf);body.set('device_catalogue',JSON.stringify(data));
            return fetch(catalogueUrl,{method:'POST',body});
        };
        assert.equal((await cataloguePost(catalogue,'wrong')).status,403);
        assert.equal((await cataloguePost({types:[],models:catalogue.models})).status,422);
        assert.equal((await cataloguePost(catalogue)).status,200);
        assert.equal((await cataloguePost(catalogue)).status,200,'Catalogue additions are idempotent');
        assert.deepEqual(await fetch(catalogueUrl).then(response=>response.json()),catalogue);
        const trainingUrl=base+'?api=training-checklist';
        const initialTraining=await fetch(trainingUrl).then(response=>response.json());
        assert.equal(initialTraining.themes.length,10);
        assert.equal(initialTraining.themes[0].items[0].key,'basics_1');
        const trainingPost=async(fields,csrf='synthetic-csrf')=>{
            const body=new FormData();body.set('csrf_token',csrf);
            for(const [name,value] of Object.entries(fields)) body.set(name,value);
            return fetch(trainingUrl,{method:'POST',body});
        };
        assert.equal((await trainingPost({action:'add',theme:'basics',label:'Synthetic line'},'wrong')).status,403);
        assert.equal((await trainingPost({action:'add',theme:'unknown',label:'Synthetic line'})).status,422);
        const addedTraining=await (await trainingPost({action:'add',theme:'basics',label:'Synthetic <line>'})).json();
        const addedItem=addedTraining.themes[0].items.at(-1);
        assert.match(addedItem.key,/^basics_c[0-9a-f]{12}$/);
        assert.equal(addedItem.label,'Synthetic <line>');
        assert.equal((await trainingPost({action:'edit',theme:'basics',item:'basics_1',label:'Synthetic edited'})).status,200);
        const deletedTraining=await (await trainingPost({action:'delete',theme:'basics',item:'basics_2'})).json();
        assert.deepEqual(deletedTraining.themes[0].items.map(item=>item.key),['basics_1','basics_3','basics_4',addedItem.key]);
        assert.equal(deletedTraining.themes[0].items[0].label,'Synthetic edited');
        const settingsUrl=base.replace('/index.php','/report-settings.php');
        assert.match(await fetch(settingsUrl).then(response=>response.text()),/Aucun logo configuré/);
        const logoBytes=execFileSync('php',['-d','extension=php_gd.dll','-r',`$image=imagecreatetruecolor(800,300); imagepng($image);`]);
        const uploadLogo=async(token,bytes,type='image/png')=>{
            const data=new FormData();data.set('csrf_token',token);
            data.set('report_logo',new Blob([bytes],{type}),'logo.png');
            return fetch(settingsUrl,{method:'POST',redirect:'manual',body:data});
        };
        assert.equal((await uploadLogo('wrong',logoBytes)).status,403);
        const upload=await uploadLogo('synthetic-csrf',logoBytes);
        assert.equal(upload.status,303,await upload.text());
        const logoPath=path.join(directory,'storage','private','report-logo.png');
        assert.ok(fs.existsSync(logoPath));
        const savedLogo=fs.readFileSync(logoPath);
        assert.equal((await uploadLogo('synthetic-csrf',Buffer.from('<svg>bad</svg>'),'image/svg+xml')).status,422);
        assert.deepEqual(fs.readFileSync(logoPath),savedLogo,'Invalid upload preserves the previous logo');
        const settingsResponse=await fetch(settingsUrl);
        assert.match(settingsResponse.headers.get('cache-control'),/no-store/);
        assert.match(await settingsResponse.text(),/data:image\/png;base64,/);
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
        for(const [width,height,expected] of [[1600,615,200],[1600,500,200],[1600,900,200],[1600,1200,200],[1600,1000,422]]) {
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
        const squareReport=await (await fetch(base+'?api=create',{method:'POST',body:new URLSearchParams({action:'create',csrf_token:'synthetic-csrf'})})).json();
        let squareRevision=squareReport.revision;
        for(const [section,format,width,height,expected] of [['6','portrait',1125,1500,422],['7','landscape',1600,615,422],['6','square',1200,1200,200],['7','original',1600,900,200]]) {
            const jpeg=execFileSync('php',['-d','extension=php_gd.dll','-r',`$image=imagecreatetruecolor(${width},${height}); imagejpeg($image);`]);
            const body=new FormData();
            for(const [key,value] of Object.entries({action:'save',csrf_token:'synthetic-csrf',report_id:String(squareReport.id),revision:String(squareRevision),request_id:randomUUID(),save_status:'draft'})) body.set(key,value);
            body.append(`photos_${section}[]`,new Blob([jpeg],{type:'image/jpeg'}),'synthetic.jpg');
            body.append(`formats_${section}[]`,format);
            const response=await fetch(base+`?api=save&id=${squareReport.id}`,{method:'POST',body});
            const text=await response.text();
            assert.equal(response.status,expected,text);
            if(expected===422) assert.match(text,/Wi-Fi et Imprimantes doivent être carrées/);
            else squareRevision=JSON.parse(text).revision;
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
        const deleteResult=await deletedPhoto.json();assert.equal(deleteResult.photos.length,photoKeys.length-1);
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
        const repeatedResult=await repeatedDelete.json();
        assert.equal(repeatedResult.photos.length,photoKeys.length-1);
        photoRevision=repeatedResult.revision;
        const captioned=await managePhotos(photoRevision,reversed.slice(1),[],{photo_captions:JSON.stringify({[reversed[1]]:'  Légende corrigée  ',[reversed[0]]:'photo supprimée ignorée'})});
        assert.equal(captioned.status,200,await captioned.clone().text());
        const captionedResult=await captioned.json();photoRevision=captionedResult.revision;
        assert.equal(captionedResult.photos.find(photo=>`photo.php?id=${photo.id}`===reversed[1]).caption,'Légende corrigée');
        const badCaptions=await managePhotos(photoRevision,reversed.slice(1),[],{photo_captions:'["liste"]'});
        assert.equal(badCaptions.status,422);
        assert.equal(template.status,200,await template.clone().text());
        const templateHtml=(await template.json()).html;
        assert.match(templateHtml,/data-section-accordion="11"/);
        assert.match(templateHtml,/name="sales_rep_id"/);
        assert.match(templateHtml,/<option value="1">Example Alice<\/option>/);
        assert.doesNotMatch(templateHtml,/alice@example.com|0600000000/);
        assert.match(templateHtml,/INFORMATIONS COMMERCIALES/);
        assert.doesNotMatch(templateHtml,/class="section-title"|LE LIEU &amp; LES RÉFÉRENCES|Les repères essentiels/);
        const commercial=templateHtml.match(/data-section-panel="1"[\s\S]*?data-section-panel="13"/)[0];
        const commercialOrder=['establishment','address','postal_code','city','contact_name','contact_phone','contact_email','sales_rep_id','order_reference','order_date','customer_id','establishment_id'];
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
        assert.match(initial,/class="button button-secondary button-preview report-preview"/);
        assert.match(initial,/Synthetic edited/);
        assert.match(initial,/Synthetic &lt;line&gt;/);
        assert.match(initial,/data-training-configure>Configurer<\/button>/);
        assert.match(initial,/name="customer_id"[^>]*inputmode="numeric" data-digits="6"/);
        assert.match(initial,/name="establishment_id"[^>]*inputmode="numeric" data-digits="16"/);
        assert.match(initial,/Numéro d’identification de l’établissement/);
        assert.doesNotMatch(initial,/value="basics_2"/);
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
        const offlineCategory='custom_'+require('node:crypto').createHash('sha256').update('synthetic offline').digest('hex').slice(0,32);
        const offlineCatalogue={types:[{category:offlineCategory,label:'Synthetic Offline'}],models:[{
            model_key:require('node:crypto').createHash('sha256').update(offlineCategory+'\noffline model').digest('hex'),
            category:offlineCategory,name:'Offline Model',
        }]};
        const first=await save(1,'[6,13]',{request_id:requestId,context_notes:'Synthetic saved content',sales_rep_id:'1',sales_rep:'Spoofed name',intervention_followup:followup,postal_code:'34280',city:'LA GRANDE MOTTE',
            device_catalogue:JSON.stringify(offlineCatalogue),'devices[0][category]':offlineCategory,'devices[0][model]':'Offline Model',
            'devices[0][serial_number]':'OFFLINE-001','devices[0][state]':'installed',
            payment_tpe_status:'good',payment_tap_to_pay_status:'issue','training_done[]':addedItem.key});
        assert.equal(first.status,200,`${await first.clone().text()}\n${logs}`);
        assert.equal((await first.json()).revision,2);
        const saved=await getPage();
        assert.match(saved,/report-accordion is-complete" data-section-accordion="6"/);
        assert.match(saved,/Synthetic saved content/);
        assert.match(saved, /name="payment_tpe_status"[\s\S]*?<option value="good" selected>/);
        assert.match(saved, /name="payment_tap_to_pay_status"[\s\S]*?<option value="issue" selected>/);
        assert.match(saved, new RegExp(`name="training_done\\[\\]" value="${addedItem.key}" checked`));
        assert.match(saved,/name="sales_rep" value="Example Alice"/);
        assert.match(saved,/name="postal_code" value="34280"/);
        assert.match(saved,/name="city" value="LA GRANDE MOTTE"/);
        assert.match(saved,/name="devices\[0\]\[serial_number\]" value="OFFLINE-001"/);
        assert.match(saved,/Synthetic Offline<\/option>/);
        const sharedAfterSync=await fetch(catalogueUrl).then(response=>response.json());
        assert.ok(sharedAfterSync.types.some(type=>type.category===offlineCategory),'Offline type is imported atomically during report sync');
        assert.ok(sharedAfterSync.models.some(model=>model.category===offlineCategory && model.name==='Offline Model'));
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
        assert.match(await getPage(),/name="city" value="LA GRANDE MOTTE"/,'Old clients preserve locality');
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
        const desktopCreate=await fetch(base,{method:'POST',redirect:'manual',
            body:new URLSearchParams({action:'create',csrf_token:'synthetic-csrf'})});
        assert.equal(desktopCreate.status,303);
        const desktopUrl=new URL(desktopCreate.headers.get('location'),base).href;
        const desktopId=new URL(desktopUrl).searchParams.get('id');
        const desktopBody=new FormData();
        for(const [name,value] of Object.entries({action:'save',csrf_token:'synthetic-csrf',report_id:desktopId,
            revision:'1',save_status:'draft',establishment:'Synthetic desktop',address:'6 Synthetic Street',
            postal_code:'31000',city:'Synthetic city',context_start_time:'08:30:00',context_end_time:'17:45:00',evaluation_minutes:'5'})) desktopBody.set(name,value);
        const desktopPhotoId=randomUUID();
        const desktopJpeg=execFileSync('php',['-d','extension=php_gd.dll','-r',
            '$image=imagecreatetruecolor(1600,900); imagejpeg($image);']);
        desktopBody.append('photos_1[]',new Blob([desktopJpeg],{type:'image/jpeg'}),'photo.jpg');
        desktopBody.append('captions_1[]','Synthetic desktop photo');
        desktopBody.append('formats_1[]','landscape');
        desktopBody.append('photo_uids_1[]',desktopPhotoId);
        desktopBody.set('photo_order',JSON.stringify([desktopPhotoId]));
        const desktopSave=await fetch(desktopUrl,{method:'POST',redirect:'manual',body:desktopBody});
        assert.equal(desktopSave.status,303,await desktopSave.text());
        // SQLite does not add MySQL's trailing seconds when reading TIME columns.
        execFileSync('php',['-d','extension=php_pdo_sqlite.dll','-r',
            `$pdo=new PDO(${JSON.stringify('sqlite:'+path.join(directory,'fixture.sqlite'))}); $q=$pdo->prepare("UPDATE foxreport_reports SET context_start_time = ?, context_end_time = ? WHERE id = ?"); $q->execute(['08:30:00','17:45:00',${Number(desktopId)}]);`]);
        const desktopPage=await fetch(desktopUrl).then(response=>response.text());
        assert.match(desktopPage,/name="address" value="6 Synthetic Street"/);
        assert.match(desktopPage,/name="postal_code" value="31000"/);
        assert.match(desktopPage,/name="city" value="Synthetic city"/);
        assert.match(desktopPage,/name="revision" value="2"/);
        assert.match(desktopPage,/name="context_start_time" value="08:30"/);
        assert.match(desktopPage,/name="context_end_time" value="17:45"/);
        assert.doesNotMatch(desktopPage,/name="evaluation_minutes"/);
        assert.match(desktopPage,/id="evaluation-duration" value="9 h 15" readonly/);
        assert.equal(execFileSync('php',['-d','extension=php_pdo_sqlite.dll','-r',
            `$pdo=new PDO(${JSON.stringify('sqlite:'+path.join(directory,'fixture.sqlite'))}); echo $pdo->query("SELECT evaluation_minutes FROM foxreport_reports WHERE id = ${Number(desktopId)}")->fetchColumn();`]).toString(),'555');
        const sticky = desktopPage.match(/<div class="form-actions">([\s\S]*?)<\/div>\s*<\/div>/)?.[1] || '';
        assert.match(sticky,/Enregistrer le brouillon/);
        assert.match(sticky,/class="button button-secondary button-preview report-preview"/);
        assert.match(sticky,/Tous les rapports/);
        assert.match(sticky,/Finaliser le rapport/);
        assert.equal((desktopPage.match(/class="button button-secondary button-preview report-preview"/g) || []).length,1);
        assert.doesNotMatch(desktopPage,/data-photo-section="2"|data-photo-input="2"/);
        assert.match(desktopPage,/Synthetic desktop photo/);
        assert.ok(desktopPage.includes(`data-photo-key="${desktopPhotoId}"`));
        for(const invalidTime of ['24:00','08:60','12:30:99','12:30:01','bad']) {
            const invalidTimeSave=await fetch(desktopUrl,{method:'POST',body:new URLSearchParams({
                action:'save',csrf_token:'synthetic-csrf',report_id:desktopId,revision:'2',save_status:'draft',
                establishment:'Synthetic desktop',context_start_time:invalidTime})});
            assert.match(await invalidTimeSave.text(),/Une heure de déroulement est invalide/);
            assert.match(await fetch(desktopUrl).then(response=>response.text()),/name="revision" value="2"/);
        }
        const desktopResave=await fetch(desktopUrl,{method:'POST',redirect:'manual',body:new URLSearchParams({
            action:'save',csrf_token:'synthetic-csrf',report_id:desktopId,revision:'2',save_status:'draft',
            establishment:'Synthetic desktop',context_start_time:'00:00:00',context_end_time:'23:59'})});
        assert.equal(desktopResave.status,303,await desktopResave.text());
        const desktopResavedPage=await fetch(desktopUrl).then(response=>response.text());
        assert.match(desktopResavedPage,/name="context_start_time" value="00:00"/);
        assert.match(desktopResavedPage,/name="context_end_time" value="23:59"/);
        const desktopConflict=await fetch(desktopUrl,{method:'POST',body:new URLSearchParams({
            action:'save',csrf_token:'synthetic-csrf',report_id:desktopId,revision:'1',save_status:'draft',
            establishment:'Stale desktop'})});
        assert.equal(desktopConflict.status,409);
        assert.match(await desktopConflict.text(),/version locale 1, serveur 3/);
        const csrf=await save(4,'[2]',{csrf_token:'wrong'});
        assert.equal(csrf.status,403);
        const denied=await fetch(base+'?api=reports&test_denied=1');
        assert.equal(denied.status,401);
        const internal=await fetch(base+'?api=session&test_error=1');
        assert.equal(internal.status,500);
        const internalBody=await internal.json();
        assert.match(internalBody.error,/Référence : [a-f0-9]{16}/);
        assert.doesNotMatch(internalBody.error,/Synthetic internal failure|TypeError/);
        await new Promise(resolve=>setTimeout(resolve,20));
        assert.match(logs,/FoxReport API failure; reference [a-f0-9]{16}; TypeError; auth.php:\d+/);
        assert.doesNotMatch(logs,/PHP (?:Warning|Fatal|Parse)/);
    } finally {
        if(child && child.exitCode===null) await new Promise(resolve=>{child.once('exit',resolve);child.kill();});
        if(process.env.FOXREPORT_KEEP_FIXTURE==='1') console.log('BROWSER_FIXTURE='+directory);
        else fs.rmSync(directory,{recursive:true,force:true});
    }
});
