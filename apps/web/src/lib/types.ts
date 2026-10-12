export type Channel = "WHATSAPP" | "SMS" | "EMAIL" | "VOICE";
export type MessageChannel = Exclude<Channel, "VOICE">;

export interface Tag {
  id: string;
  name: string;
  color: string;
  _count?: { contacts: number };
}

export interface Verification {
  id: string;
  channel: Channel;
  address: string;
  status: "UNVERIFIED" | "VALID" | "INVALID" | "UNKNOWN";
  detail: Record<string, unknown>;
  checkedAt: string;
}

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  company: string | null;
  notes: string | null;
  customFields: Record<string, unknown>;
  optOut: boolean;
  createdAt: string;
  tags?: { tag: Tag }[];
  verifications?: Verification[];
}

export interface Message {
  id: string;
  conversationId: string;
  direction: "INBOUND" | "OUTBOUND";
  channel: Channel;
  body: string;
  subject: string | null;
  mediaUrl: string | null;
  status: "QUEUED" | "SENT" | "DELIVERED" | "READ" | "FAILED" | "RECEIVED";
  provider: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface Conversation {
  id: string;
  contactId: string;
  channel: MessageChannel;
  status: "OPEN" | "PENDING" | "CLOSED";
  assigneeId: string | null;
  unreadCount: number;
  lastMessageAt: string;
  lastPreview: string | null;
  contact: Contact;
  assignee?: { id: string; name: string } | null;
}

export interface Template {
  id: string;
  name: string;
  channel: MessageChannel;
  category: string;
  language: string;
  subject: string | null;
  body: string;
  html: string | null;
  externalId: string | null;
  status: string;
  variables?: string[];
  updatedAt: string;
}

export interface Segment {
  id: string;
  name: string;
  description: string | null;
  rules: SegmentRules;
  count?: number;
}
export interface SegmentRules {
  match: "all" | "any";
  conditions: { field: string; op: string; value?: string | number | boolean }[];
}

export interface CampaignStats {
  total: number;
  PENDING: number;
  SENT: number;
  DELIVERED: number;
  FAILED: number;
  SKIPPED: number;
}

export interface Campaign {
  id: string;
  name: string;
  channel: MessageChannel;
  templateId: string | null;
  body: string | null;
  subject: string | null;
  audience: { segmentIds: string[]; tagIds: string[]; contactIds: string[]; all?: boolean };
  status: "DRAFT" | "SCHEDULED" | "RUNNING" | "COMPLETED" | "PAUSED" | "FAILED";
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  ratePerMin: number;
  createdAt: string;
  stats: CampaignStats;
  template?: { id: string; name: string } | null;
}

export interface Call {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  from: string;
  to: string;
  status: string;
  duration: number;
  recordingUrl: string | null;
  notes: string | null;
  createdAt: string;
  contact?: { id: string; firstName: string; lastName: string } | null;
  user?: { id: string; name: string } | null;
}

export interface FieldSpec {
  key: string;
  label: string;
  type?: "text" | "password" | "number" | "boolean" | "select";
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
}

export interface ProviderDef {
  key: string;
  label: string;
  description: string;
  channels: Channel[];
  credentialFields: FieldSpec[];
  settingsFields: FieldSpec[];
}

export interface Connection {
  id: string;
  provider: string;
  providerLabel: string;
  name: string;
  status: string;
  lastError: string | null;
  channels: Channel[];
  settings: Record<string, unknown>;
  credentials: Record<string, string>;
  webhooks: { label: string; path: string; url: string }[];
}

export interface ChannelRoute {
  id: string;
  channel: Channel;
  connectionId: string;
  priority: number;
}

export interface WorkflowNodeData {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface Workflow {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  triggerType: string;
  graph: { nodes: WorkflowNodeData[]; edges: { id: string; source: string; target: string; sourceHandle?: string | null }[] };
  webhookKey: string;
  webhookUrl: string;
  updatedAt: string;
  _count?: { runs: number };
}

export interface WorkflowRun {
  id: string;
  status: "RUNNING" | "WAITING" | "COMPLETED" | "FAILED";
  logs: { at: string; nodeId: string; type: string; ok: boolean; message: string }[];
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  resumeAt: string | null;
}
