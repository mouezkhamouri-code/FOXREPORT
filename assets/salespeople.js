(() => {
    const input = document.querySelector('input[name="phone"]');
    if (!input) return;

    function formatPhone() {
        const value = input.value;
        const digits = value.replace(/[\s().-]/g, '');
        if (!/^0[0-9]{0,9}$/.test(digits)) return;
        const cursor = input.selectionStart;
        const before = cursor === null ? 0 : value.slice(0, cursor).replace(/[^0-9]/g, '').length;
        const formatted = digits.match(/.{1,2}/g).join(' ');
        if (formatted === value) return;
        input.value = formatted;
        if (cursor !== null) {
            let position = 0;
            let count = 0;
            while (position < formatted.length && count < before) {
                if (/[0-9]/.test(formatted[position])) count++;
                position++;
            }
            input.setSelectionRange(position, position);
        }
    }

    input.addEventListener('input', formatPhone);
    formatPhone();
})();
