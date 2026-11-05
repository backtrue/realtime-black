export class AppError extends Error {
  constructor(public code: string, public status = 503) { super(code); }
}

export type Identity = Readonly<{ memberId: string; eligible: boolean }>;
export type Credentials = Readonly<{ cookie: string; authorization: string }>;
export type MeterEvent = Readonly<{
  id: string;
  type: "reserved" | "connected" | "tool_started" | "tool_finished" | "disconnected" | "ended";
  at: number;
  toolCallId?: string;
}>;
export type Reservation = Readonly<{ id: string; memberId: string; seconds: number; deadline: number }>;
export type Settlement = Readonly<{ billedSeconds: number; remainingSeconds: number }>;
export type ConfirmedEnd = Readonly<{ memberId: string; recordId: string; at: number }>;
export type McpGrant = Readonly<{
  memberId: string;
  expiresAt: number;
  readOnlyTools: string[];
} & ({ accessToken: string; authorizationId?: never } | { authorizationId: string; accessToken?: never })>;

// 產品內部介面，由已核定的 ECCAL adapter 實作
export interface EccalPort {
  authenticate(credentials: Credentials): Promise<Identity | null>;
  balance(memberId: string): Promise<number>;
  reserve(memberId: string, operationId: string): Promise<Reservation>;
  settle(memberId: string, reservationId: string, events: MeterEvent[]): Promise<Settlement>;
  mcpGrant(memberId: string): Promise<McpGrant>;
}

export type Tool = Readonly<{ name: string; description: string; parameters: Record<string, unknown> }>;
export interface McpPort {
  list(grant: McpGrant): Promise<Tool[]>;
  call(grant: McpGrant, name: string, args: Record<string, unknown>): Promise<unknown>;
}
export interface SharedMethodsPort {
  list(): Promise<Tool[]>;
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
}
export interface RealtimePort {
  create(sdp: string, tools: Tool[]): Promise<{ callId: string; sdp: string }>;
  hangup(callId: string): Promise<void>;
}
export interface Store {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  list<T>(prefix: string): Promise<Map<string, T>>;
  alarm(at: number): Promise<void>;
}
export type TranscriptLine = Readonly<{ itemId: string; role: "user" | "assistant"; text: string; at: number; interrupted?: boolean }>;
export type Finding = Readonly<{ kind: "member" | "tool" | "inference" | "recommendation" | "unknown"; text: string; sourceIds: string[] }>;
export type DocumentKind = "summary" | "report" | "copy" | "plan";
export type Document = Readonly<{ id: string; kind: DocumentKind; title: string; findings: Finding[]; createdAt: number; sourceRevision?: number }>;
export type CallRecord = {
  id: string;
  memberId: string;
  operationId: string;
  reservation: Reservation;
  callId?: string;
  status: "starting" | "active" | "ending" | "ended" | "failed";
  events: MeterEvent[];
  transcript: TranscriptLine[];
  itemOrder: Array<{ id: string; previousId: string | null }>;
  pendingTranscripts: string[];
  transcriptionFailures: string[];
  transcriptRevision: number;
  tools: Array<{ id: string; name: string; result: unknown }>;
  toolResults: Record<string, { output: string; sent: boolean }>;
  settlement?: Settlement;
  createdAt: number;
  endedAt?: number;
  expiresAt?: number;
  documents: Document[];
  deliveries: DeliveryJob[];
};
export interface DocumentPort {
  generate(kind: DocumentKind, record: CallRecord): Promise<Omit<Document, "id" | "createdAt">>;
}
export type DeliveryJob = {
  id: string; recordId: string; memberId: string; documentId: string; sourceRevision: number;
  operationId: string; requestFingerprint: string;
  channel: "email" | "line"; recipient: string; verifiedAt: number | null;
  state: "pending" | "sending" | "unknown" | "failed" | "succeeded";
  createdAt: number; providerReceipt?: string;
  failureCode?: "DOCUMENT_STALE";
  claimDigest?: string; claimExpiresAt?: number; claimedAt?: number;
};
export interface DeliveryPort {
  verify(job: DeliveryJob, proof: unknown): Promise<{ memberId: string; jobId: string; documentId: string; recipient: string; verifiedAt: number; supervised: boolean }>;
  send(job: DeliveryJob, resultUrl: string): Promise<{ outcome: "sent"; receipt: string } | { outcome: "rejected" | "unknown" }>;
}
export type Dependencies = {
  eccal: EccalPort;
  realtime: RealtimePort;
  mcp: SharedMethodsPort;
  documents: DocumentPort;
  store: Store;
  onMeterChange?: (record: CallRecord) => Promise<void>;
  now: () => number;
  id: () => string;
  delivery?: DeliveryPort;
  appOrigin?: string;
};
