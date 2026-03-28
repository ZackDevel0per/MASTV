import { useQueryClient } from "@tanstack/react-query";
import {
  useAdminListTenants,
  useAdminGetEstado,
  useAdminCreateTenant,
  useAdminUpdateTenant,
  useAdminSuspendTenant,
  useAdminActivateTenant,
  useAdminRestartBot,
  useAdminGetPairingCode,
  useAdminDeleteSession,
  useAdminSendMessage,
  useAdminGetPagos,
  useAdminGetPagosByTenant,
  useAdminGetCuentas,
  useAdminGetCuentasByTenant,
  useAdminLogin
} from "@workspace/api-client-react";
import { getAdminToken } from "@/lib/utils";

// --- Base Config ---
function useHeaders() {
  const token = getAdminToken();
  return { "x-admin-token": token };
}

function useReqOpts() {
  return { request: { headers: useHeaders() } };
}

// --- Queries ---

export function useTenants() {
  const opts = useReqOpts();
  return useAdminListTenants(opts, {
    query: {
      enabled: !!opts.request.headers["x-admin-token"],
      refetchInterval: 15000, // Refresh every 15s to see bot status changes
    }
  });
}

export function useBotStatus() {
  const opts = useReqOpts();
  return useAdminGetEstado(opts, {
    query: { enabled: !!opts.request.headers["x-admin-token"] }
  });
}

export function usePagos(tenantId?: string) {
  const opts = useReqOpts();
  
  const allPagos = useAdminGetPagos(opts, {
    query: { enabled: !tenantId && !!opts.request.headers["x-admin-token"] }
  });
  
  const tenantPagos = useAdminGetPagosByTenant(tenantId || "", opts, {
    query: { enabled: !!tenantId && !!opts.request.headers["x-admin-token"] }
  });

  return tenantId ? tenantPagos : allPagos;
}

export function useCuentas(tenantId?: string) {
  const opts = useReqOpts();
  
  const allCuentas = useAdminGetCuentas(opts, {
    query: { enabled: !tenantId && !!opts.request.headers["x-admin-token"] }
  });
  
  const tenantCuentas = useAdminGetCuentasByTenant(tenantId || "", opts, {
    query: { enabled: !!tenantId && !!opts.request.headers["x-admin-token"] }
  });

  return tenantId ? tenantCuentas : allCuentas;
}

// --- Mutations ---

export function useLogin() {
  return useAdminLogin();
}

export function useCreateTenant() {
  const queryClient = useQueryClient();
  const opts = useReqOpts();
  return useAdminCreateTenant({ request: opts.request }, {
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/tenants"] })
    }
  });
}

export function useUpdateTenant() {
  const queryClient = useQueryClient();
  const opts = useReqOpts();
  return useAdminUpdateTenant({ request: opts.request }, {
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/tenants"] })
    }
  });
}

export function useSuspendTenant() {
  const queryClient = useQueryClient();
  const opts = useReqOpts();
  return useAdminSuspendTenant({ request: opts.request }, {
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/tenants"] })
    }
  });
}

export function useActivateTenant() {
  const queryClient = useQueryClient();
  const opts = useReqOpts();
  return useAdminActivateTenant({ request: opts.request }, {
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/tenants"] })
    }
  });
}

export function useRestartBot() {
  const queryClient = useQueryClient();
  const opts = useReqOpts();
  return useAdminRestartBot({ request: opts.request }, {
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/tenants"] })
    }
  });
}

export function useDeleteSession() {
  const queryClient = useQueryClient();
  const opts = useReqOpts();
  return useAdminDeleteSession({ request: opts.request }, {
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/tenants"] })
    }
  });
}

export function useGetPairingCode() {
  const opts = useReqOpts();
  return useAdminGetPairingCode({ request: opts.request });
}

export function useSendMessage() {
  const opts = useReqOpts();
  return useAdminSendMessage({ request: opts.request });
}
