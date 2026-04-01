import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { format, differenceInDays } from "date-fns";
import { es } from "date-fns/locale";
import { motion } from "framer-motion";
import {
  ArrowLeft, Building, Wifi, WifiOff, RefreshCw, Trash2, QrCode,
  MessageSquare, Power, PlayCircle, StopCircle, Edit2, Save,
  MailCheck, ExternalLink, Activity, CreditCard, Users, TrendingUp,
  AlertTriangle, CheckCircle2, Clock, KeyRound, Database, Bell, X,
  Shield, ShieldOff,
} from "lucide-react";
import {
  useTenant, useTenantStats, useBotLogs, useRestartBot, useDeleteSession,
  useGetPairingCode, useSendMessage, useSuspendTenant, useActivateTenant,
  useDeleteTenant, useRawUpdateTenant,
} from "@/hooks/use-api";
import { Modal } from "@/components/modal";
import { cn, formatCurrency, getAdminToken } from "@/lib/utils";

const TIPO_ICON: Record<string, string> = {
  pago: "💰", cuenta: "📋", error: "❌", mensaje: "💬",
  conexion: "📶", info: "ℹ️", gmail: "📧", crm: "🔧",
};

const TIPO_COLOR: Record<string, string> = {
  pago: "text-emerald-400", cuenta: "text-blue-400", error: "text-rose-400",
  mensaje: "text-purple-400", conexion: "text-amber-400",
  info: "text-muted-foreground", gmail: "text-orange-400", crm: "text-cyan-400",
};

export function TenantDetalle() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();

  const { data, isLoading, refetch } = useTenant(id!);
  const { data: statsData } = useTenantStats(id!);
  const { data: logsData, refetch: refetchLogs } = useBotLogs(id!);

  const restartMut = useRestartBot();
  const deleteSessionMut = useDeleteSession();
  const suspendMut = useSuspendTenant();
  const activateMut = useActivateTenant();
  const deleteMut = useDeleteTenant();
  const updateMut = useRawUpdateTenant();
  const pairMut = useGetPairingCode();
  const sendMsgMut = useSendMessage();

  const [modal, setModal] = useState<"edit" | "pair" | "msg" | "delete" | null>(null);
  const [pairCode, setPairCode] = useState("");
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [gmailLoading, setGmailLoading] = useState(false);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Activity className="animate-pulse text-primary" size={48} />
      </div>
    );
  }

  const tenant = data?.tenant;
  if (!tenant) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        Tenant no encontrado.{" "}
        <button onClick={() => setLocation("/")} className="text-primary underline">Volver</button>
      </div>
    );
  }

  const stats = statsData?.stats;
  const eventos = logsData?.eventos || [];
  const bot = tenant.bot ?? { conectado: false, estado: "no_iniciado" };
  const isConnected = bot.conectado;
  const daysToExpiry = tenant.suscripcionVence
    ? differenceInDays(new Date(tenant.suscripcionVence), new Date())
    : null;
  const isExpiringSoon = daysToExpiry !== null && daysToExpiry <= 7 && daysToExpiry >= 0;
  const isExpired = daysToExpiry !== null && daysToExpiry < 0;

  const handleAction = async (action: "restart" | "deleteSession" | "suspend" | "activate") => {
    try {
      if (action === "restart") await restartMut.mutateAsync({ id: id! });
      if (action === "deleteSession") await deleteSessionMut.mutateAsync({ id: id! });
      if (action === "suspend") await suspendMut.mutateAsync({ id: id! });
      if (action === "activate") await activateMut.mutateAsync({ id: id! });
      refetch();
      showToast("Operación realizada correctamente");
    } catch {
      showToast("Error en la operación", false);
    }
  };

  const handleGmailAuth = async () => {
    setGmailLoading(true);
    try {
      const apiBase = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
      const token = getAdminToken();
      const res = await fetch(`${apiBase}/api/admin/tenants/${id}/gmail/autorizar`, {
        headers: { "x-admin-token": token },
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.mensaje || "Error");
      window.open(json.urlAutorizacion, "_blank", "width=600,height=700");
    } catch (e: any) {
      showToast(e.message || "Error obteniendo URL de Gmail", false);
    } finally {
      setGmailLoading(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-12">
      {/* Toast */}
      {toast && (
        <div className={cn(
          "fixed top-6 right-6 z-50 px-5 py-3 rounded-xl font-medium shadow-xl flex items-center gap-2 text-white",
          toast.ok ? "bg-emerald-600" : "bg-rose-600"
        )}>
          {toast.ok ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => setLocation("/")} className="p-2 rounded-xl hover:bg-white/10 text-muted-foreground hover:text-white transition-colors">
          <ArrowLeft size={22} />
        </button>
        <div className="flex-1">
          <h1 className="text-3xl font-display font-bold text-white flex items-center gap-3">
            <Building className="text-primary" size={28} />
            {tenant.nombreEmpresa}
          </h1>
          <div className="flex items-center gap-3 mt-1">
            <code className="text-xs text-primary bg-primary/10 px-2 py-0.5 rounded">{tenant.id}</code>
            {tenant.activo ? (
              <span className="text-xs text-emerald-400 font-medium">● Activo</span>
            ) : (
              <span className="text-xs text-rose-400 font-medium">● Suspendido</span>
            )}
            {isExpired && <span className="text-xs text-rose-400 font-bold bg-rose-500/10 px-2 py-0.5 rounded-full">Suscripción vencida</span>}
            {isExpiringSoon && !isExpired && <span className="text-xs text-amber-400 font-bold bg-amber-500/10 px-2 py-0.5 rounded-full">Vence en {daysToExpiry}d</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()} className="btn-secondary py-2 px-3 text-sm">
            <RefreshCw size={16} /> Actualizar
          </button>
          <button onClick={() => setModal("edit")} className="btn-primary py-2 px-3 text-sm">
            <Edit2 size={16} /> Editar
          </button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="Pagos este mes" value={stats?.pagosMes ?? "—"} icon={CreditCard} color="text-emerald-400" sub={stats ? `${formatCurrency(stats.ingresosMes)} ingresos` : ""} />
        <StatCard title="Pagos totales" value={stats?.pagosTotales ?? "—"} icon={TrendingUp} color="text-primary" />
        <StatCard title="Cuentas activas" value={stats?.cuentasActivas ?? "—"} icon={Users} color="text-blue-400" sub={stats ? `de ${stats.cuentasTotal} totales` : ""} />
        <StatCard title="Último pago" value={stats?.ultimoPago?.nombre ?? "—"} icon={CheckCircle2} color="text-amber-400" sub={stats?.ultimoPago ? `Bs ${stats.ultimoPago.monto}` : ""} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Bot Status + Actions */}
        <div className="glass-panel rounded-2xl p-6 space-y-5">
          <h2 className="font-display font-bold text-white text-lg flex items-center gap-2">
            <Activity className="text-primary" size={20} /> Estado del Bot
          </h2>

          <div className="flex items-center gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/10">
            <div className={cn(
              "w-3 h-3 rounded-full shadow-lg flex-shrink-0",
              isConnected ? "bg-emerald-500 shadow-emerald-500/50" :
              bot.estado === "desconectado" ? "bg-rose-500 shadow-rose-500/50" :
              "bg-amber-500 shadow-amber-500/50 animate-pulse"
            )} />
            <div>
              <div className="font-bold text-white capitalize">{bot.estado.replace("_", " ")}</div>
              <div className="text-xs text-muted-foreground">{isConnected ? "WhatsApp conectado" : "Sin conexión activa"}</div>
            </div>
          </div>

          <div className="space-y-2">
            <BotActionBtn icon={RefreshCw} label="Reiniciar Bot" onClick={() => handleAction("restart")} loading={restartMut.isPending} />
            <BotActionBtn icon={QrCode} label="Vincular WhatsApp" onClick={() => setModal("pair")} />
            <BotActionBtn icon={Trash2} label="Borrar Sesión" onClick={() => handleAction("deleteSession")} loading={deleteSessionMut.isPending} danger />
            <BotActionBtn icon={MessageSquare} label="Enviar Mensaje" onClick={() => setModal("msg")} />
          </div>

          <div className="pt-2 border-t border-white/10">
            {tenant.activo ? (
              <BotActionBtn icon={StopCircle} label="Suspender Tenant" onClick={() => handleAction("suspend")} loading={suspendMut.isPending} danger />
            ) : (
              <BotActionBtn icon={PlayCircle} label="Activar Tenant" onClick={() => handleAction("activate")} loading={activateMut.isPending} success />
            )}
          </div>

          <div className="pt-2 border-t border-white/10">
            <button
              onClick={() => setModal("delete")}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-rose-400 border border-rose-500/30 hover:bg-rose-500/10 transition-colors"
            >
              <Trash2 size={15} /> Eliminar Tenant
            </button>
          </div>
        </div>

        {/* Integrations + Subscription */}
        <div className="space-y-4">
          {/* Subscription */}
          <div className={cn(
            "glass-panel rounded-2xl p-6",
            isExpired ? "border border-rose-500/30" : isExpiringSoon ? "border border-amber-500/30" : ""
          )}>
            <h2 className="font-display font-bold text-white text-lg flex items-center gap-2 mb-4">
              <Shield className="text-primary" size={20} /> Suscripción
            </h2>
            {tenant.suscripcionVence ? (
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground text-sm">Vence el</span>
                  <span className={cn("font-bold", isExpired ? "text-rose-400" : isExpiringSoon ? "text-amber-400" : "text-white")}>
                    {format(new Date(tenant.suscripcionVence), "dd/MM/yyyy", { locale: es })}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground text-sm">Estado</span>
                  {isExpired ? (
                    <span className="text-rose-400 font-bold text-sm flex items-center gap-1"><ShieldOff size={14} /> Vencida</span>
                  ) : isExpiringSoon ? (
                    <span className="text-amber-400 font-bold text-sm flex items-center gap-1"><AlertTriangle size={14} /> {daysToExpiry}d restantes</span>
                  ) : (
                    <span className="text-emerald-400 font-bold text-sm flex items-center gap-1"><CheckCircle2 size={14} /> {daysToExpiry}d restantes</span>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">Sin fecha de vencimiento</p>
            )}
          </div>

          {/* Integrations */}
          <div className="glass-panel rounded-2xl p-6">
            <h2 className="font-display font-bold text-white text-lg flex items-center gap-2 mb-4">
              <Database className="text-primary" size={20} /> Integraciones
            </h2>
            <div className="space-y-3">
              <IntegrationRow label="Google Sheets" active={!!tenant.spreadsheetId} icon="📊" />
              <IntegrationRow label="CRM Mastv" active={!!tenant.crmUsername} icon="🖥️" sub={tenant.crmUsername ? `@${tenant.crmUsername}` : undefined} />
              {/* GMAIL DESACTIVADO — integración legacy, no se usa en el flujo actual.
              <IntegrationRow label="Gmail OAuth2" active={!!tenant.gmailRefreshToken} icon="📧"
                action={
                  <button
                    onClick={handleGmailAuth}
                    disabled={!tenant.gmailClientId || gmailLoading}
                    title={!tenant.gmailClientId ? "Guarda primero el Gmail Client ID y Secret" : "Autorizar Gmail"}
                    className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed font-semibold"
                  >
                    {gmailLoading ? <RefreshCw size={12} className="animate-spin" /> : <ExternalLink size={12} />}
                    {tenant.gmailRefreshToken ? "Re-autorizar" : "Autorizar"}
                  </button>
                }
              />
              */}
              <IntegrationRow label="VeriPagos QR" active={!!tenant.veripagosUsername} icon="💳" sub={tenant.veripagosUsername ?? undefined} />
              <IntegrationRow label="Pushover" active={!!tenant.pushoverUserKey} icon="🔔" />
            </div>
          </div>
        </div>

        {/* Event Log */}
        <div className="glass-panel rounded-2xl p-6 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-bold text-white text-lg flex items-center gap-2">
              <Clock className="text-primary" size={20} /> Eventos del Bot
            </h2>
            <button onClick={() => refetchLogs()} className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition-colors">
              <RefreshCw size={14} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 max-h-64 pr-1">
            {eventos.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <Activity className="mx-auto mb-2 opacity-30" size={24} />
                Sin eventos registrados aún.
              </div>
            ) : (
              eventos.map((ev, i) => (
                <div key={i} className="flex items-start gap-2 text-xs p-2.5 rounded-lg bg-white/[0.03] border border-white/5">
                  <span className="flex-shrink-0 text-base leading-none mt-0.5">{TIPO_ICON[ev.tipo] ?? "•"}</span>
                  <div className="flex-1 min-w-0">
                    <p className={cn("font-medium truncate", TIPO_COLOR[ev.tipo] ?? "text-white")}>{ev.texto}</p>
                    <p className="text-muted-foreground/60 mt-0.5">
                      {format(new Date(ev.ts), "dd/MM HH:mm:ss")}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      <PairingModal isOpen={modal === "pair"} onClose={() => { setModal(null); setPairCode(""); }} tenant={tenant} pairCode={pairCode} setPairCode={setPairCode} pairMut={pairMut} />
      <MessageModal isOpen={modal === "msg"} onClose={() => setModal(null)} tenant={tenant} sendMut={sendMsgMut} showToast={showToast} />
      <EditModal isOpen={modal === "edit"} onClose={() => { setModal(null); refetch(); }} tenant={tenant} updateMut={updateMut} showToast={showToast} />
      <DeleteModal isOpen={modal === "delete"} onClose={() => setModal(null)} tenant={tenant} deleteMut={deleteMut} onDeleted={() => setLocation("/")} />
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function StatCard({ title, value, icon: Icon, color = "text-white", sub }: any) {
  return (
    <div className="glass-panel p-5 rounded-2xl flex items-center justify-between relative overflow-hidden group">
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      <div>
        <p className="text-muted-foreground text-xs font-medium mb-1">{title}</p>
        <p className={cn("text-2xl font-display font-bold", color)}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
      <div className="bg-white/5 p-3 rounded-xl">
        <Icon size={22} className="text-muted-foreground" />
      </div>
    </div>
  );
}

function BotActionBtn({ icon: Icon, label, onClick, loading, danger, success }: any) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all text-left",
        danger ? "text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20" :
        success ? "text-emerald-400 hover:bg-emerald-500/10 border border-transparent hover:border-emerald-500/20" :
        "text-muted-foreground hover:bg-white/5 hover:text-white border border-transparent hover:border-white/10"
      )}
    >
      {loading ? <RefreshCw size={16} className="animate-spin" /> : <Icon size={16} />}
      {label}
    </button>
  );
}

function IntegrationRow({ label, active, icon, sub, action }: any) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0">
      <span className="text-lg">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white">{label}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
      {action ?? (
        <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full", active ? "text-emerald-400 bg-emerald-500/10" : "text-rose-400 bg-rose-500/10")}>
          {active ? "✓ Config." : "✗ Sin config"}
        </span>
      )}
    </div>
  );
}

function PairingModal({ isOpen, onClose, tenant, pairCode, setPairCode, pairMut }: any) {
  const handleSubmit = async (e: any) => {
    e.preventDefault();
    const tel = new FormData(e.currentTarget).get("telefono") as string;
    const res = await pairMut.mutateAsync({ id: tenant.id, data: { telefono: tel } });
    if (res.codigo) setPairCode(res.codigo);
  };
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Vincular WhatsApp: ${tenant?.nombre}`}>
      {!pairCode ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-muted-foreground text-sm">Ingresa el número de WhatsApp que actuará como bot.</p>
          <input name="telefono" required placeholder="591..." className="input-base" />
          <button disabled={pairMut.isPending} className="btn-primary w-full">Obtener Código</button>
        </form>
      ) : (
        <div className="text-center py-6 space-y-4">
          <p className="text-muted-foreground">Código de vinculación:</p>
          <div className="text-4xl tracking-[0.2em] font-mono font-bold text-primary bg-primary/10 py-4 rounded-xl border border-primary/20">{pairCode}</div>
          <p className="text-xs text-muted-foreground">WhatsApp → Dispositivos vinculados → Vincular con número → ingresa este código.</p>
        </div>
      )}
    </Modal>
  );
}

function MessageModal({ isOpen, onClose, tenant, sendMut, showToast }: any) {
  const handleSubmit = async (e: any) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    await sendMut.mutateAsync({ id: tenant.id, data: data as any });
    showToast("Mensaje enviado correctamente");
    onClose();
  };
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Enviar Mensaje — ${tenant?.nombre}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div><label className="label-base">Teléfono Destino</label><input name="telefono" required placeholder="591..." className="input-base" /></div>
        <div><label className="label-base">Mensaje</label><textarea name="mensaje" required rows={4} className="input-base resize-none"></textarea></div>
        <div className="flex justify-end pt-2">
          <button disabled={sendMut.isPending} className="btn-primary">Enviar</button>
        </div>
      </form>
    </Modal>
  );
}

function EditModal({ isOpen, onClose, tenant, updateMut, showToast }: any) {
  if (!tenant) return null;

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data: Record<string, unknown> = Object.fromEntries(fd);
    if (!data.suscripcionVence) delete data.suscripcionVence;
    if (!data.crmPassword) delete data.crmPassword;
    if (!data.veripagosPassword) delete data.veripagosPassword;
    try {
      await updateMut.mutateAsync({ id: tenant.id, data });
      showToast("Tenant actualizado y bot reiniciado");
      onClose();
    } catch (e: any) {
      showToast(e.message || "Error al guardar", false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Editar Configuración">
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Identidad */}
        <Section title="Identidad" icon={Building}>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label-base">Nombre Corto</label><input name="nombre" defaultValue={tenant.nombre} className="input-base" /></div>
            <div><label className="label-base">Nombre Empresa</label><input name="nombreEmpresa" defaultValue={tenant.nombreEmpresa} className="input-base" /></div>
            <div className="col-span-2"><label className="label-base">Admin WhatsApp</label><input name="adminWhatsapp" defaultValue={tenant.adminWhatsapp} className="input-base" /></div>
            <div className="col-span-2">
              <label className="label-base">Suscripción Vence</label>
              <input type="date" name="suscripcionVence"
                defaultValue={tenant.suscripcionVence ? new Date(tenant.suscripcionVence).toISOString().split("T")[0] : ""}
                className="input-base max-w-xs" />
            </div>
          </div>
        </Section>

        {/* CRM */}
        <Section title="CRM Mastv" icon={Database}>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label-base">Username</label><input name="crmUsername" defaultValue={tenant.crmUsername} className="input-base" /></div>
            <div><label className="label-base">Password</label><input name="crmPassword" type="password" placeholder="Vacío = no cambiar" className="input-base" /></div>
            <div><label className="label-base">Prefijo</label><input name="crmUsernamePrefix" defaultValue={tenant.crmUsernamePrefix} className="input-base" /></div>
          </div>
        </Section>

        {/* Google */}
        <Section title="Google" icon={KeyRound}>
          <div className="space-y-3">
            <div><label className="label-base">Spreadsheet ID</label><input name="spreadsheetId" defaultValue={tenant.spreadsheetId} className="input-base" /></div>
            <div><label className="label-base">Service Account JSON</label><textarea name="googleServiceAccountJson" defaultValue={tenant.googleServiceAccountJson} rows={3} className="input-base font-mono text-xs"></textarea></div>
          </div>
        </Section>

        {/* VeriPagos */}
        <Section title="VeriPagos — Pagos QR" icon={QrCode}>
          <p className="text-xs text-muted-foreground mb-3">
            Con credenciales configuradas, el bot generará un QR único por pago y lo verificará automáticamente. Sin credenciales, usará el flujo manual.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label-base">Usuario (email)</label><input name="veripagosUsername" defaultValue={tenant.veripagosUsername} className="input-base" placeholder="correo@ejemplo.com" /></div>
            <div><label className="label-base">Contraseña</label><input type="password" name="veripagosPassword" placeholder="Vacío = no cambiar" className="input-base" /></div>
          </div>
        </Section>

        {/* Notificaciones */}
        <Section title="Notificaciones" icon={Bell}>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label-base">Pushover User Key</label><input name="pushoverUserKey" defaultValue={tenant.pushoverUserKey} className="input-base" /></div>
            <div><label className="label-base">Pushover API Token</label><input name="pushoverApiToken" defaultValue={tenant.pushoverApiToken} className="input-base" /></div>
          </div>
        </Section>

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
          <button type="submit" disabled={updateMut.isPending} className="btn-primary">
            <Save size={16} /> {updateMut.isPending ? "Guardando..." : "Guardar Cambios"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteModal({ isOpen, onClose, tenant, deleteMut, onDeleted }: any) {
  const [confirm, setConfirm] = useState("");

  const handleDelete = async () => {
    if (confirm !== tenant.id) return;
    try {
      await deleteMut.mutateAsync(tenant.id);
      onDeleted();
    } catch {
      // silent
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={() => { onClose(); setConfirm(""); }} title="Eliminar Tenant">
      <div className="space-y-5">
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm space-y-1">
          <p className="font-bold flex items-center gap-2"><AlertTriangle size={16} /> Esta acción es irreversible.</p>
          <p>Se eliminará el tenant <strong>{tenant?.nombreEmpresa}</strong>, todos sus pagos, cuentas e historial de la base de datos. El bot se detendrá inmediatamente.</p>
        </div>
        <div>
          <label className="label-base">Escribe el ID del tenant para confirmar: <code className="text-rose-400">{tenant?.id}</code></label>
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={tenant?.id}
            className="input-base border-rose-500/30 focus:border-rose-500"
          />
        </div>
        <div className="flex justify-end gap-3">
          <button onClick={() => { onClose(); setConfirm(""); }} className="btn-secondary">Cancelar</button>
          <button
            onClick={handleDelete}
            disabled={confirm !== tenant?.id || deleteMut.isPending}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold bg-rose-600 text-white shadow-lg shadow-rose-600/25 hover:shadow-rose-600/40 hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-y-0 disabled:shadow-none"
          >
            <Trash2 size={16} /> {deleteMut.isPending ? "Eliminando..." : "Eliminar definitivamente"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Section({ title, icon: Icon, children }: any) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-bold text-primary uppercase tracking-wider flex items-center gap-2">
        <Icon size={14} /> {title}
      </h3>
      {children}
    </div>
  );
}
