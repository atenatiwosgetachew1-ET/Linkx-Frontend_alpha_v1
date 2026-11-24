import { formatFileSize, getWorkflowSteps, SOURCE_MODES, UPLOAD_LIMITS } from './sourceModel.js';

// What the chosen connection needs and what of it the session configuration
// already holds (the first page's side panel, SourceNeeds.jsx). Read only:
// it says what is saved, not whether a server can be reached.
//
// The saved storage address and port are never shown, as in the Storage
// step ("Use Default" connects without exposing them); nor is a password.
//
// -> { rows: [{ id, label, state: 'ok' | 'missing' | 'info', value }],
//      missing (how many rows), next (the next page's own words) }

const saved = (id, label, value, missing = 'Enter it next') => ({
  id, label, state: value ? 'ok' : 'missing', value: value || missing,
});
const info = (id, label, value) => ({ id, label, state: 'info', value });
const plural = (count, word) => `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`;

export const sourceNeeds = ({ connectionType, inputMode, defaults }) => {
  const { storage = {}, broker = {}, search = {}, tool = {} } = defaults || {};
  const address = saved('address', 'Address', storage.address ? 'Default saved' : '');
  const graphTool = saved('tool', 'Graph tool', tool.url ? [tool.name, tool.database].filter(Boolean).join(' · ') || 'Saved' : '');
  let rows;
  if (connectionType === 'storage') {
    rows = [
      address,
      saved('path', 'Path', storage.path),
      saved('database', 'Database', storage.database),
      info('tables', 'Tables', storage.tables?.length ? `${storage.tables.length.toLocaleString()} saved` : 'None saved'),
      graphTool,
    ];
  } else if (connectionType === 'broker') {
    rows = [saved('address', 'Address', broker.address), saved('topic', 'Topic', broker.topic), graphTool];
  } else if (connectionType === 'search') {
    rows = [
      address,
      info('fuzzy', 'Fuzzy search', search.fuzzyColumns?.length ? plural(search.fuzzyColumns.length, 'column') : 'All columns'),
      // A strict search needs one of these columns.
      info('strict', 'Strict search', search.strictColumns?.length ? plural(search.strictColumns.length, 'column') : 'Not set up'),
      graphTool,
    ];
  } else {
    rows = [
      info('types', 'Files', [...UPLOAD_LIMITS.allowedExtensions].map((extension) => extension.toUpperCase()).join(', ')),
      info('limit', 'Limit', `${plural(UPLOAD_LIMITS.maxFiles, 'file')}, ${formatFileSize(UPLOAD_LIMITS.maxFileSizeBytes)} each`),
      graphTool,
    ];
  }
  const mode = inputMode === SOURCE_MODES.REALTIME ? SOURCE_MODES.REALTIME : SOURCE_MODES.BATCH;
  return {
    rows,
    missing: rows.filter((row) => row.state === 'missing').length,
    next: getWorkflowSteps(mode, { selectedConnectionType: connectionType })[0].value,
  };
};
