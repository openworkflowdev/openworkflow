import { useTheme } from "@/components/providers/theme-provider";
import { cn } from "@/lib/utils";
import MonacoEditor from "@monaco-editor/react";
import { useMemo } from "react";

const LINE_HEIGHT = 18;

interface MonacoJsonEditorProps {
  id?: string;
  value: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  minLines?: number;
  maxLines?: number;
  invalid?: boolean;
  className?: string;
}

function lineCount(value: string): number {
  if (value.length === 0) {
    return 1;
  }

  return value.split(/\r\n|\r|\n/).length;
}

export function MonacoJsonEditor({
  id,
  value,
  readOnly = true,
  onChange,
  minLines = 6,
  maxLines = 22,
  invalid = false,
  className,
}: MonacoJsonEditorProps) {
  const { theme } = useTheme();

  const editorHeight = useMemo(() => {
    const lines = Math.min(Math.max(lineCount(value) + 1, minLines), maxLines);
    return (lines * LINE_HEIGHT).toString() + "px";
  }, [maxLines, minLines, value]);

  return (
    <div
      id={id}
      aria-invalid={invalid || undefined}
      className={cn(
        "border-border bg-background overflow-hidden rounded-none border",
        invalid && "border-destructive",
        className,
      )}
      style={{ height: editorHeight }}
    >
      <MonacoEditor
        defaultLanguage="json"
        height={editorHeight}
        value={value}
        theme={theme === "dark" ? "vs-dark" : "vs"}
        onChange={(nextValue) => {
          if (readOnly || !onChange) {
            return;
          }

          onChange(nextValue ?? "");
        }}
        options={{
          automaticLayout: true,
          domReadOnly: readOnly,
          folding: true,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 12,
          glyphMargin: false,
          lineDecorationsWidth: 8,
          lineHeight: LINE_HEIGHT,
          minimap: { enabled: false },
          padding: { top: 8, bottom: 8 },
          readOnly,
          renderLineHighlight: "none",
          scrollBeyondLastLine: false,
          stickyScroll: { enabled: false },
          tabSize: 2,
          wordWrap: "on",
        }}
      />
    </div>
  );
}
