import type { FieldSpec } from "../lib/types";
import { Field, Toggle } from "./ui";

/** Formulario generado a partir de la definición de campos de un proveedor. */
export function DynamicForm({
  fields,
  values,
  onChange,
}: {
  fields: FieldSpec[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((f) => {
        const v = values[f.key];
        if (f.type === "boolean") {
          return (
            <div key={f.key} className="sm:col-span-2">
              <Toggle checked={Boolean(v)} onChange={(x) => onChange(f.key, x)} label={f.label} />
            </div>
          );
        }
        return (
          <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`} help={f.help}>
            {f.type === "select" ? (
              <select className="input" value={String(v ?? "")} onChange={(e) => onChange(f.key, e.target.value)}>
                <option value="">—</option>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="input"
                type={f.type === "password" ? "password" : f.type === "number" ? "number" : "text"}
                placeholder={f.placeholder}
                value={String(v ?? "")}
                autoComplete="off"
                onChange={(e) => onChange(f.key, e.target.value)}
              />
            )}
          </Field>
        );
      })}
    </div>
  );
}
