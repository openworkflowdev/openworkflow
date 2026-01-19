import { Card } from "./ui/card";
import {
  CheckCircleIcon,
  CircleIcon,
  PulseIcon,
  XCircleIcon,
} from "@phosphor-icons/react";

interface StatsCardProps {
  title: string;
  value: number;
  trend: string;
  type: "total" | "completed" | "running" | "failed";
}

export function StatsCard({ title, value, trend, type }: StatsCardProps) {
  const icons = {
    total: PulseIcon,
    completed: CheckCircleIcon,
    running: CircleIcon,
    failed: XCircleIcon,
  };

  const Icon = icons[type];
  const isPositive = trend.startsWith("+");
  const isNegative = trend.startsWith("-");

  return (
    <Card className="bg-card border-border p-6">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-muted-foreground text-sm">{title}</span>
        <Icon className="text-muted-foreground h-5 w-5" />
      </div>
      <div className="mb-2 text-3xl font-bold">{value.toLocaleString()}</div>
      <div className="flex items-center text-sm">
        <span
          className={
            isPositive && type !== "failed"
              ? "text-green-500"
              : isNegative && type === "failed"
                ? "text-green-500"
                : "text-muted-foreground"
          }
        >
          {trend}
        </span>
        <span className="text-muted-foreground ml-2">vs last 24h</span>
      </div>
    </Card>
  );
}
