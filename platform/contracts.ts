/**
 * Contratos compartidos de la plataforma.
 *
 * Fuente de verdad para TODOS los módulos (plataforma, servidor, proyectos y consola).
 * Solo tipos y constantes pequeñas: aquí no vive lógica.
 * Si un módulo necesita algo que no está aquí, se añade aquí primero.
 */
import type Anthropic from '@anthropic-ai/sdk';

// ─────────────────────────────────────────────────────────────
// Autonomía y políticas
// ─────────────────────────────────────────────────────────────

/** Escalera de autonomía, de menos a más. El dial mueve este valor. */
export type AutonomyLevel = 'shadow' | 'approve' | 'notify' | 'auto';
export const AUTONOMY_ORDER: readonly AutonomyLevel[] = ['shadow', 'approve', 'notify', 'auto'];

/** Resultado de evaluar la política para una acción concreta. */
export type PolicyDecision = AutonomyLevel | 'deny' | 'escalate';

export type RiskClass =
  | 'read'
  | 'write_internal'
  | 'write_external'
  | 'financial'
  | 'physical'
  | 'code';

/** Ámbito jerárquico: cliente → tienda → dispositivo. */
export interface Scope {
  clientId?: string;
  siteId?: string;
  deviceId?: string;
}

export interface PolicyCondition {
  /** Nombres de predicados registrados. Se exige que se cumplan TODOS. */
  when: string[];
  /**
   * `deny` y `escalate` bloquean siempre.
   * Un nivel de autonomía solo puede BAJAR el techo, nunca subirlo.
   */
  decision: PolicyDecision;
  /** Frase legible para trazas y consola: "Hay un cobro en curso". */
  label: string;
}

export interface ActionPolicy {
  /** Nombre exacto de la herramienta. */
  action: string;
  /** Techo de autonomía por defecto. Es lo que mueve el dial. */
  level: AutonomyLevel;
  conditions?: PolicyCondition[];
}

export interface PolicyOverride {
  scope: Scope;
  action: string;
  level: AutonomyLevel;
}

export interface PolicyConfig {
  actions: ActionPolicy[];
  overrides: PolicyOverride[];
}

export interface PolicyEvaluation {
  action: string;
  scope: Scope;
  decision: PolicyDecision;
  /** Techo resuelto por cascada: defecto → cliente → tienda. */
  ceiling: AutonomyLevel;
  ceilingSource: 'default' | 'client' | 'site' | 'unconfigured';
  /** `label` de la condición que ha decidido, si alguna. */
  matchedCondition?: string;
  /** Explicación en español para la traza. */
  reason: string;
}

export interface PredicateArgs {
  action: string;
  input: any;
  scope: Scope;
  caseId: string;
  platform: PlatformApi;
}
export type PolicyPredicate = (args: PredicateArgs) => boolean | Promise<boolean>;

// ─────────────────────────────────────────────────────────────
// Directorio de clientes y tiendas (config/clients.yaml)
// ─────────────────────────────────────────────────────────────

export interface Site {
  id: string;
  name: string;
  city: string;
  /** "HH:MM" hora local de apertura y cierre. */
  open: string;
  close: string;
}

export interface Client {
  id: string;
  name: string;
  sites: Site[];
}

export interface DirectoryService {
  clients(): Client[];
  client(id: string): Client | undefined;
  site(id: string): (Site & { clientId: string; clientName: string }) | undefined;
  /** "Panaderías Horno Real · Centro" */
  describeScope(scope: Scope): string;
}

// ─────────────────────────────────────────────────────────────
// Casos y trazas
// ─────────────────────────────────────────────────────────────

export type CaseStatus =
  | 'open'
  | 'running'
  | 'waiting_approval'
  | 'resolved'
  | 'escalated'
  | 'failed';

export type CaseSource = 'device' | 'ticket' | 'invoice' | 'code' | 'call';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type Actor = 'agent' | 'rule' | 'human';

export type TimelineKind =
  | 'created'
  | 'rule'
  | 'llm'
  | 'tool'
  | 'policy'
  | 'approval'
  | 'note'
  | 'status'
  | 'error';

export interface TimelineEntry {
  id: string;
  at: string;
  kind: TimelineKind;
  /** Frase corta en español. */
  title: string;
  detail?: string;
  actor?: Actor;
  agentId?: string;
  data?: Record<string, unknown>;
  // Entradas `llm`
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  latencyMs?: number;
  // Entradas `tool` / `policy`
  tool?: string;
  decision?: PolicyDecision;
  executed?: boolean;
}

export interface Case {
  id: string;
  project: string;
  agentId?: string;
  title: string;
  summary?: string;
  source: CaseSource;
  scope: Scope;
  status: CaseStatus;
  severity: Severity;
  resolvedBy?: Actor;
  createdAt: string;
  updatedAt: string;
  /** Carga útil específica del proyecto. */
  data: Record<string, unknown>;
  costUsd: number;
  tokens: { input: number; output: number };
  timeline: TimelineEntry[];
}

export interface NewCase {
  project: string;
  title: string;
  source: CaseSource;
  scope: Scope;
  severity?: Severity;
  summary?: string;
  agentId?: string;
  data?: Record<string, unknown>;
}

export interface CaseService {
  create(input: NewCase): Case;
  get(id: string): Case | undefined;
  list(filter?: { project?: string; status?: CaseStatus }): Case[];
  /** Primer caso no cerrado (open/running/waiting_approval/escalated) que cumpla el predicado. */
  findOpen(predicate: (c: Case) => boolean): Case | undefined;
  update(
    id: string,
    patch: Partial<Pick<Case, 'status' | 'summary' | 'agentId' | 'resolvedBy' | 'severity' | 'data' | 'title'>>,
  ): Case;
  /** Añade a la traza. Las entradas `llm` suman coste y tokens al caso. */
  addTimeline(id: string, entry: Omit<TimelineEntry, 'id' | 'at'>): TimelineEntry;
  resolve(id: string, by: Actor, summary?: string): Case;
  escalate(id: string, reason: string): Case;
}

// ─────────────────────────────────────────────────────────────
// Aprobaciones y notificaciones
// ─────────────────────────────────────────────────────────────

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';

export interface Approval {
  id: string;
  caseId: string;
  project: string;
  actor: Actor;
  agentId?: string;
  tool: string;
  input: unknown;
  scope: Scope;
  /** "Reiniciar datáfono DAT-01 · Pan de Pueblo · Alcalá" */
  summary: string;
  /** Por qué lo propone quien lo propone. */
  reason?: string;
  risk: RiskClass;
  status: ApprovalStatus;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  comment?: string;
  result?: ToolResult;
}

export interface ApprovalService {
  create(input: Omit<Approval, 'id' | 'status' | 'createdAt'>): Approval;
  get(id: string): Approval | undefined;
  list(filter?: { status?: ApprovalStatus; caseId?: string }): Approval[];
  /** `approved` ejecuta la herramienta con `skipPolicy` y registra el resultado. */
  decide(id: string, decision: 'approved' | 'rejected', by: string, comment?: string): Promise<Approval>;
}

export interface Notification {
  id: string;
  at: string;
  level: 'info' | 'warning' | 'critical';
  title: string;
  detail?: string;
  caseId?: string;
  project?: string;
}

export interface NotificationService {
  push(input: Omit<Notification, 'id' | 'at'>): Notification;
  list(): Notification[];
}

// ─────────────────────────────────────────────────────────────
// Herramientas
// ─────────────────────────────────────────────────────────────

export interface ToolResult {
  ok: boolean;
  /** Texto que ve el modelo. */
  content: string;
  /** Datos estructurados para reglas, guiones mock y consola. */
  data?: unknown;
}

export interface ToolContext {
  platform: PlatformApi;
  caseId: string;
  actor: Actor;
  agentId?: string;
  scope: Scope;
}

export interface ToolDefinition<I = any> {
  /** ^[a-z0-9_]+$ con prefijo del proyecto: `dispositivo_restart_device`. Sin puntos: la API no los admite. */
  name: string;
  project: string;
  /** En español, escrita para el modelo. */
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  risk: RiskClass;
  /** Ámbito sobre el que se evalúa la política. Por defecto, el del caso. */
  scope?: (input: I, ctx: { platform: PlatformApi; caseId: string }) => Scope;
  /** Frase corta para la cola de aprobaciones. */
  describe?: (input: I, platform: PlatformApi) => string;
  handler: (input: I, ctx: ToolContext) => Promise<ToolResult>;
}

export interface ToolInvocation {
  caseId: string;
  actor: Actor;
  agentId?: string;
  /** Por qué se invoca (texto previo del modelo o explicación de la regla). */
  reason?: string;
  /** Solo para ejecutar una acción que ya aprobó una persona. */
  skipPolicy?: boolean;
}

export interface ToolInvokeOutcome {
  executed: boolean;
  decision: PolicyDecision;
  evaluation?: PolicyEvaluation;
  /** Si no se ejecutó, un resultado sintético que explica por qué. */
  result: ToolResult;
  approvalId?: string;
}

export interface ToolRegistry {
  register(tool: ToolDefinition): void;
  get(name: string): ToolDefinition | undefined;
  list(): ToolDefinition[];
  /** Esquemas generados desde el registro. Nunca se escriben a mano en un prompt. */
  toApiTools(names: string[]): Anthropic.Tool[];
  /** Pasa SIEMPRE por el Policy Gate (salvo `skipPolicy`) y deja traza. */
  invoke(name: string, input: unknown, invocation: ToolInvocation): Promise<ToolInvokeOutcome>;
}

export interface PolicyEngine {
  getConfig(): PolicyConfig;
  setActionLevel(action: string, level: AutonomyLevel): PolicyConfig;
  /** `level: null` elimina el override. */
  setOverride(scope: Scope, action: string, level: AutonomyLevel | null): PolicyConfig;
  registerPredicate(name: string, fn: PolicyPredicate): void;
  evaluate(action: string, input: unknown, scope: Scope, caseId: string): Promise<PolicyEvaluation>;
  /** Vuelve a config/policies.yaml. */
  reset(): PolicyConfig;
}

// ─────────────────────────────────────────────────────────────
// Reglas y eventos de dominio
// ─────────────────────────────────────────────────────────────

export interface DomainEvent<P = any> {
  name: string;
  payload: P;
  at: string;
}

export interface Rule<P = any> {
  id: string;
  project: string;
  /** En español: qué comprueba y qué hace. */
  description: string;
  /** Nombre del evento de dominio al que se suscribe. */
  on: string;
  handle: (event: DomainEvent<P>, platform: PlatformApi) => Promise<void>;
}

export interface RuleEngine {
  register(rule: Rule): void;
  list(): Rule[];
  /** Publica el evento de dominio y ejecuta en orden las reglas suscritas. */
  emit<P>(name: string, payload: P): Promise<void>;
}

// ─────────────────────────────────────────────────────────────
// Agentes, modelos y runtime
// ─────────────────────────────────────────────────────────────

export type ModelTier = 'reasoning' | 'fast';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type LlmProviderId = 'mock' | 'anthropic' | 'bedrock';

export interface AgentManifest {
  id: string;
  name: string;
  description: string;
  version: number;
  project: string;
  tier: ModelTier;
  effort?: Effort;
  maxTurns: number;
  budget: { tokensPerCase: number; usdPerCase: number };
  tools: string[];
  owner?: string;
  /** Contenido de prompt.md. */
  prompt: string;
  /** Ruta relativa al proyecto: agents/<id>/agent.yaml */
  manifestPath: string;
  /** Texto crudo del YAML, para enseñarlo en la consola. */
  manifestYaml: string;
}

export interface ManifestRegistry {
  list(): AgentManifest[];
  get(id: string): AgentManifest | undefined;
  reload(): void;
}

export interface LlmRequest {
  agentId: string;
  caseId: string;
  tier: ModelTier;
  effort?: Effort;
  system: string;
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
  maxTokens: number;
  /** Índice del turno del asistente, empezando en 0. */
  turn: number;
  /** Texto de la tarea con la que arrancó la ejecución (lo usan los guiones mock). */
  task: string;
}

export interface LlmResponse {
  /** Se vuelve a enviar tal cual como turno `assistant` (incluidos bloques de thinking). */
  content: Anthropic.ContentBlockParam[];
  /** 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'pause_turn' | ... */
  stopReason: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  costUsd: number;
  latencyMs: number;
}

export interface MockToolResult {
  name: string;
  input: any;
  ok: boolean;
  content: string;
  data?: unknown;
  executed: boolean;
  decision: PolicyDecision;
}

export interface MockContext {
  agentId: string;
  caseRecord: Case;
  turn: number;
  task: string;
  /** Resultados de las herramientas del turno anterior (vacío en el turno 0). */
  lastResults: MockToolResult[];
  /** Todos los resultados de esta ejecución, en orden. */
  allResults: MockToolResult[];
  platform: PlatformApi;
}

/** Sin `toolCalls` (o vacío) → fin de turno con `text` como resumen final. */
export interface MockTurn {
  text?: string;
  toolCalls?: { name: string; input: Record<string, unknown> }[];
}

export type MockScript = (ctx: MockContext) => MockTurn | Promise<MockTurn>;

export interface LlmClient {
  provider: LlmProviderId;
  /** "Claude API · claude-opus-5" o "Simulado · sin IA real". */
  label: string;
  modelFor(tier: ModelTier): string;
  complete(request: LlmRequest): Promise<LlmResponse>;
  registerMock(agentId: string, script: MockScript): void;
}

export interface RunAgentInput {
  agentId: string;
  caseId: string;
  /** Mensaje inicial en español describiendo qué hay que hacer. */
  task: string;
}

export type RunStatus =
  | 'completed'
  | 'waiting_approval'
  | 'escalated'
  | 'budget_exceeded'
  | 'refused'
  | 'failed';

export interface RunAgentResult {
  status: RunStatus;
  finalText?: string;
  turns: number;
  costUsd: number;
}

export interface ActiveRun {
  agentId: string;
  caseId: string;
  startedAt: string;
}

export interface AgentRuntime {
  run(input: RunAgentInput): Promise<RunAgentResult>;
  /** Encola respetando el tope de concurrencia (3 por defecto). */
  enqueue(input: RunAgentInput): void;
  /** Resuelve cuando no queda nada en curso ni en cola. */
  idle(): Promise<void>;
  activeRuns(): ActiveRun[];
}

// ─────────────────────────────────────────────────────────────
// Proyectos y escenarios
// ─────────────────────────────────────────────────────────────

export interface Scenario {
  id: string;
  project: string;
  /** Texto del botón en el panel de demo. */
  title: string;
  description: string;
  order: number;
  run(platform: PlatformApi): Promise<{ message: string; caseIds?: string[] }>;
}

export interface ProjectModule {
  id: string;
  name: string;
  description: string;
  tools: ToolDefinition[];
  rules: Rule[];
  predicates?: Record<string, PolicyPredicate>;
  /** agentId → guion del modo simulado. */
  mocks?: Record<string, MockScript>;
  scenarios: Scenario[];
  init?(platform: PlatformApi): Promise<void>;
  reset?(platform: PlatformApi): Promise<void>;
  /** Estado que pinta la vista del proyecto en la consola. */
  snapshot?(platform: PlatformApi): unknown;
  stop?(): void;
}

export interface ProjectRegistry {
  /** Registra herramientas, reglas, predicados y mocks, y llama a `init`. */
  register(project: ProjectModule): Promise<void>;
  list(): ProjectModule[];
  get(id: string): ProjectModule | undefined;
  scenarios(): Scenario[];
  runScenario(id: string): Promise<{ message: string; caseIds?: string[] }>;
  /** Avisa a la consola de que el snapshot del proyecto ha cambiado. */
  changed(projectId: string): void;
}

// ─────────────────────────────────────────────────────────────
// Persistencia, eventos y métricas
// ─────────────────────────────────────────────────────────────

export interface Store {
  get<T>(collection: string, id: string): T | undefined;
  list<T>(collection: string): T[];
  put<T extends { id: string }>(collection: string, item: T): T;
  remove(collection: string, id: string): void;
  getValue<T>(key: string): T | undefined;
  setValue<T>(key: string, value: T): void;
  clear(): void;
  flush(): Promise<void>;
}

export type PlatformEvent =
  | { type: 'hello'; at: string }
  | { type: 'case.upsert'; case: Case }
  | { type: 'timeline'; caseId: string; entry: TimelineEntry }
  | { type: 'approval.upsert'; approval: Approval }
  | { type: 'policy.changed'; config: PolicyConfig }
  | { type: 'notification'; notification: Notification }
  | { type: 'project.changed'; projectId: string }
  | { type: 'domain'; event: DomainEvent }
  | { type: 'run.started'; run: ActiveRun }
  | { type: 'run.finished'; run: ActiveRun; status: RunStatus }
  | { type: 'reset' };

export interface EventBus {
  emit(event: PlatformEvent): void;
  on(listener: (event: PlatformEvent) => void): () => void;
}

export interface Metrics {
  casesTotal: number;
  casesOpen: number;
  casesResolved: number;
  resolvedByRule: number;
  resolvedByAgent: number;
  resolvedByHuman: number;
  /** (regla + agente) / resueltos. 0 si no hay resueltos. */
  autoResolutionRate: number;
  pendingApprovals: number;
  costUsd: number;
  tokens: { input: number; output: number };
  llmCalls: number;
  toolCalls: number;
  blockedByPolicy: number;
  feedback: { approved: number; rejected: number };
  byProject: Record<string, { cases: number; resolved: number; costUsd: number }>;
}

// ─────────────────────────────────────────────────────────────
// Plataforma
// ─────────────────────────────────────────────────────────────

export interface PlatformApi {
  readonly rootDir: string;
  readonly dataDir: string;
  readonly startedAt: string;
  /** Modo rápido (tests/smoke): temporizadores y latencias casi a cero. */
  readonly fast: boolean;
  events: EventBus;
  store: Store;
  directory: DirectoryService;
  cases: CaseService;
  tools: ToolRegistry;
  policy: PolicyEngine;
  rules: RuleEngine;
  runtime: AgentRuntime;
  approvals: ApprovalService;
  notifications: NotificationService;
  manifests: ManifestRegistry;
  llm: LlmClient;
  projects: ProjectRegistry;
  metrics(): Metrics;
  /** Borra estado, vuelve a las políticas del YAML y reinicia los proyectos. */
  reset(): Promise<void>;
  /** Para temporizadores y guarda el estado. */
  shutdown(): Promise<void>;
}

export interface CreatePlatformOptions {
  rootDir: string;
  /** Por defecto `<rootDir>/data`. */
  dataDir?: string;
  /** Por defecto: LLM_PROVIDER, o `anthropic` si hay ANTHROPIC_API_KEY, o `mock`. */
  provider?: LlmProviderId;
  /** Por defecto MOCK_LATENCY_MS o 700. */
  mockLatencyMs?: number;
  fast?: boolean;
  /** No leer ni escribir disco (smoke). */
  inMemory?: boolean;
}
