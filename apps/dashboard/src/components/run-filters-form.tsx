import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RUN_FILTER_STATUSES,
  type RunFilters,
  type RunFilterStatus,
} from "@/lib/run-filters";
import { getRunStatusConfig } from "@/lib/status";
import { useState } from "react";

interface RunFiltersFormProps {
  filters: RunFilters;
  onChange: (filters: RunFilters) => void;
}

export function RunFiltersForm({ filters, onChange }: RunFiltersFormProps) {
  const [status, setStatus] = useState(filters.status);
  const [workflowName, setWorkflowName] = useState(filters.workflowName ?? "");

  return (
    <form
      aria-label="Filter workflow runs"
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onChange({ status, workflowName: workflowName.trim() || undefined });
      }}
    >
      <Field className="w-full sm:w-44">
        <FieldLabel htmlFor="run-filter-status">Status</FieldLabel>
        <Select<RunFilterStatus | "all">
          value={status ?? "all"}
          onValueChange={(value) => {
            setStatus(value === "all" || value === null ? undefined : value);
          }}
        >
          <SelectTrigger id="run-filter-status" className="w-full">
            <SelectValue>
              {status ? getRunStatusConfig(status).label : "All statuses"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {RUN_FILTER_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {getRunStatusConfig(value).label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field className="w-full sm:w-64">
        <FieldLabel htmlFor="run-filter-workflow">Workflow name</FieldLabel>
        <Input
          id="run-filter-workflow"
          name="workflowName"
          placeholder="Exact workflow name"
          value={workflowName}
          onChange={(event) => {
            setWorkflowName(event.currentTarget.value);
          }}
        />
      </Field>
      <Button type="submit">Apply filters</Button>
      <Button
        type="button"
        variant="ghost"
        onClick={() => {
          setStatus(undefined);
          setWorkflowName("");
          onChange({});
        }}
      >
        Clear filters
      </Button>
    </form>
  );
}
