# Restoring Hidden Source Windows

The "New Source" and "Source window" buttons have been hidden via a CSS class named `to_restore_source_window`.

To restore these buttons and make them visible again, you simply need to remove or modify the CSS rule located at the bottom of `src/main.css`:

```css
/* Hidden components per requirements */
.to_restore_source_window {
  display: none !important;
}
```

You can either delete those lines from `src/main.css`, or change `display: none !important;` to `display: flex !important;`.
