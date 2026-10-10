import {BrowserMultiFormatReader} from '@zxing/browser';
import {createWorker} from 'tesseract.js';
import parseScan from './scan-parser.js';

const button = document.querySelector('#scan-device');
if (button) {
    const dialog = document.createElement('dialog');
    dialog.className='media-dialog';
    dialog.innerHTML=`<h2>Scanner un matériel</h2>
        <p>QR, codes-barres ou texte OCR. Vérifiez les données avant confirmation. Aucun lien n’est ouvert.</p>
        <video playsinline muted id="scan-video"></video>
        <button type="button" class="button button-primary" id="scan-camera">Démarrer la caméra</button>
        <label class="upload-control">Lire une photo (QR / codes-barres)<input type="file" id="scan-image" accept="image/*"></label>
        <label class="upload-control">OCR d’une étiquette / écran iPhone<input type="file" id="scan-ocr" accept="image/*" capture="environment"></label>
        <label class="field">Texte brut reconnu (modifiable)<textarea id="scan-raw" rows="4"></textarea></label>
        <p id="scan-message" role="status"></p>
        <div class="form-grid" id="scan-fields"></div>
        <button type="button" class="button button-secondary" id="scan-review">Analyser le texte</button>
        <button type="button" class="button button-secondary" id="scan-close">Fermer</button>
        <button type="button" class="button button-primary" id="scan-add">Confirmer et ajouter</button>`;
    document.body.append(dialog);
    const $=selector=>dialog.querySelector(selector);
    const categories=document.querySelector('#device-row-template').content.querySelector('select[data-device-field="category"]').cloneNode(true);
    categories.id='scan-category';categories.removeAttribute('data-device-field');
    const empty=document.createElement('option');empty.value='';empty.textContent='Choisir une catégorie';categories.prepend(empty);categories.value='';
    const categoryLabel=document.createElement('label');categoryLabel.className='field';categoryLabel.textContent='Catégorie (à confirmer)';categoryLabel.append(categories);
    $('#scan-fields').append(categoryLabel);
    document.querySelector('#report-form').addEventListener('fox-inventory-restored',()=>window.FoxDeviceCatalogue?.populate(categories));
    for(const [key,label] of Object.entries({brand:'Marque',model:'Modèle',serial_number:'Numéro de série',mac_address:'MAC',decoded_password:'Mot de passe décodé (hors PDF)'})) {
        const element=document.createElement('label');element.className='field';element.textContent=label;
        const input=document.createElement('input');input.id=`scan-${key}`;input.type=key==='decoded_password'?'password':'text';input.maxLength=key==='decoded_password'?500:160;
        element.append(input);$('#scan-fields').append(element);
    }
    let controls,stream,timer,worker,busy=false;
    function stop() {controls?.stop();controls=null;stream?.getTracks().forEach(track=>track.stop());stream=null;clearTimeout(timer);$('#scan-video').srcObject=null;}
    function recognized(text) {
        stop(); $('#scan-raw').value=text;
        const {fields}=parseScan(text);
        for(const key of ['brand','model','serial_number','mac_address','decoded_password']) $(`#scan-${key}`).value=fields[key]||'';
        $('#scan-message').textContent=Object.keys(fields).length?'Vérifiez et complétez les champs reconnus avant ajout.':'Code reconnu mais champs non identifiés : choisissez leur affectation manuellement.';
    }
    button.onclick=()=>dialog.showModal();
    $('#scan-close').onclick=()=>{stop();dialog.close();};
    dialog.oncancel=stop;
    window.addEventListener('pagehide',()=>{stop();worker?.terminate();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
    $('#scan-review').onclick=()=>recognized($('#scan-raw').value);
    $('#scan-camera').onclick=async()=>{
        stop();
        try{
            if(!navigator.mediaDevices?.getUserMedia)throw new Error('Caméra indisponible. Utilisez une photo ou saisissez le texte.');
            const formats=globalThis.BarcodeDetector?await BarcodeDetector.getSupportedFormats():[];
            if(formats.includes('qr_code')&&formats.includes('code_128')){
                stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});
                const video=$('#scan-video');video.srcObject=stream;await video.play();
                const detector=new BarcodeDetector({formats:formats.filter(format=>['qr_code','code_128','code_39','ean_13','ean_8','data_matrix','pdf417'].includes(format))});
                const tick=async()=>{
                    if(!stream)return;
                    try{const found=await detector.detect(video);if(found.length){recognized(found[0].rawValue);return;}}
                    catch(error){$('#scan-message').textContent=`Lecture caméra : ${error.message}`;stop();return;}
                    timer=setTimeout(tick,250);
                };
                tick();
            }else{
                const reader=new BrowserMultiFormatReader();
                controls=await reader.decodeFromConstraints({video:{facingMode:'environment'},audio:false},$('#scan-video'),result=>{if(result)recognized(result.getText());});
            }
            $('#scan-message').textContent='Présentez un seul code à la caméra.';
        }catch(error){stop();$('#scan-message').textContent=`Caméra : ${error.message}. Essayez la lecture depuis une photo.`;}
    };
    $('#scan-image').onchange=async event=>{
        const file=event.target.files?.[0]; if(!file)return;
        const url=URL.createObjectURL(file);
        try{
            stop();
            const reader=new BrowserMultiFormatReader();
            const result=await reader.decodeFromImageUrl(url);
            recognized(result.getText());
        }catch(error){$('#scan-message').textContent='Aucun QR/code-barres lisible. Recadrez la zone ou essayez l’OCR pour les informations en clair.';}
        finally{URL.revokeObjectURL(url);event.target.value='';}
    };
    $('#scan-ocr').onchange=async event=>{
        const file=event.target.files?.[0];if(!file||busy)return;
        busy=true;stop();
        try{
            if(file.size>30*1024*1024)throw new Error('Image trop grande pour l’OCR.');
            $('#scan-message').textContent='OCR local en cours…';
            if(!worker)worker=await createWorker('eng',1,{
                workerPath:new URL('assets/ocr/worker.min.js',location.href).href,
                corePath:new URL('assets/ocr/',location.href).href,
                langPath:new URL('assets/ocr/',location.href).href,
                workerBlobURL:false,
                logger:message=>{if(message.status==='recognizing text')$('#scan-message').textContent=`OCR local ${Math.round(message.progress*100)} %`;},
            });
            const {data}=await worker.recognize(file);
            recognized(data.text);
            $('#scan-message').textContent+=' Résultat OCR à vérifier, notamment les caractères 0/O et 1/I.';
        }catch(error){$('#scan-message').textContent=`OCR : ${error.message}`;}
        finally{busy=false;event.target.value='';}
    };
    $('#scan-add').onclick=()=>{
        const data={};
        for(const key of ['brand','model','serial_number','mac_address','decoded_password'])data[key]=$(`#scan-${key}`).value.trim();
        if(!categories.value){$('#scan-message').textContent='Choisissez la catégorie avant ajout.';return;}
        if(!Object.values(data).some(Boolean)){ $('#scan-message').textContent='Renseignez au moins une information reconnue.';return;}
        const serial=data.serial_number.toUpperCase();const mac=data.mac_address.replace(/[:-]/g,'').toUpperCase();
        const duplicate=Array.from(document.querySelectorAll('.device-row')).some(row=>{
            const otherSerial=row.querySelector('[name$="[serial_number]"]').value.trim().toUpperCase();
            const otherMac=row.querySelector('[name$="[mac_address]"]').value.replace(/[:-]/g,'').toUpperCase();
            return (serial&&serial===otherSerial)||(mac&&mac===otherMac);
        });
        if(duplicate){$('#scan-message').textContent='Appareil déjà présent : série ou MAC identique.';return;}
        const row=window.FoxAddDevice();
        row.querySelector('[name$="[category]"]').value=categories.value;
        Object.entries(data).forEach(([key,value])=>{const field=row.querySelector(`[name$="[${key}]"]`);if(field)field.value=value;});
        row.dispatchEvent(new Event('input',{bubbles:true}));
        document.querySelector('#report-form').dispatchEvent(new Event('fox-change'));
        stop();dialog.close();
    };
}
