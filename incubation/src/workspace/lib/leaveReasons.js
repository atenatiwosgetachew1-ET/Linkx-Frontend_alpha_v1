// What would be lost by leaving (reload, tab closed, signed out): [] when
// nothing. Runs of other pages and STR alert runs go on at the Service.

import { canSaveAsEvidence } from '../../features/tasks/lib/saveEvidence.js';
import { TASK_ORIGINS, isTaskActive } from '../../features/tasks/lib/taskRegistry.js';
import { isRunGraphAvailable } from '../../features/graph/lib/graphLinkFlow.js';
import { WORKSPACE_WINDOW_TYPES } from '../state/workspaceTypes.js';

const count = (items, one, many) => (items === 1 ? one : many.replace('#', items));

// graphChanged(windowId): its graph was drawn or changed here.
export const leaveReasons = ({ tasks = [], windows = [], can = () => false, graphChanged = () => false }) => {
  const own = tasks.filter((task) => task.origin === TASK_ORIGINS.SOURCE && !task.remote && !task.foreign);
  const running = own.filter(isTaskActive).length;
  const kept = own.filter((task) => task.heldSession).length;
  const unsaved = own.filter((task) => !isTaskActive(task) && !task.heldSession && canSaveAsEvidence(task, can) && isRunGraphAvailable(task, windows)).length;
  const graphs = windows.filter((item) => item.type === WORKSPACE_WINDOW_TYPES.GRAPH && graphChanged(item.id)).length;
  return [
    running ? count(running, '1 running analysis will be stopped.', '# running analyses will be stopped.') : '',
    kept ? count(kept, '1 finished background run keeps its session: its graph will be lost.', '# finished background runs keep their sessions: their graphs will be lost.') : '',
    unsaved ? count(unsaved, '1 completed run is not saved as evidence: its graph will be lost.', '# completed runs are not saved as evidence: their graphs will be lost.') : '',
    graphs ? count(graphs, '1 graph was drawn or changed here: those changes will be lost.', '# graphs were drawn or changed here: those changes will be lost.') : '',
  ].filter(Boolean);
};
