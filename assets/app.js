(() => {
    'use strict';

    const form = document.querySelector('#report-form');
    if (!form) return;

    function updateEmptyFields() {
        document.querySelectorAll('.report-form .field input, .report-form .field textarea, .report-form .field select, .report-form .device-table input, .report-form .device-table select').forEach(control => {
            const editable = !control.readOnly && !['hidden', 'checkbox', 'radio', 'file', 'button', 'submit'].includes(control.type);
            control.classList.toggle('is-empty', editable && control.value.trim() === '');
        });
    }
    updateEmptyFields();

    const dateInput = document.querySelector('[name="report_date"]');
    const dayNumber = document.querySelector('#report-day-number');
    function updateDayNumber() {
        if (!dateInput || !dayNumber) return;
        dayNumber.value = '';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput.value)) return;
        const date = new Date(`${dateInput.value}T00:00:00Z`);
        if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== dateInput.value) return;
        const start = new Date(date);
        start.setUTCMonth(0, 1);
        dayNumber.value = String(Math.floor((date - start) / 86400000) + 1);
    }
    dateInput?.addEventListener('input', updateDayNumber);
    dateInput?.addEventListener('change', updateDayNumber);
    updateDayNumber();

    const orderDate = document.querySelector('[name="order_date"]');
    const orderDateCopy = document.querySelector('#organisation-order-date');
    function updateOrderDate() {
        if (orderDate && orderDateCopy) orderDateCopy.value = orderDate.value;
    }
    orderDate?.addEventListener('input', updateOrderDate);
    orderDate?.addEventListener('change', updateOrderDate);
    updateOrderDate();

    const followupField = document.querySelector('#intervention-followup');
    const followupRows = document.querySelector('#followup-rows');
    const followupMessage = document.querySelector('#followup-message');
    const addFollowup = document.querySelector('#add-followup');
    let followup = [];
    let followupDialog;
    let followupEditor;
    let editingFollowup = null;
    if (followupField) {
        followupDialog=document.createElement('dialog');
        followupDialog.id='followup-dialog';
        followupDialog.className='media-dialog followup-dialog';
        followupDialog.setAttribute('aria-labelledby','followup-dialog-title');
        followupDialog.innerHTML=`<form id="followup-editor">
            <h2 id="followup-dialog-title">Suivi intervention</h2>
            <label class="field field-floating field-native"><input type="date" name="date" required><span class="field-title">Date du suivi</span></label>
            <label class="field field-floating"><textarea name="comment" placeholder=" " maxlength="4000" required rows="5"></textarea><span class="field-title">Commentaire</span></label>
            <p id="followup-editor-error" role="alert"></p>
            <div class="followup-dialog-actions">
                <button type="submit" class="button button-primary">Enregistrer</button>
                <button type="button" class="button button-secondary" id="followup-cancel">Annuler</button>
                <button type="button" class="button button-secondary" id="followup-delete">Supprimer</button>
            </div></form>`;
        document.body.append(followupDialog);
        followupEditor=followupDialog.querySelector('#followup-editor');
        followupEditor.addEventListener('submit',event=>{
            event.preventDefault();
            const date=followupEditor.elements.date;
            const comment=followupEditor.elements.comment;
            if (!followupEditor.reportValidity()) return;
            if (comment.value.trim()==='') {
                followupDialog.querySelector('#followup-editor-error').textContent='Indiquez un commentaire.';
                comment.focus();return;
            }
            const row={date:date.value,comment:comment.value.trim()};
            if (editingFollowup===null) followup.push(row);
            else followup[editingFollowup]=row;
            followupDialog.close();renderFollowup();writeFollowup();
        });
        followupDialog.querySelector('#followup-cancel').onclick=()=>followupDialog.close();
        followupDialog.querySelector('#followup-delete').onclick=()=>{
            if (editingFollowup===null || !confirm('Supprimer cette ligne de suivi ?')) return;
            followup.splice(editingFollowup,1);
            followupDialog.close();renderFollowup();writeFollowup();
        };
    }
    function openFollowup(index=null) {
        editingFollowup=index;
        const row=index===null ? {date:'',comment:''} : followup[index];
        followupEditor.elements.date.value=row.date;
        followupEditor.elements.comment.value=row.comment;
        followupDialog.querySelector('#followup-dialog-title').textContent=index===null?'Ajouter un suivi':'Modifier le suivi';
        followupDialog.querySelector('#followup-editor-error').textContent='';
        followupDialog.querySelector('#followup-delete').hidden=index===null;
        followupDialog.showModal();
        followupEditor.elements.date.focus();
    }
    function writeFollowup() {
        followupField.value = JSON.stringify(followup);
        form.dispatchEvent(new CustomEvent('fox-section-edit', {detail:{sections:[13]}}));
    }
    function renderFollowup() {
        if (!followupField || !followupRows) return;
        followupRows.replaceChildren();
        const editable = !!addFollowup && !form.querySelector('fieldset')?.disabled;
        followup.forEach((row,index)=>{
            const wrapper = document.createElement('div');
            wrapper.className = 'followup-row';
            const date=document.createElement('time');
            date.dateTime=row.date;date.textContent=row.date.split('-').reverse().join('/');
            const comment=document.createElement('p');
            comment.className='followup-comment';comment.textContent=row.comment;
            wrapper.append(date,comment);
            if (editable) {
                const edit=document.createElement('button');
                edit.type='button';edit.className='button button-secondary';edit.textContent='Modifier';
                edit.setAttribute('aria-label',`Modifier le suivi du ${date.textContent}`);
                edit.onclick=()=>openFollowup(index);
                wrapper.append(edit);
            }
            followupRows.append(wrapper);
        });
        updateEmptyFields();
    }
    function restoreFollowup() {
        if (!followupField) return;
        try {
            const rows=JSON.parse(followupField.value || '[]');
            if (!Array.isArray(rows) || rows.some(row=>!row || typeof row.date!=='string' || typeof row.comment!=='string')) throw new Error('Format du suivi invalide.');
            followup=rows;
            if (followupMessage) followupMessage.textContent='';
            renderFollowup();
        } catch (error) {
            if (followupMessage) followupMessage.textContent=`Suivi intervention : ${error.message}`;
            if (addFollowup) addFollowup.disabled=true;
        }
    }
    restoreFollowup();
    addFollowup?.addEventListener('click',()=>{
        if (followup.length>=100) { followupMessage.textContent='Le suivi accepte au maximum 100 lignes.';return; }
        openFollowup();
    });

    const tabs = Array.from(document.querySelectorAll('[data-section-tab]'));
    const panels = Array.from(document.querySelectorAll('[data-section-panel]'));
    const activeSectionField = document.querySelector('#active-section');
    const requestedSection = Number(activeSectionField?.value || 1);
    const accordions = Array.from(document.querySelectorAll('[data-section-accordion]'));
    const sectionOrder = (accordions.length ? accordions : panels).map(panel=>Number(panel.dataset.sectionAccordion || panel.dataset.sectionPanel));
    accordions.forEach((accordion,index)=>{
        const number=accordion.querySelector('.section-index');
        if (number) number.textContent=String(index+1).padStart(2,'0');
    });
    const completedField = form.elements.completed_sections;
    function invalidateSections(numbers) {
        if (!completedField) return;
        const completed = JSON.parse(completedField.value || '[]');
        const remaining = completed.filter(number => !numbers.includes(number));
        if (remaining.length === completed.length) return;
        completedField.value = JSON.stringify(remaining);
        updateSectionStates();
    }
    function invalidatePanel(event) {
        updateEmptyFields();
        const panel = event.target.closest('[data-section-panel]');
        if (!panel || event.target.type === 'file') return;
        const number = Number(panel.dataset.sectionPanel);
        invalidateSections(event.target.name==='order_date' ? [1,13] : number === 3 ? [3,5,6,7,8,9] : [number]);
    }
    form.addEventListener('input', invalidatePanel);
    form.addEventListener('change', invalidatePanel);
    form.addEventListener('fox-section-edit', event => {
        updateEmptyFields();
        invalidateSections(event.detail.sections);
        form.dispatchEvent(new Event('fox-change'));
    });

    function updateSectionStates() {
        if (!completedField) return;
        const completed = JSON.parse(completedField.value || '[]');
        accordions.forEach(accordion => {
            const number = Number(accordion.dataset.sectionAccordion);
            const done = completed.includes(number);
            accordion.classList.toggle('is-complete', done);
            accordion.querySelector('.section-state').textContent = done ? '✓ Terminée' : 'À compléter';
            const button = accordion.querySelector('[data-complete-section]');
            if (button) {
                button.textContent = done ? 'Marquer à reprendre' : 'Section terminée';
                button.setAttribute('aria-pressed', String(done));
            }
        });
        const progress = document.querySelector('#step-progress');
        if (progress) progress.textContent = `Section ${sectionOrder.indexOf(Number(activeSectionField.value))+1}/${sectionOrder.length} · ${completed.length}/${sectionOrder.length} terminées`;
    }

    function showSection(sectionNumber) {
        const section = sectionOrder.includes(Number(sectionNumber)) ? Number(sectionNumber) : sectionOrder[0];
        if (accordions.length) {
            accordions.forEach(accordion => { accordion.open = Number(accordion.dataset.sectionAccordion) === section; });
        } else {
            panels.forEach(panel => { panel.hidden = Number(panel.dataset.sectionPanel) !== section; });
        }
        tabs.forEach((tab) => {
            if (Number(tab.dataset.sectionTab) === section) {
                tab.setAttribute('aria-current', 'step');
                tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            } else {
                tab.removeAttribute('aria-current');
            }
        });
        if (activeSectionField) activeSectionField.value = String(section);
        const previous = document.querySelector('#previous-step');
        const next = document.querySelector('#next-step');
        if (previous) previous.disabled = section === sectionOrder[0];
        if (next) next.disabled = section === sectionOrder[sectionOrder.length-1];
        const progress = document.querySelector('#step-progress');
        if (progress) progress.textContent = `Étape ${sectionOrder.indexOf(section)+1}/${sectionOrder.length}`;
        updateSectionStates();
    }

    accordions.forEach(accordion => {
        accordion.addEventListener('toggle', () => {
            if (!accordion.open) return;
            activeSectionField.value = accordion.dataset.sectionAccordion;
            const section = Number(activeSectionField.value);
            document.querySelector('#previous-step').disabled = section === sectionOrder[0];
            document.querySelector('#next-step').disabled = section === sectionOrder[sectionOrder.length-1];
            updateSectionStates();
            form.dispatchEvent(new Event('fox-change'));
        });
    });
    form.addEventListener('click', event => {
        const button = event.target.closest('[data-complete-section]');
        if (!button || !completedField) return;
        const number = Number(button.dataset.completeSection);
        const completed = new Set(JSON.parse(completedField.value || '[]'));
        const wasComplete = completed.has(number);
        if (wasComplete) completed.delete(number);
        else completed.add(number);
        completedField.value = JSON.stringify([...completed].sort((a,b) => a-b));
        updateSectionStates();
        if (!wasComplete) button.closest('[data-section-accordion]').open = false;
        form.dispatchEvent(new Event('fox-change'));
    });
    form.addEventListener('fox-sections-restored', () => {
        updateDayNumber();
        updateOrderDate();
        restoreFollowup();
        updateEmptyFields();
        showSection(activeSectionField.value);
        if (JSON.parse(completedField?.value || '[]').includes(Number(activeSectionField.value))) {
            const accordion = accordions.find(item => item.dataset.sectionAccordion === activeSectionField.value);
            if (accordion) accordion.open = false;
        }
    });
    tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            showSection(tab.dataset.sectionTab);
            form.dispatchEvent(new Event('fox-change'));
        });
    });
    showSection(requestedSection);
    if (JSON.parse(completedField?.value || '[]').includes(requestedSection)) {
        const accordion = accordions.find(item => Number(item.dataset.sectionAccordion) === requestedSection);
        if (accordion) accordion.open = false;
    }
    document.querySelector('#previous-step')?.addEventListener('click', () => {
        showSection(sectionOrder[Math.max(0,sectionOrder.indexOf(Number(activeSectionField.value))-1)]);
        form.dispatchEvent(new Event('fox-change'));
    });
    document.querySelector('#next-step')?.addEventListener('click', () => {
        showSection(sectionOrder[Math.min(sectionOrder.length-1,sectionOrder.indexOf(Number(activeSectionField.value))+1)]);
        form.dispatchEvent(new Event('fox-change'));
    });

    const deviceRows = document.querySelector('#device-rows');
    const rowTemplate = document.querySelector('#device-row-template');
    const addDeviceButton = document.querySelector('#add-device');
    const inventorySummary = document.querySelector('[data-inventory-summary]');
    const deviceLabels = new Map();
    if (rowTemplate) {
        rowTemplate.content.querySelectorAll('select[data-device-field] option').forEach((option) => {
            if (option.value) deviceLabels.set(option.value, option.textContent);
        });
    }

    function updateDevices() {
        updateEmptyFields();
        if (!deviceRows) return;
        const counts = new Map();
        deviceRows.querySelectorAll('.device-row select[name$="[category]"]').forEach((select) => {
            if (select.value) counts.set(select.value, (counts.get(select.value) || 0) + 1);
        });
        if (inventorySummary) {
            inventorySummary.replaceChildren();
            counts.forEach((count, category) => {
                const chip = document.createElement('span');
                chip.className = 'inventory-chip';
                chip.textContent = `${deviceLabels.get(category) || category} · ${count}`;
                inventorySummary.append(chip);
            });
            if (counts.size === 0) {
                const hint = document.createElement('span');
                hint.className = 'field-note';
                hint.textContent = 'Aucun appareil renseigné pour le moment.';
                inventorySummary.append(hint);
            }
        }
        document.querySelectorAll('[data-related-categories]').forEach((container) => {
            container.replaceChildren();
            const categories = container.dataset.relatedCategories.split(',');
            deviceRows.querySelectorAll('.device-row').forEach((row) => {
                const categorySelect = row.querySelector('select[name$="[category]"]');
                if (!categorySelect || !categories.includes(categorySelect.value)) return;
                const inputs = row.querySelectorAll('input');
                const card = document.createElement('article');
                card.className = 'asset-card';
                const title = document.createElement('strong');
                title.textContent = deviceLabels.get(categorySelect.value) || categorySelect.value;
                card.append(title);
                const fieldNames = ['brand', 'model', 'serial_number', 'mac_address', 'location', 'state', 'comment'];
                const labels = ['Marque', 'Modèle', 'N° série', 'MAC', 'Emplacement', 'État', 'Commentaire'];
                fieldNames.forEach((field, index) => {
                    const control = row.querySelector(`[name$="[${field}]"]`);
                    const value = control?.value || (field === 'state' ? control?.selectedOptions[0]?.textContent : '');
                    if (!value) return;
                    const detail = document.createElement('p');
                    detail.textContent = `${labels[index]} : ${value}`;
                    card.append(detail);
                });
                container.append(card);
            });
            if (!container.childElementCount) {
                const empty = document.createElement('p');
                empty.className = 'field-note';
                empty.textContent = 'Aucun appareil de cette catégorie dans l’inventaire.';
                container.append(empty);
            }
        });
    }

    if (deviceRows && rowTemplate && addDeviceButton) {
        const assignNames = (row, index) => {
            row.querySelectorAll('[data-device-field]').forEach((field) => {
                field.name = `devices[${index}][${field.dataset.deviceField}]`;
            });
        };
        addDeviceButton.addEventListener('click', () => {
            const row = rowTemplate.content.firstElementChild.cloneNode(true);
            const indexes = Array.from(deviceRows.querySelectorAll('.device-row')).map((existingRow) => {
                const namedField = existingRow.querySelector('[name^="devices["]');
                const match = namedField?.name.match(/^devices\[(\d+)]/);
                return match ? Number(match[1]) : -1;
            });
            assignNames(row, Math.max(-1, ...indexes) + 1);
            deviceRows.append(row);
            updateDevices();
            invalidateSections([3,5,6,7,8,9]);
            row.querySelector('select')?.focus();
            form.dispatchEvent(new Event('fox-change'));
        });
        deviceRows.addEventListener('click', (event) => {
            const removeButton = event.target.closest('.remove-device');
            if (!removeButton) return;
            removeButton.closest('.device-row')?.remove();
            updateDevices();
            invalidateSections([3,5,6,7,8,9]);
            form.dispatchEvent(new Event('fox-change'));
        });
        deviceRows.addEventListener('input', updateDevices);
        deviceRows.addEventListener('change', updateDevices);
        form.addEventListener('fox-inventory-restored', updateDevices);
        updateDevices();
    }

    form.addEventListener('invalid', (event) => {
        const panel = event.target.closest('[data-section-panel]');
        if (panel) showSection(panel.dataset.sectionPanel);
    }, true);
})();
