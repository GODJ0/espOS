import { Loader2 } from "lucide-react";
import { cn } from "../../lib/utils";

export function Panel({
  title,
  kicker,
  actions,
  children,
  className,
}: {
  title: string;
  kicker?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rise flex min-h-0 flex-col border border-border bg-card", className)}>
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="flex items-baseline gap-3">
          {kicker && <span className="font-mono text-[10px] text-primary">{kicker}</span>}
          <h2 className="font-display text-xs font-semibold uppercase tracking-[0.18em]">{title}</h2>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

type Tone = "primary" | "ghost" | "danger" | "warning";

export function ActionButton({
  tone = "ghost",
  loading,
  disabled,
  icon,
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; loading?: boolean; icon?: React.ReactNode }) {
  const tones: Record<Tone, string> = {
    primary: "bg-primary text-primary-foreground hover:bg-primary/85 border-primary",
    ghost: "bg-transparent text-foreground hover:bg-secondary border-border",
    danger: "bg-transparent text-destructive hover:bg-destructive/10 border-destructive/50",
    warning: "bg-warning/10 text-warning hover:bg-warning/20 border-warning/60",
  };
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        "inline-flex h-8 items-center gap-2 border px-3 font-display text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        tones[tone],
        className,
      )}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function ProgressBar({ value, tone = "primary" }: { value: number; tone?: "primary" | "success" }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="h-1.5 w-full bg-secondary">
      <div
        className={cn("h-full transition-[width] duration-200", tone === "success" ? "bg-success" : "bg-primary")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function Notice({ tone, children }: { tone: "info" | "warning" | "error" | "success"; children: React.ReactNode }) {
  const tones = {
    info: "border-primary/40 text-primary bg-primary/5",
    warning: "border-warning/50 text-warning bg-warning/5",
    error: "border-destructive/50 text-destructive bg-destructive/5",
    success: "border-success/50 text-success bg-success/5",
  };
  return <div className={cn("border px-3 py-2 text-xs leading-relaxed", tones[tone])}>{children}</div>;
}

export function NeedsDevice() {
  return (
    <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="font-display text-xs uppercase tracking-[0.18em] text-muted-foreground">Устройство не подключено</p>
      <p className="max-w-xs text-xs text-muted-foreground">Нажми «Подключить» в верхней панели и выбери порт платы.</p>
    </div>
  );
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
