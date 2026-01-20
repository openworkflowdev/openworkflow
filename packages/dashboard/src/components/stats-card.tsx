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
  type: "total" | "completed" | "running" | "failed";
}

export function StatsCard({ title, value, type }: StatsCardProps) {
  const icons = {
    total: PulseIcon,
    completed: CheckCircleIcon,
    running: CircleIcon,
    failed: XCircleIcon,
  };

  const Icon = icons[type];

  return (
    <Card className="bg-card border-border p-6">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-muted-foreground text-sm">{title}</span>
        <Icon className="text-muted-foreground h-5 w-5" />
      </div>
      <div className="text-3xl font-bold">{value.toLocaleString()}</div>
    </Card>
  );
}
