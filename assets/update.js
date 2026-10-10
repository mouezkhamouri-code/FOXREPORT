(() => {
    'use strict';
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    let registration;
    let controllerChanged=false;
    let hadController=!!navigator.serviceWorker.controller;
    let reloading=false;
    let latest='';
    const current=()=>document.body.dataset.appVersion || 'inconnue';
    const versionLabel=document.querySelector('[data-version-label]');
    if (versionLabel) versionLabel.textContent=`Version ${document.body.dataset.releaseVersion || 'inconnue'}`;
    function render(message) {
        const container=document.querySelector('[data-update-container]');
        if (!container) return;
        container.replaceChildren();
        const version=document.createElement('p');
        version.className='app-version';version.textContent=`Version ${current().replace('foxreport-shell-','')}`;
        const status=document.createElement('p');status.setAttribute('role','status');status.id='update-status';
        status.textContent=message || (registration?.waiting?'Nouvelle version prête. Vos données locales seront conservées.':'');
        const button=document.createElement('button');
        button.type='button';button.className='button button-secondary';button.id='update-app';
        button.textContent=registration?.waiting || controllerChanged?'Mettre à jour':'Vérifier les mises à jour';
        container.append(version,status,button);
    }
    async function preserve() {
        if (document.querySelector('dialog[open]')) throw new Error('Terminez ou annulez la photo/le scan avant la mise à jour.');
        if (document.querySelector('#report-form')) {
            if (!window.FoxBeforeUpdate) throw new Error('Attendez la préparation du brouillon avant la mise à jour.');
            await window.FoxBeforeUpdate();
        }
    }
    async function reloadSafely() {
        if(reloading)return;
        try {
            await preserve();
            reloading=true;
            location.reload();
        } catch(error) { render(`Mise à jour différée : ${error.message}`); }
    }
    async function check() {
        if(!navigator.onLine) { render('Hors ligne : version actuelle conservée. Vérification au retour du réseau.');return; }
        try {
            registration=await navigator.serviceWorker.getRegistration();
            if(!registration) throw new Error('Le service worker n’est pas prêt. Attendez la préparation hors ligne.');
            await registration.update();
            const response=await fetch('version.json',{cache:'no-store'});
            if(!response.ok) throw new Error(`Version de déploiement indisponible (${response.status}).`);
            const result=await response.json();
            if(typeof result.version!=='string' || !/^foxreport-shell-[a-f0-9]{16}$/.test(result.version)) {
                throw new Error('Version de déploiement invalide : exécutez npm run build et déployez version.json.');
            }
            latest=result.version;
            render(registration.waiting?'Nouvelle version prête.':latest===current()?'Vous utilisez la dernière version.':'Nouvelle version détectée ; téléchargement de l’interface en cours.');
        } catch(error) { render(`Vérification impossible : ${error.message}`); }
    }
    document.addEventListener('click',async event=>{
        if(!event.target.closest('#update-app'))return;
        if(controllerChanged) { await reloadSafely();return; }
        if(!registration?.waiting) { await check(); }
        if(registration?.waiting) {
            try {
                await preserve();
                render('Activation de la nouvelle version…');
                registration.waiting.postMessage({type:'FOXREPORT_ACTIVATE_UPDATE'});
            } catch(error) { render(`Mise à jour différée : ${error.message}`); }
        }
    });
    navigator.serviceWorker.addEventListener('controllerchange',()=>{
        if(!hadController) { hadController=true;return; }
        controllerChanged=true;
        reloadSafely();
    });
    document.addEventListener('fox-page-restored',()=>render());
    window.addEventListener('online',check);
    window.addEventListener('pageshow',check);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();});
    navigator.serviceWorker.ready.then(reg=>{
        registration=reg;
        reg.addEventListener('updatefound',()=>{
            const worker=reg.installing;
            worker?.addEventListener('statechange',()=>{
                if(worker.state==='installed' && navigator.serviceWorker.controller) render('Nouvelle version prête. Cliquez sur « Mettre à jour ».');
                if(worker.state==='redundant') render('Téléchargement de mise à jour interrompu ; version actuelle conservée. Réessayez en ligne.');
            });
        });
        render();
        check();
    }).catch(error=>render(`Mise à jour indisponible : ${error.message}`));
    render();
})();
