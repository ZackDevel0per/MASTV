import { useState } from "react";
import { useCuentas, useTenants } from "@/hooks/use-api";
import { format } from "date-fns";
import { Users, Filter } from "lucide-react";

export function Cuentas() {
  const [filterTenant, setFilterTenant] = useState("");
  const { data: tenantsData } = useTenants();
  const { data: cuentasData, isLoading } = useCuentas(filterTenant);

  const cuentas = cuentasData?.cuentas || [];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-white flex items-center gap-3">
            <Users className="text-primary" /> Cuentas IPTV
          </h1>
          <p className="text-muted-foreground mt-1">Cuentas generadas y renovadas automáticamente</p>
        </div>
        
        <div className="flex items-center gap-3 glass-panel px-4 py-2 rounded-xl">
          <Filter size={18} className="text-muted-foreground" />
          <select 
            value={filterTenant} 
            onChange={(e) => setFilterTenant(e.target.value)}
            className="bg-transparent text-white outline-none text-sm font-medium min-w-[150px]"
          >
            <option value="" className="bg-background">Todos los tenants</option>
            {tenantsData?.tenants.map((t: any) => (
              <option key={t.id} value={t.id} className="bg-background">{t.nombre}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="glass-panel rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-white/5 border-b border-white/10 text-muted-foreground">
              <tr>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs">Tenant</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs">Teléfono (WA)</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs">Usuario CRM</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs">Plan</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs">Creación</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs">Expiración</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {cuentas.map((c: any) => (
                <tr key={c.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="px-6 py-4"><code className="text-xs text-primary">{c.tenantId}</code></td>
                  <td className="px-6 py-4 font-mono text-muted-foreground">{c.telefono}</td>
                  <td className="px-6 py-4 font-mono font-bold text-white">{c.usuario}</td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-1 rounded bg-accent/20 text-accent font-bold text-xs">{c.plan}</span>
                  </td>
                  <td className="px-6 py-4 text-muted-foreground">{c.fechaCreacion || "—"}</td>
                  <td className="px-6 py-4 text-white font-medium">{c.fechaExpiracion || "—"}</td>
                  <td className="px-6 py-4">
                     <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                      c.estado === 'ACTIVA' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 
                      'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                    }`}>
                      {c.estado}
                    </span>
                  </td>
                </tr>
              ))}
              {!isLoading && cuentas.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-muted-foreground">
                    No se encontraron cuentas registradas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
