import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAdminToken } from "@/lib/utils";

// --- Helpers ---
function apiBase(): string {
  return import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
}

async function apiFetch<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const token = getAdminToken();
  const res = await fetch(`${apiBase()}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-admin-token": token,
      ...(options?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any)?.mensaje || `HTTP ${res.status}`);
  }
  return res.json();
}

// --- Query Hooks ---

export function useTenants() {
  return useQuery({
    queryKey: ["/api/admin/tenants"],
    queryFn: () => apiFetch<{ ok: boolean; tenants: any[] }>("/api/admin/tenants"),
    enabled: !!getAdminToken(),
    refetchInterval: 15000,
  });
}

export function useTenant(id: string) {
  return useQuery({
    queryKey: ["/api/admin/tenants", id],
    queryFn: () => apiFetch<{ ok: boolean; tenant: any }>(`/api/admin/tenants/${id}`),
    enabled: !!id && !!getAdminToken(),
    refetchInterval: 10000,
  });
}

export function useTenantStats(id: string) {
  return useQuery({
    queryKey: ["/api/admin/tenants", id, "stats"],
    queryFn: () => apiFetch<{ ok: boolean; stats: any }>(`/api/admin/tenants/${id}/stats`),
    enabled: !!id && !!getAdminToken(),
    refetchInterval: 30000,
  });
}

export function useBotLogs(id: string) {
  return useQuery({
    queryKey: ["/api/admin/tenants", id, "logs"],
    queryFn: () => apiFetch<{ ok: boolean; eventos: any[] }>(`/api/admin/tenants/${id}/logs`),
    enabled: !!id && !!getAdminToken(),
    refetchInterval: 8000,
  });
}

export function useBotStatus() {
  return useQuery({
    queryKey: ["/api/admin/estado"],
    queryFn: () => apiFetch<{ ok: boolean }>("/api/admin/estado"),
    enabled: !!getAdminToken(),
  });
}

export function usePagos(tenantId?: string, params?: { desde?: string; hasta?: string; estado?: string }) {
  const buildQs = () => {
    const qs = new URLSearchParams();
    if (params?.desde) qs.set("desde", params.desde);
    if (params?.hasta) qs.set("hasta", params.hasta);
    if (params?.estado) qs.set("estado", params.estado);
    return qs.toString() ? `?${qs.toString()}` : "";
  };

  return useQuery({
    queryKey: ["/api/admin/pagos", tenantId, params],
    queryFn: () => {
      const base = tenantId ? `/api/admin/pagos/${tenantId}` : "/api/admin/pagos";
      return apiFetch<{ ok: boolean; pagos: any[] }>(`${base}${buildQs()}`);
    },
    enabled: !!getAdminToken(),
    refetchInterval: 30000,
  });
}

export function useCuentas(tenantId?: string, params?: { estado?: string }) {
  const buildQs = () => {
    const qs = new URLSearchParams();
    if (params?.estado) qs.set("estado", params.estado);
    return qs.toString() ? `?${qs.toString()}` : "";
  };

  return useQuery({
    queryKey: ["/api/admin/cuentas", tenantId, params],
    queryFn: () => {
      const base = tenantId ? `/api/admin/cuentas/${tenantId}` : "/api/admin/cuentas";
      return apiFetch<{ ok: boolean; cuentas: any[] }>(`${base}${buildQs()}`);
    },
    enabled: !!getAdminToken(),
    refetchInterval: 30000,
  });
}

// --- Mutation Hooks ---

export function useLogin() {
  return useMutation({
    mutationFn: (data: { usuario: string; password: string }) =>
      apiFetch<{ ok: boolean; token: string; mensaje?: string }>("/api/admin/login", {
        method: "POST",
        body: JSON.stringify(data),
      }),
  });
}

export function useCreateTenant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiFetch("/api/admin/tenants", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/tenants"] }),
  });
}

export function useUpdateTenant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      apiFetch(`/api/admin/tenants/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/tenants"] }),
  });
}

export function useRawUpdateTenant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      apiFetch(`/api/admin/tenants/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/tenants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/tenants", vars.id] });
    },
  });
}

export function useSuspendTenant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiFetch(`/api/admin/tenants/${id}/suspender`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/tenants"] }),
  });
}

export function useActivateTenant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiFetch(`/api/admin/tenants/${id}/activar`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/tenants"] }),
  });
}

export function useRestartBot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiFetch(`/api/admin/tenants/${id}/bot/reiniciar`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/tenants"] }),
  });
}

export function useDeleteSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiFetch(`/api/admin/tenants/${id}/bot/sesion/borrar`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/tenants"] }),
  });
}

export function useGetPairingCode() {
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { telefono: string } }) =>
      apiFetch<{ ok: boolean; codigo?: string }>(`/api/admin/tenants/${id}/bot/codigo-pareo`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
  });
}

export function useSendMessage() {
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { telefono: string; mensaje: string } }) =>
      apiFetch(`/api/admin/tenants/${id}/mensaje`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
  });
}

export function useDeleteTenant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/admin/tenants/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/tenants"] }),
  });
}
