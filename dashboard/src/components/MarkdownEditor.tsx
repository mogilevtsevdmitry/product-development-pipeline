"use client";

import {
  useState,
  useRef,
  useCallback,
  type ChangeEvent,
  type DragEvent,
  type ClipboardEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minRows?: number;
}

export default function MarkdownEditor({
  value,
  onChange,
  placeholder = "Описание поддерживает **Markdown**. Перетащите или вставьте изображение.",
  minRows = 6,
}: MarkdownEditorProps) {
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [dragOver, setDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ---- Image handling ----

  const insertImageAtCursor = useCallback(
    (markdown: string) => {
      const ta = textareaRef.current;
      if (!ta) {
        onChange(value + markdown);
        return;
      }
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const before = value.slice(0, start);
      const after = value.slice(end);
      const newValue = before + markdown + after;
      onChange(newValue);

      // Restore cursor after inserted text
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + markdown.length;
        ta.focus();
      });
    },
    [value, onChange]
  );

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;
        const dataUrl = await fileToBase64(file);
        const alt = file.name.replace(/\.[^.]+$/, "");
        insertImageAtCursor(`\n![${alt}](${dataUrl})\n`);
      }
    },
    [insertImageAtCursor]
  );

  // ---- Event handlers ----

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles]
  );

  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles: File[] = [];
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        handleFiles(imageFiles);
      }
    },
    [handleFiles]
  );

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const onFileInput = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        handleFiles(e.target.files);
        e.target.value = "";
      }
    },
    [handleFiles]
  );

  // ---- Toolbar actions ----

  const wrap = (before: string, after: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const sel = value.slice(start, end) || "текст";
    const newValue =
      value.slice(0, start) + before + sel + after + value.slice(end);
    onChange(newValue);
    requestAnimationFrame(() => {
      ta.selectionStart = start + before.length;
      ta.selectionEnd = start + before.length + sel.length;
      ta.focus();
    });
  };

  const insertPrefix = (prefix: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    // Find line start
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const newValue =
      value.slice(0, lineStart) + prefix + value.slice(lineStart);
    onChange(newValue);
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + prefix.length;
      ta.focus();
    });
  };

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 overflow-hidden">
      {/* Tab bar + toolbar */}
      <div className="flex items-center justify-between border-b border-gray-700 px-1">
        <div className="flex">
          <button
            type="button"
            onClick={() => setTab("write")}
            className={`px-3 py-2 text-xs font-medium transition-colors ${
              tab === "write"
                ? "text-white border-b-2 border-blue-500"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            Редактор
          </button>
          <button
            type="button"
            onClick={() => setTab("preview")}
            className={`px-3 py-2 text-xs font-medium transition-colors ${
              tab === "preview"
                ? "text-white border-b-2 border-blue-500"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            Превью
          </button>
        </div>

        {tab === "write" && (
          <div className="flex items-center gap-0.5 pr-1">
            <button
              type="button"
              onClick={() => wrap("**", "**")}
              className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-700 rounded text-xs font-bold"
              title="Жирный (Ctrl+B)"
            >
              B
            </button>
            <button
              type="button"
              onClick={() => wrap("*", "*")}
              className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-700 rounded text-xs italic"
              title="Курсив (Ctrl+I)"
            >
              I
            </button>
            <button
              type="button"
              onClick={() => insertPrefix("## ")}
              className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-700 rounded text-xs"
              title="Заголовок"
            >
              H
            </button>
            <button
              type="button"
              onClick={() => insertPrefix("- ")}
              className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-700 rounded text-xs"
              title="Список"
            >
              •
            </button>
            <button
              type="button"
              onClick={() => wrap("`", "`")}
              className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-700 rounded text-xs font-mono"
              title="Код"
            >
              {"<>"}
            </button>
            <span className="w-px h-4 bg-gray-700 mx-1" />
            <label
              className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-700 rounded text-xs cursor-pointer"
              title="Вставить изображение"
            >
              🖼
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={onFileInput}
              />
            </label>
          </div>
        )}
      </div>

      {/* Content area */}
      {tab === "write" ? (
        <div
          className={`relative ${dragOver ? "ring-2 ring-blue-500 ring-inset" : ""}`}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onPaste={onPaste}
            placeholder={placeholder}
            rows={minRows}
            className="w-full px-3 py-3 bg-transparent text-white text-sm placeholder-gray-500 focus:outline-none resize-y min-h-[120px]"
            style={{ minHeight: `${minRows * 1.5 + 1.5}rem` }}
          />
          {dragOver && (
            <div className="absolute inset-0 bg-blue-500/10 flex items-center justify-center pointer-events-none">
              <span className="text-blue-400 text-sm font-medium">
                Отпустите для вставки изображения
              </span>
            </div>
          )}
        </div>
      ) : (
        <div
          className="px-3 py-3 prose prose-invert prose-sm max-w-none min-h-[120px] overflow-auto"
          style={{ minHeight: `${minRows * 1.5 + 1.5}rem` }}
        >
          {value ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                img: ({ src, alt, ...props }) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={src}
                    alt={alt || ""}
                    className="max-w-full h-auto rounded-lg border border-gray-700"
                    style={{ maxHeight: "300px" }}
                    {...props}
                  />
                ),
              }}
            >
              {value}
            </ReactMarkdown>
          ) : (
            <p className="text-gray-500 italic">Нет содержимого для превью</p>
          )}
        </div>
      )}

      {/* Footer hint */}
      <div className="px-3 py-1.5 border-t border-gray-700 flex items-center gap-2">
        <span className="text-[10px] text-gray-600">
          Markdown · Drag & drop или Ctrl+V для изображений · Resize ↘
        </span>
      </div>
    </div>
  );
}
