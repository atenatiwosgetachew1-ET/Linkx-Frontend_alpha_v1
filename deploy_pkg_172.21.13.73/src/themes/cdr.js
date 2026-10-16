/**
 * CDR Theme — sky-blue + dark-navy palette for CDR Link Analysis.
 *
 * Retains the "Linkx" brand name but shifts the chrome and accents
 * from the original gold-on-navy to a lighter sky-blue-on-navy look.
 */
const cdr = {
  // ── Identity ──────────────────────────────────────────────
  id: "cdr",
  name: "Linkx",
  tagline: "Web Analyzer",
  copyright: "© 2026 Linkx. All rights reserved.",
  footerNotice:
    "Authorized use only. Unauthorized access is prohibited and may be monitored.",
  vigilanceLabel: "Linkx Vigilance",

  // ── Assets (relative to Vite BASE_URL) ────────────────────
  favicon: "site_images/Linkx square Icon (256x256).png",
  logo: "site_images/Linkx square Icon (256x256).png",
  backgroundImage: "site_images/Linkx_background_basic.webp",
  backgroundVideo: "site_videos/background.mp4",

  // ── Palette — injected as [data-brand="cdr"] CSS overrides ─
  colors: {
    chrome: "#1b6ca8",          // sky-blue primary chrome
    chromeDark: "#0f3b5e",      // deep navy for headings / dark elements
    chromeAlt: "#1a609a",       // secondary chrome variant
    sidebarBg: "#0d2137",       // dark navy sidebar
    logoGradientStart: "#4aafe6", // light sky blue gradient
    logoGradientEnd: "#1b6ca8",   // mid sky blue gradient
    logoCircleBg: "#2891cc",      // logo circle fill
    loginShellBg: "#06182c",      // login page deep navy
    loginOverlay:
      "linear-gradient(#060e18, #0a1a30cc, #0c2240)",
  },
};

export default cdr;
