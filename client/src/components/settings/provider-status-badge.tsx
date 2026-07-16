import { CheckCircle2 } from "lucide-react";
import type { ProviderInfo } from "../../types/provider";

export interface ProviderStatusView {
  label: string;
  tone: "ready" | "configured" | "warning" | "error" | "neutral";
}

export default function ProviderStatusBadge({ provider, status }: { provider: ProviderInfo; status?: ProviderStatusView }) {
  if (status) {
    const classes = {
      ready: "border-emerald-ok/20 bg-emerald-ok/5 text-emerald-ok",
      configured: "border-sky-link/20 bg-sky-link/5 text-sky-link",
      warning: "border-amber-glow/20 bg-amber-glow/5 text-amber-glow",
      error: "border-rose-err/20 bg-rose-err/5 text-rose-err",
      neutral: "border-white/10 bg-white/5 text-slate-500",
    }[status.tone];
    return (
      <span className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border flex-shrink-0 ${classes}`}>
        {status.tone === "ready" && <CheckCircle2 size={10} />}{status.label}
      </span>
    );
  }
  if (provider.authManagedByCli) {
    return <span className="text-[10px] px-1.5 py-0.5 rounded border border-sky-link/20 bg-sky-link/5 text-sky-link">CLI 管理</span>;
  }
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
      provider.configured
        ? "border-sky-link/20 bg-sky-link/5 text-sky-link"
        : "border-white/10 bg-white/5 text-slate-500"
    }`}>
      {provider.configured ? "已配置" : "未配置"}
    </span>
  );
}
