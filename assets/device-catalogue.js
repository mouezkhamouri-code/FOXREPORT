(() => {
    'use strict';
    const form = document.querySelector('#report-form');
    const field = document.querySelector('#device-catalogue');
    const template = document.querySelector('#device-row-template');
    if (!form || !field || !template) return;
    const status = document.querySelector('#device-catalogue-status');
    const user = document.body.dataset.user;
    const cacheKey = `device-catalogue:${user}`;
    let data = {types: [], models: [], brands: [], deleted_brands: []};
    let caching = Promise.resolve();
    let publishing;
    const pickers = new Set();
    const message = text => { status.textContent = text; };
    function merge(incoming) {
        if (!incoming || !Array.isArray(incoming.types) || !Array.isArray(incoming.models)) throw new Error('Catalogue matériel illisible.');
        const types = new Map(data.types.map(type => [type.category, type]));
        const models = new Map(data.models.map(model => [model.model_key, model]));
        incoming.types.forEach(type => {
            if (typeof type.category !== 'string' || typeof type.label !== 'string') throw new Error('Type de matériel illisible.');
            if (!types.has(type.category)) types.set(type.category, type);
        });
        incoming.models.forEach(model => {
            if (typeof model.model_key !== 'string' || typeof model.category !== 'string' || typeof model.name !== 'string') throw new Error('Modèle de matériel illisible.');
            if (!models.has(model.model_key)) models.set(model.model_key, model);
        });
        const deleted = new Set([...data.deleted_brands, ...(incoming.deleted_brands || [])]);
        const brands = new Map(data.brands.map(brand => [brand.brand_key, brand]));
        for (const brand of incoming.brands || []) {
            if (typeof brand.brand_key !== 'string' || typeof brand.name !== 'string') throw new Error('Marque illisible.');
            const previous = brands.get(brand.brand_key);
            if (!previous || Number(brand.revision || 0) > Number(previous.revision || 0)) brands.set(brand.brand_key, brand);
        }
        for (const key of deleted) brands.delete(key);
        if (brands.size > 1000) throw new Error('Limite de 1 000 marques atteinte.');
        if (types.size > 500 || models.size > 2000) throw new Error('Limite du catalogue atteinte (500 types, 2 000 modèles).');
        data = {
            types: [...types.values()].sort((a, b) => a.label.localeCompare(b.label, 'fr')),
            models: [...models.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr')),
            brands: [...brands.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr')),
            deleted_brands: [...deleted],
        };
    }
    function populate(select) {
        const previous = select.value;
        select.replaceChildren();
        select.add(new Option('Choisir un type', ''));
        data.types.forEach(type => select.add(new Option(type.label, type.category)));
        select.value = previous;
    }
    function update() {
        field.value = JSON.stringify(data);
        populate(template.content.querySelector('[data-device-field="category"]'));
        document.querySelectorAll('#device-rows select[name$="[category]"], #scan-category').forEach(populate);
        for (const picker of pickers) {
            if (!picker.root.isConnected) { pickers.delete(picker); continue; }
            picker.refresh();
        }
        form.dispatchEvent(new Event('fox-inventory-restored'));
    }
    async function cache() {
        if (!user || !window.FoxLocal || !window.FoxAppMode?.usesLocalReports()) return;
        const snapshot = structuredClone(data);
        caching = caching.catch(() => {}).then(async () => {
            await FoxLocal.updateTemplate(cacheKey, previous => {
                if (previous?.catalogue) merge(previous.catalogue);
                merge(snapshot);
                return {key: cacheKey, catalogue: structuredClone(data)};
            });
            update();
        });
        return caching;
    }
    async function request(options) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30000);
        try {
            const response = await fetch('index.php?api=device-catalogue', {...options, cache: 'no-store', signal: controller.signal});
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || `Catalogue refusé (${response.status}).`);
            return result;
        } finally { clearTimeout(timer); }
    }
    async function publish() {
        if (!navigator.onLine) { message('Catalogue enregistré sur cet appareil · partage à la prochaine synchronisation.'); return; }
        if (publishing) { await publishing; return publish(); }
        publishing = (async () => {
            const sessionResponse = await fetch('index.php?api=session', {cache: 'no-store'});
            const session = await sessionResponse.json();
            if (!sessionResponse.ok || session.user !== user) throw new Error('Reconnectez le même compte pour partager le catalogue.');
            const body = new FormData();
            body.set('csrf_token', session.csrf);
            body.set('device_catalogue', JSON.stringify(data));
            merge(await request({method: 'POST', body}));
            update();
            await cache();
            message('Catalogue partagé à jour.');
        })();
        try { await publishing; }
        finally { publishing = null; }
    }
    async function hash(text) {
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    }
    async function addEntry(kind, name, category) {
        name = name.trim();
        const max = kind === 'model' ? 160 : 120;
        if (!name || new TextEncoder().encode(name).length > max) throw new Error(`Indiquez un nom de ${max} octets maximum.`);
        if (kind === 'brand') {
            const key = await hash(name.toLowerCase());
            if (data.deleted_brands.includes(key)) throw new Error('Cette marque a été supprimée. Choisissez une référence valide.');
            const existing = data.brands.find(brand => brand.brand_key === key);
            if (existing?.archived) throw new Error('Cette marque est archivée. Réactivez-la dans « Gérer les marques ».');
            if (existing) return existing.name;
            merge({types: [], models: [], brands: [{brand_key: key, name, archived: 0, revision: 0}]});
            update(); await cache();
            form.dispatchEvent(new Event('fox-change'));
            return name;
        }
        if (kind === 'type') {
            const existing = data.types.find(type => type.label.toLowerCase() === name.toLowerCase());
            if (existing) return existing.category;
            const key = `custom_${(await hash(name.toLowerCase())).slice(0, 32)}`;
            merge({types: [{category: key, label: name}], models: []});
            update(); await cache();
            form.dispatchEvent(new Event('fox-change'));
            return key;
        }
        if (!data.types.some(type => type.category === category)) throw new Error('Choisissez d’abord un type de matériel.');
        const key = await hash(`${category}\n${name.toLowerCase()}`);
        merge({types: [], models: [{model_key: key, category, name}]});
        update(); await cache();
        form.dispatchEvent(new Event('fox-change'));
        return data.models.find(model => model.model_key === key).name;
    }
    function mount(category, model, brand) {
        const components = [];
        for (const [kind, control] of [['type', category], ['model', model], ['brand', brand]]) {
            if (!control) continue;
            control.hidden = true;
            const root = document.createElement('div');
            root.className = 'catalogue-picker';
            root.innerHTML = `<button type="button" class="catalogue-trigger" aria-expanded="false"></button>
                <div class="catalogue-options" hidden>
                    <input class="catalogue-search" type="search" placeholder="Rechercher…" aria-label="Rechercher">
                    <div class="catalogue-results"></div>
                    <button type="button" class="button button-secondary catalogue-new"></button>
                    ${kind === 'brand' ? '<a class="button button-secondary catalogue-manage" href="device-brands.php" target="_blank" rel="noopener">Gérer les marques</a>' : ''}
                    <div class="catalogue-create" hidden><input type="text" aria-label="Nouveau nom">
                        <button type="button" class="button button-primary">Ajouter</button></div>
                    <p class="catalogue-error" role="alert"></p>
                </div>`;
            control.after(root);
            const trigger = root.querySelector('.catalogue-trigger');
            const panel = root.querySelector('.catalogue-options');
            const search = root.querySelector('.catalogue-search');
            const results = root.querySelector('.catalogue-results');
            const create = root.querySelector('.catalogue-create');
            const name = create.querySelector('input');
            name.maxLength = kind === 'model' ? 160 : 120;
            const error = root.querySelector('.catalogue-error');
            const newButton = root.querySelector('.catalogue-new');
            newButton.textContent = kind === 'type' ? '+ Nouveau type de matériel' : kind === 'brand' ? '+ Nouvelle marque' : '+ Nouveau modèle pour ce type';
            const options = () => kind === 'type'
                ? data.types.map(type => ({value: type.category, label: type.label}))
                : kind === 'brand' ? data.brands.filter(item => !item.archived).map(item => ({value: item.name, label: item.name}))
                : data.models.filter(item => item.category === category.value).map(item => ({value: item.name, label: item.name}));
            function toggle(open) {
                panel.hidden = !open;
                trigger.setAttribute('aria-expanded', String(open));
                if (open) { search.value = ''; render(); search.focus(); }
                else trigger.focus();
            }
            function select(value) {
                const changed = control.value !== value;
                control.value = value;
                if (kind === 'type' && changed) { model.value = ''; model.dispatchEvent(new Event('change', {bubbles: true})); }
                control.dispatchEvent(new Event('change', {bubbles: true}));
                refresh();
                toggle(false);
            }
            function render() {
                results.replaceChildren();
                const choices = options();
                if (kind !== 'type') choices.unshift({value: '', label: kind === 'brand' ? 'Sans marque' : 'Sans modèle'});
                choices.filter(item => item.label.toLowerCase().includes(search.value.toLowerCase())).forEach(item => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'catalogue-option';
                    button.textContent = item.label;
                    button.addEventListener('click', () => select(item.value));
                    results.append(button);
                });
                if (!results.childElementCount) {
                    const empty = document.createElement('p');
                    empty.textContent = 'Aucun résultat. Vous pouvez ajouter une référence.';
                    results.append(empty);
                }
            }
            function refresh() {
                if (kind === 'type') populate(control);
                trigger.disabled = control.disabled;
                trigger.textContent = (kind === 'type' ? data.types.find(item => item.category === control.value)?.label : control.value)
                    || (kind === 'type' ? 'Choisir un type de matériel' : kind === 'brand' ? 'Choisir une marque' : 'Choisir un modèle');
                trigger.setAttribute('aria-label', `${kind === 'type' ? 'Type de matériel' : kind === 'brand' ? 'Marque' : 'Modèle'} : ${trigger.textContent}`);
                render();
            }
            trigger.addEventListener('click', () => toggle(panel.hidden));
            search.addEventListener('input', render);
            root.addEventListener('keydown', event => {
                if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); event.stopPropagation(); toggle(false); }
                if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault();
            });
            newButton.addEventListener('click', () => { create.hidden = false; name.value = ''; error.textContent = ''; name.focus(); });
            create.querySelector('button').addEventListener('click', async event => {
                event.target.disabled = true;
                error.textContent = '';
                try {
                    const selectedCategory = category.value;
                    const value = await addEntry(kind, name.value, selectedCategory);
                    if (kind === 'model' && category.value !== selectedCategory) throw new Error('Le type a changé. Choisissez le modèle dans son type d’origine.');
                    select(value);
                    create.hidden = true;
                    await publish();
                } catch (failure) {
                    error.textContent = failure.message;
                    message(`Catalogue : ${failure.message} Les données locales sont conservées.`);
                } finally { event.target.disabled = false; }
            });
            control.addEventListener('change', refresh);
            const picker = {root, refresh};
            pickers.add(picker);
            components.push(picker);
            refresh();
        }
        category.addEventListener('change', () => components[1].refresh());
    }
    function decorateRows() {
        if (window.FoxAppMode?.usesLocalReports()) return;
        document.querySelectorAll('#device-rows .device-row').forEach(row => {
            if (row.dataset.cataloguePicker) return;
            row.dataset.cataloguePicker = 'true';
            mount(row.querySelector('[name$="[category]"]'), row.querySelector('[name$="[model]"]'), row.querySelector('[name$="[brand]"]'));
        });
    }
    async function restore() {
        merge(JSON.parse(field.value));
        update();
        await cache();
    }
    window.FoxDeviceCatalogue = {mount, populate, ready: null};
    window.FoxDeviceCatalogue.ready = (async () => {
        merge({types: [...template.content.querySelector('[data-device-field="category"]').options].map(option => ({category: option.value, label: option.textContent})), models: []});
        await restore();
        decorateRows();
        if (navigator.onLine) {
            merge(await request());
            update(); await cache();
            await publish();
        }
    })().catch(error => { message(`Catalogue : ${error.message} Les données locales sont conservées.`); throw error; });
    // The editor can still use its embedded catalogue if the shared catalogue is temporarily unavailable.
    window.FoxDeviceCatalogue.ready.catch(() => {});
    form.addEventListener('fox-sections-restored', () => restore().catch(error => message(`Catalogue : ${error.message}`)));
    form.addEventListener('fox-inventory-restored', decorateRows);
    form.addEventListener('fox-change', decorateRows);
    window.addEventListener('focus', () => { if (navigator.onLine) request().then(incoming => { merge(incoming); update(); return cache(); }).catch(error => message(`Catalogue : ${error.message}`)); });
    window.addEventListener('online', () => publish().catch(error => message(`Partage du catalogue : ${error.message}`)));
})();
