// Property names and values in the right panel's Info tab, as production
// shows them (src/App.jsx formatPropertyKeyLabel ~77, formatPropertyValue
// ~111): on the CDR domain, banking field names read as call-record terms
// and durations as seconds with minutes.

const CDR_LABELS = [
  [['ACCOUNTNO', 'ACCOUNT_NO', 'SOURCE_ACCOUNT', 'CALLING_NO'], 'Calling Number (MSISDN)'],
  [['BENACCOUNTNO', 'TARGET_ACCOUNT', 'DESTINATION_ACCOUNT', 'CALLED_NO'], 'Called Number (Destination)'],
  [['AMOUNTINBIRR', 'AMOUNT', 'DURATION', 'DURATION_SEC'], 'Call Duration'],
  [['TRANSACTIONDATE', 'TX_DATE', 'START_TIME', 'CALL_DATE'], 'Call Start Time'],
  [['TRANSACTIONID', 'TX_ID', 'CALL_ID'], 'Call Record ID'],
  [['BRANCH', 'CHANNEL', 'LOCATION_ID', 'TOWER_ID'], 'Cell Tower ID / Location'],
  [['HIGH_RISK_COUNTERPARTY'], 'High Risk Contact / Watchlist'],
  [['ACCOWNERNAME', 'CALLER_NAME'], 'Caller / Subscriber Name'],
  [['BENFULLNAME', 'CALLEE_NAME'], 'Called Party Name'],
];

export const formatPropertyKeyLabel = (key, isCdr = false) => {
  if (!isCdr) return String(key);
  const upper = String(key || '').toUpperCase();
  return CDR_LABELS.find(([keys]) => keys.includes(upper))?.[1] || String(key);
};

// Production strips currency with the character class /[$,ETB|Birr]/gi,
// which deletes the letters E, T, B, i, r (and "|") one by one. The intent was
// to remove the currency words; that is what is done here (deliberate fix).
const stripCurrency = (value) => String(value ?? '').replace(/\b(ETB|Birr)\b/gi, '').replace(/[$,]/g, '').trim();

export const formatPropertyValue = (key, value, isCdr = false) => {
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  if (!isCdr) return String(value ?? '');
  const upper = String(key || '').toUpperCase();
  if (upper.includes('AMOUNT') || upper.includes('DURATION') || upper === 'VAL') {
    const text = stripCurrency(value);
    const seconds = Number(text);
    if (text !== '' && !Number.isNaN(seconds)) {
      if (seconds >= 60) return `${seconds} sec (${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s)`;
      return `${seconds} sec`;
    }
    return text;
  }
  return String(value ?? '').replace(/\b(ETB|Birr)\b/gi, '').replace(/\$/g, '').trim();
};
