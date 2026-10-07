(() => {
    'use strict';
    let installPrompt;
    let installed = false;
    let registrationError = '';
    const standalone = window.matchMedia('(display-mode: standalone)');
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isInstalled = () => installed || standalone.matches || navigator.standalone === true;

    function render() {
        const container = document.querySelector('[data-install-container]');
        if (!container) return;
        container.hidden = isInstalled();
        if (container.hidden) return;
        if (!container.querySelector('#install-app')) {
            const button = document.createElement('button');
            button.id = 'install-app';
            button.type = 'button';
            button.className = 'button button-secondary button-small';
            button.textContent = 'Installer FoxReport';
            button.setAttribute('aria-controls', 'install-help');
            button.setAttribute('aria-expanded', 'false');
            const help = document.createElement('div');
            help.id = 'install-help';
            help.className = 'install-help';
            help.hidden = true;
            const instructions = document.createElement('p');
            instructions.id = 'install-instructions';
            const status = document.createElement('p');
            status.id = 'install-status';
            status.setAttribute('role', 'status');
            help.append(instructions, status);
            container.append(button, help);
        }
        const instructions = container.querySelector('#install-instructions');
        if (!window.isSecureContext) {
            instructions.textContent = 'Ouvrez FoxReport en HTTPS pour pouvoir l’installer. La connexion Google et le mode hors connexion nécessitent aussi HTTPS.';
        } else if (ios) {
            instructions.textContent = 'Sur iPhone ou iPad, ouvrez ce site dans Safari, touchez Partager puis « Sur l’écran d’accueil ». Activez « Ouvrir comme app » si proposé, puis touchez Ajouter.';
        } else if (installPrompt) {
            instructions.textContent = 'Confirmez l’installation proposée par votre navigateur.';
        } else {
            instructions.textContent = 'Dans Chrome ou Edge, ouvrez le menu du navigateur puis « Installer l’application » ou « Ajouter à l’écran d’accueil » si proposé. Si l’option est absente, ouvrez le site dans Chrome ou Edge, hors navigation privée ; une fenêtre intégrée à une autre application peut empêcher l’installation. Le navigateur décide quand proposer l’installation.';
        }
        container.querySelector('#install-status').textContent = registrationError
            || 'Après installation, ouvrez FoxReport depuis son icône : la barre d’adresse du navigateur ne s’affiche plus. Un onglet ouvert dans le navigateur garde cette barre.';
    }

    window.addEventListener('beforeinstallprompt', event => {
        event.preventDefault();
        installPrompt = event;
        render();
    });
    window.addEventListener('appinstalled', () => {
        installed = true;
        installPrompt = null;
        render();
    });
    standalone.addEventListener('change', render);
    document.addEventListener('fox-page-restored', render);
    document.addEventListener('click', async event => {
        if (!event.target.closest('#install-app')) return;
        render();
        const button = document.querySelector('#install-app');
        document.querySelector('#install-help').hidden = false;
        button.setAttribute('aria-expanded', 'true');
        if (!installPrompt) return;
        const prompt = installPrompt;
        installPrompt = null;
        button.disabled = true;
        try {
            await prompt.prompt();
            const choice = await prompt.userChoice;
            render();
            document.querySelector('#install-status').textContent = choice.outcome === 'accepted'
                ? 'Installation acceptée. Une fois terminée, lancez FoxReport depuis son icône.'
                : 'Installation annulée. Vous pouvez réessayer depuis le menu du navigateur.';
        } catch (error) {
            registrationError = `Installation impossible : ${error.message}`;
            render();
        } finally {
            button.disabled = false;
        }
    });
    render();
    if (window.isSecureContext && 'serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js', {updateViaCache:'none'}).catch(error => {
            registrationError = `Mode hors connexion indisponible : ${error.message}. Vérifiez le déploiement de sw.js et des ressources de la PWA.`;
            render();
            const help = document.querySelector('#install-help');
            if (help) {
                help.hidden = false;
                document.querySelector('#install-app').setAttribute('aria-expanded', 'true');
            }
        });
    }
})();
