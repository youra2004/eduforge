# ADR-0017: UI design system

- One hand-written stylesheet (`apps/web/src/app/globals.css`) with CSS variables for color, radius and shadow, no CSS framework and no component library; earlier class names are kept, so pages stay thin. Light theme only (no dark mode), Inter Variable via `@fontsource-variable/inter` (self-hosted, has Cyrillic), icons are small inline SVGs in `components/icons.tsx`.
- Server pages use `PageHeader` / `EmptyState` / `Progress` from `components/ui.tsx`; interactive states (hover, focus ring, `aria-busy` spinner, disabled, error, empty) live in the stylesheet, not in components.
- No `loading.tsx`: a loading boundary streams the page and turns `forbidden()` / `notFound()` into HTTP 200, which the e2e tests (and the server-is-the-authority rule) forbid. `error.tsx`, `not-found.tsx` and `forbidden.tsx` carry the failure states.
