import { useState } from "react";
import { useCuentas, useTenants } from "@/hooks/use-api";
import { format } from "date-fns";
import { Users, Filter, Download, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";

const ESTADOS_CUENTA = ["", "ACTIVA", "EXPIRADA", "RENOVADA"];

function exportCsv(rows: any[]) {
  const headers = ["ID", "Tenant", "Teléfono", "Usuario CRM", "Plan", "Creación", "Expiración", "Estado", "Sincronizado"];
  const lines = [headers.join(",")];
  for (const c of rows) {
    lines.push([
      c.id, c.tenantId, c.telefono ?? "", c.usuario ?? "", c.plan ?? "",
      c.fechaCreacion ?? "", c.fechaExpiracion ?? "", c.estado ?? "",
      c.sincronizadoEn ? format(new Date(c.sincronizadoEn), "dd/MM/yyyy HH:mm") : "",
    ].join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cuentas_${format(new Date(), "yyyyMMdd_HHmm")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function Cuentas() {
  const [filterTenant, setFilterTenant] = useState("");
  const [filterEstado, setFilterEstado] = useState("");
  const { data: tenantsData } = useTenants();
  const { data: cuentasData, isLoading, refetch } = useCuentas(filterTenant || undefined, {
    estado: filterEstado || undefined,
  });

  const cuentas = cuentasData?.cuentas || [];
  const hasFilters = filterTenant || filterEstado;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-white flex items-center gap-3">
            <Users className="text-primary" /> Cuentas IPTV
          </h1>
          <p className="text-muted-foreground mt-1">
            Cuentas generadas y renovadas automáticamente · <span className="text-white font-semibold">{cuentas.length}</span> registros
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()} className="btn-secondary py-2 px-3 text-sm">
            <RefreshCw size={16} /> Actualizar
          </button>
          <button onClick={() => exportCsv(cuentas)} disabled={cuentas.length === 0} className="btn-primary py-2 px-3 text-sm disabled:opacity-50">
            <Download size={16} /> Exportar CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="glass-panel rounded-2xl p-4">
        <div className="flex flex-wrap items-end gap-4">
          {/* Tenant */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Tenant</label>
            <div className="flex items-center gap-2 bg-black/40 border border-white/10 rounded-xl px-3 py-2">
              <Filter size={15} className="text-muted-foreground" />
              <select value={filterTenant} onChange={(e) => setFilterTenant(e.target.value)}
                className="bg-transparent text-white outline-none text-sm font-medium min-w-[150px]">
                <option value="" className="bg-background">Todos los tenants</option>
                {tenantsData?.tenants.map((t: any) => (
                  <option key={t.id} value={t.id} className="bg-background">{t.nombre}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Estado */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Estado</label>
            <div className="flex items-center gap-2 bg-black/40 border border-white/10 rounded-xl px-3 py-2">
              <select value={filterEstado} onChange={(e) => setFilterEstado(e.target.value)}
                className="bg-transparent text-white outline-none text-sm font-medium min-w-[130px]">
                {ESTADOS_CUENTA.map((e) => <option key={e} value={e} className="bg-background">{e || "Todos los estados"}</option>)}
              </select>
            </div>
          </div>

          {hasFilters && (
            <button onClick={() => { setFilterTenant(""); setFilterEstado(""); }}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-white transition-colors py-2 px-3 rounded-xl hover:bg-white/5 self-end">
              <X size={15} /> Limpiar filtros
            </button>
          )}
        </div>
      </div>

      {/* Table */}
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
                    <span className={cn(
                      "px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider",
                      c.estado === "ACTIVA"
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                        : c.estado === "RENOVADA"
                        ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                        : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                    )}>
                      {c.estado}
                    </span>
                  </td>
                </tr>
              ))}
              {!isLoading && cuentas.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-muted-foreground">
                    No se encontraron cuentas con los filtros actuales.
                  </td>
                </tr>
              )}
              {isLoading && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-muted-foreground">
                    <RefreshCw className="mx-auto animate-spin mb-2 opacity-50" size={24} />
                    Cargando cuentas...
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
