# Budget Flow Cloud V4.1

Cette version utilise **Supabase comme base principale** pour les données budget.
L’objectif est d’avoir la **même application sur téléphone et page Internet**, sans installation serveur et sans stockage IndexedDB pour les données budget.

## Ce que fait cette version

- connexion email / mot de passe via Supabase Auth
- sauvegarde des données budget directement en ligne dans Supabase
- synchronisation entre plusieurs mobiles et navigateurs
- plusieurs comptes
- gestion mois par mois
- duplication automatique du mois suivant
- reprise des dépenses récurrentes décochées
- dépenses prévues avec date, commentaire, catégorie, récurrence, case payée
- dépenses imprévues avec catégorie et priorité
- crédits / revenus
- notes par mois
- vue annuelle avec graphique
- export JSON
- export CSV annuel
- design mobile-first
- compatible GitHub Pages

## Structure

- `index.html`
- `styles.css`
- `app.js`
- `manifest.webmanifest`
- `service-worker.js`
- `supabase.sql`

## Déploiement

### 1. Créer le projet Supabase

Dans Supabase :
- crée un projet
- copie le **Project URL**
- copie la **anon key / publishable key** adaptée au navigateur

Supabase indique que la clé publique `anon` peut être utilisée côté navigateur si la sécurité d’accès repose sur les politiques RLS. citeturn263282search7turn263282search0

### 2. Créer la table et les règles d’accès

Ouvre le SQL Editor Supabase et exécute le contenu de `supabase.sql`.

Cette table stocke un **snapshot JSON par utilisateur**. Les politiques RLS limitent lecture et écriture à l’utilisateur connecté, ce qui correspond au modèle recommandé par Supabase pour protéger les données avec Auth + JWT + RLS. citeturn263282search0turn263282search10

### 3. Activer l’authentification

Dans **Authentication** de Supabase, active au minimum l’authentification **email / mot de passe**. Supabase Auth prend en charge ce mode nativement. citeturn263282search0

### 4. Déployer l’app

Tu peux mettre tous les fichiers sur GitHub Pages, qui sert très bien les projets statiques HTML / CSS / JS. GitHub Pages publie directement le contenu d’un dépôt GitHub comme site statique. citeturn263282search8

### 5. Configurer l’app

Au premier lancement :
- colle le Project URL
- colle la anon key
- crée ton compte
- connecte-toi

Ensuite l’app charge et sauvegarde automatiquement ton budget depuis Supabase.

## Modèle technique retenu

L’app est **cloud-first** :
- les données budget sont lues et écrites dans Supabase
- pas d’IndexedDB pour les comptes, mois et dépenses
- la session utilisateur est gérée par Supabase Auth côté navigateur

## Limites actuelles

- un seul snapshot par utilisateur
- pas encore de partage d’un même compte entre deux utilisateurs
- pas encore de fusion intelligente si deux appareils modifient exactement en même temps

## Suite possible

Une V5 peut ajouter :
- partage sécurisé d’un compte commun à deux utilisateurs
- historique de versions
- édition encore plus premium avec plus de modales et vues calendrier
- pièces jointes ou justificatifs
