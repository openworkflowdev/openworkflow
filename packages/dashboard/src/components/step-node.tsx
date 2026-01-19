import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { StepAttempt } from "@/types";
import {
  CaretDown,
  CheckCircle,
  CircleNotch,
  Clock,
  XCircle,
} from "@phosphor-icons/react";
import { Handle, Position } from "@xyflow/react";

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

  const StatusIcon =
    step.status === "completed"
      ? CheckCircle
      : step.status === "running"
        ? CircleNotch
        : step.status === "failed"
          ? XCircle
          : Clock;

  const statusColor =
    step.status === "completed"
      ? "text-green-500 border-green-500/20 bg-green-500/10"
      : step.status === "running"
        ? "text-blue-500 border-blue-500/20 bg-blue-500/10"
        : step.status === "failed"
          ? "text-red-500 border-red-500/20 bg-red-500/10"
          : "text-yellow-500 border-yellow-500/20 bg-yellow-500/10";

  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-border !w-3 !h-3"
      />

      <Card
        className={`bg-card border-2 transition-all cursor-pointer hover:shadow-lg ${statusColor}`}
        onClick={onToggle}
      >
        <div className="p-4 min-w-[240px]">
          <div className="flex items-start gap-3 mb-3">
            <StatusIcon
              className={`size-5 flex-shrink-0 ${
                step.status === "completed"
                  ? "text-green-500"
                  : step.status === "running"
                    ? "text-blue-500 animate-spin"
                    : step.status === "failed"
                      ? "text-red-500"
                      : "text-yellow-500"
              }`}
            />
            <div className="flex-1 min-w-0">
              <h4 className="font-semibold text-sm mb-1 break-words">
                {step.name}
              </h4>
              <Badge
                variant="outline"
                className="text-xs capitalize border-border"
              >
                {step.status}
              </Badge>
            </div>
            <CaretDown
              className={`size-4 text-muted-foreground transition-transform flex-shrink-0 ${
                isExpanded ? "rotate-180" : ""
              }`}
            />
          </div>

          <div className="space-y-1 text-xs text-muted-foreground">
            <div>Started {step.startedAt}</div>
            {step.duration && <div>Duration: {step.duration}</div>}
          </div>

          {isExpanded && (
            <div className="mt-3 bg-muted/50 rounded p-2 max-w-[240px]">
              <p className="text-xs font-medium text-muted-foreground mb-1">
                {step.error ? "Error" : "Result"}
              </p>
              <pre className="text-xs font-mono overflow-x-auto max-h-[200px] overflow-y-auto">
                {JSON.stringify(step.error || step.result, null, 2)}
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
