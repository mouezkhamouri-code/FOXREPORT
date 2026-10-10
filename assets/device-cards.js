(() => {
    'use strict';
    const form = document.querySelector('#report-form');
    const rows = document.querySelector('#device-rows');
    const template = document.querySelector('#device-row-template');
    const add = document.querySelector('#add-device');
    if (!form || !rows || !template || !add) return;
    const table = rows.closest('.device-table-wrap');
    const cards = document.createElement('div');
    cards.className = 'device-cards';
    table.before(cards);
    const dialog = document.createElement('dialog');
    dialog.className = 'media-dialog device-dialog';
    dialog.setAttribute('aria-labelledby', 'device-dialog-title');
    dialog.innerHTML = `<form class="device-editor">
        <h2 id="device-dialog-title">Ajouter un matériel</h2>
        <div class="device-editor-fields"></div>
        <div class="device-editor-actions">
            <button type="submit" class="button button-primary">Enregistrer le matériel</button>
            <button type="button" class="button button-secondary" data-device-cancel>Annuler</button>
            <button type="button" class="button button-secondary" data-device-delete>Supprimer</button>
        </div></form>`;
    document.body.append(dialog);
    const editor = dialog.querySelector('form');
    const fields = dialog.querySelector('.device-editor-fields');
    const save = dialog.querySelector('[type="submit"]');
    const remove = dialog.querySelector('[data-device-delete]');
    let editing = null;
    let opener = null;
    const isActive = () => window.FoxAppMode?.usesLocalReports() === true;
    const isEditable = () => !form.querySelector('fieldset')?.disabled && !form.inert;
    const control = (row, key) => row.querySelector(`[name$="[${key}]"]`);
    function refresh() {
        const active = isActive();
        table.hidden = active;
        cards.hidden = !active;
        add.classList.toggle('device-card-add', active);
        cards.replaceChildren();
        if (!active) return;
        rows.querySelectorAll('.device-row').forEach(row => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'device-summary-card';
            const category = control(row, 'category');
            const title = document.createElement('strong');
            title.textContent = category.selectedOptions[0]?.textContent || 'Matériel';
            const serial = document.createElement('span');
            serial.textContent = `S/N : ${control(row, 'serial_number').value.trim() || 'Non renseigné'}`;
            const action = document.createElement('span');
            action.className = 'device-card-action';
            action.textContent = isEditable() ? 'Modifier' : 'Consulter';
            button.append(title, serial, action);
            button.addEventListener('click', () => open(row, button));
            cards.append(button);
        });
        if (!cards.childElementCount) {
            const empty = document.createElement('p');
            empty.className = 'field-note';
            empty.textContent = 'Aucun matériel ajouté.';
            cards.append(empty);
        }
    }
    function open(row, trigger) {
        if (dialog.open) return;
        editing = row;
        opener = trigger;
        fields.replaceChildren();
        dialog.querySelector('h2').textContent = row ? 'Détails du matériel' : 'Ajouter un matériel';
        template.content.querySelectorAll('[data-device-field]').forEach(source => {
            const key = source.dataset.deviceField;
            const input = source.cloneNode(true);
            input.name = key;
            input.value = row ? control(row, key).value : source.value;
            input.disabled = !isEditable();
            const label = document.createElement('label');
            label.className = 'field';
            const caption = document.createElement('span');
            caption.textContent = source.getAttribute('aria-label');
            label.append(caption, input);
            fields.append(label);
        });
        const category = fields.querySelector('[name="category"]');
        if (!row && window.FoxDeviceCatalogue) category.value = '';
        window.FoxDeviceCatalogue?.mount(category, fields.querySelector('[name="model"]'));
        save.hidden = !isEditable();
        remove.hidden = !row || !isEditable();
        dialog.showModal();
        (fields.querySelector('.catalogue-trigger') || fields.querySelector('select'))?.focus();
    }
    function close() {
        dialog.close();
        (opener?.isConnected ? opener : add).focus();
        editing = null;
    }
    editor.addEventListener('submit', event => {
        event.preventDefault();
        if (!isEditable() || !editor.reportValidity()) return;
        if (!fields.querySelector('[name="category"]').value) {
            alert('Choisissez un type de matériel avant d’enregistrer.');
            fields.querySelector('.catalogue-trigger')?.focus();
            return;
        }
        const row = editing || window.FoxAddDevice();
        fields.querySelectorAll('[data-device-field]').forEach(input => {
            control(row, input.dataset.deviceField).value = input.value;
        });
        row.dispatchEvent(new Event('input', {bubbles: true}));
        row.dispatchEvent(new Event('change', {bubbles: true}));
        form.dispatchEvent(new Event('fox-change'));
        close();
        refresh();
    });
    dialog.querySelector('[data-device-cancel]').addEventListener('click', close);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    remove.addEventListener('click', () => {
        if (!editing || !isEditable() || !confirm('Supprimer ce matériel ?')) return;
        control(editing, 'category').closest('.device-row').querySelector('.remove-device').click();
        close();
        refresh();
    });
    window.FoxDeviceEditor = {isActive, openNew: () => open(null, add)};
    for (const event of ['input', 'change', 'fox-inventory-restored', 'fox-change']) form.addEventListener(event, refresh);
    document.addEventListener('fox-page-restored', refresh);
    refresh();
})();
