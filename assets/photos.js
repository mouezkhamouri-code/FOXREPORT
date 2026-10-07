(() => {
    'use strict';
    let photos = [];
    let savedPhotos = [];
    let cacheReady = false;
    let processing = Promise.resolve();
    const urls = new Map();
    const dialog = document.createElement('dialog');
    dialog.className = 'media-dialog';
    dialog.innerHTML = `<h2>Recadrer la photo</h2>
        <label class="field">Format<select id="crop-format"><option value="landscape">Paysage 4:3</option><option value="square">Carré 1:1</option><option value="portrait">Portrait 3:4</option></select></label>
        <canvas id="crop-preview" aria-label="Aperçu du recadrage"></canvas>
        <label class="field">Zoom<input id="crop-zoom" type="range" min="1" max="4" value="1" step=".05"></label>
        <label class="field">Position horizontale<input id="crop-x" type="range" min="0" max="1" value=".5" step=".01"></label>
        <label class="field">Position verticale<input id="crop-y" type="range" min="0" max="1" value=".5" step=".01"></label>
        <label class="field">Légende<input id="crop-caption" maxlength="500"></label>
        <p id="crop-error" role="alert"></p>
        <button type="button" class="button button-secondary" id="crop-rotate">Rotation 90°</button>
        <button type="button" class="button button-secondary" id="crop-cancel">Annuler</button>
        <button type="button" class="button button-primary" id="crop-confirm">Ajouter la photo</button>`;
    document.body.append(dialog);
    const query = selector => dialog.querySelector(selector);
    const photoBlock = section => document.querySelector(`[data-photo-section="${section}"]`)
        || document.querySelector(`[data-section-panel="${section}"] .photo-block`);
    function changed(section) {
        const panel=photoBlock(section)?.closest('[data-section-panel]');
        document.querySelector('#report-form')?.dispatchEvent(new CustomEvent('fox-section-edit', {detail:{sections:[Number(panel?.dataset.sectionPanel || section)]}}));
    }
    function jpegBlob(canvas, quality) {
        const data = canvas.toDataURL('image/jpeg', quality);
        if (!data.startsWith('data:image/jpeg;base64,')) throw new Error('Compression JPEG indisponible.');
        const binary = atob(data.slice(data.indexOf(',') + 1));
        return new Blob([Uint8Array.from(binary, character => character.charCodeAt(0))], {type:'image/jpeg'});
    }
    async function crop(file, section) {
        if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Sélectionnez un JPEG, PNG ou WebP. Convertissez les photos HEIC en JPEG.');
        if (file.size > 30 * 1024 * 1024) throw new Error('Photo source trop volumineuse (30 Mo maximum).');
        let image;
        try {
            if (globalThis.createImageBitmap) {
                image = await createImageBitmap(file, {imageOrientation:'from-image'});
            } else {
                image = new Image();
                image.src = await new Promise((resolve,reject)=>{
                    const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file);
                });
                await image.decode();
            }
            const sourceWidth=image.naturalWidth||image.width,sourceHeight=image.naturalHeight||image.height;
            const landscapeOnly = Number(section) === 1;
            if (landscapeOnly && sourceWidth <= sourceHeight) throw new Error('Photo SITE : prenez une image en mode paysage (large). Les photos portrait ou carrées ne sont pas acceptées.');
            if (sourceWidth * sourceHeight > 48000000) throw new Error('Photo supérieure à 48 mégapixels : réduisez-la avant le traitement.');
            let rotation = 0;
            let sourceCanvas;
            function rotateSource() {
                sourceCanvas = document.createElement('canvas');
                sourceCanvas.width = rotation % 180 ? sourceHeight : sourceWidth;
                sourceCanvas.height = rotation % 180 ? sourceWidth : sourceHeight;
                const context = sourceCanvas.getContext('2d');
                context.translate(sourceCanvas.width / 2, sourceCanvas.height / 2);
                context.rotate(rotation * Math.PI / 180);
                context.drawImage(image, -sourceWidth / 2, -sourceHeight / 2);
            }
            const format = query('#crop-format');
            format.disabled = landscapeOnly;
            if (landscapeOnly) format.value = 'landscape';
            query('#crop-rotate').hidden = landscapeOnly;
            const zoom = query('#crop-zoom'); const x = query('#crop-x'); const y = query('#crop-y');
            const canvas = query('#crop-preview');
            let rect;
            function preview() {
                const ratio = {square:1, landscape:4/3, portrait:3/4}[format.value];
                let width = Math.min(sourceCanvas.width, sourceCanvas.height * ratio) / Number(zoom.value);
                let height = width / ratio;
                rect = {width,height,x:(sourceCanvas.width-width)*Number(x.value),y:(sourceCanvas.height-height)*Number(y.value)};
                canvas.width = Math.round(480 * Math.min(ratio,1));
                canvas.height = Math.round(canvas.width / ratio);
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = 'white'; ctx.fillRect(0,0,canvas.width,canvas.height);
                ctx.drawImage(sourceCanvas,rect.x,rect.y,rect.width,rect.height,0,0,canvas.width,canvas.height);
            }
            zoom.value = '1'; x.value = '.5'; y.value = '.5'; query('#crop-caption').value = '';
            query('#crop-error').textContent = '';
            rotateSource(); preview();
            [format,zoom,x,y].forEach(control => { control.oninput = preview; });
            query('#crop-rotate').onclick = () => { rotation = (rotation+90)%360; rotateSource(); preview(); };
            return await new Promise(resolve => {
                const cancel = () => { dialog.close(); resolve(null); };
                query('#crop-cancel').onclick = cancel;
                dialog.oncancel = event => { event.preventDefault(); cancel(); };
                query('#crop-confirm').onclick = async () => {
                    query('#crop-confirm').disabled = true;
                    try {
                        const limits = {square:[1200,1200],landscape:[1600,1200],portrait:[1200,1600]}[format.value];
                        const scale = Math.min(1,limits[0]/rect.width,limits[1]/rect.height);
                        const output = document.createElement('canvas');
                        output.width = Math.max(1,Math.floor(rect.width*scale));
                        output.height = Math.max(1,Math.floor(rect.height*scale));
                        const ctx = output.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0,0,output.width,output.height);
                        ctx.drawImage(sourceCanvas,rect.x,rect.y,rect.width,rect.height,0,0,output.width,output.height);
                        let blob;
                        for (let quality = .9; quality >= .64; quality -= .05) {
                            blob = jpegBlob(output, quality);
                            if (!blob) throw new Error('Compression JPEG indisponible.');
                            if (blob.size <= 600 * 1024) break;
                        }
                        while (blob.size > 1024*1024) {
                            const smaller = document.createElement('canvas');
                            smaller.width = Math.max(1,Math.floor(output.width*.85));
                            smaller.height = Math.max(1,Math.floor(output.height*.85));
                            smaller.getContext('2d').drawImage(output,0,0,smaller.width,smaller.height);
                            output.width = smaller.width; output.height = smaller.height;
                            output.getContext('2d').drawImage(smaller,0,0);
                            blob = jpegBlob(output, .75);
                            if (!blob) throw new Error('Compression JPEG indisponible.');
                        }
                        const result = {id:crypto.randomUUID(), section,format:format.value,caption:query('#crop-caption').value,blob};
                        dialog.close(); resolve(result);
                    } catch (error) { query('#crop-error').textContent = error.message; }
                    finally { query('#crop-confirm').disabled = false; }
                };
                dialog.showModal();
            });
        } finally { image?.close?.(); }
    }
    function render() {
        urls.forEach((url,key) => { if(!key.startsWith('saved:')){URL.revokeObjectURL(url);urls.delete(key);} });
        document.querySelectorAll('[data-caption-fields]').forEach(container => container.replaceChildren());
        photos.forEach(photo => {
            const container = document.querySelector(`[data-caption-fields="${photo.section}"]`);
            if (!container) return;
            const figure = document.createElement('div'); figure.className = 'photo-caption-field';
            const img = document.createElement('img'); const url = URL.createObjectURL(photo.blob); urls.set(photo.id,url);
            img.src = url; img.alt = photo.caption || 'Photo en attente'; img.className = 'photo-selection-preview';
            const caption = document.createElement('input'); caption.value = photo.caption; caption.maxLength=500;
            caption.setAttribute('aria-label','Légende de la photo');
            caption.oninput = () => {photo.caption=caption.value; changed(photo.section);};
            const info = document.createElement('span'); info.textContent = `${photo.format} · ${Math.round(photo.blob.size/1024)} Ko · à synchroniser`;
            const remove = document.createElement('button'); remove.type='button'; remove.textContent='Retirer'; remove.className='button button-secondary';
            remove.onclick=()=>{photos=photos.filter(item=>item.id!==photo.id); render(); changed(photo.section);};
            figure.append(img,caption,info,remove); container.append(figure);
        });
    }
    document.querySelectorAll('[data-photo-input]').forEach(input => {
        input.addEventListener('change', () => {
            const files = Array.from(input.files || []);
            input.value='';
            processing = processing.then(async () => {
                for (const file of files) {
                    if (photos.length >= 12) throw new Error('Synchronisez les photos en attente avant d’en ajouter : 12 maximum par envoi.');
                    const result = await crop(file,Number(input.dataset.photoInput));
                    if (result) {photos.push(result); render(); changed(result.section);}
                }
            }).catch(error=>alert(`Photo : ${error.message}`));
        });
    });
    window.FoxPhotos = {
        whenReady:()=>processing,
        get:()=>photos,
        restore:async saved=>{photos=saved||[];render();},
        remove:ids=>{photos=photos.filter(photo=>!ids.has(photo.id));render();},
        getSaved:()=>savedPhotos,
        cacheReady:()=>cacheReady,
        restoreSaved:saved=>{
            savedPhotos=saved||[];
            if(!navigator.onLine || document.body.dataset.localSnapshot==='true'){
                document.querySelectorAll('.photo-grid').forEach(grid=>grid.replaceChildren());
                savedPhotos.forEach(photo=>{
                    const block=photoBlock(photo.section);
                    if(!block)return;
                    let grid=block.querySelector('.photo-grid');
                    if(!grid){grid=document.createElement('div');grid.className='photo-grid';block.append(grid);}
                    const figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption');
                    const url=URL.createObjectURL(photo.blob);urls.set(`saved:${photo.id}`,url);
                    img.src=url;img.alt=photo.caption||'Photo enregistrée';caption.textContent=photo.caption;
                    figure.append(img,caption);grid.append(figure);
                });
            }
        },
        acknowledge:sent=>{
            sent.forEach(photo=>{
                if(!savedPhotos.some(saved=>saved.id===photo.id))savedPhotos.push(photo);
                const block=photoBlock(photo.section);
                let grid=block?.querySelector('.photo-grid');
                if(block&&!grid){grid=document.createElement('div');grid.className='photo-grid';block.append(grid);}
                if(grid){
                    const figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption');
                    const url=URL.createObjectURL(photo.blob);urls.set(`saved:${photo.id}`,url);
                    img.src=url;img.alt=photo.caption||'Photo enregistrée';caption.textContent=photo.caption;figure.append(img,caption);grid.append(figure);
                }
            });
        },
    };
    if(navigator.onLine){
        Promise.all(Array.from(document.querySelectorAll('.photo-grid img')).map(async img=>{
            const response=await fetch(img.getAttribute('src'),{cache:'no-store'});
            if(!response.ok)throw new Error('Photo existante indisponible pour la reprise hors connexion.');
            const blob=await response.blob();
            if(!['image/jpeg','image/png','image/webp'].includes(blob.type)) throw new Error('Réponse photo invalide : copie hors connexion non enregistrée.');
            const section=Number(img.closest('[data-photo-section]')?.dataset.photoSection || img.closest('[data-section-panel]').dataset.sectionPanel);
            const photo={id:img.getAttribute('src'),section,format:img.dataset.photoFormat || 'original',caption:img.closest('figure').querySelector('figcaption').textContent,blob};
            savedPhotos=savedPhotos.filter(saved=>saved.id!==photo.id);
            savedPhotos.push(photo);
        })).then(()=>{cacheReady=true;document.dispatchEvent(new Event('fox-photos-cached'));}).catch(error=>{document.querySelector('#sync-state').textContent=`Erreur · ${error.message}`;});
    }
})();
