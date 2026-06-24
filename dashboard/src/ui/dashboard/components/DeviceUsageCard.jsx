import React from "react";
import { Laptop, Monitor, MonitorSmartphone } from "lucide-react";
import { Card } from "../../components";
import { copy } from "../../../lib/copy";

// Platform → icon. device.platform comes from tokentracker_devices (e.g.
// "darwin", "win32"/"windows", "linux", "web"); fall back to a generic monitor.
function PlatformIcon({ platform, className }) {
  const p = String(platform || "").toLowerCase();
  if (p.includes("darwin") || p.includes("mac")) return <Laptop className={className} aria-hidden />;
  if (p.includes("win")) return <Monitor className={className} aria-hidden />;
  if (p.includes("linux")) return <Monitor className={className} aria-hidden />;
  return <MonitorSmartphone className={className} aria-hidden />;
}

export function DeviceUsageCard({ devices = [], selectedDeviceId = "", onSelectDevice }) {
  const total = devices.reduce((sum, d) => sum + (Number(d.total_tokens) || 0), 0);

  return (
    <Card>
      <div className="text-xs text-oai-gray-500 dark:text-oai-gray-300 uppercase tracking-wider mb-3">
        {copy("dashboard.device_card.title")}
      </div>
      <div className="space-y-3">
        {devices.map((d) => {
          const tokens = Number(d.total_tokens) || 0;
          const percent = total > 0 ? ((tokens / total) * 100).toFixed(1) : "0.0";
          const isSelected = selectedDeviceId === d.id;
          const name = d.device_name || copy("dashboard.device_card.unnamed");
          return (
            <button
              key={d.id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelectDevice?.(isSelected ? "" : d.id)}
              className={`w-full text-left rounded-lg px-2 py-1.5 transition-colors ${
                isSelected
                  ? "bg-oai-gray-100 dark:bg-oai-gray-800"
                  : "hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800/60"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <PlatformIcon platform={d.platform} className="h-3.5 w-3.5 shrink-0 text-oai-gray-500 dark:text-oai-gray-300" />
                <span className="flex-1 min-w-0 truncate text-sm text-oai-black dark:text-oai-white" title={name}>
                  {name}
                </span>
                <span className="shrink-0 text-sm tabular-nums text-oai-black dark:text-oai-white">
                  {percent}%
                </span>
              </div>
              <div className="h-[3px] bg-oai-gray-100 dark:bg-oai-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-oai-brand transition-[width] duration-500 ease-out"
                  style={{ width: `${percent}%`, opacity: 0.55 }}
                />
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
