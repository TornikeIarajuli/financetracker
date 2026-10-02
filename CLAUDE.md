# Finance Tracker

Personal finance tracker app in Georgian (React + Vite).

## Tech Stack
- React + Vite (no TypeScript)
- IndexedDB via `src/store/db.js`, synced to one Supabase row (`finance_data`, id `main`)
- Recharts for charts
- CSS in `src/index.css` + `src/App.css` (CSS variables: `var(--primary)`, etc.)
- PWA with service worker (vite-plugin-pwa)

## Project Structure
- `src/pages/` — Dashboard, Transactions, Reports, Goals (savings goals + wishlist stacked on one page, anchors `#savings` / `#wishlist`; `/savings` and `/wishlist` redirect there; Dashboard savings/wishlist cards link to them)
- `src/utils/currency.js` — savings goals keep their own currency; always format with `formatGoalAmount`, never `formatCurrency` (₾)
- `src/store/db.js` — all IndexedDB operations + cloud sync (single source of truth)
- `src/store/syncMerge.js` — merge rules; **identical copy in `../finance-app/src/store/syncMerge.js`** (the Expo mobile app writes the same cloud row) — change both together
- `src/store/supabase.js` — Supabase client, email/password auth, row read/write
- `src/utils/dates.js` — always use `parseDate`/`formatDate`/`inMonth` for `yyyy-MM-dd` strings (never `new Date(t.date)`)
- `src/utils/stats.js` — chart/aggregate helpers shared by Dashboard and Reports
  - Savings: expense categories named "დანაზოგ…" (or `isSavings`) are reported as `saved`, not `expenses`; `balance` = income − expenses − saved. Pass `savingsCategoryIds(categories)` to `totalsOf`/`monthlyStats`
  - Current month is compared with the same days of last month (`monthToDateStats`) and drawn dashed in trends (`markPartialLast`)
  - Income is always called "შემოსავალი" in the UI (not "მაქვს")
- Duplicate categories (same type + name) can be merged in Reports → იმპორტი/ექსპორტი; `mergeCategories` re-points transactions (keeps `mergedFromCategoryId`, undo via `unmergeCategory`) and archives the source
- `supabase/rls.sql` — row-level-security policy (run after both apps are signed in)
- `dist/` — built output, rebuild with `npm run build`

## Key Conventions
- Language: Georgian (ქართული) for ALL UI text
- Currency: Georgian Lari (₾), formatted via `formatCurrency()` from db.js
- Colors: primary=#3b82f6 (blue, see `--primary` in index.css)
- Always run `npm run build` after changes to update dist/

## Data Safety Rules (do not break)
- Every write in db.js is wrapped in `locked()` and ends with `afterWrite()` (marks change, backs up to localStorage, schedules sync)
- Records are only removed by an explicit user delete, which writes a tombstone (`deleted` in the cloud doc, `settings.tombstones` locally)
- Sync = merge by id in both directions (`mergeDatasets`), never a wholesale replace; import/restore only ADD missing records
- Default categories are created with `seed: true`; unused seeds are dropped once real categories exist

## Data Architecture
- **Categories are per-month** (`monthlyCategories` store, DB v5)
  - Each month has its own independent category snapshot
  - First visit to a month creates its snapshot from the previous month's list, keeping only categories used last month (or already this month); falls back to the full list if nothing was used. Existing snapshots are never rewritten automatically
  - 🧹 on Transactions applies the same filter to the current month; "+ დამატება" can re-add an existing category by id (keeps history)
  - Adding/deleting categories in one month does NOT affect other months
  - Global `categories` store is kept for cross-month lookups (Reports, Dashboard trends)
- **Budgets are per-month** (`monthlyBudgets` store)
- **Transactions** reference `categoryId` — lookups fall back to global categories for historical data
- Soft-delete: global category deletion sets `archived: true` (not hard delete)
- `stocks` / `recurringTransactions` stores have no UI any more but their data is kept and synced

## Budget Card States (Transactions page)
- **< 80%**: normal, category color bar
- **80-99%**: orange warning — pulsing orange border, orange bar, `⚠️ XX%` badge
- **100%**: green complete — green border/bar, `✅` badge
- **> 100%**: red over-budget — red pulsing border, red bar, `⚠️ +XX ₾` badge

## Dashboard Layout
- Stat cards (6) → 6-month trend chart → stacked bar (expenses by category) → quarterly summary + category drill-down → spending bars + savings goals
- No donut chart, no recent transactions list
