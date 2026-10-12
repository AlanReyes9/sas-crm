import clsx from "clsx";
import { Loader2, X } from "lucide-react";
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "primary",
  size = "md",
  loading,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-60",
        size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
        {
          primary: "bg-brand-600 text-white shadow-sm hover:bg-brand-700",
          secondary: "border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50",
          ghost: "text-slate-600 hover:bg-slate-100",
          danger: "bg-rose-600 text-white hover:bg-rose-700",
        }[variant],
        className,
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Field({ label, help, children, className }: { label: string; help?: string; children: ReactNode; className?: string }) {
  return (
    <label className={clsx("block", className)}>
      <span className="label">{label}</span>
      {children}
      {help && <span className="mt-1 block text-xs text-slate-400">{help}</span>}
    </label>
  );
}

export function Badge({ children, color = "slate", className }: { children: ReactNode; color?: string; className?: string }) {
  const colors: Record<string, string> = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    red: "bg-rose-50 text-rose-700 ring-rose-600/20",
    yellow: "bg-amber-50 text-amber-700 ring-amber-600/20",
    blue: "bg-sky-50 text-sky-700 ring-sky-600/20",
    indigo: "bg-brand-50 text-brand-700 ring-brand-600/20",
  };
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ring-transparent", colors[color] ?? colors.slate, className)}>
      {children}
    </span>
  );
}

export function TagPill({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: `${color}1a`, color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {name}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx("h-5 w-5 animate-spin text-slate-400", className)} />;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {icon && <div className="mb-3 rounded-full bg-slate-100 p-3 text-slate-400">{icon}</div>}
      <p className="font-medium text-slate-700">{title}</p>
      {text && <p className="mt-1 max-w-sm text-sm text-slate-500">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-[8vh]" onMouseDown={onClose}>
      <div
        className={clsx("w-full rounded-xl bg-white shadow-xl", wide ? "max-w-3xl" : "max-w-lg")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Cerrar">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: ReactNode; title: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30" onMouseDown={onClose}>
      <div className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="font-semibold text-slate-900">{title}</div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Cerrar">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode }[] }) {
  return (
    <div className="flex gap-1 border-b border-slate-200">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={clsx(
            "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition",
            value === t.value ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-700",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="inline-flex items-center gap-2 text-sm">
      <span className={clsx("relative h-5 w-9 rounded-full transition", checked ? "bg-brand-600" : "bg-slate-300")}>
        <span className={clsx("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition", checked ? "left-[18px]" : "left-0.5")} />
      </span>
      {label}
    </button>
  );
}

export function Avatar({ text, className }: { text: string; className?: string }) {
  return (
    <div className={clsx("flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700", className)}>
      {text}
    </div>
  );
}
