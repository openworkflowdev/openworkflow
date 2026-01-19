import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { SerializedStepAttempt } from "@/lib/api";
import { computeDuration, formatRelativeTime } from "@/types";
import {
  CaretDown,
  CheckCircle,
  CircleNotch,
  XCircle,
} from "@phosphor-icons/react";
import { Handle, Position } from "@xyflow/react";

type StepAttemptStatus = SerializedStepAttempt["status"];

const statusConfig: Record<
  StepAttemptStatus,
  { icon: typeof CheckCircle; color: string; bgColor: string }
> = {
  completed: {
    icon: CheckCircle,
    color: "text-green-500",
    bgColor: "border-green-500/20 bg-green-500/10",
  },
  succeeded: {
    icon: CheckCircle,
    color: "text-green-500",
    bgColor: "border-green-500/20 bg-green-500/10",
  },
  running: {
    icon: CircleNotch,
    color: "text-blue-500",
    bgColor: "border-blue-500/20 bg-blue-500/10",
  },
  failed: {
    icon: XCircle,
    color: "text-red-500",
    bgColor: "border-red-500/20 bg-red-500/10",
  },
};

export function StepNode({
  data,
}: {
  data: {
    step: SerializedStepAttempt;
    onToggle: () => void;
    isExpanded: boolean;
  };
}) {
  const { step, onToggle, isExpanded } = data;

  const config = statusConfig[step.status];
  const StatusIcon = config.icon;

  const duration = computeDuration(step.startedAt, step.finishedAt);
  const startedAt = formatRelativeTime(step.startedAt);

  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-border !w-3 !h-3"
      />

      <Card
        className={`bg-card border-2 transition-all cursor-pointer hover:shadow-lg ${config.bgColor}`}
        onClick={onToggle}
      >
        <div className="p-4 min-w-[240px]">
          <div className="flex items-start gap-3 mb-3">
            <StatusIcon
              className={`size-5 flex-shrink-0 ${config.color} ${
                step.status === "running" ? "animate-spin" : ""
              }`}
            />
            <div className="flex-1 min-w-0">
              <h4 className="font-semibold text-sm mb-1 break-words">
                {step.stepName}
              </h4>
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className="text-xs capitalize border-border"
                >
                  {step.status}
                </Badge>
                {step.kind === "sleep" && (
                  <Badge variant="outline" className="text-xs border-border">
                    sleep
                  </Badge>
                )}
              </div>
            </div>
            <CaretDown
              className={`size-4 text-muted-foreground transition-transform flex-shrink-0 ${
                isExpanded ? "rotate-180" : ""
              }`}
            />
          </div>

          <div className="space-y-1 text-xs text-muted-foreground">
            <div>Started {startedAt}</div>
            <div>Duration: {duration}</div>
          </div>

          {isExpanded && (
            <div className="mt-3 bg-muted/50 rounded p-2 max-w-[240px]">
              <p className="text-xs font-medium text-muted-foreground mb-1">
                {step.error ? "Error" : "Output"}
              </p>
              <pre className="text-xs font-mono overflow-x-auto max-h-[200px] overflow-y-auto">
                {JSON.stringify(step.error || step.output, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </Card>

      <Handle
        type="source"
        position={Position.Right}
        className="!bg-border !w-3 !h-3"
      />
    </>
  );
}
