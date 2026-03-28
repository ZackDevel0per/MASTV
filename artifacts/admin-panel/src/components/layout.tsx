import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { 
  LayoutDashboard, 
  CreditCard, 
  Users, 
  PlusCircle, 
  LogOut, 
  Zap 
} from "lucide-react";
import { clearAdminToken } from "@/lib/utils";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/pagos", label: "Pagos", icon: CreditCard },
  { href: "/cuentas", label: "Cuentas", icon: Users },
  { href: "/nuevo", label: "Nuevo Tenant", icon: PlusCircle },
];

export function Layout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();

  const handleLogout = () => {
    clearAdminToken();
    setLocation("/login");
  };

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Sidebar */}
      <motion.aside 
        initial={{ x: -280 }}
        animate={{ x: 0 }}
        className="w-64 fixed inset-y-0 left-0 z-50 glass-panel border-y-0 border-l-0 rounded-none flex flex-col"
      >
        <div className="p-6 flex items-center gap-3">
          <div className="bg-primary/20 p-2 rounded-xl text-primary ring-1 ring-primary/30">
            <Zap size={24} />
          </div>
          <div>
            <h1 className="font-display font-bold text-xl text-white">ZK Panel</h1>
            <p className="text-xs text-muted-foreground uppercase tracking-widest">Superadmin</p>
          </div>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-2">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href} className="block">
                <div className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 font-medium",
                  isActive 
                    ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25" 
                    : "text-muted-foreground hover:bg-white/5 hover:text-white"
                )}>
                  <item.icon size={20} className={isActive ? "text-white" : "opacity-70"} />
                  {item.label}
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/5">
          <button 
            onClick={handleLogout}
            className="flex items-center gap-3 px-4 py-3 w-full rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors font-medium"
          >
            <LogOut size={20} />
            Cerrar Sesión
          </button>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 ml-64 p-8 relative">
        {/* Subtle background glow */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-primary/10 rounded-full blur-[120px] pointer-events-none" />
        
        <div className="relative z-10 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
