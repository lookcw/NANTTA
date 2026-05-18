import { useState } from "react";

interface UrlPreviewProps {
  fullUrl: string;
}

export function UrlPreview({ fullUrl }: UrlPreviewProps) {
  const [label, setLabel] = useState("Copy link");
  const [disabled, setDisabled] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setLabel("Copied");
      setDisabled(true);
      window.setTimeout(() => {
        setLabel("Copy link");
        setDisabled(false);
      }, 1200);
    } catch {
      // Fallback: select the text so the user can ctrl-C.
      const node = document.getElementById("url-out");
      if (!node) return;
      const range = document.createRange();
      range.selectNode(node);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }

  return (
    <div className="url-preview">
      <code id="url-out">{fullUrl}</code>
      <button id="copy-btn" type="button" disabled={disabled} onClick={copy}>
        {label}
      </button>
    </div>
  );
}
