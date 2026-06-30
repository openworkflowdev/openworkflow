import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface CursorPaginationControlsProps {
  className?: string;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  itemCount: number;
  itemName: string;
  onNextPage: () => void;
  onPageSizeChange: (pageSize: number) => void;
  onPreviousPage: () => void;
  pageSize: number;
  pageSizeOptions: readonly number[];
}

export function CursorPaginationControls({
  className,
  hasNextPage,
  hasPreviousPage,
  itemCount,
  itemName,
  onNextPage,
  onPageSizeChange,
  onPreviousPage,
  pageSize,
  pageSizeOptions,
}: CursorPaginationControlsProps) {
  function handlePageSizeChange(value: string) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) {
      onPageSizeChange(parsed);
    }
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3",
        className,
      )}
    >
      <p className="text-muted-foreground text-xs">
        Showing {itemCount} {itemName}
        {itemCount === 1 ? "" : "s"}
      </p>
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
        <div className="flex items-center gap-2 sm:mr-1">
          <p className="text-muted-foreground text-xs">Page size</p>
          <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
            <SelectTrigger className="h-8 w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="flex-1 sm:flex-none"
          type="button"
          onClick={onPreviousPage}
          disabled={!hasPreviousPage}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1 sm:flex-none"
          type="button"
          onClick={onNextPage}
          disabled={!hasNextPage}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
