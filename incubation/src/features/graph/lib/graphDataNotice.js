// What the Table and Chart windows say about the graph they read when it is
// not whole or not up to date (docs/integrity-audit-2026-11-24.md E11).
//
// snapshot: the graph store's; link: what its Graph window published
// (graphLinkBus.js; dataVersion: the data it was published from); scope.
// -> { label, detail } or null.
export const graphDataNotice = (snapshot, link, scope) => {
  const status = snapshot?.status || {};
  if (!snapshot?.nodes) return null;
  if (status.state === 'loading' || status.state === 'queued') return { label: 'Still loading', detail: 'The graph is still loading: figures change until it has finished.' };
  if (status.state === 'error') return { label: 'Incomplete', detail: 'The graph could not be loaded completely.' };
  if (status.partial) return { label: 'Incomplete', detail: 'The Service delivered only part of this graph.' };
  if (scope !== 'all' && link?.dataVersion !== undefined && link.dataVersion !== snapshot.dataVersion) {
    return { label: 'Out of date', detail: 'The graph has changed since its window was last shown. Show the Graph window to update what is drawn.' };
  }
  if (status.midRun) return { label: 'Run not finished', detail: 'The graph was loaded while its run was still going, so it may lack what came after.' };
  return null;
};
