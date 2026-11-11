# Theme Presets

Version-controlled theme presets. Every `*.json` file in this folder is
auto-loaded (via `index.js`) and appears in **Settings → Theme Studio → Theme
Presets**, where it can be applied in one click.

Because these presets live in the repository, they are **permanent**: they
survive browser changes, new machines, different dev-server ports, and are
shared with every teammate. This is the durable alternative to `localStorage`
overrides, which only exist in a single browser on a single origin.

## Format

```json
{
  "id": "my-theme",
  "name": "My Theme",
  "description": "Short description shown under the preset name.",
  "baseTheme": "nbe-daylight",
  "overrides": {
    "--accent": "#FFCF7A",
    "--panel-bg": "rgba(255, 255, 255, 0.96)"
  }
}
```

| Field | Required | Notes |
| :--- | :--- | :--- |
| `id` | no | Falls back to the filename. Use lowercase/kebab-case. |
| `name` | yes | Display name in the preset list. |
| `description` | no | Shown under the name. |
| `baseTheme` | no | A built-in theme id (see `THEMES` in `../themeRegistry.js`). The overrides are stored for that theme only. |
| `overrides` | yes | Map of CSS custom properties to values. These are your "custom overrides". |

## How to save a preset you designed

1. Customize colors with the Element Picker (Theme Studio → Launch Element Picker).
2. Theme Studio → **Save current as preset…** downloads a ready-to-commit JSON file.
3. Move that file into this folder and commit it.

That's it — it's now a permanent, selectable preset.
