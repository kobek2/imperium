"use client";

import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import { useEffect, useRef } from "react";

function MenuBar({ editor }: { editor: Editor }) {
  const groups: { label: string; action: () => boolean; active?: () => boolean }[][] = [
    [
      {
        label: "Bold",
        action: () => editor.chain().focus().toggleBold().run(),
        active: () => editor.isActive("bold"),
      },
      {
        label: "Italic",
        action: () => editor.chain().focus().toggleItalic().run(),
        active: () => editor.isActive("italic"),
      },
      {
        label: "Underline",
        action: () => editor.chain().focus().toggleUnderline().run(),
        active: () => editor.isActive("underline"),
      },
    ],
    [
      {
        label: "H2",
        action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
        active: () => editor.isActive("heading", { level: 2 }),
      },
      {
        label: "H3",
        action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
        active: () => editor.isActive("heading", { level: 3 }),
      },
      {
        label: "Body",
        action: () => editor.chain().focus().setParagraph().run(),
        active: () => editor.isActive("paragraph") && !editor.isActive("heading"),
      },
    ],
    [
      {
        label: "• List",
        action: () => editor.chain().focus().toggleBulletList().run(),
        active: () => editor.isActive("bulletList"),
      },
      {
        label: "1. List",
        action: () => editor.chain().focus().toggleOrderedList().run(),
        active: () => editor.isActive("orderedList"),
      },
    ],
    [
      {
        label: "Left",
        action: () => editor.chain().focus().setTextAlign("left").run(),
        active: () => editor.isActive({ textAlign: "left" }),
      },
      {
        label: "Center",
        action: () => editor.chain().focus().setTextAlign("center").run(),
        active: () => editor.isActive({ textAlign: "center" }),
      },
      {
        label: "Right",
        action: () => editor.chain().focus().setTextAlign("right").run(),
        active: () => editor.isActive({ textAlign: "right" }),
      },
    ],
  ];

  return (
    <div className="flex flex-wrap gap-1 rounded-t border border-b-0 border-[var(--psc-border)] bg-[var(--psc-panel)] p-2">
      {groups.map((grp, gi) => (
        <div key={gi} className="flex flex-wrap gap-1 border-[var(--psc-border)] pr-2 sm:border-r sm:pr-2">
          {grp.map((b) => {
            const on = b.active?.() ?? false;
            return (
              <button
                key={b.label}
                type="button"
                onClick={() => b.action()}
                className={`rounded px-2 py-1 text-xs font-semibold uppercase tracking-wide transition ${
                  on
                    ? "bg-[var(--psc-ink)] text-white"
                    : "bg-white text-[var(--psc-ink)] ring-1 ring-[var(--psc-border)] hover:bg-[var(--psc-canvas)]"
                }`}
              >
                {b.label}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Syncs editor HTML into a hidden input before native form submit (server actions). */
export function useBillEditorFormSync(editor: Editor | null, hiddenRef: React.RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    if (!editor || !hiddenRef.current) return;
    const sync = () => {
      if (hiddenRef.current) hiddenRef.current.value = editor.getHTML();
    };
    editor.on("update", sync);
    sync();
    const form = hiddenRef.current.form;
    const onSubmitCapture = () => sync();
    form?.addEventListener("submit", onSubmitCapture, true);
    return () => {
      editor.off("update", sync);
      form?.removeEventListener("submit", onSubmitCapture, true);
    };
  }, [editor, hiddenRef]);
}

export function BillRichTextEditorWithHiddenInput({
  fieldName,
  initialHtml,
}: {
  fieldName: string;
  initialHtml?: string | null;
}) {
  const hiddenRef = useRef<HTMLInputElement>(null);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
      }),
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: initialHtml?.trim() ? initialHtml : "<p></p>",
    immediatelyRender: false,
  });

  useEffect(() => {
    if (!editor || initialHtml == null || !initialHtml.trim()) return;
    editor.commands.setContent(initialHtml);
  }, [editor, initialHtml]);

  useBillEditorFormSync(editor, hiddenRef);

  if (!editor) {
    return (
      <>
        <input ref={hiddenRef} type="hidden" name={fieldName} value="" />
        <div className="min-h-[22rem] rounded border border-[var(--psc-border)] bg-white" />
      </>
    );
  }

  return (
    <>
      <input ref={hiddenRef} type="hidden" name={fieldName} defaultValue="" />
      <div className="space-y-0">
        <MenuBar editor={editor} />
        <EditorContent
          editor={editor}
          className="min-h-[22rem] rounded-b border border-[var(--psc-border)] bg-white px-3 py-3 text-sm text-[var(--psc-ink)] [&_.ProseMirror]:min-h-[18rem] [&_.ProseMirror]:outline-none [&_.ProseMirror_p]:mb-3 [&_.ProseMirror_h2]:mb-2 [&_.ProseMirror_h2]:mt-4 [&_.ProseMirror_h2]:text-lg [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h3]:mb-2 [&_.ProseMirror_h3]:mt-3 [&_.ProseMirror_h3]:text-base [&_.ProseMirror_h3]:font-semibold [&_.ProseMirror_ul]:my-2 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6 [&_.ProseMirror_ol]:my-2 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6"
        />
      </div>
    </>
  );
}
