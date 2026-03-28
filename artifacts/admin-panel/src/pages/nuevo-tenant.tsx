import { useState } from "react";
import { useCreateTenant } from "@/hooks/use-api";
import { useLocation } from "wouter";
import { PlusCircle, Building, KeyRound, Database, Bell, ListChecks } from "lucide-react";

// Planes base del sistema — mismos para todos, solo varía el precio
const PLANES_BASE = [
  { codigo: "1D1M",  nombre: "1 Dispositivo — 1 Mes",                   dispositivos: 1, duracion: "1 mes",               montoDefault: 29  },
  { codigo: "1D3M",  nombre: "1 Dispositivo — 3 Meses",                 dispositivos: 1, duracion: "3 meses",             montoDefault: 82  },
  { codigo: "1D6M",  nombre: "1 Dispositivo — 6 Meses + 1 Gratis",      dispositivos: 1, duracion: "6 meses + 1 gratis",  montoDefault: 155 },
  { codigo: "1D12M", nombre: "1 Dispositivo — 12 Meses + 2 Gratis",     dispositivos: 1, duracion: "12 meses + 2 gratis", montoDefault: 300 },
  { codigo: "2D1M",  nombre: "2 Dispositivos — 1 Mes",                  dispositivos: 2, duracion: "1 mes",               montoDefault: 35  },
  { codigo: "2D3M",  nombre: "2 Dispositivos — 3 Meses",                dispositivos: 2, duracion: "3 meses",             montoDefault: 100 },
  { codigo: "2D6M",  nombre: "2 Dispositivos — 6 Meses + 1 Gratis",     dispositivos: 2, duracion: "6 meses + 1 gratis",  montoDefault: 190 },
  { codigo: "2D12M", nombre: "2 Dispositivos — 12 Meses + 2 Gratis",    dispositivos: 2, duracion: "12 meses + 2 gratis", montoDefault: 380 },
  { codigo: "3D1M",  nombre: "3 Dispositivos — 1 Mes",                  dispositivos: 3, duracion: "1 mes",               montoDefault: 40  },
  { codigo: "3D3M",  nombre: "3 Dispositivos — 3 Meses",                dispositivos: 3, duracion: "3 meses",             montoDefault: 115 },
  { codigo: "3D6M",  nombre: "3 Dispositivos — 6 Meses + 1 Gratis",     dispositivos: 3, duracion: "6 meses + 1 gratis",  montoDefault: 225 },
  { codigo: "3D12M", nombre: "3 Dispositivos — 12 Meses + 2 Gratis",    dispositivos: 3, duracion: "12 meses + 2 gratis", montoDefault: 440 },
];

const GRUPOS = [
  { label: "📺 1 Dispositivo",  dispositivos: 1 },
  { label: "📺📺 2 Dispositivos", dispositivos: 2 },
  { label: "📺📺📺 3 Dispositivos", dispositivos: 3 },
];

export function NuevoTenant() {
  const mut = useCreateTenant();
  const [, setLocation] = useLocation();
  const [usarPreciosCustom, setUsarPreciosCustom] = useState(false);
  // Map codigo → precio ingresado
  const [precios, setPrecios] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const setPrice = (codigo: string, val: string) => {
    setPrecios((p) => ({ ...p, [codigo]: val }));
  };

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    setError("");
    const fd = new FormData(e.currentTarget);
    const data = Object.fromEntries(fd) as any;
    data.activo = fd.get("activo") === "on";

    if (usarPreciosCustom) {
      const planes = PLANES_BASE.map((p) => {
        const montoStr = precios[p.codigo];
        const monto = montoStr && montoStr.trim() !== "" ? Number(montoStr) : p.montoDefault;
        return {
          codigo: p.codigo,
          nombre: p.nombre,
          monto,
          descripcion: `📺 *${p.nombre}*\n💰 Bs ${monto}\n✅ Acceso a todos nuestros canales`,
          tolerancia: 1,
          dispositivos: p.dispositivos,
          duracion: p.duracion,
        };
      });
      data.planesJson = JSON.stringify(planes);
    }

    try {
      await mut.mutateAsync({ data });
      setLocation("/");
    } catch {
      setError("Error creando tenant. Revisa los datos e intenta de nuevo.");
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500 pb-12">
      <div>
        <h1 className="text-3xl font-display font-bold text-white flex items-center gap-3">
          <PlusCircle className="text-primary" /> Crear Nuevo Tenant
        </h1>
        <p className="text-muted-foreground mt-1">Configura un nuevo cliente con sus integraciones y bot</p>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm font-medium">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Identidad */}
        <Section title="1. Identidad" icon={Building}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div><label className="label-base">ID Único (Slug)*</label><input name="id" required placeholder="ej: mipymes-tv" className="input-base" /></div>
            <div><label className="label-base">Admin WhatsApp*</label><input name="adminWhatsapp" required placeholder="59160000000" className="input-base" /></div>
            <div><label className="label-base">Nombre Corto*</label><input name="nombre" required placeholder="Mi Empresa" className="input-base" /></div>
            <div><label className="label-base">Nombre Empresa Completo*</label><input name="nombreEmpresa" required placeholder="Mi Empresa Bolivia S.R.L." className="input-base" /></div>
            <div className="col-span-1 sm:col-span-2">
              <label className="label-base">Suscripción Vence (Opcional)</label>
              <input type="date" name="suscripcionVence" className="input-base max-w-xs" />
            </div>
          </div>
        </Section>

        {/* CRM */}
        <Section title="2. Credenciales CRM Mastv" icon={Database}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="col-span-1 sm:col-span-2"><label className="label-base">CRM Base URL</label><input name="crmBaseUrl" defaultValue="https://resellermastv.com:8443" className="input-base" /></div>
            <div><label className="label-base">Username</label><input name="crmUsername" className="input-base" /></div>
            <div><label className="label-base">Password</label><input type="password" name="crmPassword" className="input-base" /></div>
            <div><label className="label-base">Prefijo Usuarios (ej: zk)</label><input name="crmUsernamePrefix" defaultValue="zk" className="input-base" /></div>
          </div>
        </Section>

        {/* Google */}
        <Section title="3. Google Workspace" icon={KeyRound}>
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div><label className="label-base">Spreadsheet ID</label><input name="spreadsheetId" className="input-base" /></div>
              <div><label className="label-base">Filtro Remitente Gmail</label><input name="gmailRemitenteFiltro" placeholder="pagos@banco.com" className="input-base" /></div>
            </div>
            <div>
              <label className="label-base">Service Account JSON</label>
              <textarea name="googleServiceAccountJson" rows={4} className="input-base font-mono text-xs" placeholder='{"type": "service_account", ...}'></textarea>
            </div>
          </div>
        </Section>

        {/* Planes */}
        <Section title="4. Precios del Tenant" icon={ListChecks}>
          {/* Toggle */}
          <div className="flex items-center gap-3 mb-6">
            <button
              type="button"
              onClick={() => setUsarPreciosCustom(!usarPreciosCustom)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${usarPreciosCustom ? "bg-primary" : "bg-white/10"}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${usarPreciosCustom ? "translate-x-6" : "translate-x-1"}`} />
            </button>
            <span className="text-white font-medium">
              {usarPreciosCustom ? "Precios personalizados para este tenant" : "Usar precios por defecto del sistema"}
            </span>
          </div>

          {!usarPreciosCustom ? (
            <p className="text-sm text-muted-foreground bg-white/[0.03] rounded-xl p-4 border border-white/5">
              Se usarán los precios estándar: <span className="text-white font-medium">1D=29/82/155/300 Bs · 2D=35/100/190/380 Bs · 3D=40/115/225/440 Bs</span>. Activa el switch para personalizarlos.
            </p>
          ) : (
            <div className="space-y-6">
              {GRUPOS.map(({ label, dispositivos }) => (
                <div key={dispositivos}>
                  <p className="text-sm font-semibold text-muted-foreground mb-3">{label}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {PLANES_BASE.filter((p) => p.dispositivos === dispositivos).map((plan) => (
                      <div key={plan.codigo} className="bg-white/[0.03] border border-white/10 rounded-xl p-3 space-y-2">
                        <p className="text-xs text-muted-foreground font-medium">{plan.duracion}</p>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min={0}
                            placeholder={String(plan.montoDefault)}
                            value={precios[plan.codigo] ?? ""}
                            onChange={(e) => setPrice(plan.codigo, e.target.value)}
                            className="input-base text-center text-lg font-bold py-2 px-2"
                          />
                          <span className="text-muted-foreground text-sm font-medium shrink-0">Bs</span>
                        </div>
                        <p className="text-xs text-muted-foreground/60 text-center">
                          default: {plan.montoDefault} Bs
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Notificaciones */}
        <Section title="5. Notificaciones" icon={Bell}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div><label className="label-base">Pushover User Key</label><input name="pushoverUserKey" className="input-base" /></div>
            <div><label className="label-base">Pushover API Token</label><input name="pushoverApiToken" className="input-base" /></div>
          </div>

          <div className="mt-6 pt-6 border-t border-white/10">
            <label className="flex items-center gap-3 cursor-pointer group w-max">
              <div className="relative flex items-center justify-center">
                <input type="checkbox" name="activo" defaultChecked className="peer sr-only" />
                <div className="w-6 h-6 border-2 border-muted-foreground rounded bg-transparent peer-checked:bg-primary peer-checked:border-primary transition-all"></div>
                <svg className="absolute w-4 h-4 text-white opacity-0 peer-checked:opacity-100 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
              </div>
              <span className="text-white font-medium group-hover:text-primary transition-colors">Activar bot inmediatamente al crear</span>
            </label>
          </div>
        </Section>

        <div className="flex justify-end gap-4 pt-4">
          <button type="button" onClick={() => setLocation("/")} className="btn-secondary px-8">Cancelar</button>
          <button type="submit" disabled={mut.isPending} className="btn-primary px-8 text-lg">
            {mut.isPending ? "Creando..." : "Crear Tenant"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Section({ title, icon: Icon, children }: any) {
  return (
    <div className="glass-panel rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-white/5 bg-white/[0.02] flex items-center gap-3">
        <Icon className="text-primary" size={20} />
        <h2 className="text-lg font-display font-bold text-white">{title}</h2>
      </div>
      <div className="p-6">
        {children}
      </div>
    </div>
  );
}
