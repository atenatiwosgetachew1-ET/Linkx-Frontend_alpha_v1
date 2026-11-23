import React, { useEffect, useMemo, useRef, useState } from 'react';

import ThemePicker from '../../../../shared/theme/ThemePicker.jsx';
import { useTheme } from '../../../../shared/theme/ThemeContext.jsx';
import { resolveCssColor } from '../../../../shared/theme/resolveColor.js';
import { hexAlphaToOutput, parseColorToHexAlpha } from '../../lib/settingsModel.js';
import { categoryTitle, collectTokens, groupCategories, normalizeQuery, plainName, tokenGroups, tokenMatches } from '../../lib/themeStudioModel.js';

export function ColorAlphaPicker({ value, onChange }) {
  const parsed = parseColorToHexAlpha(value);
  const [hex, setHex] = React.useState(parsed.hex);
  const [alpha, setAlpha] = React.useState(parsed.alpha);
  const [rawText, setRawText] = React.useState(value);

  // Sync from parent when value changes externally
  React.useEffect(() => {
    const p = parseColorToHexAlpha(value);
    setHex(p.hex);
    setAlpha(p.alpha);
    setRawText(value);
  }, [value]);

  const emitChange = (newHex, newAlpha) => {
    const out = hexAlphaToOutput(newHex, newAlpha);
    setRawText(out);
    onChange(out);
  };

  return (
    <div className="theme_studio_color_alpha">
      <div
        className="theme_studio_swatch_preview"
        style={{ background: (rawText && rawText.includes('gradient')) ? rawText : hexAlphaToOutput(hex, alpha) }}
      />
      <input
        type="color"
        className="theme_studio_color_swatch"
        value={hex}
        onChange={(e) => { setHex(e.target.value); emitChange(e.target.value, alpha); }}
      />
      <div className="theme_studio_alpha_wrap">
        <label className="theme_studio_alpha_label">α</label>
        <input
          type="range"
          className="theme_studio_range_slider"
          min="0"
          max="1"
          step="0.01"
          value={alpha}
          onChange={(e) => { const a = parseFloat(e.target.value); setAlpha(a); emitChange(hex, a); }}
        />
        <span className="theme_studio_alpha_value">{Math.round(alpha * 100)}%</span>
      </div>
      <input
        type="text"
        className="settings_input theme_studio_hex_input"
        value={rawText}
        onChange={(e) => { setRawText(e.target.value); onChange(e.target.value); }}
        placeholder="#hex, rgba(...), or linear-gradient(...)"
      />
    </div>
  );
}

// Glyphs (24px grid, stroked).
const ICONS = {
  palette: 'M12 22a10 10 0 1 1 10-10c0 2.2-1.8 3.5-4 3.5h-1.8a1.7 1.7 0 0 0-1.2 2.9c.6.6.4 1.6-.3 2.1-.8.9-1.7 1.5-2.7 1.5zM7.5 10.5h.01M12 7.5h.01M16.5 10.5h.01',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  // A pointer inside a dashed selection frame: pick an element on screen.
  pick: 'M12 12l9 3.5-3.9 1.4-1.4 3.9zM5 3a2 2 0 0 0-2 2M19 3a2 2 0 0 1 2 2M5 21a2 2 0 0 1-2-2M9 3h1M14 3h1M9 21h2M3 9v1M3 14v1M21 9v2',
  copy: 'M9 9h11a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  undo: 'M3 7v6h6M3.5 13a9 9 0 1 0 2.1-9.4L3 7',
  chevron: 'M9 6l6 6-6 6',
  close: 'M18 6L6 18M6 6l12 12',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z',
};

function Icon({ name, size = 14 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

// How many rows a search or the list of changes shows before "Show more".
const RESULTS_STEP = 40;
const CHANGES_VIEW = '__changes';

// One token: what it is, then its control and (once changed) its reset.
function TokenRow({ token, value, changed, onChange }) {
  return (
    <div className={`theme_studio_token_row${changed ? ' is-overridden' : ''}`}>
      <div className="theme_studio_token_label">
        <strong title={plainName(token.label)}>{plainName(token.label)}</strong>
        <code title={token.key}>{token.key}</code>
      </div>
      <div className="theme_studio_token_controls">
        {token.type === 'range' ? (
          <>
            <input
              type="range"
              className="theme_studio_range_slider"
              min="0"
              max="1"
              step="0.01"
              aria-label={plainName(token.label)}
              value={parseFloat(value) || 0}
              onChange={(event) => onChange(token.key, event.target.value)}
            />
            <input
              type="text"
              className="settings_input theme_studio_hex_input is-short"
              value={value}
              onChange={(event) => onChange(token.key, event.target.value)}
              placeholder="0.0 — 1.0"
            />
          </>
        ) : token.type === 'text' ? (
          <input
            type="text"
            className="settings_input theme_studio_hex_input"
            aria-label={plainName(token.label)}
            value={value}
            onChange={(event) => onChange(token.key, event.target.value)}
            placeholder={token.placeholder || 'e.g. 180deg, 45deg'}
          />
        ) : (
          <ColorAlphaPicker value={value} onChange={(next) => onChange(token.key, next)} />
        )}
        {changed ? (
          <button type="button" className="theme_studio_reset_btn" title="Back to the theme's value" aria-label={`Reset ${plainName(token.label)}`} onClick={() => onChange(token.key, undefined)}>
            <Icon name="undo" size={12} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function LiveThemeCustomizerStudio() {
  const { categories, customOverrides, setCustomVariable, resetCustomOverrides, exportThemeConfig, importThemeConfig, inspectorActive, toggleInspector } = useTheme();
  const areas = useMemo(() => groupCategories(categories), [categories]);
  const [view, setView] = useState(() => categories[0]?.id || '');
  const [searchQuery, setSearchQuery] = useState('');
  const [openGroups, setOpenGroups] = useState({});
  const [limit, setLimit] = useState(RESULTS_STEP);
  const [isImportOpen, setImportOpen] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [isResetAsked, setResetAsked] = useState(false);
  const [notice, setNotice] = useState(null);
  // The area whose menu of parts is open (one at a time).
  const [openArea, setOpenArea] = useState(null);
  const navRef = useRef(null);

  // An open menu closes on Escape or a click outside the menu bar.
  useEffect(() => {
    if (!openArea) return undefined;
    const onPointer = (event) => { if (!navRef.current?.contains(event.target)) setOpenArea(null); };
    const onKey = (event) => { if (event.key === 'Escape') setOpenArea(null); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [openArea]);

  const query = normalizeQuery(searchQuery);
  const isChanged = (token) => Boolean(customOverrides[token.key]);
  const changedCount = Object.keys(customOverrides).length;
  const changedIn = (tokens) => tokens.filter(isChanged).length;

  const selected = useMemo(() => {
    for (const area of areas) {
      const category = area.categories.find((item) => item.id === view);
      if (category) return { area, category };
    }
    return null;
  }, [areas, view]);
  const groups = useMemo(() => (selected ? tokenGroups(selected.category.tokens) : []), [selected]);

  // A search looks through every category at once; "Your changes" lists
  // what was changed, wherever it is.
  const mode = query ? 'search' : view === CHANGES_VIEW ? 'changes' : 'category';
  const found = useMemo(() => {
    if (mode === 'search') return collectTokens(areas, (token) => tokenMatches(token, query));
    if (mode === 'changes') return collectTokens(areas, (token) => Boolean(customOverrides[token.key]));
    return [];
  }, [mode, areas, query, customOverrides]);
  const foundCount = found.reduce((sum, entry) => sum + entry.tokens.length, 0);
  const matchesByCategory = useMemo(() => Object.fromEntries(found.map((entry) => [entry.category.id, entry.tokens.length])), [found]);

  const rootStyle = typeof window !== 'undefined' ? getComputedStyle(document.documentElement) : null;
  const getEffectiveValue = (token) => {
    if (customOverrides[token.key]) return customOverrides[token.key];
    const computed = rootStyle ? rootStyle.getPropertyValue(token.key).trim() : '';
    if (computed && (computed.startsWith('#') || computed.startsWith('rgb'))) return computed;
    // Not a colour (an angle, a size): the value as it stands.
    if (token.type && token.type !== 'color') return computed || token.default || '';
    // A gradient is edited as text; anything else (a variable, a mix of
    // two colours) is shown as the colour it gives right now.
    if (/gradient\(/i.test(computed)) return computed;
    return resolveCssColor(computed || token.default) || token.default || '#000000';
  };

  const say = (text, tone = 'ok') => {
    setNotice({ text, tone });
    setTimeout(() => setNotice((current) => (current?.text === text ? null : current)), 3500);
  };

  const openCategory = (id) => {
    setView(id);
    setOpenArea(null);
    setSearchQuery('');
    setLimit(RESULTS_STEP);
  };
  const changeQuery = (value) => {
    setSearchQuery(value);
    setLimit(RESULTS_STEP);
  };

  // Every group of a category starts closed, and opens on a click.
  const isGroupOpen = (categoryId, index) => openGroups[`${categoryId}/${index}`] ?? false;
  const toggleGroup = (categoryId, index) => setOpenGroups((current) => ({ ...current, [`${categoryId}/${index}`]: !isGroupOpen(categoryId, index) }));

  const resetTokens = (tokens) => tokens.filter(isChanged).forEach((token) => setCustomVariable(token.key, undefined));

  const handleExport = () => {
    const json = exportThemeConfig();
    navigator.clipboard?.writeText(json);
    say('Theme configuration copied to the clipboard.');
  };

  const handleImport = () => {
    if (!importJson.trim()) return;
    if (importThemeConfig(importJson)) {
      setImportJson('');
      setImportOpen(false);
      say('Theme configuration imported.');
    } else {
      say('That is not a theme configuration: check the JSON and try again.', 'bad');
    }
  };

  const handleResetAll = () => {
    resetCustomOverrides();
    setResetAsked(false);
    say('All changes removed: the theme is back to its own values.');
  };

  const renderTokens = (tokens) => (
    <div className="theme_studio_token_grid">
      {/* A few tokens are listed under two groups: the index keeps keys apart. */}
      {tokens.map((token, index) => (
        <TokenRow key={`${token.key}/${index}`} token={token} value={getEffectiveValue(token)} changed={isChanged(token)} onChange={setCustomVariable} />
      ))}
    </div>
  );

  // Search results and the list of changes: by category, up to `limit` rows.
  const renderFound = () => {
    let room = limit;
    const shown = [];
    found.forEach((entry) => {
      if (room <= 0) return;
      const tokens = entry.tokens.slice(0, room);
      room -= tokens.length;
      shown.push({ ...entry, tokens });
    });
    return (
      <>
        {shown.map(({ area, category, tokens }) => (
          <section key={category.id} className="theme_studio_found" aria-label={categoryTitle(category, area)}>
            <header className="theme_studio_found_head">
              <span>{area.name}</span>
              <Icon name="chevron" size={11} />
              <button type="button" className="theme_studio_found_open" title="Open this section" onClick={() => openCategory(category.id)}>{categoryTitle(category, area)}</button>
              <span className="theme_studio_cat_badge">{matchesByCategory[category.id]}</span>
            </header>
            {renderTokens(tokens)}
          </section>
        ))}
        {foundCount > limit ? (
          <button type="button" className="settings_button theme_studio_more" onClick={() => setLimit((current) => current + RESULTS_STEP)}>
            Show more ({(foundCount - limit).toLocaleString()} left)
          </button>
        ) : null}
      </>
    );
  };

  const selectedChanged = selected ? changedIn(selected.category.tokens) : 0;

  return (
    <section className="theme_studio_container" aria-label="Theme Studio">
      <header className="theme_studio_header">
        <span className="theme_studio_header_icon" aria-hidden="true"><Icon name="palette" size={18} /></span>
        <div className="theme_studio_header_text">
          <h4>Theme Studio</h4>
          <p>Restyle the app to your taste. Every change shows at once and is kept in this browser.</p>
        </div>
        <span className={`theme_studio_count${changedCount ? ' is-on' : ''}`}>
          {changedCount ? `${changedCount.toLocaleString()} ${changedCount === 1 ? 'change' : 'changes'}` : 'No changes yet'}
        </span>
      </header>

      {notice ? <div className={`theme_studio_notice${notice.tone === 'bad' ? ' is-bad' : ''}`} role="status">{notice.text}</div> : null}

      <section className="theme_studio_step is-base" aria-label="Base theme">
        <header className="theme_studio_step_head">
          <div>
            <h5>Start from a theme</h5>
            <p>Your changes are kept per theme, so each one can be tuned on its own.</p>
          </div>
        </header>
        <div className="theme_studio_step_body">
          <ThemePicker variant="pills" />
        </div>
      </section>

      <section className="theme_studio_step" aria-label="Customise">
        <header className="theme_studio_step_head">
          <div>
            <h5>Change what you like</h5>
            <p>Choose a part of the app from the menus, search by name, or point at it on screen.</p>
          </div>
        </header>
        <div className="theme_studio_step_body">
          <div className="theme_studio_toolbar">
            <div className="theme_studio_search_input_wrapper">
              <span className="theme_studio_search_icon" aria-hidden="true"><Icon name="search" size={13} /></span>
              <input
                type="search"
                className="settings_input theme_studio_search_input"
                aria-label="Search all settings"
                placeholder="Search everything: border, hover, footer, tab…"
                value={searchQuery}
                onChange={(event) => changeQuery(event.target.value)}
              />
              {searchQuery ? (
                <button type="button" className="theme_studio_search_clear" onClick={() => changeQuery('')} aria-label="Clear search">
                  <Icon name="close" size={12} />
                </button>
              ) : null}
            </div>
            <button
              type="button"
              className={`settings_button theme_studio_pick${inspectorActive ? ' is-on' : ''}`}
              aria-pressed={inspectorActive}
              title="Click any part of the app to see and change its colours"
              onClick={toggleInspector}
            >
              <Icon name="pick" size={15} />
              {inspectorActive ? 'Picking… click to stop' : 'Pick on screen'}
            </button>
          </div>

          <div className="theme_studio_workbench">
            <nav className="theme_studio_nav" aria-label="Parts of the app" ref={navRef}>
              <div className="theme_studio_nav_menus">
              {areas.map((area) => {
                const isOpen = openArea === area.id;
                const holdsSelected = mode === 'category' && selected?.area.id === area.id;
                const areaMatches = area.categories.reduce((sum, category) => sum + (matchesByCategory[category.id] || 0), 0);
                const areaChanged = area.categories.some((category) => changedIn(category.tokens) > 0);
                return (
                  <div key={area.id} className="theme_studio_menu" role="group" aria-label={area.name}>
                    <button
                      type="button"
                      className={`theme_studio_cat_btn theme_studio_menu_btn${holdsSelected ? ' is-active' : ''}${isOpen ? ' is-open' : ''}`}
                      aria-haspopup="true"
                      aria-expanded={isOpen}
                      title={area.hint}
                      onClick={() => setOpenArea(isOpen ? null : area.id)}
                    >
                      <span>{area.name}</span>
                      {mode === 'search'
                        ? (areaMatches ? <span className="theme_studio_cat_badge">{areaMatches}</span> : null)
                        : (areaChanged ? <span className="theme_studio_cat_dot" title="Has changes of yours" /> : null)}
                      <Icon name="chevron" size={11} />
                    </button>
                    {isOpen ? (
                      <div className="theme_studio_menu_list">
                        {area.categories.map((category) => {
                          const matches = matchesByCategory[category.id] || 0;
                          const changed = changedIn(category.tokens);
                          const isActive = mode === 'category' && category.id === view;
                          return (
                            <button
                              key={category.id}
                              type="button"
                              className={`theme_studio_cat_btn${isActive ? ' is-active' : ''}${mode === 'search' && !matches ? ' is-dim' : ''}`}
                              aria-current={isActive ? 'true' : undefined}
                              title={category.description}
                              onClick={() => openCategory(category.id)}
                            >
                              <span>{categoryTitle(category, area)}</span>
                              {mode === 'search'
                                ? (matches ? <span className="theme_studio_cat_badge">{matches}</span> : null)
                                : (changed ? <span className="theme_studio_cat_dot" title={`${changed} changed`} /> : null)}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
              </div>
              <button
                type="button"
                className={`theme_studio_cat_btn is-changes${mode === 'changes' ? ' is-active' : ''}`}
                aria-pressed={mode === 'changes'}
                title="Everything you changed in this theme"
                onClick={() => openCategory(CHANGES_VIEW)}
              >
                <Icon name="edit" size={12} />
                <span>Your changes</span>
                <span className="theme_studio_cat_badge">{changedCount.toLocaleString()}</span>
              </button>
            </nav>

            <div className="theme_studio_token_card" role="region" aria-label="Settings to change">
              {mode === 'category' && selected ? (
                <>
                  <div className="theme_studio_card_info">
                    <div>
                      <p className="theme_studio_crumb">{selected.area.name}</p>
                      <h5>{categoryTitle(selected.category, selected.area)}</h5>
                      <p>{selected.category.description}</p>
                    </div>
                    <div className="theme_studio_card_meta">
                      <span>{selected.category.tokens.length.toLocaleString()} settings{selectedChanged ? ` · ${selectedChanged} changed` : ''}</span>
                      {selectedChanged ? (
                        <button type="button" className="theme_studio_link" onClick={() => resetTokens(selected.category.tokens)}>Reset this part</button>
                      ) : null}
                    </div>
                  </div>
                  {groups.length === 1 ? renderTokens(groups[0].tokens) : groups.map((group, index) => {
                    const open = isGroupOpen(selected.category.id, index);
                    const changed = changedIn(group.tokens);
                    return (
                      <section key={group.name} className={`theme_studio_group${open ? ' is-open' : ''}`}>
                        <button type="button" className="theme_studio_group_head" aria-expanded={open} onClick={() => toggleGroup(selected.category.id, index)}>
                          <Icon name="chevron" size={12} />
                          <strong>{group.name}</strong>
                          {changed ? <span className="theme_studio_cat_badge">{changed} changed</span> : null}
                          <small>{group.tokens.length}</small>
                        </button>
                        {open ? renderTokens(group.tokens) : null}
                      </section>
                    );
                  })}
                </>
              ) : (
                <>
                  <div className="theme_studio_card_info">
                    <div>
                      <p className="theme_studio_crumb">{mode === 'search' ? 'Search' : 'Overview'}</p>
                      <h5>{mode === 'search' ? `Results for “${searchQuery.trim()}”` : 'Your changes'}</h5>
                      <p>
                        {mode === 'search'
                          ? `${foundCount.toLocaleString()} ${foundCount === 1 ? 'setting' : 'settings'} in ${found.length} ${found.length === 1 ? 'part' : 'parts'} of the app.`
                          : 'Everything you changed in this theme, wherever it is.'}
                      </p>
                    </div>
                  </div>
                  {foundCount === 0 ? (
                    <div className="theme_studio_empty_search">
                      <p>{mode === 'search' ? <>Nothing is called “<strong>{searchQuery.trim()}</strong>”.</> : 'Nothing changed yet.'}</p>
                      <p className="theme_studio_search_hint">
                        {mode === 'search'
                          ? 'Try a shorter word (border, text, hover), or use Pick on screen and click the part itself.'
                          : 'Choose a part of the app from the menus above, or use Pick on screen and click what you want to restyle.'}
                      </p>
                    </div>
                  ) : renderFound()}
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="theme_studio_step theme_studio_import_card" aria-label="Keep and share">
        <header className="theme_studio_step_head">
          <div>
            <h5>Keep or share it</h5>
            <p>Copy your changes as text to keep them safe or pass them on; import to bring them back.</p>
          </div>
        </header>
        <div className="theme_studio_step_body">
          <div className="theme_studio_actions">
            <button type="button" className="settings_button" disabled={!changedCount} onClick={handleExport}><Icon name="copy" /> Copy configuration</button>
            <button type="button" className="settings_button" aria-expanded={isImportOpen} onClick={() => setImportOpen((current) => !current)}><Icon name="download" /> Import…</button>
            <span className="theme_studio_actions_gap" />
            {isResetAsked ? (
              <span className="theme_studio_confirm" role="group" aria-label="Confirm reset">
                <span>Remove all {changedCount.toLocaleString()} changes?</span>
                <button type="button" className="settings_button is-danger" onClick={handleResetAll}>Yes, reset</button>
                <button type="button" className="settings_button" onClick={() => setResetAsked(false)}>Keep them</button>
              </span>
            ) : (
              <button type="button" className="settings_button" disabled={!changedCount} onClick={() => setResetAsked(true)}><Icon name="undo" /> Reset all changes</button>
            )}
          </div>
          {isImportOpen ? (
            <div className="theme_studio_import_row">
              <textarea
                className="settings_input theme_studio_json_area"
                rows={3}
                aria-label="Theme configuration JSON"
                placeholder='Paste a copied configuration, e.g. {"theme": "nbe-daylight", "customOverrides": {"--app-bg": "#F4F7FA"}}'
                value={importJson}
                onChange={(event) => setImportJson(event.target.value)}
              />
              <button type="button" className="settings_button settings_primary" disabled={!importJson.trim()} onClick={handleImport}>Apply</button>
            </div>
          ) : null}
        </div>
      </section>
    </section>
  );
}
