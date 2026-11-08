import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Check, Copy } from "lucide-react";
import { ESPOS_VERSION } from "../lib/espos-files";
import { cn } from "../lib/utils";
import { WiringDiagram } from "../components/studio/wiring-diagram";

const SECTIONS = [
  { id: "wiring", n: "01", title: "Подключение" },
  { id: "flash", n: "02", title: "Прошивка MicroPython" },
  { id: "install", n: "03", title: "Установка espOS" },
  { id: "apps", n: "04", title: "Приложения" },
  { id: "own-app", n: "05", title: "Своё приложение" },
  { id: "calibration", n: "06", title: "Калибровка тача" },
  { id: "recovery", n: "07", title: "Восстановление" },
  { id: "payload", n: "08", title: "Обновление пакета Studio" },
];

const PINS: [string, string, string, string][] = [
  ["SCLK", "12", "общий SCLK", "12"],
  ["MOSI", "11", "общий MOSI", "11"],
  ["MISO", "13", "общий MISO", "13"],
  ["CS", "10", "T_CS", "15"],
  ["DC", "9", "T_IRQ", "16"],
  ["RST", "14", "", ""],
  ["BL_EN (если есть)", "8 *", "", ""],
  ["VCC", "по паспорту *", "", ""],
  ["GND", "GND", "", ""],
];

const APPS: [string, string][] = [
  ["Hello", "Шаблон — скопируй папку, чтобы начать своё приложение"],
  ["Touch", "Калибровка тача: тапни 4 крестика → выведет значения TOUCH_*; затем тест рисованием"],
  ["SysMon", "Свободная память, температура чипа, время работы, график памяти"],
  ["Settings", "Перезагрузка, перезапуск лаунчера, частота CPU, место во flash, UID"],
  ["About", "Версии и подсказки по восстановлению"],
];

function Code({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative my-4 border border-border bg-background">
      <button
        onClick={() => {
          void navigator.clipboard.writeText(children).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }).catch(() => setCopied(false));
        }}
        className="absolute top-2 right-2 grid size-7 place-items-center border border-border bg-card text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-primary"
        title="Скопировать"
      >
        {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      </button>
      <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-6 text-foreground/90">{children}</pre>
    </div>
  );
}

function C({ children }: { children: React.ReactNode }) {
  return <code className="border border-border bg-background px-1.5 py-0.5 font-mono text-[0.85em] text-primary break-all">{children}</code>;
}

function Callout({ tone, title, children }: { tone: "info" | "warning"; title: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "my-5 border-l-2 px-4 py-3 text-sm leading-relaxed",
        tone === "info" ? "border-primary bg-primary/5" : "border-warning bg-warning/5",
      )}
    >
      <div className={cn("mb-1 font-display text-[11px] font-semibold uppercase tracking-[0.16em]", tone === "info" ? "text-primary" : "text-warning")}>
        {title}
      </div>
      <div className="text-foreground/85">{children}</div>
    </div>
  );
}

function Section({ id, n, title, children }: { id: string; n: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-border py-12 first:border-t-0 first:pt-0">
      <div className="mb-5 flex items-baseline gap-4">
        <span className="font-mono text-sm text-primary">{n}</span>
        <h2 className="font-display text-2xl font-bold tracking-tight md:text-3xl">{title}</h2>
      </div>
      <div className="max-w-2xl text-[15px] leading-7 text-foreground/85 [&_p]:my-3">{children}</div>
    </section>
  );
}

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="my-4 flex flex-col gap-3">
      {items.map((it, i) => (
        <li key={i} className="flex gap-4">
          <span className="grid size-6 shrink-0 place-items-center border border-primary/50 font-mono text-[11px] text-primary">{i + 1}</span>
          <span className="pt-0.5">{it}</span>
        </li>
      ))}
    </ol>
  );
}

export default function GuidePage() {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 sm:gap-6 border-b border-border bg-card/85 px-5 backdrop-blur">
        <Link to="/" className="flex items-center gap-2 font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground hover:text-primary">
          <ArrowLeft className="size-3.5" /> Studio
        </Link>
        <span className="font-display text-lg font-bold tracking-tight">
          esp<span className="text-primary">OS</span>
        </span>
        <span className="font-display text-[10px] uppercase tracking-[0.22em] text-muted-foreground hidden sm:inline">Инструкция по прошивке</span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">v{ESPOS_VERSION} · ESP32-S3</span>
      </header>

      <div className="mx-auto grid max-w-6xl gap-12 px-5 pt-14 pb-24 lg:grid-cols-[220px_1fr]">
        <aside className="hidden lg:block">
          <nav className="sticky top-24 flex flex-col">
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="flex gap-3 border-l border-border py-1.5 pl-4 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground">
                <span className="font-mono text-[11px] text-primary/70">{s.n}</span>
                {s.title}
              </a>
            ))}
          </nav>
        </aside>

        <main className="min-w-0">
          <div className="rise mb-16">
            <p className="mb-4 font-mono text-xs text-primary">// MVP · только USB</p>
            <h1 className="font-display text-4xl leading-[1.05] font-bold tracking-tight md:text-6xl">
              От голой платы
              <br />
              до <span className="text-primary">лаунчера</span> на экране
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
              espOS работает поверх официального MicroPython: сначала шьётся рантайм, затем на файловую систему копируются Python-файлы espOS.
              Собирать свою прошивку не нужно. Все шаги можно сделать в Studio прямо из браузера или вручную через терминал.
            </p>
            <div className="mt-8 grid max-w-2xl grid-cols-1 sm:grid-cols-3 border border-border">
              {[
                ["Плата", "ESP32-S3 DevKitC"],
                ["Экран", "ILI9341 240×320"],
                ["Тач", "XPT2046"],
              ].map(([k, v]) => (
                <div key={k} className="border-b sm:border-b-0 sm:border-r border-border p-4 last:border-0">
                  <div className="font-display text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{k}</div>
                  <div className="mt-1 font-mono text-sm">{v}</div>
                </div>
              ))}
            </div>
          </div>

          <Section id="wiring" n="01" title="Подключение">
            <p>
              Экран и тач сидят на одной шине SPI, у каждого свой CS. Если подключаешь иначе — поменяй пины в <C>config.py</C>.
            </p>
            <WiringDiagram />
            <div className="my-5 overflow-x-auto border border-border">
              <table className="w-full font-mono text-sm">
                <thead>
                  <tr className="border-b border-border bg-card text-left">
                    <th className="px-4 py-2.5 font-normal text-muted-foreground">Экран</th>
                    <th className="px-4 py-2.5 font-normal text-muted-foreground">GPIO</th>
                    <th className="border-l border-border px-4 py-2.5 font-normal text-muted-foreground">Тач</th>
                    <th className="px-4 py-2.5 font-normal text-muted-foreground">GPIO</th>
                  </tr>
                </thead>
                <tbody>
                  {PINS.map(([a, b, c, d]) => (
                    <tr key={a} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-2">{a}</td>
                      <td className="px-4 py-2 text-primary">{b}</td>
                      <td className="border-l border-border px-4 py-2 text-muted-foreground">{c}</td>
                      <td className="px-4 py-2 text-primary">{d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Callout tone="warning" title="Не трогай эти пины">
              GPIO 19/20 — нативный USB (D−/D+). GPIO 26–32 обычно используются для flash/PSRAM; при octal-памяти также могут быть заняты GPIO 33–37. Проверяй вариант модуля.
            </Callout>
            <Callout tone="warning" title="Питание и подсветка — сначала проверь модуль">
              ILI9341 — контроллер экрана, не обозначение конкретной платы: VCC, ток подсветки и вход LED различаются.
              Не подавай 5 V на GPIO ESP32. Не питай силовой LED напрямую от GPIO 8: он допустим только для логического
              BL_EN или внешнего драйвера подсветки. Если LED — силовой вывод, подключай по схеме производителя,
              а в config.py установи TFT_BL = None. На чертеже предполагается резистивный тач XPT2046;
              при другом контроллере нужны другая схема и драйвер.
            </Callout>
          </Section>

          <Section id="flash" n="02" title="Прошивка MicroPython">
            <Callout tone="info" title="Web Flasher: несколько семейств">
              Теперь доступны ESP32, S2, S3, C2, C3 и C6. Выбери семейство вручную либо нажми «Определить чип»:
              ROM-проверка перезапускает плату, но не записывает flash. При несовпадении чипа и выбранного образа запись блокируется.
              Семейство не определяет flash/PSRAM и модель платы — вариант сборки выбирай отдельно.
              Для ESP32/S2 адрес полного generic-образа — 0x1000; для S3/C2/C3/C6 — 0x0.
              Инструкция подключения и пакет espOS на этой странице по-прежнему относятся к S3 DevKitC.
            </Callout>
            <p className="font-display text-xs font-semibold uppercase tracking-[0.16em] text-primary">Вариант А — espOS Studio</p>
            <Steps
              items={[
                <>Открой Studio в Chrome или Edge и нажми «Подключить».</>,
                <>
                  Вкладка «Прошивка» → выбери сборку. Для модулей с octal PSRAM (N8R8, N16R8) бери вариант <C>SPIRAM_OCT</C>.
                </>,
                <>Оставь «Полностью стереть flash» при первой установке и нажми «Стереть и прошить».</>,
              ]}
            />
            <p className="mt-8 font-display text-xs font-semibold uppercase tracking-[0.16em] text-primary">Вариант Б — терминал</p>
            <p>
              Скачай сборку с <C>micropython.org/download/ESP32_GENERIC_S3</C>, затем:
            </p>
            <Code>{`pip install esptool mpremote
esptool.py --chip esp32s3 --port /dev/ttyACM0 erase_flash
esptool.py --chip esp32s3 --port /dev/ttyACM0 write_flash -z 0 ESP32_GENERIC_S3-*.bin`}</Code>
            <p className="text-sm text-muted-foreground">
              Windows: порт вида <C>COM5</C>. macOS: <C>/dev/cu.usbmodemXXXX</C>.
            </p>
            <Callout tone="info" title="Какой USB-порт">
              У DevKitC два разъёма. Прошивать надёжнее через <b>UART</b> (CP210x/CH343): нативный <b>USB</b> при сбросе переподключается как другое
              устройство. Если плата не входит в загрузчик — зажми BOOT, нажми RST, отпусти BOOT.
            </Callout>
          </Section>

          <Section id="install" n="03" title="Установка espOS">
            <p className="font-display text-xs font-semibold uppercase tracking-[0.16em] text-primary">Вариант А — espOS Studio</p>
            <Steps items={[<>Вкладка «Установка» → «Установить espOS».</>, <>Дождись галочек у всех файлов и нажми «Soft reset» — на экране появится лаунчер.</>]} />
            <p className="mt-8 font-display text-xs font-semibold uppercase tracking-[0.16em] text-primary">Вариант Б — mpremote</p>
            <Code>{`cd firmware
mpremote connect /dev/ttyACM0 cp boot.py :boot.py
mpremote connect /dev/ttyACM0 cp main.py :main.py
mpremote connect /dev/ttyACM0 cp config.py :config.py
mpremote connect /dev/ttyACM0 cp -r lib/ :
mpremote connect /dev/ttyACM0 cp -r apps/ :
mpremote connect /dev/ttyACM0 reset`}</Code>
          </Section>

          <Section id="apps" n="04" title="Приложения">
            <p>Тапни плитку, чтобы открыть приложение. Тап в верхний левый угол (<C>{"<-"}</C>) возвращает в лаунчер.</p>
            <div className="my-5 border border-border">
              {APPS.map(([name, desc]) => (
                <div key={name} className="flex gap-6 border-b border-border/60 px-4 py-3 last:border-0">
                  <span className="w-20 shrink-0 font-mono text-sm text-primary">{name}</span>
                  <span className="text-sm text-foreground/80">{desc}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section id="own-app" n="05" title="Своё приложение">
            <p>
              Создай <C>apps/&lt;имя&gt;/app.py</C> (или нажми «Новое приложение» во вкладке «Редактор» в Studio):
            </p>
            <Code>{`from espos.app import BaseApp
from espos import ui

MANIFEST = {"name": "Hello", "icon": "H", "color": ui.GREEN}

class App(BaseApp):
    def on_start(self):
        self.display.clear(ui.BLACK)
        self.display.draw_text8x8(20, 40, "Hello espOS!", ui.WHITE, ui.BLACK)

    def on_touch(self, x, y, pressed):
        pass

    def on_tick(self):   # ~40 раз/с, не блокируй
        pass`}</Code>
            <p>
              Залей папку (<C>mpremote cp -r apps/имя :apps/</C> или через Studio) и перезапусти — появится новая плитка. Перекомпилировать прошивку
              не нужно.
            </p>
          </Section>

          <Section id="calibration" n="06" title="Калибровка тача">
            <Steps
              items={[
                <>Открой на плате приложение <b>Touch</b>.</>,
                <>Тапни по очереди 4 крестика.</>,
                <>
                  Скопируй выведенные <C>TOUCH_X_MIN/MAX</C>, <C>TOUCH_Y_MIN/MAX</C> в <C>config.py</C>.
                </>,
                <>
                  Если ось зеркальна — переключи <C>TOUCH_INVERT_X</C> / <C>TOUCH_INVERT_Y</C>.
                </>,
              ]}
            />
          </Section>

          <Section id="recovery" n="07" title="Восстановление">
            <div className="my-5 grid gap-px border border-border bg-border sm:grid-cols-3">
              {[
                ["Ctrl-C по USB", "Останавливает лаунчер и даёт приглашение >>>"],
                ["RST, затем BOOT", "Безопасный режим: нажми и отпусти RST, затем сразу зажми BOOT на время «hold BOOT now» (1,5 с). Лаунчер и LAN не запускаются. BOOT, зажатый во время RST, — это вход в загрузчик, а не safe mode"],
                ["Без экрана", "DISPLAY_ENABLED = False или ошибка дисплея — espOS работает только через USB"],
              ].map(([k, v]) => (
                <div key={k} className="bg-card p-4">
                  <div className="font-mono text-sm text-primary">{k}</div>
                  <div className="mt-2 text-sm leading-6 text-foreground/80">{v}</div>
                </div>
              ))}
            </div>
          </Section>

          <Section id="payload" n="08" title="Обновление пакета Studio">
            <p>
              После любых правок в <C>firmware/</C> пересобери пакет, чтобы кнопка «Установить espOS» копировала новые файлы:
            </p>
            <Code>{`node tools/gen_payload.mjs`}</Code>
          </Section>
        </main>
      </div>
    </div>
  );
}
