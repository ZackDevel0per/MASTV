import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Zap, Loader2 } from "lucide-react";
import { useLogin } from "@/hooks/use-api";
import { setAdminToken } from "@/lib/utils";

export function Login() {
  const [, setLocation] = useLocation();
  const loginMutation = useLogin();
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    const formData = new FormData(e.currentTarget);
    const usuario = formData.get("usuario") as string;
    const password = formData.get("password") as string;

    try {
      const res = await loginMutation.mutateAsync({ data: { usuario, password } });
      if (res.ok && res.token) {
        setAdminToken(res.token);
        setLocation("/");
      } else {
        setError(res.mensaje || "Error de autenticación");
      }
    } catch (err: any) {
      setError("Usuario o contraseña incorrectos");
    }
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center overflow-hidden">
      {/* Background Image & Overlay */}
      <div className="absolute inset-0 z-0">
        <img 
          src={`${import.meta.env.BASE_URL}images/auth-bg.png`}
          alt="Abstract dark background" 
          className="w-full h-full object-cover opacity-60"
        />
        <div className="absolute inset-0 bg-background/80 backdrop-blur-[2px]" />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-panel w-full max-w-md p-8 rounded-3xl relative z-10 mx-4"
      >
        <div className="flex justify-center mb-8">
          <div className="bg-primary/20 p-4 rounded-2xl text-primary ring-1 ring-primary/30">
            <Zap size={32} />
          </div>
        </div>
        
        <div className="text-center mb-8">
          <h1 className="text-3xl font-display font-bold text-white">SaaS Admin</h1>
          <p className="text-muted-foreground mt-2">Inicia sesión para gestionar tenants</p>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm font-medium text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">Usuario</label>
            <input 
              name="usuario"
              type="text" 
              required
              className="w-full px-4 py-3 rounded-xl bg-black/20 border border-white/10 text-white placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
              placeholder="admin"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">Contraseña</label>
            <input 
              name="password"
              type="password" 
              required
              className="w-full px-4 py-3 rounded-xl bg-black/20 border border-white/10 text-white placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
              placeholder="••••••••"
            />
          </div>

          <button 
            disabled={loginMutation.isPending}
            className="w-full mt-4 flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-semibold bg-primary text-primary-foreground shadow-lg shadow-primary/25 hover:shadow-primary/40 hover:-translate-y-0.5 transition-all disabled:opacity-70 disabled:cursor-not-allowed disabled:transform-none"
          >
            {loginMutation.isPending ? <Loader2 className="animate-spin" size={20} /> : "Acceder al Panel"}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
