import { useEffect, useRef, useState } from "react";
import { FilePlus2, Play, RotateCcw, Save } from "lucide-react";
import { useDevice } from "../device-context";
import { mpy } from "../../lib/mpy";
import { ActionButton, NeedsDevice, Notice, Panel, errorText } from "./primitives";

const NEW_APP_TEMPLATE = (name: string) => `from espos.app import BaseApp
from espos import ui

MANIFEST = {"name": "${name}", "icon": "${name.slice(0, 1).toUpperCase()}", "color": ui.ACCENT}


class App(BaseApp):
    def on_start(self):
        d = self.display
        d.clear(ui.BLACK)
        ui.status_bar(d, d.width, "${name}")
        ui.text_center(d, d.width // 2, 60, "${name} is running", ui.WHITE)

    def on_touch(self, x, y, pressed):
        self.display.fill_rectangle(x - 2, y - 2, 5, 5, ui.ACCENT)

    def on_tick(self):
        pass
`;

export function EditorPanel({ path, setPath }: { path: string | null; setPath: (p: string) => void }) {
  const device = useDevice();
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pathInput, setPathInput] = useState(path ?? "/apps/hello/app.py");
  const [newApp, setNewApp] = useState("");
  const [runOutput, setRunOutput] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const connected = device.status === "connected";
  const dirty = content !== original;

  useEffect(() => {
    if (!path || !connected) return;
    setPathInput(path);
    setLoading(true);
    setError(null);
    setSaved(false);
    mpy
      .readFile(path)
      .then((txt) => {
        setContent(txt);
        setOriginal(txt);
      })
      .catch((e) => {
        setError(errorText(e));
        setContent("");
        setOriginal("");
      })
      .finally(() => setLoading(false));
  }, [path, connected]);

  async function save(reset: boolean) {
    const target = pathInput.trim();
    if (!target.startsWith("/")) {
      setError("Путь должен начинаться с /");
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await mpy.writeFile(target, content);
      setOriginal(content);
      setSaved(true);
      if (target !== path) setPath(target);
      if (reset) await mpy.softReset();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  async function runSnippet() {
    setRunOutput("…");
    try {
      const out = await mpy.exec(content, 30000);
      setRunOutput(out || "(без вывода)");
    } catch (e) {
      setRunOutput(errorText(e));
    }
  }

  function createApp() {
    const slug = newApp.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (!slug) return;
    const p = `/apps/${slug}/app.py`;
    setPathInput(p);
    setContent(NEW_APP_TEMPLATE(newApp.trim()));
    setOriginal("");
    setNewApp("");
    setSaved(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Tab") {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: s, selectionEnd: en } = el;
      const next = content.slice(0, s) + "    " + content.slice(en);
      setContent(next);
      requestAnimationFrame(() => el.setSelectionRange(s + 4, s + 4));
    } else if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      void save(false);
    }
  }

  const lineCount = content.split("\n").length;

  return (
    <Panel kicker="ED" title="Редактор" className="h-full">
      {!connected ? (
        <NeedsDevice />
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
            <input
              value={pathInput}
              aria-label="Путь к файлу на устройстве"
              onChange={(e) => setPathInput(e.target.value)}
              className="h-8 min-w-56 flex-1 border border-border bg-background px-2 font-mono text-xs outline-none focus:border-primary"
              spellCheck={false}
            />
            {dirty && <span className="font-mono text-[10px] uppercase text-warning">изменён</span>}
            {saved && !dirty && <span className="font-mono text-[10px] uppercase text-success">сохранён</span>}
            <ActionButton icon={<Save className="size-3.5" />} loading={saving} onClick={() => save(false)}>
              Сохранить
            </ActionButton>
            <ActionButton tone="primary" icon={<RotateCcw className="size-3.5" />} disabled={saving} onClick={() => save(true)}>
              Сохранить + reset
            </ActionButton>
            <ActionButton icon={<Play className="size-3.5" />} onClick={runSnippet} title="Выполнить содержимое редактора в raw REPL (без сохранения)">
              Выполнить
            </ActionButton>
          </div>

          <div className="flex items-center gap-2 border-b border-border bg-background/50 px-4 py-1.5">
            <span className="font-display text-[10px] uppercase tracking-[0.16em] text-muted-foreground">новое приложение</span>
            <input
              value={newApp}
              aria-label="Название нового приложения"
              onChange={(e) => setNewApp(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createApp()}
              placeholder="Название"
              className="h-7 w-40 border border-border bg-background px-2 font-mono text-xs outline-none focus:border-primary"
            />
            <button onClick={createApp} className="grid size-7 place-items-center border border-border hover:border-primary hover:text-primary" title="Создать из шаблона">
              <FilePlus2 className="size-3.5" />
            </button>
          </div>

          {error && (
            <div className="p-3">
              <Notice tone="error">{error}</Notice>
            </div>
          )}

          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            {loading && <div className="absolute inset-0 z-10 grid place-items-center bg-card/80 font-mono text-xs text-muted-foreground">чтение {path}…</div>}
            <pre
              aria-hidden
              className="pointer-events-none select-none overflow-hidden border-r border-border bg-background px-2 py-3 text-right font-mono text-[12px] leading-5 text-muted-foreground/60"
              style={{ transform: `translateY(-${area.current?.scrollTop ?? 0}px)` }}
            >
              {Array.from({ length: lineCount }, (_, i) => i + 1).join("\n")}
            </pre>
            <textarea
              ref={area}
              aria-label="Код"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={onKeyDown}
              onScroll={(e) => {
                const pre = e.currentTarget.previousElementSibling as HTMLElement | null;
                if (pre) pre.style.transform = `translateY(-${e.currentTarget.scrollTop}px)`;
              }}
              spellCheck={false}
              className="min-h-0 flex-1 resize-none bg-background px-3 py-3 font-mono text-[12px] leading-5 text-foreground outline-none"
              placeholder="# открой файл во вкладке «Файлы» или введи путь выше"
            />
          </div>

          {runOutput !== null && (
            <div className="border-t border-border">
              <div className="flex items-center justify-between px-4 py-1.5">
                <span className="font-display text-[10px] uppercase tracking-[0.16em] text-muted-foreground">вывод</span>
                <button className="font-mono text-[10px] text-muted-foreground hover:text-foreground" onClick={() => setRunOutput(null)}>
                  закрыть
                </button>
              </div>
              <pre className="max-h-40 overflow-auto px-4 pb-3 font-mono text-[11px] text-foreground">{runOutput}</pre>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
