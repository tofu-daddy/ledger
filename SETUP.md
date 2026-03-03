# Ledger Setup (GitHub + Supabase)

## 1) Supabase table setup
1. Open your Supabase project: `yeiwludpviidmlfxeuid`.
2. Go to SQL Editor.
3. Run the SQL in [`supabase.setup.sql`](/Users/toniromero/Desktop/ledger/supabase.setup.sql).

This app now syncs state to Supabase table `public.ledger_states` using your anon key.

## 2) Run locally
Open [`index.html`](/Users/toniromero/Desktop/ledger/index.html) in a browser.

Login:
- username: `toni`
- password: `budget`

## 3) Push to GitHub
From `/Users/toniromero/Desktop/ledger`:

```bash
git init
git add .
git commit -m "Modern UI refresh + Supabase cloud sync"
git branch -M main
git remote add origin https://github.com/tofu-daddy/ledger.git
git push -u origin main
```

## Notes
- Client uses Supabase **anon** key only.
- Do **not** put service-role or secret API keys in frontend code.
- For production security, move to Supabase Auth + RLS per-user policies.
