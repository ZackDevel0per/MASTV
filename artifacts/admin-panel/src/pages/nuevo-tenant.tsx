import { useCreateTenant } from "@/hooks/use-api";
import { useLocation } from "wouter";
import { PlusCircle, Building, KeyRound, Database, Bell } from "lucide-react";

export function NuevoTenant() {
  const mut = useCreateTenant();
  const [, setLocation] = useLocation();

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = Object.fromEntries(fd) as any;
    
    // Checkbox handling
    data.activo = fd.get("activo") === "on";
    
    try {
      await mut.mutateAsync({ data });
      setLocation("/");
    } catch (err) {
      alert("Error creando tenant");
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

        {/* Google Integrations */}
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

        {/* Pushover & Extras */}
        <Section title="4. Notificaciones & Extras" icon={Bell}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div><label className="label-base">Pushover User Key</label><input name="pushoverUserKey" className="input-base" /></div>
            <div><label className="label-base">Pushover API Token</label><input name="pushoverApiToken" className="input-base" /></div>
            <div className="col-span-1 sm:col-span-2">
              <label className="label-base">Planes JSON (Opcional - sobrescribe defaults)</label>
              <textarea name="planesJson" rows={4} className="input-base font-mono text-xs" placeholder='[{"nombre": "1 MES", "monto": 35, ...}]'></textarea>
            </div>
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
          <button type="submit" disabled={mut.isPending} className="btn-primary px-8 text-lg">Crear Tenant</button>
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
