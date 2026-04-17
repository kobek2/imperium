"use client";

export function NoPasteTextarea({
  name,
  rows,
  className,
  placeholder,
}: {
  name: string;
  rows: number;
  className: string;
  placeholder?: string;
}) {
  return (
    <textarea
      name={name}
      rows={rows}
      required
      onPaste={(e) => e.preventDefault()}
      placeholder={placeholder}
      className={className}
    />
  );
}