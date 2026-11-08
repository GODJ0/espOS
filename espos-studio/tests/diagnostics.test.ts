import { expect, test } from "bun:test";
import { diagnose, FlashJournal } from "../packages/web/src/web/lib/flash-diagnostics";

test("classifies common failures without inventing a definite cause", () => {
  expect(diagnose("Failed to connect: timeout", "rom").code).toBe("ROM_CONNECTION");
  expect(diagnose("Failed to open serial port: access denied", "port").code).toBe("PORT_ACCESS");
  expect(diagnose("No port selected by user", "idle").code).toBe("PORT_NOT_SELECTED");
  expect(diagnose("Download failed (502)", "download").code).toBe("DOWNLOAD");
  expect(diagnose("Secure Download Mode", "guard").code).toBe("SECURITY_MODE");
  expect(diagnose("Образ для ESP32-C3, выбран ESP32-S3. Запись запрещена.", "validate").code).toBe("IMAGE_OR_FAMILY");
  expect(diagnose("timeout", "write").code).toBe("USB_CONNECTION");
  expect(diagnose("unusual error", "guard").code).toBe("UNKNOWN");
});
test("session metadata is copied and bounded, reconnect doesn't erase write evidence", () => {
  const meta = { Target: "ESP32-S3", Image: "s3.bin" }; const journal = new FlashJournal(meta);
  meta.Target = "ESP32-C3";
  journal.event({ stage: "write", message: "start" }); journal.event({ stage: "reconnect", message: "lost", warning: true });
  expect(journal.lastOperationStage).toBe("write"); expect(journal.flashMayHaveChanged).toBe(true); expect(journal.writeCompleted).toBe(false);
  journal.append("x".repeat(100000));
  const report = journal.export(); expect(report).toContain("Target: ESP32-S3"); expect(report).toContain("REPL contents: not included"); expect(report.length).toBeLessThan(66000);
});
test("write completion is not a boot claim and ROM probe doesn't mark flash changed", () => {
  const journal = new FlashJournal({});journal.event({stage:"rom",message:"probe"});expect(journal.flashMayHaveChanged).toBe(false);
  journal.event({stage:"write",message:"start"});journal.event({stage:"reset",message:"write complete"});journal.event({stage:"reconnect",message:"lost"});
  expect(journal.writeCompleted).toBe(true);expect(journal.lastOperationStage).toBe("reset");
});