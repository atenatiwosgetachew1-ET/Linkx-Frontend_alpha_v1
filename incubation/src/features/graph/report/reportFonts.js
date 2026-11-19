import ethiopicRegularUrl from './fonts/NotoSansEthiopic-Regular.ttf?url';
import ethiopicBoldUrl from './fonts/NotoSansEthiopic-Bold.ttf?url';

// Noto Sans Ethiopic (SIL Open Font License 1.1, fonts/OFL.txt), bundled as
// separate files and fetched only for a report with Ethiopic text, so other
// reports and the app's own bundle stay small. Resolves to { regular, bold }
// as base64, or null when they cannot be loaded (Ethiopic then prints "?").

const toBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
};

const fetchFont = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Font ${response.status}`);
  return toBase64(await response.arrayBuffer());
};

let pending = null;
export const loadEthiopicFonts = () => {
  if (!pending) {
    pending = Promise.all([fetchFont(ethiopicRegularUrl), fetchFont(ethiopicBoldUrl)])
      .then(([regular, bold]) => ({ regular, bold }))
      .catch(() => {
        pending = null;
        return null;
      });
  }
  return pending;
};
