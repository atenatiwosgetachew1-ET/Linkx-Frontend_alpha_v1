# Styles

Component styles still live in `src/main.css`; theme tokens live in `themes/`.

## Theme architecture (`themes/`)

Tokens are layered so a theme only defines a small, stable set of values:

| Tier | Where | What |
| --- | --- | --- |
| Semantic | `themes/<theme-id>.css` | ~71 tokens: surfaces, text, borders, accent, actions (`--app-bg`, `--accent`, `--linkx-window-bg`, …). **Every theme must define all of them.** |
| Component | `themes/tokens.css` | ~840 tokens (`--central-*`, `--right-*`, `--window-*`, …) that default to `var(--semantic)` or `color-mix(in srgb, var(--semantic) N%, transparent)`. |
| Overrides | Theme Studio (runtime) | Inline CSS vars on `<html>`, stored **per theme** in `localStorage` (`linkx_theme_overrides_by_theme`). |

`nbe-daylight.css` defines the semantic tier on `:root`, so it is also the fallback for every theme.
A theme may override component tokens when it needs a deliberate deviation (see `dark.css`).

### Adding a theme

1. Copy `themes/emerald-dark.css` to `themes/<id>.css`, change the selector to `[data-theme="<id>"]` and the values.
2. Add `@import './<id>.css';` to `themes/index.css`.
3. Register it in `src/shared/theme/themeRegistry.js` (`id`, `name`, `colorScheme`, `previewColor`).
4. Run `npm run theme:check`. It fails on missing semantic tokens, unregistered files and `var()` cycles.

### Rules

- Component CSS uses component tokens (or semantic ones). Don't hard-code colors in `main.css`.
- Exception: the element picker's own chrome (`.element_picker_*` in `main.css`) is hard-coded on purpose, so it stays readable under any theme or override.
- New component tokens go in `tokens.css` and must reference a semantic token unless they are theme-neutral (status colors, black shadows).
- The pre-paint boot script in `index.html` mirrors the storage keys in `themeRegistry.js`. Keep them in sync.
