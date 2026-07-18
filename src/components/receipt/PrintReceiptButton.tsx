"use client";

import { useState } from "react";
import Button from "../ui/Button";
import Dialog from "../ui/Dialog";

interface PrintReceiptButtonProps {
  className?: string;
}

export default function PrintReceiptButton({
  className = "",
}: PrintReceiptButtonProps) {
  const [shareOpen, setShareOpen] = useState(false);

  return (
    <div className={`flex flex-wrap gap-3 ${className}`}>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => window.print()}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M4 6V2H12V6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <rect
            x="3"
            y="6"
            width="10"
            height="7"
            rx="1"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M5 10H11"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        Print receipt
      </Button>
      <Button variant="secondary" size="sm" onClick={() => setShareOpen(true)}>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M8 1V10M8 1L5 4M8 1L11 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M2 11V13.5C2 14.33 2.67 15 3.5 15H12.5C13.33 15 14 14.33 14 13.5V11"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        Share receipt
      </Button>

      <Dialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        title="Share receipt"
        primaryLabel="Got it"
        onPrimary={() => setShareOpen(false)}
      >
        <p>Receipt sharing will be enabled when real receipt records are connected.</p>
      </Dialog>
    </div>
  );
}
