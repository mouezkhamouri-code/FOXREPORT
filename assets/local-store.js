(() => {
    'use strict';
    let database;
    function getDatabase() {
        if (database) return database;
        database = new Promise((resolve, reject) => {
            const request = indexedDB.open('foxreport-local', 3);
            request.onupgradeneeded = () => {
                if (!request.result.objectStoreNames.contains('reports')) request.result.createObjectStore('reports', {keyPath: 'key'});
                if (!request.result.objectStoreNames.contains('templates')) request.result.createObjectStore('templates', {keyPath: 'key'});
                if (!request.result.objectStoreNames.contains('syncLogs')) {
                    const store = request.result.createObjectStore('syncLogs', {keyPath: 'id', autoIncrement: true});
                    store.createIndex('user_timestamp', ['user', 'timestamp']);
                }
            };
            request.onerror = () => reject(request.error);
            request.onblocked = () => reject(new Error('La base locale est verrouillée par un autre onglet. Fermez les autres fenêtres FoxReport puis réessayez.'));
            request.onsuccess = () => {
                request.result.onversionchange = () => request.result.close();
                resolve(request.result);
            };
        });
        return database;
    }
    async function transaction(mode, operation, name = 'reports') {
        const db = await getDatabase();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(name, mode);
            const request = operation(tx.objectStore(name));
            let result;
            request.onsuccess = () => { result = request.result; };
            tx.oncomplete = () => {
                resolve(result);
                if (mode==='readwrite' && name==='reports') document.dispatchEvent(new Event('fox-local-change'));
            };
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('Stockage local interrompu.'));
        });
    }
    window.FoxLocal = {
        get: key => transaction('readonly', store => store.get(key)),
        put: report => transaction('readwrite', store => store.put(report)),
        remove: key => transaction('readwrite', store => store.delete(key)),
        all: () => transaction('readonly', store => store.getAll()),
        getTemplate: key => transaction('readonly', store => store.get(key), 'templates'),
        putTemplate: template => transaction('readwrite', store => store.put(template), 'templates'),
        removeTemplate: key => transaction('readwrite', store => store.delete(key), 'templates'),
        addSyncLog: entry => transaction('readwrite', store => store.add(entry), 'syncLogs'),
        syncLogs: user => transaction('readonly', store => store.getAll(), 'syncLogs')
            .then(entries => entries.filter(entry => entry.user === user).sort((a, b) => b.timestamp - a.timestamp).slice(0, 15)),
        updateTemplate: (key, operation) => window.FoxLocal.update(key, operation, 'templates'),
        async resolveConflict(key, copyKey, verify) {
            const db=await getDatabase();
            return new Promise((resolve,reject)=>{
                const tx=db.transaction('reports','readwrite'),store=tx.objectStore('reports');
                const sourceRequest=store.get(key),copyRequest=store.get(copyKey);
                let reads=0;
                const finish=()=>{
                    if (++reads!==2) return;
                    try {
                        const records=verify(sourceRequest.result,copyRequest.result);
                        store.put(records.source);store.put(records.copy);
                    } catch(error) { tx.abort();reject(error); }
                };
                sourceRequest.onsuccess=finish;copyRequest.onsuccess=finish;
                tx.oncomplete=()=>{resolve();document.dispatchEvent(new Event('fox-local-change'));};
                tx.onerror=()=>reject(tx.error);
                tx.onabort=()=>reject(tx.error || new Error('Archivage local interrompu : conflit original conservé.'));
            });
        },
        async update(key, operation, name = 'reports') {
            const db = await getDatabase();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(name, 'readwrite');
                const store = tx.objectStore(name);
                const request = store.get(key);
                let result;
                request.onsuccess = () => {
                    try {
                        result = operation(request.result);
                        if (result) store.put(result);
                    } catch (error) { tx.abort(); reject(error); }
                };
                tx.oncomplete = () => { resolve(result); if (name === 'reports') document.dispatchEvent(new Event('fox-local-change')); };
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error || new Error('Mise à jour locale interrompue.'));
            });
        },
    };
})();
