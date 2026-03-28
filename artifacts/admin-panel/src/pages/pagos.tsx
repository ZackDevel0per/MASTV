import { useState, useCallback } from "react";
import { usePagos, useTenants } from "@/hooks/use-api";
import { formatCurrency } from "@/lib/utils";
import { format, startOfMonth, endOfDay } from "date-fns";
import { CreditCard, Filter, Download, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";

const ESTADOS_PAGO = ["", "No usado", "Usado"];

function exportCsv(rows: any[]) {
  const headers = ["ID", "Tenant", "Fecha", "Nombre", "Monto (Bs)", "Teléfono", "Estado", "Gmail ID", "Sincronizado"];
  const lines = [headers.join(",")];
  for (const p of rows) {
    lines.push([
      p.id, p.tenantId, p.fecha ?? "", `"${(p.nombre ?? "").replace(/"/g, "'")}"`,
      p.monto ?? "", p.telefono ?? "", p.estado ?? "", p.gmailId ?? "",
      p.sincronizadoEn ? format(new Date(p.sincronizadoEn), "dd/MM/yyyy HH:mm") : "",
    ].join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pagos_${format(new Date(), "yyyyMMdd_HHmm")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function Pagos() {
  const [filterTenant, setFilterTenant] = useState("");
  const [filterEstado, setFilterEstado] = useState("");
  const [filterDesde, setFilterDesde] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [filterHasta, setFilterHasta] = useState(format(endOfDay(new Date()), "yyyy-MM-dd"));
  const [useDesde, setUseDesde] = useState(false);
  const [useHasta, setUseHasta] = useState(false);

  const { data: tenantsData } = useTenants();
  const { data: pagosData, isLoading, refetch } = usePagos(filterTenant || undefined, {
    desde: useDesde ? filterDesde : undefined,
    hasta: useHasta ? `${filterHasta}T23:59:59` : undefined,
    estado: filterEstado || undefined,
  });

  const pagos = pagosData?.pagos || [];

  const clearFilters = () => {
    setFilterTenant(""); setFilterEstado("");
    setUseDesde(false); setUseHasta(false);
  };

  const hasFilters = filterTenant || filterEstado || useDesde || useHasta;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-white flex items-center gap-3">
            <CreditCard className="text-primary" /> Pagos Registrados
          </h1>
          <p className="text-muted-foreground mt-1">
            Historial global de pagos sincronizados · <span className="text-white font-semibold">{pagos.length}</span> registros
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()} className="btn-secondary py-2 px-3 text-sm">
            <RefreshCw size={16} /> Actualizar
          </button>
          <button onClick={() => exportCsv(pagos)} disabled={pagos.length === 0} className="btn-primary py-2 px-3 text-sm disabled:opacity-50">
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
                className="bg-transparent text-white outline-none text-sm font-medium min-w-[120px]">
                {ESTADOS_PAGO.map((e) => <option key={e} value={e} className="bg-background">{e || "Todos los estados"}</option>)}
              </select>
            </div>
          </div>

          {/* Desde */}
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-2 text-xs text-muted-foreground font-semibold uppercase tracking-wider cursor-pointer">
              <input type="checkbox" checked={useDesde} onChange={(e) => setUseDesde(e.target.checked)} className="accent-primary" />
              Desde
            </label>
            <input type="date" value={filterDesde} onChange={(e) => setFilterDesde(e.target.value)} disabled={!useDesde}
              className="bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none disabled:opacity-40 focus:border-primary" />
          </div>

          {/* Hasta */}
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-2 text-xs text-muted-foreground font-semibold uppercase tracking-wider cursor-pointer">
              <input type="checkbox" checked={useHasta} onChange={(e) => setUseHasta(e.target.checked)} className="accent-primary" />
              Hasta
            </label>
            <input type="date" value={filterHasta} onChange={(e) => setFilterHasta(e.target.value)} disabled={!useHasta}
              className="bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none disabled:opacity-40 focus:border-primary" />
          </div>

          {hasFilters && (
            <button onClick={clearFilters} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-white transition-colors py-2 px-3 rounded-xl hover:bg-white/5 self-end">
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
                    <span className={cn(
                      "px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider",
                      p.estado === "Usado"
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                        : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                    )}>
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
                    No se encontraron pagos con los filtros actuales.
                  </td>
                </tr>
              )}
              {isLoading && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-muted-foreground">
                    <RefreshCw className="mx-auto animate-spin mb-2 opacity-50" size={24} />
                    Cargando pagos...
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
