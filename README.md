# espOS + espOS Studio

Экспериментальная ОС на MicroPython для ESP32-S3 и браузерный Studio для прошивки, установки приложений, редактора файлов, REPL и Wi-Fi v2.

Версия: espOS **0.1.1-mvp** (срез архива v5 от 2026-10-25).

## Структура

| Папка / файл | Что внутри |
|---|---|
| `espOS/` | Прошивка (`firmware/`), тесты Python, документация (`docs/`), генератор payload (`tools/gen_payload.mjs`) |
| `espos-studio/` | Studio: Bun + Vite + React + Hono, WebSerial-прошивальщик, мастер «Простой старт», Wi-Fi bridge |
| `PLAN.md` | Копия `espOS/docs/NEXT_STEPS.md` — текущий план |
| `HARDWARE_STATUS.md` | Копия `espOS/docs/HARDWARE_STATUS.md` — что подтверждено на железе |

## Запуск Studio локально

```bash
cd espos-studio
bun install --frozen-lockfile
touch .env          # Windows PowerShell: New-Item -ItemType File .env
bun run dev
```

Открыть `http://localhost:4200` в Chrome/Edge. Подробно: `espos-studio/SELF_HOSTING.md`, сеть и риски: `espOS/docs/WIFI.md`.

## Проверки

```bash
cd espOS && python -m unittest discover -s tests && python -m compileall -q firmware
node tools/gen_payload.mjs        # после изменений firmware/ обновляет payload Studio
cd ../espos-studio
bun test tests/mpy.test.ts
bun test tests/beginner.test.ts
bun test tests/flasher.test.ts tests/diagnostics.test.ts tests/lan.test.ts
bun test tests/serial.test.ts     # тестовые группы запускать раздельно
```

## Безопасность

- `.env`, `/network_config.py` с платы, пароль Wi-Fi и токен сопряжения **не коммитить**.
- Программные тесты не доказывают работу на реальной плате — см. `HARDWARE_STATUS.md`.
