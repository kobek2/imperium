"use client";

import { EditorContent, useEditor, type Editor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import { useEffect, useRef } from "react";
import { sanitizeBillHtml } from "@/lib/sanitize-bill-html";

/** Keep toolbar formatting from yanking the page scroll when the editor is far down the form. */
const focusWithoutScroll = { scrollIntoView: false } as const;

const EMPTY_EDITOR_HTML = "<p></p>";

/** Stable extension list — must not be recreated on render or TipTap re-applies options and drops focus. */
const BILL_EDITOR_EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [2, 3, 4] },
  }),
  Underline,
  TextAlign.configure({ types: ["heading", "paragraph"] }),
];

/** Stop ProseMirror selection sync from nudging page scroll after zoom/layout changes. */
const billEditorDomProps = {
  handleScrollToSelection: () => true,
  transformPastedHTML: (html: string) => sanitizeBillHtml(html),
} as const;

function ToolbarButton({
  editor,
  label,
  active,
  onAction,
}: {
  editor: Editor;
  label: string;
  active: boolean;
  onAction: () => void;
}) {
  const pressedOnButton = useRef(false);

  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      onMouseDown={(e) => {
        // Keep the editor selection; only honor clicks that start on this button.
        e.preventDefault();
        pressedOnButton.current = true;
      }}
      onFocus={(e) => {
        // Toolbar buttons must never hold keyboard focus — typing belongs in the editor.
        e.currentTarget.blur();
        editor.commands.focus(null, focusWithoutScroll);
      }}
      onMouseLeave={() => {
        pressedOnButton.current = false;
      }}
      onClick={() => {
        if (!pressedOnButton.current) return;
        pressedOnButton.current = false;
        onAction();
      }}
      className={`rounded px-2 py-1 text-xs font-semibold uppercase tracking-wide transition select-none ${
        active
          ? "bg-[var(--psc-ink)] text-white"
          : "bg-white text-[var(--psc-ink)] ring-1 ring-[var(--psc-border)] hover:bg-[var(--psc-canvas)]"
      }`}
    >
      {label}
    </button>
  );
}

function MenuBar({ editor }: { editor: Editor }) {
  const active = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      bold: ed.isActive("bold"),
      italic: ed.isActive("italic"),
      underline: ed.isActive("underline"),
      h2: ed.isActive("heading", { level: 2 }),
      h3: ed.isActive("heading", { level: 3 }),
      body: ed.isActive("paragraph") && !ed.isActive("heading"),
      bulletList: ed.isActive("bulletList"),
      orderedList: ed.isActive("orderedList"),
      alignLeft: ed.isActive({ textAlign: "left" }),
      alignCenter: ed.isActive({ textAlign: "center" }),
      alignRight: ed.isActive({ textAlign: "right" }),
    }),
  });

  const groups: {
    label: string;
    action: () => boolean;
    isActive: boolean;
  }[][] = [
    [
      { label: "Bold", action: () => editor.chain().focus(null, focusWithoutScroll).toggleBold().run(), isActive: active.bold },
      { label: "Italic", action: () => editor.chain().focus(null, focusWithoutScroll).toggleItalic().run(), isActive: active.italic },
      { label: "Underline", action: () => editor.chain().focus(null, focusWithoutScroll).toggleUnderline().run(), isActive: active.underline },
    ],
    [
      { label: "H2", action: () => editor.chain().focus(null, focusWithoutScroll).toggleHeading({ level: 2 }).run(), isActive: active.h2 },
      { label: "H3", action: () => editor.chain().focus(null, focusWithoutScroll).toggleHeading({ level: 3 }).run(), isActive: active.h3 },
      { label: "Body", action: () => editor.chain().focus(null, focusWithoutScroll).setParagraph().run(), isActive: active.body },
    ],
    [
      { label: "• List", action: () => editor.chain().focus(null, focusWithoutScroll).toggleBulletList().run(), isActive: active.bulletList },
      { label: "1. List", action: () => editor.chain().focus(null, focusWithoutScroll).toggleOrderedList().run(), isActive: active.orderedList },
    ],
    [
      { label: "Left", action: () => editor.chain().focus(null, focusWithoutScroll).setTextAlign("left").run(), isActive: active.alignLeft },
      { label: "Center", action: () => editor.chain().focus(null, focusWithoutScroll).setTextAlign("center").run(), isActive: active.alignCenter },
      { label: "Right", action: () => editor.chain().focus(null, focusWithoutScroll).setTextAlign("right").run(), isActive: active.alignRight },
    ],
  ];

  return (
    <div
      role="toolbar"
      aria-label="Text formatting"
      className="flex flex-wrap gap-1 rounded-t border border-b-0 border-[var(--psc-border)] bg-[var(--psc-panel)] p-2"
    >
      {groups.map((grp, gi) => (
        <div key={gi} className="flex flex-wrap gap-1 border-[var(--psc-border)] pr-2 sm:border-r sm:pr-2">
          {grp.map((b) => (
            <ToolbarButton
              key={b.label}
              editor={editor}
              label={b.label}
              active={b.isActive}
              onAction={() => b.action()}
            />
          ))}
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
  const initialContent = initialHtml?.trim() ? initialHtml : EMPTY_EDITOR_HTML;
  const editor = useEditor(
    {
      extensions: BILL_EDITOR_EXTENSIONS,
      content: initialContent,
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
      editorProps: billEditorDomProps,
    },
    [initialContent],
  );

  useBillEditorFormSync(editor, hiddenRef);

  useEffect(() => {
    if (!editor || initialHtml == null || !initialHtml.trim()) return;
    // Only hydrate when the stored bill HTML changes (e.g. after save), not on every parent render.
    if (editor.getHTML() === initialHtml) return;
    editor.commands.setContent(initialHtml, { emitUpdate: false });
  }, [editor, initialHtml]);

  if (!editor) {
    return (
      <>
        <input ref={hiddenRef} type="hidden" name={fieldName} defaultValue="" />
        <div className="min-h-[22rem] rounded border border-[var(--psc-border)] bg-white" />
      </>
    );
  }

  return (
    <>
      <input ref={hiddenRef} type="hidden" name={fieldName} defaultValue="" />
      <div className="flex flex-col-reverse">
        <MenuBar editor={editor} />
        <EditorContent
          editor={editor}
          className="min-h-[22rem] rounded-b border border-t-0 border-[var(--psc-border)] bg-white px-3 py-3 text-sm text-[var(--psc-ink)] [&_.ProseMirror]:min-h-[18rem] [&_.ProseMirror]:[overflow-anchor:none] [&_.ProseMirror]:outline-none [&_.ProseMirror_p]:mb-3 [&_.ProseMirror_h2]:mb-2 [&_.ProseMirror_h2]:mt-4 [&_.ProseMirror_h2]:text-lg [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h3]:mb-2 [&_.ProseMirror_h3]:mt-3 [&_.ProseMirror_h3]:text-base [&_.ProseMirror_h3]:font-semibold [&_.ProseMirror_ul]:my-2 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6 [&_.ProseMirror_ol]:my-2 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6"
        />
      </div>
    </>
  );
}
