import { useState } from "react";
import { useCreateTenant } from "@/hooks/use-api";
import { useLocation } from "wouter";
import { PlusCircle, Building, KeyRound, Database, Bell, Trash2, Plus, ListChecks } from "lucide-react";

interface Plan {
  codigo: string;
  nombre: string;
  monto: number;
  tolerancia: number;
  dispositivos: number;
  duracion: string;
  dias: number;
  crmPlanId: string;
}

const DEFAULT_PLAN: Plan = {
  codigo: "",
  nombre: "",
  monto: 0,
  tolerancia: 5,
  dispositivos: 1,
  duracion: "1 mes",
  dias: 30,
  crmPlanId: "",
};

export function NuevoTenant() {
  const mut = useCreateTenant();
  const [, setLocation] = useLocation();
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [nuevoPlan, setNuevoPlan] = useState<Plan>({ ...DEFAULT_PLAN });
  const [error, setError] = useState("");

  const agregarPlan = () => {
    if (!nuevoPlan.codigo || !nuevoPlan.nombre || nuevoPlan.monto <= 0) {
      setError("El plan necesita código, nombre y monto.");
      return;
    }
    if (planes.find((p) => p.codigo === nuevoPlan.codigo)) {
      setError(`Ya existe un plan con el código "${nuevoPlan.codigo}".`);
      return;
    }
    setError("");
    setPlanes([...planes, { ...nuevoPlan }]);
    setNuevoPlan({ ...DEFAULT_PLAN });
  };

  const eliminarPlan = (codigo: string) => {
    setPlanes(planes.filter((p) => p.codigo !== codigo));
  };

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = Object.fromEntries(fd) as any;
    data.activo = fd.get("activo") === "on";
    if (planes.length > 0) {
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
        <Section title="4. Planes de Precios" icon={ListChecks}>
          <div className="space-y-6">
            <p className="text-sm text-muted-foreground">
              Agrega los planes que este tenant venderá. Si no agregas ninguno, se usarán los planes por defecto del sistema.
            </p>

            {/* Tabla de planes agregados */}
            {planes.length > 0 && (
              <div className="rounded-xl overflow-hidden border border-white/10">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-white/[0.03] text-muted-foreground text-xs uppercase tracking-wider">
                      <th className="px-4 py-3 text-left">Código</th>
                      <th className="px-4 py-3 text-left">Nombre</th>
                      <th className="px-4 py-3 text-left">Monto</th>
                      <th className="px-4 py-3 text-left">Tolerancia</th>
                      <th className="px-4 py-3 text-left">Dispositivos</th>
                      <th className="px-4 py-3 text-left">Duración</th>
                      <th className="px-4 py-3 text-left">Días</th>
                      <th className="px-4 py-3 text-left">CRM Plan ID</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {planes.map((p) => (
                      <tr key={p.codigo} className="border-t border-white/5 hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 py-3 font-mono text-primary font-bold">{p.codigo}</td>
                        <td className="px-4 py-3 text-white font-medium">{p.nombre}</td>
                        <td className="px-4 py-3 text-white">{p.monto} Bs</td>
                        <td className="px-4 py-3 text-muted-foreground">±{p.tolerancia} Bs</td>
                        <td className="px-4 py-3 text-muted-foreground">{p.dispositivos}</td>
                        <td className="px-4 py-3 text-muted-foreground">{p.duracion}</td>
                        <td className="px-4 py-3 text-muted-foreground">{p.dias}</td>
                        <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{p.crmPlanId || "—"}</td>
                        <td className="px-4 py-3">
                          <button type="button" onClick={() => eliminarPlan(p.codigo)} className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded">
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Formulario para agregar un plan */}
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 space-y-4">
              <p className="text-sm font-semibold text-primary">Agregar plan</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <label className="label-base">Código (letra)*</label>
                  <input
                    value={nuevoPlan.codigo}
                    onChange={(e) => setNuevoPlan({ ...nuevoPlan, codigo: e.target.value.toUpperCase().slice(0, 2) })}
                    placeholder="A"
                    maxLength={2}
                    className="input-base font-mono uppercase"
                  />
                </div>
                <div className="col-span-1 sm:col-span-3">
                  <label className="label-base">Nombre del plan*</label>
                  <input
                    value={nuevoPlan.nombre}
                    onChange={(e) => setNuevoPlan({ ...nuevoPlan, nombre: e.target.value })}
                    placeholder="ej: 1 MES HD"
                    className="input-base"
                  />
                </div>
                <div>
                  <label className="label-base">Precio (Bs)*</label>
                  <input
                    type="number"
                    min={0}
                    value={nuevoPlan.monto || ""}
                    onChange={(e) => setNuevoPlan({ ...nuevoPlan, monto: Number(e.target.value) })}
                    placeholder="35"
                    className="input-base"
                  />
                </div>
                <div>
                  <label className="label-base">Tolerancia (±Bs)</label>
                  <input
                    type="number"
                    min={0}
                    value={nuevoPlan.tolerancia || ""}
                    onChange={(e) => setNuevoPlan({ ...nuevoPlan, tolerancia: Number(e.target.value) })}
                    placeholder="5"
                    className="input-base"
                  />
                </div>
                <div>
                  <label className="label-base">Dispositivos</label>
                  <input
                    type="number"
                    min={1}
                    value={nuevoPlan.dispositivos || ""}
                    onChange={(e) => setNuevoPlan({ ...nuevoPlan, dispositivos: Number(e.target.value) })}
                    placeholder="1"
                    className="input-base"
                  />
                </div>
                <div>
                  <label className="label-base">Días</label>
                  <input
                    type="number"
                    min={1}
                    value={nuevoPlan.dias || ""}
                    onChange={(e) => setNuevoPlan({ ...nuevoPlan, dias: Number(e.target.value) })}
                    placeholder="30"
                    className="input-base"
                  />
                </div>
                <div className="col-span-2">
                  <label className="label-base">Descripción duración</label>
                  <input
                    value={nuevoPlan.duracion}
                    onChange={(e) => setNuevoPlan({ ...nuevoPlan, duracion: e.target.value })}
                    placeholder="ej: 1 mes"
                    className="input-base"
                  />
                </div>
                <div className="col-span-2">
                  <label className="label-base">CRM Plan ID (opcional)</label>
                  <input
                    value={nuevoPlan.crmPlanId}
                    onChange={(e) => setNuevoPlan({ ...nuevoPlan, crmPlanId: e.target.value })}
                    placeholder="ej: 1month"
                    className="input-base"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={agregarPlan}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity"
              >
                <Plus size={16} /> Agregar plan a la lista
              </button>
            </div>
          </div>
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
