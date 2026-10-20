/**
 * PIO test program (on-board)
 * ===========================
 *
 * Self-verifying PIO smoke test for the Kaluma runtime.
 *
 * What it does:
 *   1. Loads the rp2 module and reads the reported PIO block count (rp2.pioNum):
 *        - 3 on the Pico 2 (RP2350)  -> tests PIO block 2 (the NEW code path
 *          added by this fork: pio2 in module_rp2.c, system.c, rp2.js)
 *        - 2 on the Pico  (RP2040)  -> tests PIO block 0 (same API, no block 2)
 *   2. Builds a tiny PIO program that, on each instruction:
 *        a. OUT pins,1    : pops 1 bit from the SM OUT FIFO and drives the
 *           on-board LED (pin 25);
 *        b. IRQ nowait,0  : fires the block's PIO IRQ 0 (verified by a JS
 *           IRQ handler — proves the per-block IRQ dispatch path, including
 *           block 2 on the RP2350).
 *   3. Puts values into the OUT FIFO, lets the hardware SM act, and checks
 *      digitalRead(25) and the IRQ-handler flag.
 *   4. Prints a PASS/FAIL summary.  No network, no extra hardware needed.
 *
 * How to run:
 *   - Save this file to the board's flash FS (partition C) as /pio-test.js,
 *     then in the Kaluma REPL:   .load /pio-test.js
 *   - ...or just paste it straight into the REPL.
 *
 * Example output on a Pico 2 (RP2350):
 *   rp2 PIO smoke test
 *     pioNum = 3  (testing PIO block 2 - the new RP2350 path)
 *     [ok]   SM drove LED HIGH
 *     [ok]   SM drove LED LOW
 *     [ok]   block-2 IRQ 0 fired
 *   PASS: 3/3 PIO checks
 *
 * Any failure prints the failing check and the observed value.
 */

"use strict";

const rp2 = require('rp2');
const ASM = rp2.ASM;
const StateMachine = rp2.StateMachine;

const LED_PIN = 25; // on-board LED on both Pico (RP2040) and Pico 2 (RP2350)

let passed = 0;
let failed = 0;

function check(name, cond, detail) {
  if (cond) {
    passed++;
    print("  [ok]   " + name);
  } else {
    failed++;
    print("  [FAIL] " + name + (detail ? "  (" + detail + ")" : ""));
  }
}

// The SM runs in hardware at the system clock (tens of MHz), so it reacts in
// nanoseconds - far faster than any JS work. A bounded busy-loop is the
// portable way to give it (and the async IRQ handler) a moment to act; it does
// not require any timer or Date API.
function settle() {
  let n = 0;
  while (n++ < 200000) {}
}

print("rp2 PIO smoke test");

// --- 1. Discover how many PIO blocks this chip actually has -----------------
const pioNum = rp2.pioNum;
if (typeof pioNum !== "number" || pioNum < 2) {
  print("  [FAIL] rp2.pioNum is " + pioNum + " (expected 2 or 3)");
  return;
}

// Use the highest block so we actually exercise the RP2350 block-2 path when
// we're on a Pico 2; on a Pico fall back to block 0.
const testBlock = (pioNum >= 3) ? 2 : 0;
const testSm = 0;                        // first SM on that block
const testId = testBlock * 4 + testSm;   // JS maps: pio = floor(id/4), sm = id%4

print("  pioNum = " + pioNum + "  (testing PIO block " + testBlock +
      (testBlock === 2 ? " - the new RP2350 path" : ""));

// --- 2. Build a tiny PIO program -------------------------------------------
//   0: OUT pins, 1      pop 1 bit from OUT FIFO -> drive the LED
//   1: IRQ nowait, 0    fire this block's PIO IRQ 0 (no wait)
//   2: NOP              keep running (harmless)
const asm = new ASM();
asm.wrap_target();
asm.out("pins", 1);
asm.irq("nowait", 0);
asm.nop();

// --- 3. Register an IRQ handler (flags when this block's IRQ 0 fires) ------
let irqSeen = false;
function irqHandler() {
  irqSeen = true;
}

// --- 4. Configure + start the SM -------------------------------------------
// outBase/outCount route `OUT pins,1` to the LED; outSticky latches the last
// value on the pin so it stays readable after the SM is stopped.
const sm = new StateMachine(testId, asm, {
  outBase: LED_PIN,
  outCount: 1,
  outSticky: true,
});
sm.irq(irqHandler);

pinMode(LED_PIN, OUTPUT);
digitalWrite(LED_PIN, LOW); // known start state

// --- 5. Drive the LED through the SM and verify the pin state --------------
sm.put(1);        // queue a HIGH
sm.active(true);  // start the SM; it pops the FIFO and drives the pin HIGH
settle();
check("SM drove LED HIGH", digitalRead(LED_PIN) === 1,
      "digitalRead(" + LED_PIN + ")=" + digitalRead(LED_PIN));

sm.put(0);        // queue a LOW
settle();
check("SM drove LED LOW", digitalRead(LED_PIN) === 0,
      "digitalRead(" + LED_PIN + ")=" + digitalRead(LED_PIN));

// --- 6. Verify the IRQ path fired for this block ---------------------------
settle();
check("block-" + testBlock + " IRQ 0 fired", irqSeen === true,
      "IRQ handler did not run");

// --- 7. Cleanup ------------------------------------------------------------
sm.active(false);
digitalWrite(LED_PIN, LOW);

// --- 8. Summary ------------------------------------------------------------
if (failed === 0) {
  print("PASS: " + passed + "/" + passed + " PIO checks");
} else {
  print("FAIL: " + failed + " of " + (passed + failed) + " PIO checks");
}
