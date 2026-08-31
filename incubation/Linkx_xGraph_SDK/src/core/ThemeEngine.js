/**
 * @file ThemeEngine.js
 * Extracted ThemeEngine for Linkx graph rendering system.
 */

function normalizeColorToken(value) {
    return String(value || "").replace(/\s+/g, "").toLowerCase();
}

function hexToRgb(hex) {
    hex = hex.replace(/^#/, "");
    if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
    if (hex.length !== 6) return null;
    return {
        r: parseInt(hex.substring(0, 2), 16),
        g: parseInt(hex.substring(2, 4), 16),
        b: parseInt(hex.substring(4, 6), 16)
    };
}

function brightenColor(colorHex, percent) {
    const rgb = hexToRgb(colorHex);
    if (!rgb) return colorHex;
    let { r, g, b } = rgb;
    r = Math.max(0, Math.min(255, r + (255 - r) * (percent / 100)));
    g = Math.max(0, Math.min(255, g + (255 - g) * (percent / 100)));
    b = Math.max(0, Math.min(255, b + (255 - b) * (percent / 100)));
    return "#" + ("0" + Math.round(r).toString(16)).slice(-2) + ("0" + Math.round(g).toString(16)).slice(-2) + ("0" + Math.round(b).toString(16)).slice(-2);
}

function darkenColor(colorHex, percent) {
    const rgb = hexToRgb(colorHex);
    if (!rgb) return colorHex;
    let { r, g, b } = rgb;
    r = Math.max(0, Math.min(255, r * (100 - percent) / 100));
    g = Math.max(0, Math.min(255, g * (100 - percent) / 100));
    b = Math.max(0, Math.min(255, b * (100 - percent) / 100));
    return "#" + ("0" + Math.round(r).toString(16)).slice(-2) + ("0" + Math.round(g).toString(16)).slice(-2) + ("0" + Math.round(b).toString(16)).slice(-2);
}

function buildNodeColorStates(baseBg, baseBorder) {
    return {
        background: baseBg,
        border: baseBorder,
        hover: {
            background: brightenColor(baseBg, 12),
            border: darkenColor(baseBorder || baseBg, 20)
        },
        highlight: {
            background: brightenColor(baseBg, 18),
            border: darkenColor(baseBorder || baseBg, 20)
        }
    };
}

function isWhiteLike(value) {
    const token = normalizeColorToken(value);
    return token === "#fff" || token === "#ffffff" || token === "rgb(255,255,255)" || token === "rgba(255,255,255,1)";
}

function isBlackLike(value) {
    const token = normalizeColorToken(value);
    return token === "#000" || token === "#000000" || token === "rgb(0,0,0)" || token === "rgba(0,0,0,1)";
}

function isLightDefaultNodeColor(color) {
    if (!color) return true;
    if (typeof color === "string") {
        const token = normalizeColorToken(color);
        return isWhiteLike(color) || token === "transparent" || token === "rgba(0,0,0,0)" || token === "rgba(0,0,0,0.0)";
    }
    const bg = color.background;
    const border = normalizeColorToken(color.border);
    const defaultBorder = border === "" || border === "#555" || border === "#333" || border === "#111" || border === "#777" || border === "#777777";
    const bgToken = normalizeColorToken(bg);
    const defaultBg = isWhiteLike(bg) || bgToken === "transparent" || bgToken === "rgba(0,0,0,0)" || bgToken === "rgba(0,0,0,0.0)";
    return defaultBg && defaultBorder;
}

function isLightDefaultEdgeColor(color) {
    if (!color) return true;
    if (typeof color === "string") return isBlackLike(color);
    if (color.inherit === true) return true;
    return isBlackLike(color.color);
}

function isBuiltinGraphSvgIcon(iconPath) {
    const raw = String(iconPath || "").trim();
    if (!raw || raw.indexOf("data:") === 0) return false;
    return /graph_icons\/.+\.svg/i.test(raw);
}

function getIconCacheKey(iconPath, mode) {
    try {
        return new URL(iconPath, typeof window !== 'undefined' ? window.location.href : "http://localhost").toString() + "|" + mode;
    } catch (_err) {
        return String(iconPath || "").trim() + "|" + mode;
    }
}

function svgToDataUrl(svgText) {
    const encoded = encodeURIComponent(svgText)
        .replace(/%20/g, " ")
        .replace(/%3D/g, "=")
        .replace(/%3A/g, ":")
        .replace(/%2F/g, "/");
    return "data:image/svg+xml;charset=UTF-8," + encoded;
}

function recolorSvgForDarkMode(svgText) {
    if (typeof svgText !== "string" || svgText.indexOf("<svg") === -1) return svgText;
    if (svgText.indexOf("<style") !== -1) return svgText;
    return svgText.replace(/<svg\b[^>]*>/i, function(openTag) {
        return openTag + "<style>path,rect,circle,ellipse,polygon,line,polyline{fill:#ffffff !important;stroke:#ffffff !important;}</style>";
    });
}

export class ThemeEngine {
    constructor(mode = 'light') {
        this.mode = mode;
        this.iconCache = new Map();
        this.iconPending = new Set();
    }

    setMode(mode) {
        this.mode = mode === "dark" ? "dark" : "light";
    }

    getNodeDefaults() {
        if (this.mode === "dark") {
            return {
                background: "rgba(0,0,0,0)",
                border: "#3e5775",
                highlight: { background: "rgba(0,0,0,0)", border: "#4a6484" },
                hover: { background: "rgba(0,0,0,0)", border: "#446082" }
            };
        }
        return {
            background: "rgba(0,0,0,0)",
            border: "#555",
            highlight: { background: "rgba(0,0,0,0)", border: "#111" },
            hover: { background: "rgba(0,0,0,0)", border: "#333" }
        };
    }

    getNodeLabelColor() {
        return this.mode === "dark" ? "#8fa4bd" : "#111111";
    }

    getEdgeDefaults() {
        if (this.mode === "dark") {
            return { color: "#485360", highlight: "#5b6776", hover: "#55616f", inherit: false };
        }
        return { color: "rgba(0,0,0,1)", highlight: "rgba(0,0,0,1)", hover: "rgba(0,0,0,1)", inherit: false };
    }

    getCanvasBackground() {
        return this.mode === "dark" ? "#1e242a" : "#ffffff";
    }

    applyToNetwork(visNetwork) {
        const nodeDefaults = this.getNodeDefaults();
        const edgeDefaults = this.getEdgeDefaults();
        if (visNetwork && visNetwork.setOptions) {
            visNetwork.setOptions({
                nodes: { color: nodeDefaults, font: { color: this.getNodeLabelColor() } },
                edges: { color: edgeDefaults }
            });
        }
    }

    normalizeNodeForTheme(rawNode) {
        let themedNode = { ...rawNode };
        
        // 1. Generate missing hover/highlight colors based on the base color
        if (themedNode.color && typeof themedNode.color === 'object') {
            const bg = themedNode.color.background;
            if (bg && (!themedNode.color.hover || !themedNode.color.highlight)) {
                themedNode.color = buildNodeColorStates(bg, themedNode.color.border);
            }
        }

        // 2. Apply dark mode overrides if necessary
        if (this.mode === "dark") {
            const needsColor = isLightDefaultNodeColor(themedNode?.color);
            const currentFontColor = normalizeColorToken(themedNode?.font?.color);
            const needsFontColor = !currentFontColor || isBlackLike(currentFontColor);
            if (needsColor) themedNode.color = this.getNodeDefaults();
            if (needsFontColor) themedNode.font = { ...(themedNode?.font || {}), color: this.getNodeLabelColor() };
        }
        
        return themedNode;
    }

    normalizeEdgeForTheme(rawEdge) {
        if (this.mode !== "dark") return rawEdge;
        if (!isLightDefaultEdgeColor(rawEdge?.color)) return rawEdge;
        return { ...rawEdge, color: this.getEdgeDefaults() };
    }

    _ensureDarkIconCached(iconPath, nodeIdHint, callback) {
        if (!isBuiltinGraphSvgIcon(iconPath)) return;
        const cacheKey = getIconCacheKey(iconPath, "dark");
        if (this.iconCache.has(cacheKey) || this.iconPending.has(cacheKey)) return;
        this.iconPending.add(cacheKey);

        let requestUrl = iconPath;
        try { requestUrl = new URL(iconPath, typeof window !== 'undefined' ? window.location.href : "http://localhost").toString(); } catch (_err) {}

        if (typeof fetch !== 'undefined') {
            fetch(requestUrl)
                .then(resp => (resp.ok ? resp.text() : Promise.reject(new Error("Icon fetch failed"))))
                .then(svgText => {
                    const themedUrl = svgToDataUrl(recolorSvgForDarkMode(svgText));
                    this.iconCache.set(cacheKey, themedUrl);
                    if (callback) callback(nodeIdHint, themedUrl, iconPath);
                })
                .catch(() => {})
                .finally(() => { this.iconPending.delete(cacheKey); });
        }
    }

    resolveIconForTheme(iconPath, nodeIdHint, onIconLoaded) {
        if (this.mode !== "dark" || !isBuiltinGraphSvgIcon(iconPath)) return iconPath;
        const cacheKey = getIconCacheKey(iconPath, "dark");
        const cached = this.iconCache.get(cacheKey);
        if (cached) return cached;
        this._ensureDarkIconCached(iconPath, nodeIdHint, onIconLoaded);
        return iconPath;
    }

    getDocumentIconDataUri(fillColor = "#4f6c86") {
        const fill = String(fillColor || "#4f6c86");
        const pathData = "M19.5 3h0.5l6 7v18.009c0 1.093-0.894 1.991-1.997 1.991h-15.005c-1.107 0-1.997-0.899-1.997-2.007v-22.985c0-1.109 0.897-2.007 2.003-2.007h10.497zM19 4h-10.004c-0.55 0-0.996 0.455-0.996 0.995v23.009c0 0.55 0.455 0.995 1 0.995h15c0.552 0 1-0.445 1-0.993v-17.007h-4.002c-1.103 0-1.998-0.887-1.998-2.006v-4.994zM20 4.5v4.491c0 0.557 0.451 1.009 0.997 1.009h3.703l-4.7-5.5z";
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path fill="' + fill + '" d="' + pathData + '"/></svg>';
        return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
    }

    getOleDefaults() {
        if (this.mode === "dark") {
            return {
                iconFill: "#d5e1ec",
                fontColor: "#a9bdd1",
                shadowColor: "rgba(111, 139, 164, 0.34)",
                accentColor: "#8ca9c4"
            };
        }
        return {
            iconFill: "#4f6c86",
            fontColor: "#2f4a63",
            shadowColor: "rgba(79, 108, 134, 0.24)",
            accentColor: "#4f6c86"
        };
    }
    
    isLegacyOleColorToken(value) {
        const token = String(value == null ? "" : value)
            .replace(/\s+/g, "")
            .toLowerCase();
        return token === "#7c3aed"
            || token === "#6d28d9"
            || token === "rgba(124,58,237,0.32)"
            || token === "rgba(124,58,237,0.35)"
            || token === "rgb(124,58,237)"
            || token === "rgb(109,40,217)";
    }
}

export default ThemeEngine;
