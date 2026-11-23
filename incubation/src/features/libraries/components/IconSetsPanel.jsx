import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { Block, Masthead, PageHero, Pill, SettingsPage, SettingsPopup, Stat, Stats } from '../../settings/components/SettingsPage.jsx';
import { downloadBlob } from '../../graph/lib/graphFile.js';
import { resolveIconUrl } from '../../graph/lib/graphIcons.js';
import {
  BUILTIN_CATEGORIES,
  BUILTIN_SET,
  BUILTIN_SET_ID,
  ICON_FILE_ACCEPT,
  ICON_LIMITS,
  addIcons,
  createIconSet,
  customBytes,
  exportIconSet,
  getIconSets,
  iconSetFileName,
  importIconSet,
  readIconFile,
  removeIcon,
  removeIconSet,
  renameIcon,
  setIconSetEnabled,
  subscribeIconSets,
  updateIconSet,
} from '../../graph/lib/iconSets.js';

// Libraries ▸ Icon sets (analyst request 2026-11-23): the icons a node can
// be given in a Graph window. The built-in set, by category, and the
// analyst's own sets: made here, filled by uploading images, turned on or
// off for the Graph window's icon album, and moved between browsers as a
// file. Scope: this device, until the Service keeps them (backend request
// B-34).

const ICONS = {
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  upload: 'M12 16V4M6 10l6-6 6 6M4 20h16',
  bin: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6',
};
const Glyph = ({ d, size = 13 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const srcOf = (set, icon) => (set.builtIn ? resolveIconUrl(icon.name) : icon.src);
const kb = (bytes) => `${Math.max(bytes ? 1 : 0, Math.round(bytes / 1024)).toLocaleString()} KB`;

// A text field that keeps what is typed to itself and saves it on blur or
// Enter (saving on every key would clean the text while it is being typed).
function CommitInput({ value, onCommit, ...rest }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => { if (draft !== value) onCommit(draft); };
  return (
    <input
      {...rest}
      className="settings_input"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
    />
  );
}

// New set, or more icons for a set: a name (new only), the images chosen or
// dropped, each read and checked before anything is kept.
function UploadPopup({ set, onClose, onDone }) {
  const isNew = !set;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [items, setItems] = useState([]); // { key, ok, name, src?, reason? }
  const [reading, setReading] = useState(false);
  const [over, setOver] = useState(false);
  const [problem, setProblem] = useState('');
  const inputRef = useRef(null);
  const good = items.filter((item) => item.ok);
  const room = ICON_LIMITS.SET_ICONS - (set?.icons.length || 0);

  const take = async (fileList) => {
    const files = [...(fileList || [])];
    if (!files.length) return;
    setReading(true);
    setProblem('');
    const read = await Promise.all(files.map(readIconFile));
    setItems((current) => [...current, ...read.map((item, index) => ({ ...item, key: `${Date.now()}-${index}-${item.name}` }))]);
    setReading(false);
  };
  const submit = () => {
    const icons = good.slice(0, room).map(({ name: iconName, src }) => ({ name: iconName, src }));
    const result = isNew ? createIconSet({ name, description, icons }) : addIcons(set.id, icons);
    if (!result.ok) {
      setProblem(result.reason);
      return;
    }
    onDone({ id: isNew ? result.id : set.id, added: icons.length, isNew });
  };
  const ready = isNew ? Boolean(name.trim()) : good.length > 0;

  return (
    <SettingsPopup
      title={isNew ? 'New icon set' : `Add icons to ${set.name}`}
      subtitle={isNew ? 'Name it, then add its images' : `${set.icons.length} of ${ICON_LIMITS.SET_ICONS} icons used`}
      hint={`SVG, PNG, JPEG or WebP · up to ${Math.round(ICON_LIMITS.FILE_BYTES / 1024)} KB each`}
      narrow
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="graph_customize_button" onClick={onClose}>Cancel</button>
          <button type="button" className="graph_customize_button is-primary" disabled={!ready || reading} onClick={submit}>
            {isNew ? (good.length ? `Create set with ${Math.min(good.length, room)} icon${Math.min(good.length, room) === 1 ? '' : 's'}` : 'Create empty set') : `Add ${Math.min(good.length, room)} icon${Math.min(good.length, room) === 1 ? '' : 's'}`}
          </button>
        </>
      )}
    >
      <div className="libraries_upload">
        {isNew ? (
          <>
            <label className="graph_customize_field">
              <span>Set name</span>
              <input className="graph_customize_input" value={name} maxLength={ICON_LIMITS.NAME} placeholder="e.g. Telecom equipment" onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="graph_customize_field">
              <span>Description (optional)</span>
              <input className="graph_customize_input" value={description} maxLength={200} placeholder="What these icons are for" onChange={(event) => setDescription(event.target.value)} />
            </label>
          </>
        ) : null}
        <button
          type="button"
          className={`libraries_dropzone${over ? ' is-over' : ''}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => { event.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => { event.preventDefault(); setOver(false); take(event.dataTransfer?.files); }}
        >
          <Glyph d={ICONS.upload} size={20} />
          <strong>{reading ? 'Reading…' : 'Choose images, or drop them here'}</strong>
          <small>Square images on a clear background work best. Each file becomes one icon, named after the file.</small>
        </button>
        <input ref={inputRef} type="file" accept={ICON_FILE_ACCEPT} multiple hidden aria-label="Icon images" onChange={(event) => { take(event.target.files); event.target.value = ''; }} />
        {items.length ? (
          <ul className="libraries_upload_list" aria-label="Chosen images">
            {items.map((item) => (
              <li key={item.key} className={item.ok ? '' : 'is-bad'}>
                <span className="libraries_icon_plate" aria-hidden="true">{item.ok ? <img src={item.src} alt="" /> : <Glyph d="M18 6L6 18M6 6l12 12" />}</span>
                {item.ok ? (
                  <input
                    className="graph_customize_input"
                    aria-label={`Name of ${item.name}`}
                    value={item.name}
                    maxLength={ICON_LIMITS.NAME}
                    onChange={(event) => setItems((current) => current.map((entry) => (entry.key === item.key ? { ...entry, name: event.target.value } : entry)))}
                  />
                ) : <span className="libraries_upload_reason"><strong>{item.name}</strong> {item.reason}</span>}
                <button type="button" className="config_row_remove" aria-label={`Leave out ${item.name}`} title="Leave out" onClick={() => setItems((current) => current.filter((entry) => entry.key !== item.key))}>
                  <Glyph d={ICONS.bin} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {good.length > room ? <p className="settings_hint" role="status">Only the first {room} fit: a set holds up to {ICON_LIMITS.SET_ICONS} icons.</p> : null}
        {problem ? <div className="settings_error" role="alert">{problem}</div> : null}
      </div>
    </SettingsPopup>
  );
}

export default function IconSetsPanel({ onNotice }) {
  const state = useSyncExternalStore(subscribeIconSets, getIconSets);
  const [selectedId, setSelectedId] = useState(BUILTIN_SET_ID);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [popup, setPopup] = useState(null); // 'new' | 'add'
  const [iconId, setIconId] = useState('');
  const [armed, setArmed] = useState(false);
  const importRef = useRef(null);
  const notice = (title, message, level = 'success') => onNotice?.({ title, message, level, source: 'Libraries' });

  const allSets = useMemo(() => [{ ...BUILTIN_SET, enabled: state.builtinEnabled }, ...state.sets], [state]);
  const selected = allSets.find((set) => set.id === selectedId) || allSets[0];
  const used = customBytes(state);
  const customIcons = state.sets.reduce((sum, set) => sum + set.icons.length, 0);
  const inAlbum = allSets.filter((set) => set.enabled).length;

  // A delete confirmation expires; a change of set drops what was picked.
  useEffect(() => {
    if (!armed) return undefined;
    const timer = setTimeout(() => setArmed(false), 6000);
    return () => clearTimeout(timer);
  }, [armed]);
  useEffect(() => {
    setQuery('');
    setCategory('');
    setIconId('');
    setArmed(false);
  }, [selected.id]);

  const wanted = query.trim().toLowerCase();
  const icons = selected.icons.filter((icon) => (!wanted || icon.name.toLowerCase().includes(wanted)) && (!category || icon.category === category));
  const picked = selected.builtIn ? null : selected.icons.find((icon) => icon.id === iconId) || null;
  const report = (result, ok) => {
    if (result.ok) ok?.();
    else notice('Icon sets', result.reason, 'warning');
    return result.ok;
  };

  const handleImport = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const result = importIconSet(await file.text());
    if (report(result, () => notice('Icon set imported', `${result.added} icon${result.added === 1 ? '' : 's'} added as a new set.`))) setSelectedId(result.id);
  };
  const handleExport = () => {
    downloadBlob(iconSetFileName(selected), new Blob([exportIconSet(selected.id)], { type: 'application/json' }));
    notice('Icon set exported', `“${selected.name}” was saved as a file. Import it in another browser to use it there.`);
  };
  const handleDelete = () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    const name = selected.name;
    if (report(removeIconSet(selected.id), () => notice('Icon set deleted', `“${name}” was removed. Graphs that use its icons keep them.`))) setSelectedId(BUILTIN_SET_ID);
  };

  return (
    <SettingsPage className="config_page libraries_page libraries_icons">
      <Masthead>
        <PageHero
          eyebrow="Icon sets"
          title="Node icons"
          pill={<Pill tone={state.sets.length ? 'active' : 'neutral'}>{state.sets.length ? `${state.sets.length} custom set${state.sets.length === 1 ? '' : 's'}` : 'Built-in only'}</Pill>}
          meta="The icons a node can be given in a Graph window: the set that comes with LinkX, and sets of your own images."
          media={(
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" />
            </svg>
          )}
        />
        <Stats label="Icon set figures" columns={4}>
          <Stat lead icon="layers" label="Sets" value={allSets.length.toLocaleString()} note={`${inAlbum} in the icon album`} />
          <Stat icon="lock" label="Built-in icons" value={BUILTIN_SET.icons.length.toLocaleString()} note={`${BUILTIN_CATEGORIES.length} categories`} />
          <Stat icon="list" label="Custom icons" value={customIcons.toLocaleString()} note={`in ${state.sets.length} set${state.sets.length === 1 ? '' : 's'}`} />
          <Stat text icon="database" label="Space used" value={kb(used)} note={`of ${Math.round(ICON_LIMITS.TOTAL_BYTES / 1024 / 1024)} MB in this browser`} />
        </Stats>
      </Masthead>

      <p className="settings_hint">Custom sets are kept in this browser. An icon put on a node is saved with the graph, so graphs stay whole when a set is changed, deleted or missing on another device.</p>

      <Block
        title="Sets"
        description="Turn a set on to offer its icons in the Graph window's icon album."
        actions={(
          <>
            <button type="button" className="settings_button" onClick={() => importRef.current?.click()} title="Add a set from an exported file">Import set…</button>
            <button type="button" className="settings_button settings_primary" disabled={state.sets.length >= ICON_LIMITS.SETS} onClick={() => setPopup('new')}>New set</button>
          </>
        )}
      >
        <input ref={importRef} type="file" accept=".json,application/json" hidden aria-label="Icon set file" onChange={handleImport} />
        <ul className="libraries_sets" aria-label="Icon sets">
          {allSets.map((set) => (
            <li key={set.id} className={`libraries_set${set.id === selected.id ? ' is-open' : ''}`}>
              <button type="button" className="libraries_set_open" aria-pressed={set.id === selected.id} onClick={() => setSelectedId(set.id)}>
                <span className="libraries_set_preview" aria-hidden="true">
                  {set.icons.slice(0, 5).map((icon) => <span key={icon.id} className="libraries_icon_plate"><img src={srcOf(set, icon)} alt="" /></span>)}
                  {set.icons.length === 0 ? <span className="libraries_icon_plate is-empty">—</span> : null}
                </span>
                <span className="libraries_set_text">
                  <strong>{set.name}</strong>
                  <small>{set.icons.length.toLocaleString()} icon{set.icons.length === 1 ? '' : 's'}{set.builtIn ? '' : ` · ${kb(set.icons.reduce((sum, icon) => sum + icon.src.length, 0))}`}</small>
                </span>
                <span className={`libraries_badge ${set.builtIn ? 'is-builtin' : 'is-custom'}`}>{set.builtIn ? 'Built-in' : 'Custom'}</span>
              </button>
              <label className="settings_switch" title={set.enabled ? 'Offered in the icon album' : 'Not offered in the icon album'}>
                <input type="checkbox" role="switch" aria-label={`Offer ${set.name} in the icon album`} checked={set.enabled} onChange={(event) => report(setIconSetEnabled(set.id, event.target.checked))} />
                <span aria-hidden="true">{set.enabled ? 'In album' : 'Off'}</span>
              </label>
            </li>
          ))}
        </ul>
      </Block>

      <Block
        title={selected.name}
        description={selected.description || (selected.builtIn ? '' : 'Your own images. Choose an icon to rename or remove it.')}
        actions={selected.builtIn ? null : (
          <>
            <button type="button" className="settings_button settings_primary" disabled={selected.icons.length >= ICON_LIMITS.SET_ICONS} onClick={() => setPopup('add')}>Add icons</button>
            <button type="button" className="settings_button" disabled={!selected.icons.length} onClick={handleExport} title="Save this set as a file, to import in another browser">Export</button>
            <button type="button" className="settings_button is-danger" onClick={handleDelete}>{armed ? 'Confirm delete' : 'Delete set'}</button>
          </>
        )}
      >
        <div className="config_card libraries_icon_browser">
          {selected.builtIn ? null : (
            <div className="config_card_grid">
              <label className="config_window_field">
                <span className="config_window_field_label">Set name</span>
                <CommitInput aria-label="Set name" value={selected.name} maxLength={ICON_LIMITS.NAME} onCommit={(value) => report(updateIconSet(selected.id, { name: value || 'Icon set' }))} />
              </label>
              <label className="config_window_field">
                <span className="config_window_field_label">Description</span>
                <CommitInput aria-label="Set description" value={selected.description} maxLength={200} placeholder="What these icons are for" onCommit={(value) => report(updateIconSet(selected.id, { description: value }))} />
              </label>
            </div>
          )}
          <div className="libraries_icon_tools">
            <label className="libraries_search">
              <Glyph d={ICONS.search} />
              <input type="search" className="settings_input libraries_rules_filter" placeholder="Find an icon" aria-label="Find an icon" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <span className="libraries_metrics_count">{icons.length.toLocaleString()} of {selected.icons.length.toLocaleString()}</span>
          </div>
          {selected.builtIn ? (
            <div className="libraries_choices" role="radiogroup" aria-label="Category">
              <button type="button" role="radio" aria-checked={!category} className={`libraries_choice${category ? '' : ' is-on'}`} onClick={() => setCategory('')}>All</button>
              {BUILTIN_CATEGORIES.map((entry) => (
                <button key={entry.id} type="button" role="radio" aria-checked={category === entry.id} className={`libraries_choice${category === entry.id ? ' is-on' : ''}`} onClick={() => setCategory(entry.id)}>
                  {entry.label}<small>{entry.icons.length}</small>
                </button>
              ))}
            </div>
          ) : null}
          {icons.length ? (
            <ul className="libraries_icon_grid" aria-label={`${selected.name} icons`}>
              {icons.map((icon) => (
                <li key={icon.id}>
                  {selected.builtIn ? (
                    <span className="libraries_icon" title={icon.name}>
                      <span className="libraries_icon_plate"><img src={srcOf(selected, icon)} alt="" loading="lazy" /></span>
                      <small>{icon.name}</small>
                    </span>
                  ) : (
                    <button type="button" className={`libraries_icon${icon.id === iconId ? ' is-on' : ''}`} aria-pressed={icon.id === iconId} title={icon.name} onClick={() => setIconId(icon.id === iconId ? '' : icon.id)}>
                      <span className="libraries_icon_plate"><img src={srcOf(selected, icon)} alt="" loading="lazy" /></span>
                      <small>{icon.name}</small>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="libraries_icon_empty" role="status">
              {selected.icons.length ? 'No icon matches.' : 'This set has no icons yet. Use Add icons to upload some.'}
            </p>
          )}
          {picked ? (
            <div className="libraries_icon_edit" role="group" aria-label={`Icon ${picked.name}`}>
              <span className="libraries_icon_plate is-large"><img src={picked.src} alt="" /></span>
              <label className="config_window_field">
                <span className="config_window_field_label">Icon name</span>
                <CommitInput aria-label="Icon name" value={picked.name} maxLength={ICON_LIMITS.NAME} onCommit={(value) => report(renameIcon(selected.id, picked.id, value || 'Icon'))} />
              </label>
              <span className="libraries_metrics_count">{kb(picked.src.length)}</span>
              <button type="button" className="settings_button is-danger" onClick={() => report(removeIcon(selected.id, picked.id), () => setIconId(''))}>Remove icon</button>
            </div>
          ) : null}
        </div>
      </Block>

      {popup ? (
        <UploadPopup
          set={popup === 'add' ? selected : null}
          onClose={() => setPopup(null)}
          onDone={({ id, added, isNew }) => {
            setPopup(null);
            setSelectedId(id);
            notice(isNew ? 'Icon set created' : 'Icons added', isNew ? `The set is ready with ${added} icon${added === 1 ? '' : 's'}, and is offered in the icon album.` : `${added} icon${added === 1 ? '' : 's'} added.`);
          }}
        />
      ) : null}
    </SettingsPage>
  );
}
