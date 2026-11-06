<p align="center"><img src="build/icon.png" width="120" alt="Gip 2.0"></p>

<h1 align="center">Gip 2.0</h1>
<p align="center"><b>Le navigateur libre, privé et chiffré — avec ses propres services et comptes internes.</b></p>

---

## ✨ Fonctionnalités

### 🌐 Navigateur complet (moteur Chromium)
- Onglets animés : glisser-déposer, épingler, dupliquer, couper le son, rouvrir un onglet fermé
- Barre d'adresse intelligente avec suggestions (historique, favoris, recherche)
- Barre de favoris, recherche dans la page, zoom par onglet, plein écran, impression, outils de développement
- Gestionnaire de téléchargements (pause, reprise, anneau de progression)
- Fenêtres privées (session en mémoire, effacée à la fermeture)
- Restauration de la session précédente, menu contextuel complet, raccourcis clavier
- Demandes d'autorisation (caméra, micro, position, notifications…) mémorisées par site
- Thèmes clair, sombre ou système, couleur d'accent et fond d'accueil personnalisables

### 👤 Comptes Gip internes (100 % locaux)
- Plusieurs comptes sur le même appareil, plus un mode invité
- **Chaque profil est chiffré en AES-256-GCM** avec une clé dérivée de votre mot de passe (scrypt)
- Historique, favoris, notes, coffre-fort, Drive, agenda et mails : tout est chiffré
- Chaque compte a sa propre session web isolée (cookies séparés)
- Changement de mot de passe (avec re-chiffrement), export et suppression du compte

### 🧩 Services Gip
| Service | Description |
|---|---|
| 🔍 **Gip Search** | Recherche relayée par un proxy Gip : sans cookies, sans pistage, sans annonces. Calculatrice et réponses instantanées |
| ✉️ **Gip Mail** | Messagerie entre comptes Gip, **chiffrée de bout en bout** (X25519 + AES-256-GCM) — adresses `prenom@gip.local` |
| 📝 **Gip Notes** | Notes colorées, épinglables, chiffrées |
| 🔑 **Coffre-fort** | Gestionnaire de mots de passe, générateur, analyse de robustesse et de réutilisation, vérification des fuites (k-anonymat) |
| ☁️ **Gip Drive** | Stockage de fichiers chiffré, glisser-déposer, aperçu d'images, de vidéos et de textes |
| 📅 **Gip Agenda** | Calendrier mensuel avec événements colorés |
| 🛡️ **Bouclier** | Tableau de bord de confidentialité avec statistiques animées |
| 🖼️ **Gip Images** | Recherche d'images multi-sources, filtre réglable (ou désactivé), visionneuse |
| ✨ **Gip IA** | Assistant Claude ou compatible OpenAI, serveurs MCP, et Gip comme serveur MCP |

### 🖼️ Gip Images, Vidéos et Actualités
- **Recherche d'images multi-sources** : DuckDuckGo, Bing, Openverse et Wikimedia Commons interrogés en parallèle, résultats fusionnés et dédoublonnés, défilement infini
- **Filtre de contenu réglable** (Paramètres ou directement dans la barre de recherche) : *Strict*, *Modéré* ou *Désactivé* — en mode désactivé, tous les résultats sont accessibles, sans aucun filtre
- Filtres : source, taille (jusqu'aux fonds d'écran), couleur, type (photo, illustration, GIF, transparent, dessin), format, licence (Creative Commons, domaine public, usage commercial…)
- Visionneuse plein écran (← →), dimensions, licence et auteur, téléchargement, « Tout télécharger », recherche d'images similaires (Google Lens, Bing, Yandex, TinEye)
- Vignettes relayées par Gip (les sites ne voient pas vos recherches)
- Onglets **Vidéos** et **Actualités** natifs, bandeau d'images dans les résultats web
- **Toutes les images d'une page** (Ctrl+Maj+G) : images, srcset haute définition, images de fond, affiches vidéo, images de partage — avec tri, filtre de taille, sélection et téléchargement groupé

### ✨ Gip IA et MCP
- **Assistant intégré** (page `gip://ai` ou panneau latéral redimensionnable, Ctrl+Maj+A) qui voit l'onglet actif
- Fournisseurs : **Claude** (clé API Anthropic, Claude Opus 5.5 par défaut, réflexion adaptative, réponses en direct) ou **tout service compatible OpenAI** (Ollama, LM Studio, OpenRouter, Mistral, Groq…)
- **Connectez vos serveurs MCP** : programmes locaux (stdio), serveurs distants Streamable HTTP ou SSE, en-têtes d'authentification, import d'une configuration Claude Desktop / Cursor, ajout rapide (fichiers, mémoire, fetch, GitHub…)
- Outils du navigateur pour l'IA : lister/ouvrir/fermer des onglets, lire une page, capture d'écran, cliquer, saisir, recherche web/images/vidéos/actualités, favoris, historique, notes (JavaScript en option)
- Confirmation des actions (réglable), clés et conversations chiffrées dans le profil
- **Gip comme serveur MCP** : Claude Desktop, Claude Code, Cursor… peuvent piloter Gip (`http://127.0.0.1:7457/mcp`, jeton secret, lecture seule possible, fenêtres privées jamais exposées)

```bash
# Claude Code
claude mcp add --transport http gip http://127.0.0.1:7457/mcp --header "Authorization: Bearer <jeton>"
```

### 🧰 Outils du navigateur
Capture d'écran (Ctrl+Maj+S, copiée et enregistrée), vidéo en image dans l'image (Ctrl+Maj+Y), traduction de la page, « Demander à Gip IA » dans le menu contextuel, recherche d'images similaires par clic droit.

### 🛡️ Vie privée intégrée
- Blocage des publicités et des traqueurs (listes intégrées, compteur par page)
- HTTPS partout (passage automatique en HTTPS)
- Blocage des cookies tiers et réduction du Referer aux requêtes inter-sites
- Nettoyage des liens (`utm_*`, `fbclid`, `gclid`…)
- Anti-empreinte numérique (canvas, WebGL, audio, matériel)
- Global Privacy Control et Do Not Track
- Option « tout effacer à la fermeture », aucune télémétrie

### 🎬 Animations
Écran de démarrage avec logo dessiné, connexion sur fond aurore animé, onglets qui apparaissent et se ferment en fondu, barre de progression lumineuse, menus à ressort, compteurs animés, fonds vivants sur la page d'accueil.

## 🚀 Lancer Gip 2.0

Prérequis : [Node.js](https://nodejs.org) 18 ou plus récent.

```bash
npm install
npm start
```

> Sous Linux en `root` (conteneurs) : `npx electron . --no-sandbox`

### Créer un installateur
```bash
npm run dist:win     # Windows (.exe)
npm run dist:mac     # macOS (.dmg)
npm run dist:linux   # Linux (AppImage, .deb)
```

## 📱 Version Android (APK)

Le dossier `android/` contient Gip 2.0 pour Android 10 ou plus récent. C'est une application native en Kotlin, basée sur le WebView Chromium. Elle réutilise directement les pages `gip://` de la version bureau et propose :
- des comptes chiffrés (PBKDF2 + AES-256-GCM) et le mode invité ;
- Gip Mail chiffré de bout en bout (ECDH P-256) ;
- le Bouclier (même liste de blocage), HTTPS partout, les cookies tiers bloqués et l'anti-empreinte ;
- des onglets normaux et privés, un sélecteur d'onglets animé, la recherche dans la page, la version ordinateur, les téléchargements et le plein écran vidéo ;
- la possibilité de devenir le navigateur par défaut.

```bash
cd android
echo "sdk.dir=/chemin/vers/android-sdk" > local.properties
gradle assembleRelease          # → app/build/outputs/apk/release/app-release.apk
gradle testReleaseUnitTest      # tests du chiffrement, du mail et du Drive
```

## ⌨️ Raccourcis

| Raccourci | Action |
|---|---|
| `Ctrl+T` / `Ctrl+W` | Nouvel onglet / fermer l'onglet |
| `Ctrl+Maj+T` | Rouvrir l'onglet fermé |
| `Ctrl+N` / `Ctrl+Maj+N` | Nouvelle fenêtre / fenêtre privée |
| `Ctrl+L` | Barre d'adresse |
| `Ctrl+F` | Rechercher dans la page |
| `Ctrl+D` | Ajouter aux favoris |
| `Ctrl+H` / `Ctrl+J` | Historique / téléchargements |
| `Ctrl+Tab`, `Ctrl+1…9` | Changer d'onglet |
| `Ctrl +` / `Ctrl -` / `Ctrl 0` | Zoom |
| `Alt+←` / `Alt+→` | Précédent / suivant |
| `F5`, `F11`, `F12` | Actualiser, plein écran, outils de développement |

## 🗂️ Structure

```
src/
├── main/            Processus principal (Electron)
│   ├── main.js      Fenêtres, protocole gip://, IPC, téléchargements, Gip Search
│   ├── store.js     Comptes, chiffrement, Gip Mail E2E, Gip Drive
│   ├── privacy.js   Bouclier : blocage, HTTPS, cookies, nettoyage des liens
│   └── blocklist.js Listes de blocage intégrées
├── preload/         Ponts sécurisés (contextIsolation + sandbox)
└── renderer/
    ├── browser/     Interface du navigateur (onglets, barre d'adresse, menus)
    └── pages/       Pages internes gip:// (accueil, services, paramètres…)
```

## 🔐 Sécurité
- Les pages web s'exécutent en bac à sable (`sandbox`, `contextIsolation`, pas de Node.js)
- Les pages internes `gip://` sont les seules à pouvoir appeler l'API Gip ; un site web ne peut pas naviguer vers elles
- Politique de sécurité du contenu (CSP) stricte sur les pages internes
- Le mot de passe principal ne peut pas être récupéré : sans lui, les données restent illisibles

Licence MIT.
