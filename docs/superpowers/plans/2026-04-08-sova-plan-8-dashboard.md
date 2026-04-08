# Plan 8: Sova Web Dashboard (React SPA)

**Date:** 2026-04-08
**Status:** Implementation

## Goal

Build Phase 1 (MVP) web dashboard for Sova: Login, Overview, Transactions, Analytics pages as a React 18 + TypeScript SPA served from FastAPI.

## Architecture

```
sova/dashboard/           <- Vite + React 18 + TS
  src/
    components/           <- Shared UI (Card, Badge, ProgressBar, etc.)
    pages/                <- Login, Dashboard, Transactions, Analytics
    layouts/              <- AppLayout (sidebar + bottom nav)
    lib/                  <- Helpers (formatCurrency, mock data)
    App.tsx               <- React Router
    main.tsx              <- Entry point
  index.html
  vite.config.ts
  tailwind.config.ts
  tsconfig.json
  package.json

sova/src/api/
  dashboard.py            <- Mock data endpoints
  router.py               <- Include dashboard router

sova/src/main.py          <- Mount static files + SPA fallback
```

## Steps

### 1. Project Setup
- `npm create vite` with React + TS template
- Install: tailwindcss@4, react-router-dom@6, recharts, lucide-react
- Configure Tailwind with design tokens (dark theme)
- Vite build output -> `dashboard/dist/`

### 2. Design Tokens (Tailwind)
```
bg: #0D1117, card: #1C2333, card-border: #30363D
primary: #F5A623, text: #F0F6FC, text-secondary: #8B949E
success: #3FB950, error: #F85149, warning: #D29922
Font: Inter, border-radius: 12px for cards
```

### 3. Login Page (P0)
- Centered layout: shield icon + "Сова" + tagline
- "Войти через Telegram" amber button
- Footer links: privacy, terms
- Mock auth: store fake token in localStorage

### 4. Layout & Navigation
- Desktop: left sidebar (240px) with logo, nav items, AI balance widget, user
- Mobile: bottom tab bar (5 items)
- React Router: /, /transactions, /analytics (plus future stubs)

### 5. Dashboard/Overview (P0)
- 2-col balance cards (total balance + portfolio)
- Bar chart: income vs expenses (Recharts)
- Goals section: 2 cards with progress bars
- Recent transactions: 5 items

### 6. Transactions (P1)
- Search + filter chips
- Table with date, description, category+icon, amount
- Export CSV button
- 10 mock transactions

### 7. Analytics (P1)
- Period tabs (month/quarter/year)
- Donut chart: expenses by category (Recharts)
- Top categories list
- Stacked bar chart: category trends
- Expense calendar (simplified heatmap grid)
- Anomaly/recommendation cards

### 8. FastAPI Integration
- Add GET /api/dashboard/overview, /transactions, /analytics
- Mount dashboard/dist as StaticFiles on "/"
- SPA fallback: non-API routes -> index.html

### 9. Build & Verify
- `npm run build` -> dashboard/dist/
- Test FastAPI serves dashboard at localhost

## Dependencies
- react@18, react-dom@18, react-router-dom@6
- recharts, lucide-react
- tailwindcss@4, @tailwindcss/vite
- vite, typescript

## Success Criteria
- All 4 pages render with polished dark UI matching design mockups
- FastAPI serves the SPA with API routes working
- Production build < 500KB gzipped
- Mobile responsive layout works
