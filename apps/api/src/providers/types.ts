import type { Channel, MessageStatus, VerificationStatus } from "@prisma/client";

/** Descripción de un campo de configuración; la UI genera el formulario a partir de esto. */
export interface FieldSpec {
  key: string;
  label: string;
  type?: "text" | "password" | "number" | "boolean" | "select";
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
}

export interface OutboundMessage {
  channel: Channel;
  /** E.164 para teléfono/WhatsApp, email para correo. */
  to: string;
  body: string;
  subject?: string;
  html?: string;
  mediaUrl?: string;
  /** Plantilla pre-aprobada (WhatsApp Business / Meta). */
  template?: { name: string; language: string; variables: string[] };
}

export interface SendResult {
  providerMessageId?: string;
  status: MessageStatus;
  raw?: unknown;
}

export interface VerifyResult {
  status: VerificationStatus;
  detail?: Record<string, unknown>;
}

export interface ProviderHooks {
  /** Notifica un cambio de estado de entrega (usado por proveedores sin webhooks, p. ej. mock). */
  statusUpdate(providerMessageId: string, status: MessageStatus, error?: string): Promise<void>;
}

export interface ProviderContext {
  connectionId: string;
  workspaceId: string;
  credentials: Record<string, string>;
  settings: Record<string, unknown>;
  hooks: ProviderHooks;
}

export interface VoiceCapability {
  /** Token para el SDK de voz en el navegador. */
  createAccessToken(identity: string): string;
  /** Número que se muestra como identificador de llamadas salientes. */
  callerId(): string | undefined;
}

export interface ProviderAdapter {
  send(message: OutboundMessage): Promise<SendResult>;
  /** Comprueba que las credenciales funcionan. */
  test(): Promise<{ ok: boolean; detail?: string }>;
  /** Verifica si una dirección es alcanzable por un canal (lookup, onWhatsApp...). */
  verifyAddress?(channel: Channel, address: string): Promise<VerifyResult>;
  voice?: VoiceCapability;
}

export interface ProviderDefinition {
  key: string;
  label: string;
  description: string;
  channels: Channel[];
  credentialFields: FieldSpec[];
  settingsFields: FieldSpec[];
  /** Rutas de webhook que hay que configurar en el proveedor (relativas a PUBLIC_URL). */
  webhooks?: (connectionId: string) => { label: string; path: string }[];
  create(ctx: ProviderContext): ProviderAdapter;
}

export class ProviderError extends Error {
  constructor(
    public provider: string,
    message: string,
    public retryable = false,
  ) {
    super(`[${provider}] ${message}`);
  }
}
