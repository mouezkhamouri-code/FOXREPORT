((root, factory) => {
    const parse = factory();
    if (typeof module === 'object' && module.exports) module.exports = parse;
    else root.FoxParseScan = parse;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
    'use strict';
    const aliases = {
        brand:'brand', marque:'brand', manufacturer:'brand',
        model:'model', modèle:'model', 'nom du modèle':'model', 'model name':'model', 'product name':'model',
        serial:'serial_number', sn:'serial_number', 's/n':'serial_number', 'serial number':'serial_number',
        'numéro de série':'serial_number', 'numero de serie':'serial_number', serialnumber:'serial_number',
        mac:'mac_address', 'mac address':'mac_address', macaddress:'mac_address', 'adresse wi-fi':'mac_address',
        password:'decoded_password', pwd:'decoded_password', pass:'decoded_password', 'mot de passe':'decoded_password',
    };
    return function parseScan(raw) {
        const fields = {};
        const assign = (label,value) => {
            const key = aliases[label.toLowerCase().trim()];
            if (key && typeof value === 'string' && value.trim()) fields[key]=value.trim();
        };
        try {
            const json = JSON.parse(raw);
            if (json && typeof json === 'object' && !Array.isArray(json)) {
                Object.entries(json).forEach(([key,value])=>assign(key,value));
            }
        } catch (error) {
            if (!(error instanceof SyntaxError)) throw error;
        }
        let url;
        try { url = new URL(raw.trim()); } catch (error) { if (!(error instanceof TypeError)) throw error; }
        if (url) url.searchParams.forEach((value,key)=>assign(key,value));
        if (url?.hostname === 'app.nebula.zyxel.com') {
            const token = new URLSearchParams(url.hash.slice(1)).get('zn');
            if (token && /^[A-Za-z0-9+/=]+$/.test(token)) {
                try {
                    const decoded = atob(token);
                    // Verified on the supplied Nebula QR: explicit Z + serial + M + MAC suffix.
                    // Opaque model/version prefixes are not translated to guessed model names.
                    const nebula = decoded.match(/Z(S[A-Z0-9]{8,20})M([A-F0-9]{12})$/);
                    if (nebula) {
                        fields.serial_number = nebula[1];
                        fields.mac_address = nebula[2];
                        fields.brand = 'Zyxel';
                    }
                } catch (error) {
                    if (error.name !== 'InvalidCharacterError') throw error;
                }
            }
        }
        // OCR labels can be on the same line as their value or the following line.
        const lines = raw.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
        for (let index=0;index<lines.length;index++) {
            const line=lines[index];
            for (const [alias,key] of Object.entries(aliases)) {
                if (line.toLowerCase() === alias && lines[index+1] && !aliases[lines[index+1].toLowerCase()]) {
                    fields[key]=lines[index+1];
                }
            }
            const pair=line.match(/^([^:=]+)\s*[:=]\s*(.+)$/);
            if(pair) assign(pair[1],pair[2]);
            if(!pair) {
                for(const alias of Object.keys(aliases).sort((a,b)=>b.length-a.length)) {
                    if(line.toLowerCase().startsWith(alias.toLowerCase()+' ')){
                        assign(alias,line.slice(alias.length).trim());break;
                    }
                }
            }
        }
        const macMatch=raw.match(/\b(?:[a-f0-9]{2}[:-]){5}[a-f0-9]{2}\b/i);
        if(!fields.mac_address&&macMatch)fields.mac_address=macMatch[0];
        if(fields.mac_address) {
            const normalized=fields.mac_address.replace(/[:-]/g,'').toUpperCase();
            if(/^[A-F0-9]{12}$/.test(normalized)) fields.mac_address=normalized.match(/.{2}/g).join(':');
            else delete fields.mac_address;
        }
        // Unlabelled barcode content is not guessed to be a serial or model.
        return {raw,fields};
    };
});
