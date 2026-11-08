/** Logical connections, not a physical header drawing. */
const nets = [
  { gpio: "GPIO 12", pin: "SCK / SCLK", y: 160, color: "#22d3ee", touch: 560, branch: 356 },
  { gpio: "GPIO 11", pin: "SDI / MOSI", y: 192, color: "#4ade80", touch: 592, branch: 388 },
  { gpio: "GPIO 13", pin: "SDO / MISO", y: 224, color: "#fbbf24", touch: 624, branch: 420 },
  { gpio: "GPIO 10", pin: "CS", y: 256, color: "#a78bfa" },
  { gpio: "GPIO 9", pin: "DC / RS", y: 288, color: "#a78bfa" },
  { gpio: "GPIO 14", pin: "RESET / RST", y: 320, color: "#a78bfa" },
  { gpio: "3V3 *", pin: "VCC *", y: 352, color: "#f4646a" },
  { gpio: "GND", pin: "GND", y: 384, color: "#94a3b8" },
];

export function WiringDiagram() {
  return (
    <figure className="my-5 border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <span className="font-display text-xs uppercase tracking-widest">Схема соединений</span>
        <a href="/wiring.svg" download="espos-wiring.svg" className="font-mono text-[10px] text-primary hover:underline">Скачать SVG</a>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox="0 0 900 740" className="block w-full min-w-[680px]" aria-labelledby="wiring-title wiring-description">
          <title id="wiring-title">ESP32-S3 DevKitC: подключение ILI9341 и XPT2046</title>
          <desc id="wiring-description">Цветные линии соединяют GPIO с сигналами TFT и тача. SCK, MOSI и MISO общие; точки обозначают соединение. Положение контактов условное, не соответствует порядку на разъёмах.</desc>
          <defs>
            <pattern id="wiring-grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#1e232c" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="900" height="740" fill="url(#wiring-grid)" />
          <g fontFamily="JetBrains Mono, monospace" fontSize="13" fill="#e7eaef">
            <text x="30" y="34" fill="#8a93a2">Логическая схема · номера GPIO, не номера контактов разъёма</text>
            <rect x="30" y="85" width="224" height="570" fill="#0e1014" stroke="#475569" />
            <text x="46" y="115" fontSize="17">ESP32-S3</text>
            <text x="46" y="137" fill="#8a93a2">DevKitC</text>
            <rect x="636" y="85" width="236" height="340" fill="#0e1014" stroke="#475569" />
            <text x="652" y="115" fontSize="17">ILI9341 · TFT</text>
            <text x="652" y="137" fill="#8a93a2">2.8″ / 240 × 320</text>
            <rect x="636" y="446" width="236" height="209" fill="#0e1014" stroke="#475569" />
            <text x="652" y="471" fontSize="17">XPT2046 · Touch</text>
            {nets.map((n) => (
              <g key={n.gpio}>
                <path d={`M254 ${n.y} H636`} stroke={n.color} strokeWidth="2" fill="none" strokeDasharray={n.pin === "VCC *" ? "6 4" : undefined} />
                <text x="238" y={n.y + 4} textAnchor="end">{n.gpio}</text>
                <text x="652" y={n.y + 4}>{n.pin}</text>
                <circle cx="254" cy={n.y} r="3" fill={n.color} />
                <circle cx="636" cy={n.y} r="3" fill={n.color} />
                {n.touch !== undefined && (
                  <g>
                    <path d={`M${n.branch} ${n.y} V${n.touch} H636`} stroke={n.color} strokeWidth="2" fill="none" />
                    <circle cx={n.branch} cy={n.y} r="4" fill={n.color} />
                    <circle cx="636" cy={n.touch} r="3" fill={n.color} />
                    <text x="652" y={n.touch + 4}>{["SCK / SCLK", "SDI / MOSI", "SDO / MISO"].indexOf(n.pin) === 0 ? "T_CLK" : n.pin === "SDI / MOSI" ? "T_DIN" : "T_DO"}</text>
                  </g>
                )}
              </g>
            ))}
            {[{ gpio: "GPIO 15", pin: "T_CS", y: 496 }, { gpio: "GPIO 16", pin: "T_IRQ", y: 528 }].map((n) => (
              <g key={n.gpio}>
                <text x="238" y={n.y + 4} textAnchor="end">{n.gpio}</text>
                <path d={`M254 ${n.y} H636`} fill="none" stroke="#a78bfa" strokeWidth="2" />
                <circle cx="254" cy={n.y} r="3" fill="#a78bfa" />
                <circle cx="636" cy={n.y} r="3" fill="#a78bfa" />
                <text x="652" y={n.y + 4}>{n.pin}</text>
              </g>
            ))}
            <text x="46" y="596" fill="#8a93a2">USB: GPIO 19 / 20</text>
            <text x="46" y="619" fill="#8a93a2">не подключать к TFT</text>
            <text x="30" y="687" fill="#f4646a">* VCC: проверить паспорт модуля; сигнальные уровни только 3.3 V.</text>
            <text x="30" y="712" fill="#8a93a2">LED / BL показан отдельно в примечаниях. SD-карта не подключена.</text>
          </g>
        </svg>
      </div>
      <figcaption className="border-t border-border px-4 py-3 text-xs leading-6 text-muted-foreground">
        TFT и XPT2046 предполагаются на одном модуле с общим питанием. Точка = соединение; пересечение без точки = разные цепи.
        Для отдельных модулей соедини земли и подай питание по их паспортам. Физическое расположение контактов сверяй с маркировкой своей платы.
      </figcaption>
    </figure>
  );
}