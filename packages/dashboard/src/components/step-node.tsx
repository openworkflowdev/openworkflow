import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { computeDuration, formatRelativeTime } from "@/utils";
import {
  CaretDown,
  CheckCircle,
  CircleNotch,
  XCircle,
} from "@phosphor-icons/react";
import { Handle, Position } from "@xyflow/react";
import type { StepAttempt, StepAttemptStatus } from "openworkflow/internal";

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
    step: StepAttempt;
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
        className="!bg-border !h-3 !w-3"
      />

      <Card
        className={`bg-card cursor-pointer border-2 transition-all hover:shadow-lg ${config.bgColor}`}
        onClick={onToggle}
      >
        <div className="min-w-[240px] p-4">
          <div className="mb-3 flex items-start gap-3">
            <StatusIcon
              className={`size-5 flex-shrink-0 ${config.color} ${
                step.status === "running" ? "animate-spin" : ""
              }`}
            />
            <div className="min-w-0 flex-1">
              <h4 className="mb-1 text-sm font-semibold break-words">
                {step.stepName}
              </h4>
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className="border-border text-xs capitalize"
                >
                  {step.status}
                </Badge>
                {step.kind === "sleep" && (
                  <Badge variant="outline" className="border-border text-xs">
                    sleep
                  </Badge>
                )}
              </div>
            </div>
            <CaretDown
              className={`text-muted-foreground size-4 flex-shrink-0 transition-transform ${
                isExpanded ? "rotate-180" : ""
              }`}
            />
          </div>

          <div className="text-muted-foreground space-y-1 text-xs">
            <div>Started {startedAt}</div>
            <div>Duration: {duration}</div>
          </div>

          {isExpanded && (
            <div className="bg-muted/50 mt-3 max-w-[240px] rounded p-2">
              <p className="text-muted-foreground mb-1 text-xs font-medium">
                {step.error ? "Error" : "Output"}
              </p>
              <pre className="max-h-[200px] overflow-x-auto overflow-y-auto font-mono text-xs">
                {JSON.stringify(step.error || step.output, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </Card>

      <Handle
        type="source"
        position={Position.Right}
        className="!bg-border !h-3 !w-3"
      />
    </>
  );
}
