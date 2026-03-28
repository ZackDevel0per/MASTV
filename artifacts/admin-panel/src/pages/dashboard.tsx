import { useState } from "react";
import { useLocation } from "wouter";
import { differenceInDays } from "date-fns";
import { format } from "date-fns";
import { 
  useTenants, 
  useSuspendTenant, 
  useActivateTenant, 
  useRestartBot, 
  useDeleteSession, 
  useGetPairingCode,
  useSendMessage,
  useUpdateTenant
} from "@/hooks/use-api";
import { Modal } from "@/components/modal";
import { 
  Edit2, RefreshCw, MessageSquare, 
  QrCode, Trash2, Activity, PlayCircle, StopCircle, CheckCircle2, ShieldAlert,
  ExternalLink, AlertTriangle, ArrowRight, Wifi, WifiOff, Monitor
} from "lucide-react";
import { cn } from "@/lib/utils";

type Tenant = any;

export function Dashboard() {
  const { data, isLoading, refetch } = useTenants();
  const [, setLocation] = useLocation();
  
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [modalType, setModalType] = useState<"edit" | "msg" | "pair" | null>(null);
  const [view, setView] = useState<"tenants" | "monitor">("tenants");

  const suspendMut = useSuspendTenant();
  const activateMut = useActivateTenant();
  const restartMut = useRestartBot();
  const deleteSessionMut = useDeleteSession();

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center"><Activity className="animate-pulse text-primary" size={48} /></div>;
  }

  const tenants = data?.tenants || [];
  const stats = {
    total: tenants.length,
    activos: tenants.filter((t: any) => t.activo).length,
    conectados: tenants.filter((t: any) => t.bot.conectado).length,
  };

  const expiringSoon = tenants.filter((t: any) => {
    if (!t.suscripcionVence) return false;
    const days = differenceInDays(new Date(t.suscripcionVence), new Date());
    return days >= 0 && days <= 7;
  });
  const expired = tenants.filter((t: any) => {
    if (!t.suscripcionVence) return false;
    return differenceInDays(new Date(t.suscripcionVence), new Date()) < 0;
  });

  const handleAction = async (action: "suspend" | "activate" | "restart" | "delete", id: string) => {
    if (!confirm(`¿Seguro que deseas ${action} este tenant?`)) return;
    try {
      if (action === "suspend") await suspendMut.mutateAsync({ id });
      if (action === "activate") await activateMut.mutateAsync({ id });
      if (action === "restart") await restartMut.mutateAsync({ id });
      if (action === "delete") await deleteSessionMut.mutateAsync({ id });
      refetch();
    } catch {
      alert("Error en la operación");
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-white">Tenants</h1>
          <p className="text-muted-foreground mt-1">Gestión general y estado de bots en tiempo real</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()} className="btn-secondary py-2 px-3 text-sm">
            <RefreshCw size={16} /> Actualizar
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard title="Tenants Totales" value={stats.total} icon={Activity} />
        <StatCard title="Bots Activos" value={stats.activos} icon={CheckCircle2} color="text-emerald-400" />
        <StatCard title="Conectados (WhatsApp)" value={stats.conectados} icon={MessageSquare} color="text-primary" />
      </div>

      {/* Subscription Alerts */}
      {(expiringSoon.length > 0 || expired.length > 0) && (
        <div className="space-y-3">
          {expired.map((t: any) => (
            <AlertBanner key={t.id} type="error" tenant={t} onClick={() => setLocation(`/tenant/${t.id}`)} />
          ))}
          {expiringSoon.map((t: any) => (
            <AlertBanner key={t.id} type="warning" tenant={t} onClick={() => setLocation(`/tenant/${t.id}`)} />
          ))}
        </div>
      )}

      {/* View Toggle */}
      <div className="flex items-center gap-2 glass-panel p-1 rounded-xl w-fit">
        <button onClick={() => setView("tenants")}
          className={cn("flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all",
            view === "tenants" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-white")}>
          <ShieldAlert size={16} /> Tenants
        </button>
        <button onClick={() => setView("monitor")}
          className={cn("flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all",
            view === "monitor" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-white")}>
          <Monitor size={16} /> Monitor Bots
        </button>
      </div>

      {/* Tenants Table */}
      {view === "tenants" && (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-white/5 border-b border-white/10 text-muted-foreground">
                <tr>
                  <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs">ID / Empresa</th>
                  <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs">Admin WA</th>
                  <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs">Integraciones</th>
                  <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs">Estado Bot</th>
                  <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs">Suscripción</th>
                  <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {tenants.map((t: any) => {
                  const daysLeft = t.suscripcionVence
                    ? differenceInDays(new Date(t.suscripcionVence), new Date())
                    : null;
                  const isExpired = daysLeft !== null && daysLeft < 0;
                  const isExpiringSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 7;
                  return (
                    <tr key={t.id} className="hover:bg-white/[0.02] transition-colors group">
                      <td className="px-6 py-4">
                        <div className="font-bold text-white">{t.nombreEmpresa}</div>
                        <code className="text-xs text-primary bg-primary/10 px-2 py-0.5 rounded mt-1 inline-block">{t.id}</code>
                      </td>
                      <td className="px-6 py-4 text-muted-foreground font-mono">{t.adminWhatsapp}</td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-2">
                          {t.tieneSheets && <Badge>Sheets</Badge>}
                          {t.tieneCRM && <Badge>CRM</Badge>}
                          {t.tieneGmail && <Badge>Gmail</Badge>}
                          {!t.tieneSheets && !t.tieneCRM && <span className="text-muted-foreground/50 text-xs">Sin config</span>}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className={cn(
                            "w-2.5 h-2.5 rounded-full shadow-lg",
                            t.bot.conectado ? "bg-emerald-500 shadow-emerald-500/50" :
                            t.bot.estado === "desconectado" ? "bg-rose-500 shadow-rose-500/50" :
                            "bg-amber-500 shadow-amber-500/50 animate-pulse"
                          )} />
                          <span className="capitalize font-medium text-muted-foreground">
                            {t.bot.estado.replace("_", " ")}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {t.activo ? (
                          <span className="text-emerald-400 font-medium">Activo</span>
                        ) : (
                          <span className="text-rose-400 font-medium">Suspendido</span>
                        )}
                        <div className={cn("text-xs mt-1", isExpired ? "text-rose-400 font-semibold" : isExpiringSoon ? "text-amber-400 font-semibold" : "text-muted-foreground")}>
                          {t.suscripcionVence
                            ? isExpired ? `Venció ${format(new Date(t.suscripcionVence), "dd/MM/yy")}`
                              : isExpiringSoon ? `Vence en ${daysLeft}d`
                              : format(new Date(t.suscripcionVence), "dd/MM/yyyy")
                            : "Sin límite"}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <ActionBtn icon={ExternalLink} title="Ver detalle" onClick={() => setLocation(`/tenant/${t.id}`)} className="text-primary hover:bg-primary/10" />
                          <ActionBtn icon={Edit2} title="Editar" onClick={() => { setSelectedTenant(t); setModalType("edit"); }} />
                          <ActionBtn icon={QrCode} title="Parear WA" onClick={() => { setSelectedTenant(t); setModalType("pair"); }} />
                          <ActionBtn icon={MessageSquare} title="Enviar MSJ" onClick={() => { setSelectedTenant(t); setModalType("msg"); }} />
                          <ActionBtn icon={RefreshCw} title="Reiniciar Bot" onClick={() => handleAction("restart", t.id)} />
                          <ActionBtn icon={Trash2} title="Borrar Sesión" onClick={() => handleAction("delete", t.id)} className="hover:text-rose-400" />
                          <div className="w-px h-6 bg-white/10 mx-1" />
                          {t.activo ? (
                            <ActionBtn icon={StopCircle} title="Suspender" onClick={() => handleAction("suspend", t.id)} className="text-rose-400 hover:bg-rose-500/20" />
                          ) : (
                            <ActionBtn icon={PlayCircle} title="Activar" onClick={() => handleAction("activate", t.id)} className="text-emerald-400 hover:bg-emerald-500/20" />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {tenants.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                      <ShieldAlert className="mx-auto mb-3 opacity-50" size={32} />
                      No hay tenants registrados. Crea uno nuevo.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Bot Monitor View */}
      {view === "monitor" && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {tenants.length === 0 && (
            <div className="col-span-3 py-20 text-center text-muted-foreground">
              <Monitor className="mx-auto mb-3 opacity-30" size={40} />
              Sin tenants para monitorear.
            </div>
          )}
          {tenants.map((t: any) => (
            <BotMonitorCard
              key={t.id}
              tenant={t}
              onRestart={() => handleAction("restart", t.id)}
              onPair={() => { setSelectedTenant(t); setModalType("pair"); }}
              onDetail={() => setLocation(`/tenant/${t.id}`)}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      <PairingModal isOpen={modalType === "pair"} onClose={() => setModalType(null)} tenant={selectedTenant} />
      <MessageModal isOpen={modalType === "msg"} onClose={() => setModalType(null)} tenant={selectedTenant} />
      <EditTenantModal 
        isOpen={modalType === "edit"} 
        onClose={() => { setModalType(null); refetch(); }} 
        tenant={selectedTenant} 
      />
    </div>
  );
}

// ── Helper Components ──────────────────────────────────────────────────────

function AlertBanner({ type, tenant, onClick }: { type: "error" | "warning"; tenant: any; onClick: () => void }) {
  const days = differenceInDays(new Date(tenant.suscripcionVence), new Date());
  return (
    <div
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-all hover:brightness-110",
        type === "error"
          ? "bg-rose-500/10 border-rose-500/30 text-rose-300"
          : "bg-amber-500/10 border-amber-500/30 text-amber-300"
      )}
    >
      <AlertTriangle size={18} className="flex-shrink-0" />
      <div className="flex-1 text-sm">
        <span className="font-bold">{tenant.nombreEmpresa}</span>
        {type === "error"
          ? ` — Suscripción vencida (${Math.abs(days)}d de atraso)`
          : ` — Suscripción vence en ${days} día${days !== 1 ? "s" : ""}`}
      </div>
      <ArrowRight size={16} className="flex-shrink-0 opacity-60" />
    </div>
  );
}

function BotMonitorCard({ tenant, onRestart, onPair, onDetail }: any) {
  const bot = tenant.bot ?? { conectado: false, estado: "no_iniciado" };
  const isConnected = bot.conectado;
  const isPending = ["esperando_qr", "esperando_codigo", "iniciando"].includes(bot.estado);

  return (
    <div className={cn(
      "glass-panel rounded-2xl p-5 flex flex-col gap-4 border",
      isConnected ? "border-emerald-500/20" :
      isPending ? "border-amber-500/20" :
      "border-rose-500/20"
    )}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-bold text-white">{tenant.nombreEmpresa}</p>
          <code className="text-xs text-primary">{tenant.id}</code>
        </div>
        <div className={cn(
          "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold",
          isConnected ? "bg-emerald-500/20 text-emerald-400" :
          isPending ? "bg-amber-500/20 text-amber-400" :
          "bg-rose-500/20 text-rose-400"
        )}>
          <div className={cn("w-1.5 h-1.5 rounded-full", isConnected ? "bg-emerald-500" : isPending ? "bg-amber-500 animate-pulse" : "bg-rose-500")} />
          {isConnected ? "Conectado" : isPending ? "Pendiente" : "Desconectado"}
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {isConnected ? <Wifi size={15} className="text-emerald-400" /> : <WifiOff size={15} className="text-rose-400" />}
        <span className="capitalize">{bot.estado.replace("_", " ")}</span>
      </div>

      <div className="grid grid-cols-3 gap-2 pt-1 border-t border-white/5">
        <button onClick={onRestart} className="flex flex-col items-center gap-1 py-2 rounded-xl hover:bg-white/5 text-muted-foreground hover:text-white transition-colors text-xs">
          <RefreshCw size={16} />
          Reiniciar
        </button>
        <button onClick={onPair} className="flex flex-col items-center gap-1 py-2 rounded-xl hover:bg-white/5 text-muted-foreground hover:text-white transition-colors text-xs">
          <QrCode size={16} />
          Vincular
        </button>
        <button onClick={onDetail} className="flex flex-col items-center gap-1 py-2 rounded-xl hover:bg-primary/10 text-primary transition-colors text-xs">
          <ExternalLink size={16} />
          Detalle
        </button>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon: Icon, color = "text-white" }: any) {
  return (
    <div className="glass-panel p-6 rounded-2xl flex items-center justify-between relative overflow-hidden group">
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      <div>
        <p className="text-muted-foreground text-sm font-medium mb-1">{title}</p>
        <p className={cn("text-4xl font-display font-bold", color)}>{value}</p>
      </div>
      <div className="bg-white/5 p-4 rounded-xl">
        <Icon size={28} className="text-muted-foreground" />
      </div>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-white/10 text-white/90 border border-white/10">
      {children}
    </span>
  );
}

function ActionBtn({ icon: Icon, title, onClick, className }: any) {
  return (
    <button 
      onClick={onClick}
      title={title}
      className={cn("p-2 rounded-lg text-muted-foreground hover:text-white hover:bg-white/10 transition-colors", className)}
    >
      <Icon size={16} />
    </button>
  );
}

// ── Specific Modals ────────────────────────────────────────────────────────

function PairingModal({ isOpen, onClose, tenant }: any) {
  const mut = useGetPairingCode();
  const [code, setCode] = useState("");

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    const tel = new FormData(e.currentTarget).get("telefono") as string;
    const res = await mut.mutateAsync({ id: tenant.id, data: { telefono: tel } });
    if (res.codigo) setCode(res.codigo);
  };

  return (
    <Modal isOpen={isOpen} onClose={() => { onClose(); setCode(""); }} title={`Vincular WhatsApp: ${tenant?.nombre}`}>
      {!code ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-muted-foreground text-sm mb-4">Ingresa el número de WhatsApp que actuará como bot (ej. 59160000000).</p>
          <input name="telefono" required placeholder="591..." className="input-base" />
          <button disabled={mut.isPending} className="btn-primary w-full">Obtener Código</button>
        </form>
      ) : (
        <div className="text-center py-6 space-y-4">
          <p className="text-muted-foreground">Código de vinculación generado:</p>
          <div className="text-4xl tracking-[0.2em] font-mono font-bold text-primary bg-primary/10 py-4 rounded-xl border border-primary/20">
            {code}
          </div>
          <p className="text-xs text-muted-foreground mt-4">Ve a WhatsApp &gt; Dispositivos vinculados &gt; Vincular con número, e ingresa este código.</p>
        </div>
      )}
    </Modal>
  );
}

function MessageModal({ isOpen, onClose, tenant }: any) {
  const mut = useSendMessage();

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    await mut.mutateAsync({ id: tenant.id, data: data as any });
    alert("Mensaje enviado");
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Enviar Mensaje - ${tenant?.nombre}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label-base">Teléfono Destino</label>
          <input name="telefono" required placeholder="591..." className="input-base" />
        </div>
        <div>
          <label className="label-base">Mensaje</label>
          <textarea name="mensaje" required rows={4} className="input-base resize-none" placeholder="Hola, este es un mensaje de prueba..."></textarea>
        </div>
        <div className="flex justify-end pt-2">
          <button disabled={mut.isPending} className="btn-primary">Enviar por WA</button>
        </div>
      </form>
    </Modal>
  );
}

function EditTenantModal({ isOpen, onClose, tenant }: any) {
  const mut = useUpdateTenant();

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = Object.fromEntries(fd);
    if (!data.suscripcionVence) delete data.suscripcionVence;
    
    await mut.mutateAsync({ id: tenant.id, data: data as any });
    onClose();
  };

  if (!tenant) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Editar Configuración">
      <form onSubmit={handleSubmit} className="space-y-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="col-span-2 sm:col-span-1 mt-4">
          <label className="label-base">Nombre Corto</label>
          <input name="nombre" defaultValue={tenant.nombre} className="input-base" />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="label-base">Nombre Empresa</label>
          <input name="nombreEmpresa" defaultValue={tenant.nombreEmpresa} className="input-base" />
        </div>
        <div className="col-span-2">
          <label className="label-base">Admin WhatsApp</label>
          <input name="adminWhatsapp" defaultValue={tenant.adminWhatsapp} className="input-base" />
        </div>
        
        <div className="col-span-2 pt-4 border-t border-white/10">
          <h3 className="text-sm font-bold text-primary mb-3 uppercase tracking-wider">CRM Mastv</h3>
        </div>
        <div><label className="label-base">Username</label><input name="crmUsername" defaultValue={tenant.crmUsername} className="input-base" /></div>
        <div><label className="label-base">Password</label><input name="crmPassword" type="password" placeholder="Dejar vacío para no cambiar" className="input-base" /></div>
        <div><label className="label-base">Prefijo</label><input name="crmUsernamePrefix" defaultValue={tenant.crmUsernamePrefix} className="input-base" /></div>
        
        <div className="col-span-2 pt-4 border-t border-white/10">
          <h3 className="text-sm font-bold text-primary mb-3 uppercase tracking-wider">Google</h3>
        </div>
        <div className="col-span-2"><label className="label-base">Spreadsheet ID</label><input name="spreadsheetId" defaultValue={tenant.spreadsheetId} className="input-base" /></div>
        <div className="col-span-2"><label className="label-base">Service Account JSON</label><textarea name="googleServiceAccountJson" defaultValue={tenant.googleServiceAccountJson} rows={3} className="input-base font-mono text-xs"></textarea></div>

        <div className="col-span-2 pt-4 border-t border-white/10 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
          <button type="submit" disabled={mut.isPending} className="btn-primary">Guardar Cambios</button>
        </div>
      </form>
    </Modal>
  );
}
