# CRM SYSTEM — Multi-tenant SaaS

CRM de réservations (location de voitures) en **SaaS multi-tenant** : chaque client
crée son compte et ne voit **que ses propres données** (isolation par Row Level Security).

## Stack
- **Frontend** : HTML/CSS/JS statique (aucun build requis).
- **Backend / Auth / DB** : [Supabase](https://supabase.com) (projet `cars-chakroun`).
- **Emails transactionnels** : SMTP custom (Brevo).
- **Hébergement** : Hostinger (fichiers statiques → `public_html`).

## Structure
```
index.html            → Landing page (offres/plans + inscription/connexion)
app.html              → Application CRM (dashboard, protégé par session)
css/admin.css         → Styles de l'app
js/
  landing.js          → Plans + auth (email / téléphone / Google) + code OTP
  supabase-config.js  → URL + clé publique Supabase
  supabase-store.js   → Pont données : miroir md_* ⇆ Supabase (par utilisateur)
  admin.js            → Logique CRM
  panel-lang.js       → Traductions (FR / EN / AR)
  auth.js             → (hérité, non utilisé)
```

## Authentification
- Inscription par **Email + mot de passe**, **Téléphone** (nécessite un provider SMS),
  ou **Google** (OAuth).
- Mot de passe fort obligatoire (8+ car., majuscule, minuscule, chiffre, symbole).
- Confirmation par email : **lien** + **code à 6 chiffres** (template Supabase).

## Données (multi-tenant)
- Table `public.kv_store (user_id, key, value)` avec RLS `auth.uid() = user_id`.
- Chaque compte = un espace privé. Les données ne se mélangent jamais.

## Déploiement
1. Pousser sur GitHub.
2. Connecter le dépôt à Hostinger (Git) → déploiement auto à chaque push,
   ou téléverser les fichiers dans `public_html`.
3. Dans Supabase → Authentication → URL Configuration : mettre l'URL du site
   (Site URL + Redirect URLs) pour que Google/confirmation fonctionnent.

## Développement local
```bash
npx serve . -l 5500
# puis ouvrir http://localhost:5500  (ne pas ouvrir le fichier en file://)
```
