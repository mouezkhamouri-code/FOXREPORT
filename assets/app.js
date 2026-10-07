(() => {
    'use strict';

    const form = document.querySelector('#report-form');
    if (!form) return;

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
        const panel = event.target.closest('[data-section-panel]');
        if (!panel || event.target.type === 'file') return;
        const number = Number(panel.dataset.sectionPanel);
        invalidateSections(number === 3 ? [3,5,6,7,8,9] : [number]);
    }
    form.addEventListener('input', invalidatePanel);
    form.addEventListener('change', invalidatePanel);
    form.addEventListener('fox-section-edit', event => {
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
