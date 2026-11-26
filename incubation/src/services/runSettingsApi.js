// Which runs a graph's data came from, out of a /get_graph answer (B-42):
//   by task_id and by evidence: `settings_used` (null: not recorded)
//   by session: `task_id` and `task_ids` of the runs whose rows it holds; the
//   remark is read from those tasks.

import { MAX_RUN_ENTRIES, UNKNOWN_RUN, readSettingsUsed } from '../shared/runSettings.js';
import { getJobResult } from './jobs.js';

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const layers = (answers) => answers.filter(isObject).flatMap((answer) => [answer, answer.results, answer.results?.result, answer.result, answer.data, getJobResult(answer)]).filter(isObject);

// answers: the request's answer and its job's. -> { settings } | { taskIds } | null
export const readGraphRuns = (...answers) => {
  const all = layers(answers);
  const recorded = all.find((item) => 'settings_used' in item);
  if (recorded) return { settings: recorded.settings_used };
  const listed = all.find((item) => Array.isArray(item.task_ids));
  if (listed) return { taskIds: [...new Set(listed.task_ids.filter((id) => id !== null && id !== undefined && id !== '').map(String))] };
  const one = all.find((item) => item.task_id !== null && item.task_id !== undefined && item.task_id !== '' && 'task_ids' in item);
  return one ? { taskIds: [String(one.task_id)] } : null;
};

const fetchTaskSettings = async (apiFetch, id, signal) => {
  try {
    const data = await apiFetch(`/api/v1/tasks/${encodeURIComponent(id)}`, { suppressForbiddenHandler: true, signal });
    const task = [data?.task, data?.data, data?.results, data].find((item) => isObject(item) && 'settings_used' in item);
    return readSettingsUsed(task?.settings_used);
  } catch {
    return null; // not readable (another's, removed): not recorded, as far as is known
  }
};

// -> entries [{ id, settings }] (shared/runSettings.js); never empty: a graph
// the Service sends was made from something.
export const resolveGraphRuns = async (apiFetch, runs, { signal, id = '' } = {}) => {
  if (!runs) return [...UNKNOWN_RUN];
  if ('settings' in runs) return [{ id: String(id), settings: readSettingsUsed(runs.settings) }];
  const ids = runs.taskIds.slice(0, MAX_RUN_ENTRIES - 1);
  if (!ids.length) return [...UNKNOWN_RUN];
  const entries = await Promise.all(ids.map(async (taskId) => ({ id: taskId, settings: await fetchTaskSettings(apiFetch, taskId, signal) })));
  return runs.taskIds.length > ids.length ? [...entries, { id: 'more', settings: null }] : entries;
};
