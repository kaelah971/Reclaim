"use client";

import { type ChangeEvent, useState, useRef } from "react";

interface FileSelectionFieldProps {
  label?: string;
  helper?: string;
  accept?: string;
  onChange?: (file: File | null) => void;
  className?: string;
}

export default function FileSelectionField({
  label = "Select a file",
  helper = "Choose a file from your device.",
  accept,
  onChange,
  className = "",
}: FileSelectionFieldProps) {
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] || null;
    setFile(selected);
    onChange?.(selected);
  };

  const handleRemove = () => {
    setFile(null);
    onChange?.(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className={className}>
      <label className="text-[15px] font-medium text-ink">{label}</label>

      {!file ? (
        <div className="mt-2">
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            onChange={handleChange}
            className="block w-full text-[15px] text-muted file:mr-4 file:rounded-[--radius-button] file:border-0 file:bg-input file:px-4 file:py-2 file:text-[14px] file:font-medium file:text-ink hover:file:bg-border/50 cursor-pointer"
          />
          {helper && (
            <p className="mt-2 text-[13px] text-muted">{helper}</p>
          )}
        </div>
      ) : (
        <div className="mt-2 rounded-[--radius-card] border border-border bg-input p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[15px] font-medium text-ink">{file.name}</p>
              <p className="mt-0.5 text-[13px] text-muted">
                {file.type || "Unknown type"} &middot; {formatSize(file.size)}
              </p>
            </div>
            <button
              type="button"
              onClick={handleRemove}
              className="shrink-0 text-muted hover:text-ink transition-colors"
              aria-label="Remove file"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M1 1L17 17M17 1L1 17"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
