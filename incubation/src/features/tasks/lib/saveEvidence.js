// Saving a run as evidence (H-6), from the Tasks window and when its Source
// window is closed. The Service takes the graph snapshot itself, from the
// run's session, so it can only be asked for while that session is open
// (graphLinkFlow.js isRunGraphAvailable).

import { getServiceRefusalCode, getServiceRefusalMessage } from '../../../services/apiErrors.js';
import { saveTaskEvidence } from '../../../services/tasksApi.js';
import { getGraphClaim } from '../../reports/lib/reportModel.js';
import { TASK_LIFECYCLES, TASK_STATUSES, updateTask } from './taskRegistry.js';

const WHERE = 'Reports ▸ Service evidence ▸ Analysts';

// The analyst may save this run, and has not yet.
export const canSaveAsEvidence = (task, can) => Boolean(task?.serverId) && !task.evidenceId && !task.foreign
  && task.status === TASK_STATUSES.COMPLETED
  && task.lifecycle !== TASK_LIFECYCLES.EXPIRED && task.lifecycle !== TASK_LIFECYCLES.ARCHIVED
  && can('evidence:create');

// -> { ok: true, graphKept: true | false | null (not said), message }
//  | { ok: false, message, offerWithoutGraph }
export const saveRunAsEvidence = async (apiFetch, task, values, { includeGraph }) => {
  try {
    const { evidence } = await saveTaskEvidence(apiFetch, {
      serverId: task.serverId, title: values.title, summary: values.summary, includeGraph,
    });
    if (evidence?.id) updateTask(task.id, { evidenceId: String(evidence.id) });
    // What the Service says it kept, not what was asked for.
    const graphKept = includeGraph ? getGraphClaim(evidence || {}) : false;
    const message = graphKept === true ? `Saved as evidence, with its graph (${WHERE}).`
      : graphKept === null ? `Saved as evidence (${WHERE}).`
        : includeGraph ? `Saved as evidence, but the Service kept no graph with it (${WHERE}).`
          : `Saved as evidence, without its graph (${WHERE}).`;
    return { ok: true, graphKept, graphLost: includeGraph && graphKept === false, message };
  } catch (error) {
    return {
      ok: false,
      offerWithoutGraph: getServiceRefusalCode(error) === 'graph_unavailable',
      message: getServiceRefusalMessage(error) || (error?.status === 404 ? 'The Service does not know this task.' : 'The run could not be saved as evidence.'),
    };
  }
};
