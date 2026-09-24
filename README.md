# TAKARDATA V2.1 — version corrigée et prête pour test

Cette version conserve l'interface V2 et ajoute/corrige les fonctions prévues :

- portail Citoyen, portail central TAKARDATA/Entreprise, portail Mairie ;
- inscription citoyen avec CNI recto + verso obligatoires ;
- validation/rejet de la CNI depuis TAKARDATA avant activation du compte ;
- formulaire Acte de naissance avec les deux parcours : « pour moi-même » et « pour mon enfant / membre de ma famille » ;
- pièces justificatives photo/scan/PDF ;
- suivi des demandes ;
- circuit TAKARDATA → mairie → TAKARDATA → citoyen ;
- dépôt du document officiel par la mairie ;
- contrôle final par TAKARDATA ;
- téléchargement du document officiel lorsque le dossier est prêt ;
- gestion des mairies, régions et communes ;
- génération d'un mot de passe temporaire pour les comptes mairie ;
- changement obligatoire du mot de passe à la première connexion et expiration après 90 jours ;
- PostgreSQL ;
- serveur Express capable de servir le frontend React après `npm run build` ;
- configuration Vite compatible avec Node 16.20.2 / macOS High Sierra.

## Compatibilité du Mac

Cible de test locale :
- macOS High Sierra 10.13
- Node.js 16.20.2
- npm 8.19.4
- PostgreSQL 17.x (Postgres.app)

Le projet n'utilise pas `node --watch` et utilise Vite 4.5.x afin d'éviter les incompatibilités de Vite 6 avec Node 16.

## 1. Installation locale

Dans Terminal :

```bash
cd TAKARDATA_V2.1/backend
cp .env.example .env
```

Puis adapte `DATABASE_URL` à ton rôle PostgreSQL si nécessaire. Exemple avec le rôle local `hightsierra` :

```env
DATABASE_URL=postgresql://hightsierra@localhost:5432/takardata
JWT_SECRET=change-moi-takardata-secret
FRONTEND_URL=http://localhost:5173
UPLOAD_DIR=uploads
NODE_ENV=development
```

Ensuite :

```bash
npm install
npm run setup
npm run seed
npm start
```

Dans un deuxième Terminal :

```bash
cd TAKARDATA_V2.1/frontend
npm install
npm run dev
```

Ouvre : http://localhost:5173

## Comptes de test

- TAKARDATA / administration : `admin@takardata.com` / `Admin123!`
- TAKARDATA / opérateur : `entreprise@takardata.com` / `Entreprise123!`
- Mairie d'Agadez : `mairie@agadez.ne` / `Mairie123!`

Le compte mairie est configuré pour demander un changement de mot de passe à la première connexion.

## Tester la CNI

1. Créer un compte citoyen avec les deux faces de CNI.
2. Se connecter au portail central avec `entreprise@takardata.com`.
3. Ouvrir « Vérification CNI ».
4. Vérifier le dossier.
5. Le citoyen peut alors se connecter.

La comparaison officielle OCR/biométrique n'est pas simulée comme une vraie vérification d'identité : l'interface et le statut sont prêts pour cette intégration, mais le contrôle actuel est manuel.

## Déploiement Render — test

Le plus simple est de déployer le dépôt comme un **Web Service** unique.

Build Command :

```bash
npm install --prefix backend && npm install --prefix frontend && npm run build --prefix frontend
```

Start Command :

```bash
cd backend && npm start
```

Variables d'environnement :

```env
DATABASE_URL=<URL PostgreSQL Render>
JWT_SECRET=<long secret aleatoire>
NODE_ENV=production
FRONTEND_URL=*
UPLOAD_DIR=uploads
```

Le serveur Express sert automatiquement `frontend/dist` une fois le build terminé.

### Important pour le test Render

Les fichiers uploadés dans `backend/uploads` sont stockés sur le disque du service. Sur Render, le système de fichiers d'un service sans disque persistant peut être perdu lors d'un redéploiement/redémarrage. Pour un vrai déploiement, utiliser un stockage persistant (par exemple un Render Disk ou un stockage objet) avant de considérer les documents administratifs comme durables.

## Vérifications réalisées dans cette version

- suppression de `node --watch` pour Node 16 ;
- remplacement de Vite 6 par Vite 4.5.x ;
- ajout des routes backend qui manquaient dans l'archive V2.1 ;
- API frontend en URL relative (`/api`) pour fonctionner en local et sur Render ;
- proxy Vite vers le backend en développement ;
- service du frontend React par Express en production ;
- gestion d'erreurs API et uploads ;
- transitions de statut contrôlées côté serveur ;
- contrôle d'accès par rôle côté serveur ;
- comptes mairie et changement de mot de passe ;
- workflow de document officiel.
