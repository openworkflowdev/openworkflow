import { Card } from "@/components/ui/card";
import { CheckCircle, Clock, Pulse, XCircle } from "@phosphor-icons/react";

export function WorkflowStats() {
  const stats = [
    {
      label: "Total Runs",
      value: "1,247",
      icon: Pulse,
      change: "+12%",
      positive: true,
    },
    {
      label: "Completed",
      value: "1,189",
      icon: CheckCircle,
      change: "+8%",
      positive: true,
    },
    {
      label: "Running",
      value: "23",
      icon: Clock,
      change: "+3",
      positive: false,
    },
    {
      label: "Failed",
      value: "35",
      icon: XCircle,
      change: "-5%",
      positive: true,
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <Card
            key={stat.label}
            className="p-5 bg-card border-border hover:border-primary/50 transition-colors"
          >
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">{stat.label}</p>
                <p className="text-3xl font-semibold font-mono">{stat.value}</p>
              </div>
              <Icon className="size-5 text-muted-foreground" />
            </div>
            <div className="mt-3">
              <span
                className={`text-sm font-medium ${stat.positive ? "text-green-500" : "text-muted-foreground"}`}
              >
                {stat.change}
              </span>
              <span className="text-sm text-muted-foreground ml-2">
                vs last 24h
              </span>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
