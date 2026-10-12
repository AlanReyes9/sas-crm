import { EventEmitter } from "node:events";
import type { Call, Contact, Conversation, Message } from "@prisma/client";

/** Bus de eventos de dominio. Desacopla los módulos del motor de automatizaciones. */
export interface DomainEvents {
  "message.received": { workspaceId: string; contact: Contact; conversation: Conversation; message: Message };
  "contact.created": { workspaceId: string; contact: Contact };
  "tag.added": { workspaceId: string; contact: Contact; tagName: string };
  "call.completed": { workspaceId: string; call: Call; contact: Contact | null };
}

class TypedBus extends EventEmitter {
  emitEvent<K extends keyof DomainEvents>(name: K, payload: DomainEvents[K]) {
    return this.emit(name, payload);
  }
  onEvent<K extends keyof DomainEvents>(name: K, fn: (p: DomainEvents[K]) => void | Promise<void>) {
    return this.on(name, (p) => {
      Promise.resolve(fn(p)).catch((e) => console.error(`[bus] ${name}`, e));
    });
  }
}

export const bus = new TypedBus();
