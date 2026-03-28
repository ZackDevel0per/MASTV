import { useState } from "react";
import { usePagos, useTenants } from "@/hooks/use-api";
import { formatCurrency } from "@/lib/utils";
import { format } from "date-fns";
import { CreditCard, Filter } from "lucide-react";

export function Pagos() {
  const [filterTenant, setFilterTenant] = useState("");
  const { data: tenantsData } = useTenants();
  const { data: pagosData, isLoading } = usePagos(filterTenant);

  const pagos = pagosData?.pagos || [];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-white flex items-center gap-3">
            <CreditCard className="text-primary" /> Pagos Registrados
          </h1>
          <p className="text-muted-foreground mt-1">Historial global de pagos sincronizados por los bots</p>
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
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs">Fecha</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs">Cliente</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs">Monto</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs">Teléfono</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs">Estado</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs">Sincronizado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {pagos.map((p: any) => (
                <tr key={p.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="px-6 py-4"><code className="text-xs text-primary">{p.tenantId}</code></td>
                  <td className="px-6 py-4 whitespace-nowrap text-muted-foreground">{p.fecha}</td>
                  <td className="px-6 py-4 font-bold text-white">{p.nombre}</td>
                  <td className="px-6 py-4 text-emerald-400 font-bold">{formatCurrency(p.monto)}</td>
                  <td className="px-6 py-4 font-mono text-muted-foreground">{p.telefono || "—"}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                      p.estado === 'Usado' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 
                      'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                    }`}>
                      {p.estado}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-xs text-muted-foreground whitespace-nowrap">
                    {p.sincronizadoEn ? format(new Date(p.sincronizadoEn), "dd/MM/yy HH:mm") : "—"}
                  </td>
                </tr>
              ))}
              {!isLoading && pagos.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-muted-foreground">
                    No se encontraron pagos.
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
