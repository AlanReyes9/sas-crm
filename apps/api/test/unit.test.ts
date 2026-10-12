import { describe, expect, it } from "vitest";
import { extractVariables, render, renderDeep } from "../src/lib/template.js";
import { toE164 } from "../src/lib/phone.js";
import { decryptJson, encryptJson, mask } from "../src/lib/crypto.js";
import { nextNodeId, validateGraph } from "../src/automation/engine.js";
import { evaluateCondition } from "../src/automation/nodes.js";

describe("plantillas", () => {
  it("renderiza variables anidadas y valores por defecto", () => {
    const ctx = { contact: { firstName: "Ana" }, workspace: { name: "Nexus" } };
    expect(render("Hola {{contact.firstName}} de {{ workspace.name }}", ctx)).toBe("Hola Ana de Nexus");
    expect(render('Hola {{contact.lastName | "cliente"}}', ctx)).toBe("Hola cliente");
    expect(renderDeep({ a: ["{{contact.firstName}}"] }, ctx)).toEqual({ a: ["Ana"] });
    expect(extractVariables("{{a.b}} {{c}} {{a.b}}")).toEqual(["a.b", "c"]);
  });
});

describe("teléfonos", () => {
  it("normaliza a E.164", () => {
    expect(toE164("55 1234 5678")).toBe("+525512345678");
    expect(toE164("+1 (415) 555-0100")).toBe("+14155550100");
    expect(toE164("whatsapp:+34600111222")).toBe("+34600111222");
    expect(toE164("0034600111222")).toBe("+34600111222");
    expect(toE164("123")).toBeNull();
  });
});

describe("cifrado de credenciales", () => {
  it("cifra y descifra con AES-GCM", () => {
    const enc = encryptJson({ authToken: "secreto123" });
    expect(enc).not.toContain("secreto123");
    expect(decryptJson(enc)).toEqual({ authToken: "secreto123" });
    expect(mask("secreto123")).toBe("••••o123");
  });
});

describe("motor de workflows", () => {
  const graph = {
    nodes: [
      { id: "t", type: "trigger", data: { triggerType: "manual" } },
      { id: "c", type: "condition", data: {} },
      { id: "a", type: "add_tag", data: {} },
      { id: "b", type: "end", data: {} },
    ],
    edges: [
      { id: "e1", source: "t", target: "c" },
      { id: "e2", source: "c", target: "a", sourceHandle: "true" },
      { id: "e3", source: "c", target: "b", sourceHandle: "false" },
    ],
  };
  it("sigue las ramas por handle", () => {
    expect(nextNodeId(graph, "t")).toBe("c");
    expect(nextNodeId(graph, "c", "true")).toBe("a");
    expect(nextNodeId(graph, "c", "false")).toBe("b");
    expect(validateGraph(graph)).toEqual([]);
  });
  it("detecta grafos inválidos", () => {
    expect(validateGraph({ nodes: [{ id: "x", type: "foo", data: {} }], edges: [] })).toHaveLength(2);
  });
  it("evalúa condiciones", () => {
    const ctx = { workspaceId: "w", trigger: { type: "manual" }, message: { id: "1", body: "Quiero el PRECIO", channel: "SMS" }, vars: { n: 5 } };
    expect(evaluateCondition({ left: "{{message.body}}", op: "contains", right: "precio, costo" }, ctx)).toBe(true);
    expect(evaluateCondition({ left: "{{vars.n}}", op: "gt", right: "3" }, ctx)).toBe(true);
    expect(evaluateCondition({ left: "{{contact.email}}", op: "is_empty" }, ctx)).toBe(true);
  });
});
