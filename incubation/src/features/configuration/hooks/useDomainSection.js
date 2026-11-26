import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { getServiceRefusalMessage } from '../../../services/apiErrors.js';
import { fetchDomainHistory, fetchDomainSection, isFeatureDisabled } from '../../../services/domainConfigApi.js';
import { asOwnChange, getDomainChangeSeq, subscribeDomainChanges } from '../lib/domainChanges.js';

// One section of a domain (`sensitivity`, `columns`, `mapping`) and its
// history, read again when someone changes it. A save always ends on the
// Service's own state, never on what was typed.
// -> { state, status: 'loading' | 'ready' | 'error' | 'missing', error, history, reload, save }
export default function useDomainSection({ apiFetch, domain, section, canManage }) {
  const [state, setState] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);
  const [tick, setTick] = useState(0);
  const changeSeq = useSyncExternalStore(subscribeDomainChanges, () => getDomainChangeSeq(domain, section));
  const readRef = useRef(0);

  useEffect(() => {
    const mine = ++readRef.current;
    const current = () => mine === readRef.current;
    fetchDomainSection(apiFetch, domain, section).then((next) => {
      if (!current()) return;
      if (!next) throw new Error('The Service’s answer could not be read.');
      setState(next);
      setStatus('ready');
      setError('');
    }).catch((failure) => {
      if (!current()) return;
      setStatus(isFeatureDisabled(failure) || failure?.status === 404 ? 'missing' : 'error');
      setError(getServiceRefusalMessage(failure) || failure?.message || 'It could not be loaded.');
    });
    if (canManage) {
      fetchDomainHistory(apiFetch, domain, section)
        .then((items) => { if (current()) setHistory(items); })
        .catch(() => {});
    }
    return () => { readRef.current += 1; };
  }, [apiFetch, domain, section, canManage, tick, changeSeq]);

  const reload = useCallback(() => setTick((value) => value + 1), []);

  // send(): one of domainConfigApi's saves. -> its result
  const save = useCallback(async (send) => {
    const result = await asOwnChange(domain, section, send, (answer) => answer?.state?.versionId);
    if (result.ok && result.state) setState(result.state);
    if (!result.ok) setState(result.conflict);
    // The history has a new line; a save without a state is read again.
    setTick((value) => value + 1);
    return result;
  }, [domain, section]);

  return { state, status, error, history, reload, save };
}

// { field: message } of a refused save ({ errors: [{ field, message }] }).
export const readFieldErrors = (failure) => Object.fromEntries((Array.isArray(failure?.data?.errors) ? failure.data.errors : [])
  .filter((entry) => typeof entry?.field === 'string' && entry.message)
  .map((entry) => [entry.field, String(entry.message).slice(0, 200)]));
