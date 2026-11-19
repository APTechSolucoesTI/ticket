import { EditorContent, Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import { useEffect, useReducer, useRef } from "react";
import { useRetainedDialogResource } from "@/components/ui/dialog-resources";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  List,
  ListOrdered,
  Heading1,
  Heading2,
  Heading3,
  Quote,
  Code,
  Link as LinkIcon,
  Undo,
  Redo,
  AlignLeft,
  AlignCenter,
  AlignRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  value: string;
  onChange: (html: string) => void;
  className?: string;
  readOnly?: boolean;
};

function ToolbarBtn({
  active,
  onClick,
  children,
  title,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn("h-7 w-7", active && "bg-accent text-accent-foreground")}
    >
      {children}
    </Button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b p-1 bg-muted/40">
      <ToolbarBtn title="Desfazer" onClick={() => editor.chain().focus().undo().run()}>
        <Undo className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn title="Refazer" onClick={() => editor.chain().focus().redo().run()}>
        <Redo className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <div className="mx-1 h-5 w-px bg-border" />
      <ToolbarBtn
        title="Negrito"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn
        title="Itálico"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn
        title="Sublinhado"
        active={editor.isActive("underline")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn
        title="Tachado"
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <div className="mx-1 h-5 w-px bg-border" />
      <ToolbarBtn
        title="Título 1"
        active={editor.isActive("heading", { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        <Heading1 className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn
        title="Título 2"
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn
        title="Título 3"
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <div className="mx-1 h-5 w-px bg-border" />
      <ToolbarBtn
        title="Lista"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn
        title="Numerada"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn
        title="Citação"
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn
        title="Código"
        active={editor.isActive("codeBlock")}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        <Code className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <div className="mx-1 h-5 w-px bg-border" />
      <ToolbarBtn
        title="Esquerda"
        active={editor.isActive({ textAlign: "left" })}
        onClick={() => editor.chain().focus().setTextAlign("left").run()}
      >
        <AlignLeft className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn
        title="Centro"
        active={editor.isActive({ textAlign: "center" })}
        onClick={() => editor.chain().focus().setTextAlign("center").run()}
      >
        <AlignCenter className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn
        title="Direita"
        active={editor.isActive({ textAlign: "right" })}
        onClick={() => editor.chain().focus().setTextAlign("right").run()}
      >
        <AlignRight className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <div className="mx-1 h-5 w-px bg-border" />
      <ToolbarBtn
        title="Link"
        active={editor.isActive("link")}
        onClick={() => {
          const prev = editor.getAttributes("link").href as string | undefined;
          const url = window.prompt("URL", prev || "https://");
          if (url === null) return;
          if (url === "") {
            editor.chain().focus().unsetLink().run();
            return;
          }
          editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
        }}
      >
        <LinkIcon className="h-3.5 w-3.5" />
      </ToolbarBtn>
    </div>
  );
}

export function RichTextEditor({ value, onChange, className, readOnly = false }: Props) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [, refreshToolbar] = useReducer((version: number) => version + 1, 0);
  // Create in an effect (SSR/StrictMode safe). The dialog owns the imperative
  // instance while minimized, retaining ProseMirror selection and undo history.
  const editor = useRetainedDialogResource(
    () =>
      new Editor({
        extensions: [
          StarterKit.configure({ link: false, underline: false }),
          Underline,
          Link.configure({ openOnClick: false, autolink: true }),
          TextAlign.configure({ types: ["heading", "paragraph"] }),
        ],
        content: value || "",
        editable: !readOnly,
        editorProps: {
          attributes: {
            class:
              "prose prose-sm dark:prose-invert max-w-none min-h-[260px] p-3 focus:outline-none",
          },
        },
        onUpdate: ({ editor }) => {
          if (!editor.isDestroyed) onChangeRef.current(editor.getHTML());
        },
      }),
    (instance) => {
      if (!instance.isDestroyed) instance.destroy();
    },
  );

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.on("transaction", refreshToolbar);
    return () => {
      editor.off("transaction", refreshToolbar);
    };
  }, [editor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (value !== editor.getHTML()) editor.commands.setContent(value || "", { emitUpdate: false });
  }, [editor, value]);

  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  if (!editor || editor.isDestroyed) return null;

  return (
    <div className={cn("rounded-md border bg-background", className)}>
      {!readOnly && <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}
