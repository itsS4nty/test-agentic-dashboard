/**
 * Estado vivo de la consola: carga inicial por HTTP y actualizaciones por SSE.
 * Las vistas leen `live` directamente; para snapshots de proyecto, observan
 * `live.projectVersion[id]` y vuelven a pedir `api.project(id)` cuando cambia.
 */
import { reactive } from 'vue';
import type {
  ActiveRun,
  Approval,
  Case,
  Metrics,
  Notification,
  PlatformEvent,
  PolicyConfig,
  TimelineEntry,
} from '../../platform/contracts.ts';
import { api, type StatusInfo } from './api.ts';

export interface FeedItem {
  key: string;
  at: string;
  caseId: string;
  caseTitle: string;
  project: string;
  entry: TimelineEntry;
}

const FEED_LIMIT = 150;

export const live = reactive({
  connected: false,
  status: null as StatusInfo | null,
  metrics: null as Metrics | null,
  cases: {} as Record<string, Case>,
  approvals: {} as Record<string, Approval>,
  notifications: [] as Notification[],
  feed: [] as FeedItem[],
  policy: null as PolicyConfig | null,
  runs: [] as ActiveRun[],
  projectVersion: {} as Record<string, number>,
  resetCount: 0,
});

export function sortedCases(): Case[] {
  return Object.values(live.cases).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function pendingApprovals(): Approval[] {
  return Object.values(live.approvals)
    .filter((a) => a.status === 'pending')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

let metricsTimer: ReturnType<typeof setTimeout> | undefined;
function refreshMetricsSoon() {
  if (metricsTimer) return;
  metricsTimer = setTimeout(async () => {
    metricsTimer = undefined;
    try {
      live.metrics = await api.metrics();
    } catch {
      /* el servidor puede estar reiniciando */
    }
  }, 400);
}

function bumpProject(id: string) {
  live.projectVersion[id] = (live.projectVersion[id] ?? 0) + 1;
}

async function loadAll() {
  const [status, metrics, cases, approvals, notifications, runs] = await Promise.all([
    api.status(),
    api.metrics(),
    api.cases(),
    api.approvals(),
    api.notifications(),
    api.runs(),
  ]);
  live.status = status;
  live.metrics = metrics;
  live.cases = Object.fromEntries(cases.map((c) => [c.id, c]));
  live.approvals = Object.fromEntries(approvals.map((a) => [a.id, a]));
  live.notifications = notifications.slice(-50);
  live.runs = runs;
  live.feed = cases
    .flatMap((c) =>
      c.timeline.map((entry) => ({
        key: `${c.id}:${entry.id}`,
        at: entry.at,
        caseId: c.id,
        caseTitle: c.title,
        project: c.project,
        entry,
      })),
    )
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, FEED_LIMIT);
  for (const p of status.projects) bumpProject(p.id);
}

function handle(event: PlatformEvent) {
  switch (event.type) {
    case 'case.upsert':
      live.cases[event.case.id] = event.case;
      // La primera línea de traza puede llegar antes que el caso: pon el título que faltaba.
      for (const item of live.feed) {
        if (item.caseId === event.case.id && item.caseTitle === item.caseId) {
          item.caseTitle = event.case.title;
          item.project = event.case.project;
        }
      }
      refreshMetricsSoon();
      break;
    case 'timeline': {
      const c = live.cases[event.caseId];
      live.feed.unshift({
        key: `${event.caseId}:${event.entry.id}`,
        at: event.entry.at,
        caseId: event.caseId,
        caseTitle: c?.title ?? event.caseId,
        project: c?.project ?? '',
        entry: event.entry,
      });
      if (live.feed.length > FEED_LIMIT) live.feed.length = FEED_LIMIT;
      break;
    }
    case 'approval.upsert':
      live.approvals[event.approval.id] = event.approval;
      refreshMetricsSoon();
      break;
    case 'policy.changed':
      live.policy = event.config;
      break;
    case 'notification':
      live.notifications.push(event.notification);
      if (live.notifications.length > 50) live.notifications.shift();
      break;
    case 'project.changed':
      bumpProject(event.projectId);
      break;
    case 'run.started':
      live.runs.push(event.run);
      break;
    case 'run.finished':
      live.runs = live.runs.filter((r) => !(r.caseId === event.run.caseId && r.agentId === event.run.agentId));
      refreshMetricsSoon();
      break;
    case 'reset':
      live.resetCount++;
      void loadAll();
      break;
  }
}

export function startLive() {
  void loadAll().catch(() => {});
  let source: EventSource | undefined;
  const connect = () => {
    source = new EventSource('/api/events');
    source.onopen = () => {
      const wasDisconnected = !live.connected;
      live.connected = true;
      if (wasDisconnected) void loadAll().catch(() => {});
    };
    source.onmessage = (msg) => {
      try {
        handle(JSON.parse(msg.data) as PlatformEvent);
      } catch {
        /* ignora mensajes mal formados */
      }
    };
    source.onerror = () => {
      live.connected = false;
      source?.close();
      setTimeout(connect, 1500);
    };
  };
  connect();
}
