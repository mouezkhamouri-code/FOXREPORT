(() => {
    'use strict';
    if (window.FoxAppMode.usesLocalReports()) return;
    const form = document.querySelector('#report-form');
    if (!form || form.querySelector('fieldset')?.disabled) return;
    const state = document.querySelector('#sync-state');
    let changed = false;
    let submitting = false;
    let preparing = false;
    const signature = () => JSON.stringify({
        fields: [...new FormData(form).entries()].filter(([name, value]) => !['active_section', 'device_catalogue'].includes(name) && typeof value === 'string'),
        photos: (window.FoxPhotos?.get() || []).map(photo => [photo.id, photo.caption, photo.format]),
    });
    const initialSignature = signature();
    const edited = () => {
        changed = signature() !== initialSignature;
        if (state) state.textContent = changed
            ? 'Modifications non enregistrées · cliquez sur Enregistrer le brouillon'
            : 'Enregistré sur le serveur';
    };
    for (const event of ['input', 'change', 'fox-change']) form.addEventListener(event, edited);
    form.addEventListener('formdata', event => {
        // Cleared camera/gallery inputs would shift the upload metadata indexes.
        for (const name of [...event.formData.keys()]) {
            if (['photos_', 'captions_', 'formats_', 'photo_uids_'].some(prefix => name.startsWith(prefix))) {
                event.formData.delete(name);
            }
        }
        for (const photo of window.FoxPhotos?.get() || []) {
            event.formData.append(`photos_${photo.section}[]`, photo.blob, 'photo.jpg');
            event.formData.append(`captions_${photo.section}[]`, photo.caption);
            event.formData.append(`formats_${photo.section}[]`, photo.format || 'original');
            event.formData.append(`photo_uids_${photo.section}[]`, photo.id);
        }
    });
    form.addEventListener('submit', async event => {
        if (submitting) return;
        event.preventDefault();
        if (preparing) return;
        preparing = true;
        try {
            await window.FoxPhotos?.whenReady();
            // Native submission cannot be restarted inside the initial submit dispatch.
            await new Promise(resolve => setTimeout(resolve, 0));
            submitting = true;
            form.requestSubmit(event.submitter || undefined);
            // Validation can prevent the second submit event from firing.
            if (!form.checkValidity()) submitting = false;
        } catch (error) {
            submitting = false;
            if (state) state.textContent = `Erreur · ${error.message}`;
        } finally { preparing = false; }
    });
    window.addEventListener('beforeunload', event => {
        if (changed && !submitting) {
            event.preventDefault();
            event.returnValue = '';
        }
    });
    window.FoxBeforePreview = async () => {
        await window.FoxPhotos?.whenReady();
        if (signature() !== initialSignature) {
            throw new Error('Enregistrez le brouillon avant de prévisualiser : le PDF doit reprendre vos dernières modifications.');
        }
    };
    window.FoxBeforeUpdate = async () => {
        await window.FoxPhotos?.whenReady();
        if (changed) throw new Error('Enregistrez vos modifications sur le serveur avant la mise à jour.');
    };
})();
