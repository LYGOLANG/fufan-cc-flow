import type { ElementType } from "react";

export default function SettingsSectionTitle({
  icon: Icon,
  label,
  color = "text-slate-400",
}: {
  icon: ElementType;
  label: string;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon size={14} className={color} />
      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{label}</span>
    </div>
  );
}
