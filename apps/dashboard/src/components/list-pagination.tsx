import { CursorPaginationControls } from "./cursor-pagination-controls";
import { Button } from "./ui/button";
import {
  RUNS_PAGE_SIZE_OPTIONS,
  resolveRunsPageSize,
  shouldShowPaginationControls,
  type RunsPaginationSearch,
} from "@/lib/runs-page-pagination";
import type { PaginatedResponse } from "openworkflow/internal";

interface ListPaginationProps {
  pagination: PaginatedResponse<unknown>["pagination"];
  search: RunsPaginationSearch;
  itemCount: number;
  itemName: string;
  onChange: (search: RunsPaginationSearch) => void;
}

export function ListPagination({
  pagination,
  search,
  itemCount,
  itemName,
  onChange,
}: ListPaginationProps) {
  if (itemCount === 0 && (search.after ?? search.before)) {
    return (
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            onChange({ limit: search.limit });
          }}
        >
          Back to first page
        </Button>
      </div>
    );
  }
  if (!shouldShowPaginationControls(pagination)) return null;
  return (
    <CursorPaginationControls
      hasNextPage={!!pagination.next}
      hasPreviousPage={!!pagination.prev}
      itemCount={itemCount}
      itemName={itemName}
      pageSize={resolveRunsPageSize(search.limit)}
      pageSizeOptions={RUNS_PAGE_SIZE_OPTIONS}
      onNextPage={() => {
        onChange({ limit: search.limit, after: pagination.next ?? undefined });
      }}
      onPreviousPage={() => {
        onChange({ limit: search.limit, before: pagination.prev ?? undefined });
      }}
      onPageSizeChange={(limit) => {
        onChange({ limit });
      }}
    />
  );
}
