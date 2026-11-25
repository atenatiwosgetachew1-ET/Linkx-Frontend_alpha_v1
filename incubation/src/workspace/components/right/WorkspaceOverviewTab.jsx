import React, { useMemo, useSyncExternalStore } from 'react';

import { formatDomainPillarLabel, getActiveDomainKey } from '../../../features/configuration/lib/configModel.js';
import { graphStateOf } from '../../../features/graph/components/panel/GraphPanels.jsx';
import { getGraphStore } from '../../../features/graph/lib/graphStore.js';
import { graphWindowName, useActiveGraph } from '../../../features/graph/lib/useActiveGraph.js';
import { Masthead, PageHero, Pill, Stat, Stats } from '../../../features/settings/components/SettingsPage.jsx';
import { endedText, taskOriginLabel, taskStatusLabel } from '../../../features/tasks/lib/taskFormat.js';
import { TASK_STATUSES, countActiveTasks, getSessionUsage, getTasksSnapshot, isTaskActive, subscribeTasks } from '../../../features/tasks/lib/taskRegistry.js';
import { TOOL_ICONS } from '../../../shared/icons/windowIcons.js';
import { useSession } from '../../../shared/session/useSession.js';
import { WORKSPACE_WINDOW_LIMITS, WORKSPACE_WINDOW_TYPES } from '../../state/workspaceTypes.js';
import OneLine from './OneLine.jsx';
import { PanelBlock, PanelNote, PanelPage, PanelRows } from './PanelParts.jsx';

const noopSubscribe = () => () => {};
const RECENT_TASKS = 3;
const ICONS = {
  session: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
  graph: TOOL_ICONS.showGraph,
  assistant: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
};
const formatCount = (value) => Number(value || 0).toLocaleString();
const formatWhen = (ms) => new Date(ms).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// The graph the active window shows, or (Chart, Table) follows.
function GraphSummary({ windowItem }) {
  const store = useMemo(() => getGraphStore(windowItem.id), [windowItem.id]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const keyword = windowItem.metadata?.graphSearch?.keyword;
  return (
    <PanelBlock title="Graph" icon={ICONS.graph} collapsible>
      <div className="right_card_body">
        <PanelRows
          label="Graph"
          rows={[
            ['Window', graphWindowName(windowItem)],
            ['Data', graphStateOf(snapshot).label],
            ['Nodes shown', `${formatCount(snapshot.viewStats.nodes)} of ${formatCount(snapshot.nodes)}`],
            ['Edges shown', `${formatCount(snapshot.viewStats.edges)} of ${formatCount(snapshot.edges)}`],
            ['Search', keyword ? `“${keyword}”` : 'None'],
          ]}
        />
      </div>
    </PanelBlock>
  );
}

// The graph's alerts, as its Graph Alerts card's tooltip says them. Opening
// the co-analyst puts a question about them in its box (not sent).
function CoAnalystCard({ windowItem, canOpen, onAsk }) {
  const store = useMemo(() => (windowItem ? getGraphStore(windowItem.id) : null), [windowItem]);
  const snapshot = useSyncExternalStore(store ? store.subscribe : noopSubscribe, store ? store.getSnapshot : () => null);
  const report = snapshot?.nodes ? snapshot.alertReport : null;
  const total = report?.total || 0;
  const medium = total - (report?.high || 0);
  const summary = !windowItem ? 'No graph selected'
    : !snapshot?.nodes ? 'No graph loaded'
      : report ? report.summary : 'Not scanned yet';
  const hint = !windowItem ? 'Select a Graph, Chart or Table window to ask about its graph.'
    : total ? 'Ask the co-analyst which to look at first.'
      : snapshot?.nodes ? 'Ask the co-analyst about this graph.' : 'Load a graph to ask about it.';
  const question = total
    ? `This graph has ${formatCount(total)} ${total === 1 ? 'alert' : 'alerts'}${report.high ? ` (${formatCount(report.high)} high)` : ''}. Which should I look at first, and why?`
    : '';
  return (
    <PanelBlock title="Co-analyst" icon={ICONS.assistant} collapsible actions={total ? <Pill dot title="The graph's alert rules flagged something here">Suspicious</Pill> : null}>
      <div className="right_card_body">
        <div className={`right_alert${total ? ' is-raised' : ''}`} role="group" aria-label="Graph alerts">
          <span className="right_alert_title">Graph Alerts</span>
          <strong>{summary}</strong>
          {total ? (
            <span className="right_alert_chips">
              {report.high ? <span className="right_alert_chip">{formatCount(report.high)} high</span> : null}
              {medium ? <span className="right_alert_chip is-medium">{formatCount(medium)} medium</span> : null}
            </span>
          ) : null}
          <small>{hint}</small>
        </div>
        <button type="button" className="right_assist_open" disabled={!canOpen} onClick={() => onAsk(question)}>Open co-analyst</button>
      </div>
    </PanelBlock>
  );
}

function ActivityRow({ task }) {
  const active = isTaskActive(task);
  const ended = endedText(task);
  const tone = task.status === TASK_STATUSES.FAILED ? ' is-failed' : active ? ' is-active' : '';
  const detail = `${taskOriginLabel(task)} · ${active ? 'since' : 'ended'} ${formatWhen(active ? task.startedAt : task.endedAt || task.startedAt)}`;
  return (
    <li className={`right_task${tone}`}>
      <span>
        <OneLine as="strong">{task.title}</OneLine>
        <OneLine as="small">{detail}</OneLine>
      </span>
      <em className={ended ? 'linkx_tooltip_anchor' : undefined} data-tooltip={ended || undefined} tabIndex={ended ? 0 : undefined}>{taskStatusLabel(task)}</em>
    </li>
  );
}

export default function WorkspaceOverviewTab({ displayName, workspace, onSwitchTab, canOpenAssistant = false }) {
  const { configuration, isSocketConnected } = useSession();
  const { tasks } = useSyncExternalStore(subscribeTasks, getTasksSnapshot);
  const graph = useActiveGraph(workspace);
  const graphWindow = graph.windowItem || graph.companionGraph;

  const windows = workspace?.windows || [];
  const sessions = getSessionUsage(windows.filter((item) => item.type === WORKSPACE_WINDOW_TYPES.SOURCE).length, tasks);
  const own = tasks.filter((task) => !task.foreign);
  const recent = own.slice(0, RECENT_TASKS);
  const activeName = workspace?.activeWindow ? graphWindowName(workspace.activeWindow) : '';

  return (
    <PanelPage fill cards label="Overview">
      <Masthead>
        <PageHero
          eyebrow="Overview"
          title={activeName || 'No window selected'}
          titleHint={activeName}
          pill={<Pill tone={isSocketConnected ? 'active' : ''}>{isSocketConnected ? 'Connected' : 'Offline'}</Pill>}
          media={(
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" />
            </svg>
          )}
        />
        <Stats label="Workspace figures" columns={3}>
          <Stat label="Windows" value={formatCount(windows.length)} note="open" />
          <Stat label="Sessions" value={`${sessions.used}/${sessions.limit}`} note="in use" />
          <Stat label="Tasks" value={formatCount(countActiveTasks(tasks))} note="running" />
        </Stats>
      </Masthead>

      <PanelBlock title="Session" icon={ICONS.session} collapsible startCollapsed>
        <div className="right_card_body">
          <PanelRows
            label="Session"
            rows={[
              ['Signed in as', displayName],
              ['Domain', formatDomainPillarLabel(getActiveDomainKey(configuration))],
              ...WORKSPACE_WINDOW_LIMITS.map((group) => [
                `${group.label} windows`,
                `${windows.filter((item) => group.types.includes(item.type)).length} of ${group.limit}`,
              ]),
            ]}
          />
        </div>
      </PanelBlock>

      {graphWindow ? <GraphSummary windowItem={graphWindow} /> : null}

      <CoAnalystCard
        windowItem={graphWindow || null}
        canOpen={canOpenAssistant}
        onAsk={(draft) => onSwitchTab?.('assistant', { draft })}
      />

      <PanelBlock title="Activity" icon={ICONS.activity} collapsible grow>
        <div className="right_card_body">
          {recent.length ? (
            <ul className="right_tasks" aria-label="Recent analyses">
              {recent.map((task) => <ActivityRow key={task.id} task={task} />)}
            </ul>
          ) : <PanelNote>No analysis has run yet.</PanelNote>}
          {own.length > recent.length ? <PanelNote>{formatCount(own.length - recent.length)} more in Tasks.</PanelNote> : null}
        </div>
      </PanelBlock>
    </PanelPage>
  );
}
