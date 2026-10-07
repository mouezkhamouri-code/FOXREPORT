# FOXREPORT

FoxReport est une application indépendante de PLANESTO pour saisir, sauvegarder et reprendre des rapports d’intervention d’installation et de formation Lightspeed.

## Première installation

1. Dans IONOS, créez une base MySQL et un utilisateur dédiés à FoxReport. Ne choisissez pas une base PLANESTO.
2. Configurez `SERVEUR/db.php` pour cette base dédiée. L’application réutilise l’instance PDO `$pdo` fournie par ce fichier. Le fichier contient des identifiants et reste ignoré par Git.
3. Dans phpMyAdmin, sélectionnez explicitement la base FoxReport, puis importez `database/schema.sql`. Le script ne contient que des tables préfixées `foxreport_`; il ne sélectionne ni ne modifie une base PLANESTO.
4. Dans IONOS, dirigez la racine web vers la racine du projet (le dossier contenant `index.php`). `SERVEUR/` ne contient que le fichier privé `db.php`. Vérifiez que PHP 8.1+ et les extensions PDO MySQL, Fileinfo, DOM, Mbstring, GD, EXIF et cURL sont activés. HTTPS est nécessaire pour la PWA, la caméra et Google OAuth.
5. Configurez Google OAuth et la liste d'adresses autorisées comme indiqué ci-dessous. Rapports, photos, PDF, carte et synchronisation exigent une session authentifiée. Vérifiez que les règles `.htaccess` bloquent l'accès HTTP à `storage/` et `DOCUMENTATION/` sur IONOS.

Si les tables existent déjà, n'exécutez pas simplement `schema.sql` : importez explicitement et une seule fois les migrations manquantes `database/migrations/002-pwa.sql`, `database/migrations/003-location.sql`, puis `database/migrations/004-section-state.sql`, après sauvegarde de la base dédiée FoxReport et vérification des colonnes déjà présentes. Pour une nouvelle base, `schema.sql` suffit. Aucun script SQL n'est lancé automatiquement.

Si la liste signale un schéma incomplet, elle affiche désormais les colonnes manquantes. L'absence de `latitude`, `longitude` et `map_zoom` indique que la migration de localisation reste à appliquer ; inspectez d'abord la table si certaines colonnes existent déjà, car le script ne doit pas être réexécuté aveuglément. Une checklist JSON invalide sur un rapport ne bloque plus toute la liste : ce rapport affiche un avertissement explicite à la place du taux. Les logs indiquent seulement son ID, sans données du rapport. Les erreurs de connexion/table restent signalées séparément. Les dernières lignes reçues restent visibles si l'actualisation échoue.

Les photos sont stockées dans `storage/photos/`, qui refuse les accès directs HTTP. Elles ne sont pas suivies par Git. Les rapports sont stockés dans la base FoxReport et ne sont pas inclus dans le dépôt.

## Fonctionnalités de cette étape

- Accueil sur les rapports ouverts par défaut, filtres Ouverts / Clôturés / Tous, bouton « Nouveau rapport » visible. Les outils secondaires (installation, mises à jour, brouillons locaux, modèle PDF et déconnexion) sont dans le menu ; les actions PDF/suppression d'un rapport sont dans son menu Actions.
- Chaque ligne de la liste permet de supprimer définitivement un brouillon ou un rapport finalisé : cochez « Confirmer », puis « Supprimer ». Avec JavaScript, une confirmation supplémentaire rappelle que la suppression concerne toute l'équipe. Une connexion est requise. La suppression authentifiée et protégée par CSRF vérifie la version affichée ; si le rapport a changé entre-temps, elle est refusée. Le matériel, les références photo et les opérations de synchronisation sont supprimés dans une transaction, puis les fichiers photo sont nettoyés (tout échec de nettoyage est signalé). La copie locale de cet appareil est retirée après succès. Les copies hors connexion sur d'autres appareils ne peuvent pas recréer silencieusement le rapport : une tentative de synchronisation affiche un conflit et conserve les saisies pour une éventuelle copie.

Le test de suppression utilise une base SQLite en mémoire et des photos synthétiques : `php -d extension=php_pdo_sqlite.dll tests/report-delete.php` sous Windows (ou `php tests/report-delete.php` si PDO SQLite est déjà activé). Aucun rapport réel n'est utilisé. Le comportement du bouton est également couvert par `npm test`.
- La liste ouverte sur ordinateur ou téléphone est actualisée toutes les 3 secondes, uniquement lorsque la page est visible et connectée. Les créations et modifications envoyées par la PWA apparaissent sans recharger la page. Une saisie hors connexion n'apparaît sur les autres appareils qu'après synchronisation. L'éditeur déjà ouvert n'est pas rechargé automatiquement : sa protection contre les conflits reste active.
- Taux de remplissage dans la liste : champs renseignés sur les 41 champs des 11 sections, localisation incluse (photos et détails des appareils exclus). La checklist compte pour un champ dès qu'un thème est coché ; « Non », zéro et « Non applicable » sont des réponses renseignées. Le calcul porte sur les données sauvegardées, indépendamment du statut Brouillon/Finalisé, et ne mesure pas la validation métier du rapport.
- Navigation par sections sans perdre les modifications saisies dans la page.
- Les 11 sections sont des accordéons empilés : leurs en-têtes sont bleu pétrole très clair, les formulaires restent blancs. « Section terminée » referme la section et passe l'en-tête au vert avec une coche, même pour une section optionnelle vide. Toute modification ultérieure de champ, photo/légende, localisation ou matériel annule sa validation (une modification d'inventaire annule aussi celles des sections montrant ce matériel). La validation est explicite, indépendante du pourcentage de champs renseignés. Les états sont stockés dans `completed_sections`, inclus dans IndexedDB et les opérations de synchronisation, avec la même protection de révision que les autres champs. Précédent/Suivant restent disponibles. Sans la migration 004, l'éditeur affiche l'action requise au lieu de prétendre sauvegarder ces états.
- Inventaire par appareil : les quantités sont déduites du nombre de lignes détaillées.
- Ajout de photos avec légendes dans chaque section.
- Validation serveur, requêtes PDO préparées, jeton CSRF, vérification des types et tailles d’images, et stockage protégé des fichiers.
- Checklist de formation : commandes/tables/service, paiements/remboursements/annulations et impression/tickets.

Le PDF présent dans `DOCUMENTATION/` est un compte rendu client et est volontairement exclu du dépôt. Ne versionnez pas de rapports réels, d’identifiants ou de photos.

## Identité visuelle et icônes

Les logos fournis dans `images/` restent intacts et servent de sources : leur fond et leurs yeux évidés sont recolorés en bleu pétrole `#176B75`, le renard reste blanc sans contour noir. L'en-tête, la connexion et les brouillons locaux utilisent le logo. Les favicons ICO/PNG, les icônes PWA 192/512 et l'icône Apple 180 sont dans `assets/icons/`. Les proportions sont conservées. La version maskable place le visuel dans un carré central de 56% de l'icône sur fond `#176B75`, entièrement inclus dans le cercle de sécurité de rayon 40%, pour protéger les oreilles, y compris avec un masque circulaire.

Pour régénérer les fichiers avec PHP GD : `php -d extension=php_gd.dll scripts/generate-icons.php` sous Windows, puis `npm run build` pour actualiser la version du service worker. Sur un environnement où GD est déjà chargé : `php scripts/generate-icons.php`. Déployez les nouveaux fichiers `assets/icons/`, les pages PHP/HTML, CSS/JS, le manifest et le service worker ensemble. Certaines plateformes conservent l'ancienne icône jusqu'à une mise à jour ou une réinstallation ; ne supprimez pas les données locales non synchronisées pour forcer le changement.

Le thème web/PWA utilise boutons/identité `#176B75` avec texte blanc, survol/appui `#11515A`, sections/sélections `#E5F1F2`, accents abricot `#F2B38D` avec texte sombre, fond `#F3F7F7`, cartes/champs blancs, texte `#172033`/`#596579`, bordures `#DCE5E7`, validation `#15803D` sur `#DCFCE7`, erreur `#B91C1C` sur `#FEE2E2`. Le vert est réservé aux validations. La prévisualisation PDF conserve sa pagination, avec des accents bleu pétrole.

## Prévisualisation PDF

Installez les dépendances avec `composer install --no-dev --optimize-autoloader`, puis déployez également le dossier `vendor/` sur IONOS (ce dossier est exclu de Git). `composer.lock` fixe les versions utilisées. Le dossier protégé `storage/pdf-cache/` doit être accessible en écriture par PHP.

- Le bouton **Rapport · modèle vide** ouvre `rapport.php` sans accéder à la base. Toutes les sections restent visibles, avec des zones à renseigner, les quantités à zéro et la checklist non cochée.
- Dans un rapport, **Rapport · prévisualiser le PDF** ouvre un vrai PDF A4 dans un nouvel onglet. Sur les navigateurs mobiles qui ne disposent pas de lecteur PDF intégré, le document peut être téléchargé.
- Le PDF utilise uniquement les données et photos déjà enregistrées. Sauvegardez avant de prévisualiser : ce bouton ne sauvegarde pas le formulaire.
- Une nouvelle section commence sur une nouvelle page ; les contenus longs peuvent continuer sur les pages suivantes. Les appareils, les légendes et la pagination sont inclus. Les brouillons portent la mention BROUILLON.
- Aucun PDF réel n'est conservé sur le serveur. Les ressources distantes, PHP et JavaScript sont désactivés dans le moteur PDF.

Cette mise en page sert à valider les sections ; la reproduction exacte du modèle client reste à affiner.

## Traitement des photos

Les fichiers JPEG, PNG et WebP sont prévisualisés dès leur sélection, sans quitter la section. Ils sont traités côté serveur lors de la sauvegarde :

- entrée : 8 Mo et 12 mégapixels maximum, sous réserve de la mémoire PHP disponible ;
- correction de l'orientation EXIF, sans conserver les métadonnées GPS/EXIF ;
- conversion en JPEG (fond blanc pour les zones transparentes), sans agrandissement ;
- côté maximal de 1 600 pixels, qualité initiale de 82 puis compression/réduction supplémentaire si nécessaire, sortie limitée à 1 Mo ;
- images enregistrées visibles dans le formulaire et dans le PDF avec leurs légendes.

Les fichiers déjà enregistrés restent compatibles et ne sont pas modifiés rétroactivement. Les originaux des nouveaux envois ne sont pas conservés.

## Google OAuth et équipe

Dans Google Cloud Console, créez un client OAuth de type Application Web, configurez l'écran de consentement et déclarez exactement `https://VOTRE-DOMAINE/auth.php?action=callback` comme URI de redirection. Copiez `config/oauth.example.php` vers `storage/private/oauth.php`, puis complétez le client ID, le client secret, l'URI de retour et `allowed_emails`. Ne transmettez pas les secrets par Git ou par la conversation.

Pour le domaine `fox.whitefox-france.com`, activez d'abord le certificat SSL et HTTPS dans IONOS, puis configurez la redirection HTTP vers HTTPS. L'URI de retour Google sera exactement `https://fox.whitefox-france.com/auth.php?action=callback`. Google OAuth n'accepte pas une URI HTTP sur ce domaine public ; l'exception HTTP pour les essais locaux ne s'applique qu'à localhost. Ne saisissez pas de données client sur la version HTTP.

Seules les adresses vérifiées présentes dans cette liste peuvent accéder aux rapports partagés. L'autorisation est recontrôlée côté serveur à chaque accès. La connexion utilise un état à usage unique, PKCE S256, les endpoints Google fixes et une session PHP HttpOnly / SameSite=Lax, expirant après 12 heures. Aucun jeton Google n'est conservé dans le navigateur. La déconnexion est un POST avec CSRF ; elle efface les données locales. Fermez les autres onglets en cas de suppression bloquée. La liste ne doit contenir que les personnes habilitées à consulter les données client.

### Diagnostic du retour Google

Le départ OAuth est normalisé vers l'origine HTTPS et le chemin configurés **avant** création de la session. Un cookie sans domaine explicite (host-only), `Path=/`, `Secure`, `HttpOnly` et `SameSite=Lax` permet le callback Google en navigation GET. Ne remplacez pas Lax par Strict : le cookie serait absent au retour intersite. Les en-têtes de proxy fournis par le client ne sont pas considérés comme une preuve HTTPS ; vérifiez la terminaison TLS IONOS si une boucle de redirection apparaît.

Chaque tentative garde son propre state/PKCE pendant dix minutes, jusqu'à cinq tentatives simultanées. La session est écrite avant le départ vers Google, et une tentative validée est consommée avant l'échange du code. Un callback erroné ne détruit pas les autres tentatives. Le client et l'URI doivent rester identiques entre le départ et le retour.

Les logs PHP préfixés `FoxReport OAuth` indiquent notamment :
- `pending_session_missing` : session/tentative absente ; vérifier cookie de retour, domaine, HTTPS, stockage PHP des sessions et éventuelle répartition entre serveurs ;
- `callback_state_missing` / `callback_state_mismatch` : state absent ou sans correspondance ;
- `attempt_expired` / `attempt_already_consumed_or_expired` : délai dépassé ou callback déjà utilisé ;
- `configuration_changed` : client/URI modifié pendant le parcours ;
- `google_authorization_denied` : autorisation annulée/refusée ;
- `google_token_exchange_failed` : state accepté mais échange Google refusé (client secret, code, URI, réseau) ;
- `identity_not_authorized` : adresse vérifiée mais non autorisée dans FoxReport.

Un identifiant aléatoire de tentative permet de rapprocher départ et callback. Les logs applicatifs ne contiennent ni state, ID de session, adresse e-mail, code OAuth, jeton ni secret. Configurez aussi les journaux HTTP IONOS pour ne pas conserver la query string du callback : elle contient le code et le state. Le contrôle des utilisateurs de test dans Google Cloud est distinct de `allowed_emails` dans FoxReport ; les deux doivent autoriser l'utilisateur.

Tests ciblés : `php tests/oauth.php` et `node --test tests/oauth-http.test.cjs`. Le test HTTP utilise une configuration synthétique et une session PHP réelle dans un serveur local isolé, sans contacter Google ni lire les secrets du projet.

## PWA et reprise hors connexion

Exécutez `npm ci`, puis `npm run build` pour préparer le lecteur ZXing de remplacement et l'OCR Tesseract local (modèle anglais, adapté aux étiquettes et aux numéros). Les fichiers d'exécution, les modèles et les notices de licence sont déployés depuis `assets/`. Les modèles OCR représentent plusieurs Mo : attendez la fin de l'installation en ligne avant une utilisation hors connexion.

Le bouton « Installer FoxReport » est accessible sur la connexion, la liste, l'éditeur et la page hors connexion, même sans proposition automatique du navigateur. Sur Android/Chrome ou Edge, il ouvre la proposition native lorsqu'elle est disponible ; sinon il explique le menu à utiliser. Sur iPhone/iPad, ouvrez le site dans Safari, puis Partager > Sur l'écran d'accueil ; activez « Ouvrir comme app » si proposé. Lancez ensuite FoxReport depuis l'icône installée : le manifest utilise `display: standalone`, ce qui retire la barre d'adresse. Un onglet normal garde toujours cette barre. Le bouton est masqué lorsque l'application est déjà en mode autonome. L'installation ne peut pas être forcée (navigation privée ou navigateur intégré à une autre application peuvent l'empêcher).

Déployez également le `.htaccess` racine (type MIME du manifest), `assets/install.js`, `manifest.webmanifest`, `sw.js`, les icônes et toutes les ressources listées par le service worker. Le manifest et ses icônes sont déclarés aussi sur la page de connexion, vers laquelle les visiteurs non authentifiés sont redirigés. Les erreurs d'enregistrement du service worker sont affichées dans l'aide d'installation. HTTPS est obligatoire hors localhost. La première connexion Google et la première ouverture d'un rapport se font en ligne. Les 11 sections disposent de boutons Précédent/Suivant et d'un indicateur d'étape.

Les modifications et photos sont conservées dans IndexedDB et synchronisées automatiquement après une pause de saisie, au retour du réseau et à la réouverture. La page locale et la liste en ligne reprennent aussi les autres brouillons en attente. « Hors ligne — enregistré sur cet appareil » indique une sauvegarde locale, avec le nombre de modifications, rapports et photos en attente. Les brouillons ouverts sur cet appareil sont accessibles depuis **Brouillons locaux**, même hors connexion. L'OS peut évincer ce stockage : ce n'est pas une sauvegarde permanente. Les données locales ne sont pas chiffrées par l'application ; utilisez un téléphone personnel verrouillé. Les comptes sont séparés par identifiant Google ; il faut reconnecter le même compte pour synchroniser.

Le service worker ne met jamais en cache les réponses contenant des rapports, photos, PDF, cartes ou sessions. Les saisies et photos locales sont stockées explicitement dans IndexedDB. Le serveur compare une révision sous verrou transactionnel ; un conflit conserve les données locales et propose soit de charger la version serveur (avec confirmation), soit de créer un autre rapport avec les saisies locales. Un identifiant d'opération évite de dupliquer un envoi après une réponse réseau perdue. Un rapport finalisé doit être rouvert explicitement. La finalisation se fait en ligne.

À la réouverture en ligne d'une copie locale déjà synchronisée, la révision serveur confirmée devient la nouvelle référence ; son identifiant local reste stable. Cela évite un faux conflit lors de la saisie suivante après une modification distante déjà affichée. Les modifications locales en attente ne sont jamais remplacées par cette actualisation. Les messages de conflit indiquent les révisions locale/serveur, et les logs ne contiennent que l'identifiant du rapport et ces numéros. Pour récupérer un brouillon en conflit, ouvrez **Brouillons locaux**, puis **Créer une copie** ; les saisies et les photos sont reprises dans un rapport distinct. Les formats connus sont conservés ; une ancienne photo sans métadonnées de recadrage conserve ses proportions originales.

L'accueil affiche les conflits locaux encore actifs avec **Résoudre**. La synchronisation automatique ne retente pas ces conflits : leur message mémorisé ne constitue pas une nouvelle réponse 409 du serveur. La création d'une copie vérifie les champs, les métadonnées et chaque octet des photos relus depuis IndexedDB avant d'archiver l'original. Si l'original change pendant la copie ou si la vérification échoue, il reste actif et l'erreur est affichée. L'archive conserve les saisies, photos et ancienne opération, reste consultable en lecture seule dans **Brouillons locaux**, mais n'entre plus dans les compteurs ni la synchronisation. La déconnexion ne la supprime pas ; reconnectez le même compte pour la consulter. La copie devient le brouillon à synchroniser. Aucune vérification de révision serveur n'est désactivée.

Pour le déclenchement initial, `api=save` renvoie 409 après annulation de la transaction uniquement sur `ReportConflict` : révision absente, rapport introuvable/supprimé, révision différente ou rapport finalisé. Les logs indiquent la cause, l'ID et les révisions disponibles, jamais les champs, photos, identifiants Google ou secrets. Une opération déjà confirmée est rejouée avant le contrôle de révision et ne crée pas de faux conflit.

Les deux boutons de résolution masquent le panneau après confirmation locale et bloquent les sauvegardes tardives de l'ancien éditeur (cache photo, événements de saisie et mise à jour PWA), qui ne doivent pas recréer un conflit après archivage. **Utiliser la version serveur** conserve également les données originales dans une archive ; la nouvelle page serveur utilise une copie locale active distincte. L'éditeur hors connexion charge ses scripts avec la version de l'interface, afin de ne pas mélanger ancien gestionnaire et nouveau synchroniseur.

Après une première connexion et préparation en ligne (interface statique et scanner en cache, modèle vide dans IndexedDB), **Nouveau rapport** crée un brouillon sur l'appareil même sans réseau. Son UUID stable est envoyé comme `client_uid` et réutilisé par le serveur en cas de réponse perdue ; les envois de champs/photos gardent leur identifiant d'opération jusqu'à confirmation serveur. Les photos ne quittent la liste d'attente qu'après cette confirmation et leur copie locale sauvegardée reste disponible. La déconnexion et le retrait d'une copie locale refusent de supprimer les modifications non synchronisées. Une édition simultanée dans une autre fenêtre conserve une copie locale en conflit plutôt que d'écraser les saisies.

La synchronisation n'est pas garantie lorsque l'application est fermée ou suspendue par iOS/Android ; elle reprend à l'ouverture. Un ancien rapport serveur jamais téléchargé n'est pas accessible hors connexion, mais un nouveau brouillon peut être créé depuis le modèle local. Le PDF, la carte Google et Google OAuth nécessitent le réseau. Le scanner et l'OCR sont fournis localement ; la caméra reste soumise aux permissions du téléphone.

## Versions et mises à jour PWA

Exécutez `npm run build` avant chaque déploiement. Le build calcule une version de contenu commune à `sw.js`, `version.json`, `app/build-version.php` et `offline.html`, incluant les assets et le code PHP de l'interface. Un build sans changement garde la même version. Déployez ces fichiers ensemble avec les ressources modifiées et `app/version.php` ; le `.htaccess` racine empêche la conservation sans revalidation du worker et de l'indicateur de version.

Dans **Menu**, la version courante et **Vérifier les mises à jour** sont accessibles même dans l'application installée. La vérification reprend à la réouverture, au retour du réseau et lorsque la page redevient visible. Lorsque tous les fichiers de la nouvelle interface sont téléchargés, **Mettre à jour** active le worker en attente puis recharge les onglets. Avant tout rechargement de rapport, les saisies sont conservées dans IndexedDB ; une erreur d'écriture ou une photo/un scan encore ouvert reporte la mise à jour. Les caches statiques obsolètes sont remplacés, jamais les données IndexedDB. Les pages PHP utilisent aussi des URLs CSS/JS portant la version pour éviter un mélange avec un ancien worker. Hors ligne, la version déjà disponible est conservée. Il n'est plus nécessaire d'effacer les données du navigateur ou de désinstaller la PWA pour actualiser son interface.

## Photos mobiles, scan et OCR

Dans chaque section : photo avec la caméra ou sélection depuis la galerie, format carré 1:1 / paysage 4:3 / portrait 3:4, déplacement du recadrage par les curseurs, zoom, rotation et légende. Le téléphone applique l'orientation puis génère un JPEG sans agrandissement : carré 1200×1200, paysage 1600×1200, portrait 1200×1600 maximum. La compression vise au plus 600 Ko sans gonfler artificiellement les images inférieures à 300 Ko ; le plafond reste 1 Mo. Le serveur vérifie aussi le type, les proportions, les dimensions et le poids. Les photos en attente restent dans IndexedDB. Le PDF conserve leurs proportions, sans recadrage.

**Scanner un matériel / OCR** lit les QR et codes-barres avec la caméra (BarcodeDetector si compatible, ZXing sinon) ou depuis une photo. L'OCR d'une photo d'étiquette ou d'écran Informations iPhone tourne sur le téléphone, sans service externe. Une photo de coque seule ne révèle pas le numéro de série. Les données brutes et champs reconnus sont éditables avant confirmation. Les codes non étiquetés ne sont pas attribués arbitrairement à une série ou un modèle ; aucun lien scanné n'est ouvert. Les doublons par série ou MAC sont refusés dans le navigateur et sur le serveur.

Le format Nebula `https://app.nebula.zyxel.com/6RQi#zn=...` a été vérifié sur la photo fournie : le suffixe décodé permet de récupérer série et MAC. Son préfixe opaque n'est pas converti en un modèle supposé ; utilisez l'OCR ou saisissez le modèle. Les mots de passe explicitement reconnus sont placés dans un champ distinct, absent du PDF et des résumés d'appareils, mais présent dans la base et le brouillon local : traitez ces données comme sensibles.

## Localisation et Google Maps

Latitude, longitude et zoom sont sauvegardés même si la géolocalisation ou la carte échouent. **Utiliser ma position** demande la permission uniquement au clic, affiche la précision et demande confirmation. La carte se charge au clic ou après modification des paramètres ; un clic sur la carte propose un nouveau point à confirmer. Les coordonnées GPS/saisies ne proviennent pas de Google Geocoding.

Copiez `config/maps.example.php` vers `storage/private/maps.php`, puis configurez la clé côté serveur. Activez Maps Static API et la facturation ; restreignez la clé à cette API et aux IP de sortie IONOS. Ne placez pas la clé dans le JavaScript. `scale=2` produit 1280×720 via `size=640x360`; utilisez `scale=1` si nécessaire. Le marqueur est bleu pétrole, le cadrage 16:9 et les crédits de l'image sont conservés intégralement.

L'image n'est jamais conservée dans Git, IndexedDB, le service worker ou un cache serveur permanent. Dans la page ouverte, un même triplet coordonnées/zoom/style ne provoque pas de nouvelle requête tant que l'aperçu reste disponible. Une nouvelle ouverture ou génération PDF peut nécessiter une nouvelle requête : une régénération strictement limitée aux changements nécessiterait un cache durable, que nous ne présumons pas autorisé.

`pdf_allowed` est **false par défaut**. Ne l'activez qu'après vérification des conditions du compte Google, des règles applicables à votre usage des PDF et des éventuelles autorisations requises. Les conditions grand public ne constituent pas automatiquement une autorisation pour Maps Platform. Le contrat EEE peut différer selon le compte de facturation. Si l'inclusion est désactivée ou échoue, le PDF conserve les coordonnées et affiche le motif d'absence de carte ; le rapport n'est pas perdu. Lorsqu'elle est autorisée, la carte est chargée à la génération et intégrée entière, au même centre/zoom/style que l'aperçu. Un PDF téléchargé contient alors cette image : vérifiez également le droit de conservation et de diffusion du document.

Références officielles à vérifier pour le compte utilisé :
- [Conditions Google Maps Platform](https://cloud.google.com/maps-platform/terms)
- [Conditions spécifiques des services](https://cloud.google.com/maps-platform/terms/maps-service-terms)
- [Modifications Maps Static pour les clients EEE](https://developers.google.com/maps/comms/eea/maps-static)
- [Attribution et usages géographiques](https://about.google/brand-resource-center/products-and-services/geo-guidelines/)

## Vérifications locales

Avec les extensions PHP indiquées ci-dessus : `composer test` ou `php tests/run.php`, et `npm test`. Les tests automatisés utilisent des données synthétiques et n'accèdent ni à `SERVEUR/db.php`, ni à MySQL, ni au rapport client.

Le test navigateur optionnel `tests/offline-browser.test.cjs` utilise Edge headless dans un profil isolé, une fenêtre mobile et uniquement une fixture PHP/SQLite sur `127.0.0.1`. Il vérifie création hors ligne, scanner, recadrage JPEG, validation, reprise, synchronisation sans doublon, mise à jour avec modifications en attente et récupération d'un conflit avec copie des photos. Pour conserver une fixture : définissez `FOXREPORT_KEEP_FIXTURE=1` puis lancez `node --test tests/report-state-http.test.cjs`. Servez le dossier temporaire indiqué avec PHP et les extensions SQLite/GD/EXIF/Fileinfo/Mbstring, définissez `FOXREPORT_BROWSER_URL` sur son URL `http://127.0.0.1:PORT/index.php` et `FOXREPORT_BROWSER_FIXTURE` sur ce dossier, puis lancez `node --test tests/offline-browser.test.cjs`. Ce test modifie uniquement la version de cette fixture ; restaurez ses fichiers de version avant de le répéter. Il ne remplace pas les essais physiques ci-dessous.

Avant production, testez sur de vrais Android/Chrome et iPhone/Safari : connexion Google autorisée/refusée, installation, reprise de brouillon après fermeture, photos dans les trois formats, permission caméra refusée, QR/code-barres/OCR, mode avion puis reconnexion, deux appareils modifiant la même révision, expiration de session et déconnexion. L'émulation de viewport ne valide pas le matériel, le cycle de vie iOS ni le vrai flux OAuth.
