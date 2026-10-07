(async () => {
    if (document.body.dataset.loggedOut !== 'true') return;
    try {
        const user=localStorage.getItem('foxreport-user');
        let pending=false;
        for(const record of await FoxLocal.all()) {
            if(record.user!==user) continue;
            if(record.conflictResolved) continue;
            if(record.dirty || record.operation) pending=true;
            else await FoxLocal.remove(record.key);
        }
        if(user) await FoxLocal.removeTemplate(user);
        localStorage.removeItem('foxreport-user');
        if(pending) {
            const message=document.createElement('p');message.setAttribute('role','alert');
            message.textContent='Des saisies non synchronisées ont été conservées sur cet appareil. Reconnectez le même compte Google pour les reprendre.';
            document.querySelector('main').append(message);
        }
    } catch (error) {
        const message = document.createElement('p');
        message.setAttribute('role', 'alert');
        message.textContent = `Suppression locale incomplète : ${error.message}`;
        document.querySelector('main').append(message);
    }
})();
