/* eslint-disable react-refresh/only-export-components -- Standalone browser fixture, no HMR boundary. */
import * as React from "react";
import { createRoot } from "react-dom/client";
import * as UI from "@/components/ui/dialog";
import * as Alert from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { RichTextEditor } from "@/components/rich-text-editor-impl";
import { useRetainedDialogResource } from "@/components/ui/dialog-resources";

const resourceProbe = { created: 0, disposed: 0 };
const childResourceProbe = { created: 0, disposed: 0 };
Object.assign(window, {
  __dialogResourceProbe: resourceProbe,
  __dialogChildResourceProbe: childResourceProbe,
});
function ChildResourceProbe() {
  const resource = useRetainedDialogResource(
    () => ({ id: ++childResourceProbe.created }),
    () => {
      childResourceProbe.disposed++;
    },
  );
  return resource ? <output data-testid="child-resource-identity">{resource.id}</output> : null;
}
function ResourceProbe() {
  useRetainedDialogResource(
    () => {
      resourceProbe.created++;
      return {};
    },
    () => {
      resourceProbe.disposed++;
    },
  );
  return null;
}

// Namespace lookup deliberately lets the old primitive load for a meaningful RED run.
const Dock = (UI as typeof UI & { DialogWindowDock?: React.ComponentType }).DialogWindowDock;
const Content = UI.DialogContent as React.ComponentType<
  React.ComponentProps<typeof UI.DialogContent> & {
    windowControls?: boolean;
    showCloseButton?: boolean;
  }
>;

function WrappedHeader({ title }: { title: string }) {
  return (
    <UI.DialogHeader>
      <UI.DialogTitle>{title}</UI.DialogTitle>
      <UI.DialogDescription>Rascunho local de teste; nenhum dado é enviado.</UI.DialogDescription>
    </UI.DialogHeader>
  );
}

function Draft({ title }: { title: string }) {
  const priorityLabelId = React.useId();
  const [count, setCount] = React.useState(0);
  const [nested, setNested] = React.useState(false);
  const [confirmation, setConfirmation] = React.useState(false);
  return (
    <>
      <form className="space-y-3" onSubmit={(event) => event.preventDefault()}>
        <label className="block">
          Nome do rascunho
          <input className="block w-full rounded-md border p-2" defaultValue="Inicial" />
        </label>
        <label className="block">
          Arquivo do rascunho
          <input className="block w-full" type="file" />
        </label>
        <Button type="button" onClick={() => setCount((value) => value + 1)}>
          Contador React: {count}
        </Button>
        <label className="block" id={priorityLabelId}>
          Prioridade
        </label>
        <Select defaultValue="normal">
          <SelectTrigger aria-labelledby={priorityLabelId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="high">Alta</SelectItem>
          </SelectContent>
        </Select>
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button">Abrir ajuda</Button>
          </PopoverTrigger>
          <PopoverContent>
            <label>
              Nota na ajuda
              <input className="block border p-2" />
            </label>
          </PopoverContent>
        </Popover>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => setNested(true)}>
            Abrir janela filha
          </Button>
          <Button type="button" onClick={() => setConfirmation(true)}>
            Solicitar confirmação
          </Button>
        </div>
        <div style={{ height: 280 }} aria-hidden="true" />
        <Button type="submit">Salvar rascunho</Button>
      </form>
      <UI.Dialog open={nested} onOpenChange={setNested}>
        <Content className="max-w-md">
          <WrappedHeader title="Cadastro filho" />
          <ChildResourceProbe />
          <label>
            Campo filho
            <input className="block border p-2" />
          </label>
        </Content>
      </UI.Dialog>
      <Alert.AlertDialog open={confirmation} onOpenChange={setConfirmation}>
        <Alert.AlertDialogContent>
          <Alert.AlertDialogHeader>
            <Alert.AlertDialogTitle>Confirmar alteração</Alert.AlertDialogTitle>
            <Alert.AlertDialogDescription>
              Esta escolha deve continuar modal.
            </Alert.AlertDialogDescription>
          </Alert.AlertDialogHeader>
          <Alert.AlertDialogCancel>Voltar ao cadastro</Alert.AlertDialogCancel>
        </Alert.AlertDialogContent>
      </Alert.AlertDialog>
    </>
  );
}

function FixtureWindow({ title, uncontrolled = false }: { title: string; uncontrolled?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [closes, setCloses] = React.useState(0);
  return (
    <>
      <output data-testid={`closes-${title}`}>{closes}</output>
      <UI.Dialog
        {...(uncontrolled ? {} : { open })}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setCloses((value) => value + 1);
        }}
      >
        <UI.DialogTrigger asChild>
          <Button>Abrir {title}</Button>
        </UI.DialogTrigger>
        <Content className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
          <WrappedHeader title={title} />
          <Draft title={title} />
        </Content>
      </UI.Dialog>
    </>
  );
}

function EditorFixtureWindow() {
  const [open, setOpen] = React.useState(false);
  const [html, setHtml] = React.useState("<p>Inicial editor</p>");
  return (
    <>
      <output data-testid="editor-html" className="sr-only">
        {html}
      </output>
      <UI.Dialog
        open={open}
        onOpenChange={(next) => {
          if (next) setHtml("<p>Inicial editor</p>");
          setOpen(next);
        }}
      >
        <UI.DialogTrigger asChild>
          <Button>Abrir editor</Button>
        </UI.DialogTrigger>
        <Content className="sm:max-w-2xl">
          <WrappedHeader title="Cadastro com editor" />
          <ResourceProbe />
          <RichTextEditor value={html} onChange={setHtml} />
        </Content>
      </UI.Dialog>
    </>
  );
}

function App() {
  const [clicks, setClicks] = React.useState(0);
  const [owner, setOwner] = React.useState(true);
  const [editorOwner, setEditorOwner] = React.useState(true);
  return (
    <main className="bg-background p-4 text-foreground" style={{ minHeight: "250vh" }}>
      <h1>Teste isolado de janelas</h1>
      <div className="flex flex-wrap gap-2">
        <Button data-testid="background-action" onClick={() => setClicks((value) => value + 1)}>
          Ação de fundo: {clicks}
        </Button>
        <Button onClick={() => setOwner(false)}>Desmontar proprietário</Button>
        <label>
          Campo de fundo
          <input className="block border p-2" />
        </label>
        {owner && <FixtureWindow title="Cadastro A" />}
        <FixtureWindow title="Cadastro B" uncontrolled />
        {editorOwner && <EditorFixtureWindow />}
        <Button onClick={() => setEditorOwner(false)}>Desmontar editor</Button>
        <UI.Dialog>
          <UI.DialogTrigger asChild>
            <Button>Abrir escolha obrigatória</Button>
          </UI.DialogTrigger>
          <Content
            windowControls={false}
            showCloseButton={false}
            onEscapeKeyDown={(event) => event.preventDefault()}
            onPointerDownOutside={(event) => event.preventDefault()}
          >
            <WrappedHeader title="Escolha obrigatória" />
            <UI.DialogClose asChild>
              <Button>Concluir escolha</Button>
            </UI.DialogClose>
          </Content>
        </UI.Dialog>
      </div>
      {Dock ? <Dock /> : null}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
