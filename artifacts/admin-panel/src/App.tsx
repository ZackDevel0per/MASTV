import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Login } from "@/pages/login";
import { Dashboard } from "@/pages/dashboard";
import { Pagos } from "@/pages/pagos";
import { Cuentas } from "@/pages/cuentas";
import { NuevoTenant } from "@/pages/nuevo-tenant";
import { TenantDetalle } from "@/pages/tenant-detalle";
import NotFound from "@/pages/not-found";
import { getAdminToken } from "@/lib/utils";
import { useEffect } from "react";

const queryClient = new QueryClient();

function GlobalStyles() {
  return (
    <style dangerouslySetInnerHTML={{__html: `
      .label-base {
        @apply block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2;
      }
      .input-base {
        @apply w-full px-4 py-3 rounded-xl bg-black/40 border border-white/10 text-white placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all;
      }
      .btn-primary {
        @apply flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-semibold bg-primary text-primary-foreground shadow-lg shadow-primary/25 hover:shadow-primary/40 hover:-translate-y-0.5 active:translate-y-0 active:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed;
      }
      .btn-secondary {
        @apply flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-semibold bg-white/5 text-white border border-white/10 hover:bg-white/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed;
      }
    `}} />
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const token = getAdminToken();

  useEffect(() => {
    if (!token && location !== "/login") {
      setLocation("/login");
    }
  }, [token, location, setLocation]);

  if (!token) return null;

  return <Layout>{children}</Layout>;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      
      <Route path="/">
        <RequireAuth><Dashboard /></RequireAuth>
      </Route>
      <Route path="/pagos">
        <RequireAuth><Pagos /></RequireAuth>
      </Route>
      <Route path="/cuentas">
        <RequireAuth><Cuentas /></RequireAuth>
      </Route>
      <Route path="/nuevo">
        <RequireAuth><NuevoTenant /></RequireAuth>
      </Route>
      <Route path="/tenant/:id">
        {(params) => <RequireAuth><TenantDetalle /></RequireAuth>}
      </Route>
      
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <GlobalStyles />
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <Router />
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
