import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Button, Field } from "../components/ui";

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-full">
      <div className="hidden flex-1 flex-col justify-between bg-slate-900 p-12 text-white lg:flex">
        <div className="flex items-center gap-2">
          <img src="/logo.svg" className="h-9 w-9" alt="" />
          <span className="text-lg font-bold tracking-wide">CRM NEXUS</span>
        </div>
        <div>
          <h2 className="max-w-md text-3xl font-semibold leading-tight">
            WhatsApp, llamadas, SMS, correo y automatizaciones en una sola plataforma.
          </h2>
          <p className="mt-4 max-w-md text-slate-400">
            Conecta el proveedor que prefieras para cada canal —Twilio, Meta, WhatsApp Web, SendGrid, SMTP…— y cámbialo
            cuando quieras sin perder tu historial.
          </p>
        </div>
        <p className="text-xs text-slate-500">© {new Date().getFullYear()} CRM NEXUS</p>
      </div>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
          <p className="mb-6 mt-1 text-sm text-slate-500">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("demo@nexus.dev");
  const [password, setPassword] = useState("nexus1234");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await login(email, password);
      nav("/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Shell title="Inicia sesión" subtitle="Accede a tu espacio de trabajo">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Contraseña">
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <Button className="w-full" loading={loading}>
          Entrar
        </Button>
        <p className="text-center text-sm text-slate-500">
          ¿No tienes cuenta?{" "}
          <Link to="/register" className="font-medium text-brand-600">
            Crea tu workspace
          </Link>
        </p>
      </form>
    </Shell>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ name: "", company: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await register(form);
      nav("/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Shell title="Crea tu workspace" subtitle="Empieza con el proveedor sandbox y conecta los reales cuando quieras">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Tu nombre">
          <input className="input" value={form.name} onChange={set("name")} required minLength={2} />
        </Field>
        <Field label="Empresa">
          <input className="input" value={form.company} onChange={set("company")} required minLength={2} />
        </Field>
        <Field label="Email">
          <input className="input" type="email" value={form.email} onChange={set("email")} required />
        </Field>
        <Field label="Contraseña" help="Mínimo 8 caracteres">
          <input className="input" type="password" value={form.password} onChange={set("password")} required minLength={8} />
        </Field>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <Button className="w-full" loading={loading}>
          Crear cuenta
        </Button>
        <p className="text-center text-sm text-slate-500">
          ¿Ya tienes cuenta?{" "}
          <Link to="/login" className="font-medium text-brand-600">
            Inicia sesión
          </Link>
        </p>
      </form>
    </Shell>
  );
}
