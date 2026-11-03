export function downloadBlob(data: BlobPart, filename: string, type: string): void {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFilename(name: string): string {
  return (name.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '') || 'rca-analysis').slice(0, 80);
}
