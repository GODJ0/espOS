import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, FileCode, Folder, FolderPlus, RefreshCw, Trash2, Upload } from "lucide-react";
import { useDevice } from "../device-context";
import { mpy, type DirEntry } from "../../lib/mpy";
import { ActionButton, NeedsDevice, Notice, Panel, errorText } from "./primitives";
import { cn } from "../../lib/utils";

export function FilesPanel({ onOpen }: { onOpen: (path: string) => void }) {
  const device = useDevice();
  const [cwd, setCwd] = useState("/");
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [newDir, setNewDir] = useState("");
  const upload = useRef<HTMLInputElement>(null);
  const connected = device.status === "connected";

  const refresh = useCallback(
    async (path = cwd) => {
      setLoading(true);
      setError(null);
      try {
        const list = await mpy.listDir(path);
        list.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
        setEntries(list);
        setCwd(path);
      } catch (e) {
        setError(errorText(e));
      } finally {
        setLoading(false);
      }
    },
    [cwd],
  );

  useEffect(() => {
    if (connected && !device.busy && entries === null) void refresh("/");
    if (!connected) setEntries(null);
  }, [connected, device.busy, entries, refresh]);

  async function remove(e: DirEntry) {
    setPendingDelete(null);
    try {
      await mpy.remove(e.path, e.isDir);
      await refresh();
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function onUpload(files: FileList | null) {
    if (!files) return;
    try {
      for (const f of Array.from(files)) {
        const target = (cwd === "/" ? "" : cwd) + "/" + f.name;
        setUploading(target);
        await mpy.writeFile(target, await f.text());
      }
      await refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setUploading(null);
      if (upload.current) upload.current.value = "";
    }
  }

  async function mkdir() {
    const name = newDir.trim().replace(/\//g, "");
    if (!name) return;
    try {
      await mpy.makeDirs((cwd === "/" ? "" : cwd) + "/" + name);
      setNewDir("");
      await refresh();
    } catch (e) {
      setError(errorText(e));
    }
  }

  const crumbs = cwd.split("/").filter(Boolean);

  return (
    <Panel
      kicker="FS"
      title="Файлы устройства"
      className="h-full"
      actions={
        connected && (
          <>
            <input ref={upload} aria-label="Загрузить файлы" type="file" multiple className="hidden" onChange={(e) => onUpload(e.target.files)} />
            <ActionButton icon={<Upload className="size-3.5" />} loading={!!uploading} onClick={() => upload.current?.click()}>
              Загрузить
            </ActionButton>
            <ActionButton icon={<RefreshCw className="size-3.5" />} loading={loading} onClick={() => refresh()}>
              Обновить
            </ActionButton>
          </>
        )
      }
    >
      {!connected ? (
        <NeedsDevice />
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex flex-wrap items-center gap-1 border-b border-border px-4 py-2 font-mono text-xs">
            <button className="text-primary hover:underline" onClick={() => refresh("/")}>
              /
            </button>
            {crumbs.map((c, i) => {
              const p = "/" + crumbs.slice(0, i + 1).join("/");
              return (
                <span key={p} className="flex items-center gap-1">
                  <ChevronRight className="size-3 text-muted-foreground" />
                  <button className="hover:text-primary" onClick={() => refresh(p)}>
                    {c}
                  </button>
                </span>
              );
            })}
            <div className="ml-auto flex items-center gap-1">
              <input
                value={newDir}
                aria-label="Имя новой папки"
                onChange={(e) => setNewDir(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && mkdir()}
                placeholder="новая папка"
                className="h-7 w-32 border border-border bg-background px-2 font-mono text-xs outline-none focus:border-primary"
              />
              <button onClick={mkdir} className="grid size-7 place-items-center border border-border hover:border-primary hover:text-primary" title="Создать папку">
                <FolderPlus className="size-3.5" />
              </button>
            </div>
          </div>

          {error && (
            <div className="p-3">
              <Notice tone="error">{error}</Notice>
            </div>
          )}
          {uploading && <div className="px-4 py-2 font-mono text-xs text-primary">загрузка {uploading}…</div>}

          <div className="min-h-0 flex-1 overflow-auto">
            {entries === null && loading && <div className="p-4 font-mono text-xs text-muted-foreground">чтение…</div>}
            {cwd !== "/" && (
              <button
                onClick={() => refresh("/" + crumbs.slice(0, -1).join("/"))}
                className="flex w-full items-center gap-3 border-b border-border/60 px-4 py-2 text-left font-mono text-xs text-muted-foreground hover:bg-secondary"
              >
                <Folder className="size-3.5" /> ..
              </button>
            )}
            {entries?.length === 0 && <div className="p-4 font-mono text-xs text-muted-foreground">пусто</div>}
            {entries?.map((e) => (
              <div key={e.path} className="group flex items-center gap-3 border-b border-border/60 px-4 py-2 font-mono text-xs hover:bg-secondary">
                <button
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  onClick={() => (e.isDir ? refresh(e.path) : onOpen(e.path))}
                >
                  {e.isDir ? <Folder className="size-3.5 shrink-0 text-primary" /> : <FileCode className="size-3.5 shrink-0 text-muted-foreground" />}
                  <span className={cn("truncate", e.isDir && "text-primary")}>{e.name}</span>
                </button>
                {!e.isDir && <span className="text-muted-foreground">{e.size < 1024 ? `${e.size} B` : `${(e.size / 1024).toFixed(1)} KB`}</span>}
                {pendingDelete === e.path ? (
                  <span className="flex items-center gap-2">
                    <button className="text-destructive hover:underline" onClick={() => remove(e)}>
                      удалить
                    </button>
                    <button className="text-muted-foreground hover:underline" onClick={() => setPendingDelete(null)}>
                      отмена
                    </button>
                  </span>
                ) : (
                  <button
                    className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    onClick={() => setPendingDelete(e.path)}
                    title={e.isDir ? "Удалить (только пустую папку)" : "Удалить"}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}
