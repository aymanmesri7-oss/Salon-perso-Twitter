# Bot Salons VA

Crée automatiquement un salon textuel privé pour chaque VA du serveur Discord.

- Nouveau membre → salon créé tout de suite, visible par lui, le rôle admin et le bot.
- Au démarrage → le bot vérifie tout le monde et crée seulement les salons manquants.
- Changement de pseudo → le salon est renommé (seulement si le nom change vraiment).
- Catégorie pleine (50) → création automatique de « <nom> 2 », « <nom> 3 »… avec les mêmes permissions.
- Serveur proche de 500 salons → arrêt avec une marge de 10, et le nombre de salons non créés est écrit dans les logs.
- Le sujet de chaque salon contient l'identifiant du membre : si la base de données est perdue, le bot retrouve tout seul à qui appartient chaque salon.

---

## ÉTAPE 1 — Créer le bot sur Discord (10 min)

1. Va sur https://discord.com/developers/applications et connecte-toi.
2. Clique **New Application** (en haut à droite). Donne un nom (ex. « Salons VA »), coche la case, clique **Create**.
3. Tu arrives sur **General Information**. Sous **Application ID**, clique **Copy**. Colle-le dans une note : c'est ton **CLIENT_ID**.
4. Menu de gauche → **Bot**.
   - Clique **Reset Token** → **Yes, do it!** → **Copy**. Colle-le dans ta note : c'est ton **DISCORD_TOKEN**. Ne le donne à personne.
   - Descends jusqu'à **Privileged Gateway Intents** :
     - **Server Members Intent** → **activé** (obligatoire, sinon le bot ne voit pas les membres).
     - Presence Intent → désactivé.
     - Message Content Intent → désactivé (inutile ici).
   - Clique **Save Changes** en bas.
5. Menu de gauche → **OAuth2** → **URL Generator**.
   - Dans **Scopes**, coche **bot**.
   - Dans **Bot Permissions**, coche exactement :
     - View Channels
     - Manage Channels
     - Manage Roles
     - Send Messages
     - Embed Links
     - Attach Files
     - Read Message History
     - Add Reactions
   - Copie l'URL générée tout en bas, ouvre-la dans ton navigateur, choisis ton serveur, clique **Autoriser**.

Pourquoi ces permissions : « Manage Channels » pour créer et renommer les salons, « Manage Roles » pour régler qui voit chaque salon, et Discord interdit à un bot de donner une permission qu'il n'a pas lui-même — d'où Send Messages, Attach Files, etc., que le bot donne aux VA.

## ÉTAPE 2 — Régler le serveur Discord (5 min)

### Activer le mode développeur (pour copier les identifiants)
1. Discord → roue dentée **Paramètres utilisateur** (en bas à gauche).
2. **Avancés** → active **Mode développeur**.

### Copier les identifiants
- **GUILD_ID** : clic droit sur l'icône de ton serveur (colonne de gauche) → **Copier l'identifiant du serveur**.
- **CATEGORY_ID** : clic droit sur le nom de la catégorie où iront les salons → **Copier l'identifiant de la catégorie**. (Crée-la avant si besoin : clic droit sur le serveur → **Créer une catégorie**, nomme-la par exemple « VA ».)
- **ADMIN_ROLE_ID** : **Paramètres du serveur** → **Rôles** → clique sur les **…** à droite de ton rôle admin → **Copier l'identifiant du rôle**.

### Placer le rôle du bot
1. **Paramètres du serveur** → **Rôles**.
2. Fais glisser le rôle du bot (il porte le nom du bot) **juste sous ton rôle admin**, au-dessus des rôles des VA.

Pourquoi : un rôle ne peut agir que sur les rôles placés en dessous de lui. Avec le bot sous l'admin, il ne pourra jamais toucher aux administrateurs ; au-dessus des VA, il ne sera bloqué par aucun de leurs rôles si on lui ajoute plus tard la gestion des rôles. Pour ce bot précis, ce qui compte vraiment, ce sont les permissions de l'étape 1 et celles de la catégorie ci-dessous.

### Donner accès à la catégorie
Si ta catégorie est privée (cachée à @everyone), le bot doit y avoir accès :
1. Clic droit sur la catégorie → **Modifier la catégorie** → **Permissions**.
2. Clique **+** à côté de « Rôles/Membres » → choisis le rôle du bot.
3. Mets en vert ✅ : **Voir les salons**, **Gérer les salons**, **Gérer les permissions**, **Envoyer des messages**, **Voir les anciens messages**.
4. **Enregistrer les modifications**.

Les catégories de débordement (« VA 2 », « VA 3 »…) recopient ces permissions automatiquement.

## ÉTAPE 3 — Mettre le code sur GitHub (5 min)

1. Décompresse le fichier `bot-salons-va.zip` sur ton ordinateur.
2. Va sur https://github.com, connecte-toi.
3. En haut à droite, clique **+** → **New repository**.
4. Repository name : `bot-salons-va`. Coche **Private**. Ne coche rien d'autre. Clique **Create repository**.
5. Sur la page suivante, clique le lien **uploading an existing file**.
6. Ouvre le dossier décompressé, sélectionne **tout ce qu'il y a dedans** (dossiers `src` et `test`, fichiers `package.json`, `package-lock.json`, `README.md`, `.gitignore`) et fais-le glisser dans la page GitHub.
   - Sur Mac, le fichier `.gitignore` est caché : dans le Finder, appuie sur **Cmd + Maj + .** pour le voir. S'il manque, ce n'est pas grave.
7. Attends que tous les fichiers apparaissent, puis clique **Commit changes** en bas.

## ÉTAPE 4 — Héberger sur Railway (10 min)

1. Va sur https://railway.com → **Login** → **Login with GitHub**. Autorise Railway.
2. Clique **New Project** (ou **+ New**) → **Deploy from GitHub repo**.
   - Si ton dépôt n'apparaît pas : clique **Configure GitHub App**, donne l'accès au dépôt `bot-salons-va`, reviens.
3. Choisis `bot-salons-va`. Railway lance un premier déploiement : il va échouer, c'est normal (les variables manquent).
4. Clique sur la case du service (au milieu de l'écran) → onglet **Variables** → **Raw Editor**. Colle ceci en remplaçant par tes valeurs :
   ```
   DISCORD_TOKEN=ton_token
   CLIENT_ID=123456789012345678
   GUILD_ID=123456789012345678
   CATEGORY_ID=123456789012345678
   ADMIN_ROLE_ID=123456789012345678
   ```
   Clique **Update Variables**.
5. **Ajouter le volume (indispensable pour garder la base de données)** :
   - Fais un clic droit sur la case du service → **Attach volume** (ou appuie sur **Cmd + K** / **Ctrl + K**, tape « volume », choisis **Add Volume** puis ton service).
   - **Mount path** : `/app/data` → valide.
6. En haut, Railway affiche une barre **Apply changes** / **Deploy** : clique dessus.
7. Onglet **Deployments** → clique sur le dernier déploiement → **View logs**. Tu dois voir :
   ```
   🤖 Connecté en tant que Salons VA#1234.
   🏠 Serveur : ...
   👥 12 VA trouvés (3 bots/admins ignorés). 0 salons existaient déjà, 12 à créer.
   ✅ Salon créé pour Jean Dupont (#jean-dupont, catégorie "VA").
   🏁 Vérification terminée : 12 salon(s) créé(s), ...
   ```

À partir de là, chaque fois que tu modifies un fichier sur GitHub, Railway redéploie tout seul.

## Comment vérifier que ça marche

1. Les logs Railway affichent « 🏁 Vérification terminée » sans ligne ❌.
2. Dans Discord, chaque VA a son salon dans la catégorie, avec le message de bienvenue et le bouton.
3. Invite un compte de test : son salon apparaît en quelques secondes.
4. Change le pseudo du compte de test sur le serveur : le salon est renommé.
5. Clique **Redeploy** dans Railway : les logs disent « X salons existaient déjà, 0 à créer » et aucun message n'est renvoyé.

## Variables facultatives

| Variable | Effet |
|---|---|
| `WELCOME_TEXT` | Remplace le texte de bienvenue. `{membre}` est remplacé par la mention du VA. |
| `SAFETY_MARGIN` | Marge gardée sous la limite de 500 salons (10 par défaut). |
| `DEBUG` | Mettre `1` pour afficher le détail technique des erreurs. |

## Si un message ❌ apparaît

Chaque erreur est expliquée en français dans les logs, avec quoi corriger. Les plus courantes :
- « active Server Members Intent » → étape 1, point 4.
- « le bot n'a pas les permissions nécessaires » → étape 1 point 5, et étape 2 « Donner accès à la catégorie ».
- « La catégorie indiquée dans CATEGORY_ID est introuvable » → recopie l'identifiant (étape 2).
- « Aucun volume Railway n'est branché » → étape 4, point 5.

## Bon à savoir

- Si un VA quitte le serveur, son salon est conservé. S'il revient, il récupère son salon.
- Si tu supprimes un salon à la main, il est recréé au prochain redémarrage.
- Si tu renommes la catégorie de base, renomme aussi « VA 2 », « VA 3 »… avec le même nouveau nom suivi du numéro.
- Les membres qui ont le rôle admin, la permission Administrateur, le propriétaire du serveur et les bots n'ont pas de salon.

## Pour un développeur

```
npm install
npm test        # 19 tests : doublons, débordement à 50, limite 500, pseudo en emojis, renommages, erreurs
npm start
```
Structure : `src/index.js` (événements Discord), `src/channels.js` (toute la logique), `src/naming.js` (noms de salon), `src/throttle.js` (pause d'1 s, file d'attente, limite de renommage), `src/errors.js` (traduction des erreurs), `src/db.js` (SQLite).
