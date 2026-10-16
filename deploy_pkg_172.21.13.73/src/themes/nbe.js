/**
 * NBE Theme — the original Linkx look & feel.
 *
 * Gold/amber accents on a dark-navy chrome.
 * This file captures every brand-level value that was previously
 * hard-coded across App.jsx, LoginPage.jsx and main.css.
 */
const nbe = {
  // ── Identity ──────────────────────────────────────────────
  id: "nbe",
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

  // ── Palette — injected as [data-brand="nbe"] CSS overrides ─
  colors: {
    chrome: "#314961",
    chromeDark: "#142e47",
    chromeAlt: "#2e465d",
    sidebarBg: "#19212e",
    logoGradientStart: "#ae794f",
    logoGradientEnd: "#7f4f23",
    logoCircleBg: "#925e35",
    loginShellBg: "#041327",
    loginOverlay:
      "linear-gradient(#050b11, #081019cc, #0a1622)",
  },
};

export default nbe;
