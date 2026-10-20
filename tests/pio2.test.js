// Unit tests for the RP2350 "pio2" (third PIO block) support in the JS layer.
//
// This runs under Node with a stubbed `process.binding("rp2")`, so it needs no
// RP2040/RP2350 hardware or firmware build. It validates the pure-JS logic in
// StateMachine that maps a state-machine id onto a PIO block:
//   - when the chip advertises 3 blocks (RP2350/Pico 2), id 8..11 land on
//     block 2 and reach block 2's instruction memory / IRQ wiring;
//   - when the chip advertises only 2 blocks (RP2040/Pico), block-2 ids are
//     rejected with a clear error so the API never regresses on RP2040.

// --- Stub the native rp2 binding ------------------------------------------
const nativeCalls = { pio_add_program: [] };
const fakeNative = {
  pioNum: 3, // RP2350 by default; each test sets this explicitly.
  pio_add_program(pio, prog) {
    nativeCalls.pio_add_program.push({ pio, len: prog.length });
    return 32 - prog.length;
  },
  pio_sm_init() {},
  pio_sm_set_enabled() {},
  pio_sm_restart() {},
  pio_sm_exec() {},
  pio_sm_put() {},
  pio_sm_get() { return 0; },
  pio_sm_set_pins() {},
  pio_sm_rxfifo() { return 0; },
  pio_sm_txfifo() { return 0; },
  pio_sm_clear_fifos() {},
  pio_sm_drain_txfifo() {},
  pio_sm_irq() {},
  dormant() {},
  randomBigInt() { return 0n; },
};

// rp2.js does: `process.binding(process.binding.rp2)`.
// - `process.binding.rp2` (a property lookup) -> "rp2"
// - `process.binding("rp2")` (a call)          -> fakeNative
const bindingStub = () => fakeNative;
bindingStub.rp2 = "rp2";
process.binding = bindingStub;

const rp2 = require("../src/modules/rp2/rp2.js");
const { ASM, StateMachine } = rp2;

// --- tiny test harness -----------------------------------------------------
let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL - ${name}`);
    console.error(`    ${e && e.message ? e.message : e}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}
function assertThrows(fn, re, msg) {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
    if (re && !re.test(String(e && e.message ? e.message : e))) {
      throw new Error(`${msg || "unexpected error message"}: ${e.message}`);
    }
  }
  if (!threw) throw new Error(msg || "expected an exception but none was thrown");
}

const FULL_POOL = [0, 4, 1, 5, 2, 6, 3, 7, 8, 12, 9, 13, 10, 14, 11, 15];
// The SM id pool is shared mutable state; reset it before each test so the
// tests are independent (mirrors how the board starts with all SMs free).
function resetPool() {
  StateMachine.ids.length = 0;
  StateMachine.ids.push(...FULL_POOL);
}

function blinkAsm() {
  const asm = new ASM();
  asm.wrap_target();
  asm.out("pins", 1);
  asm.nop();
  return asm;
}

console.log("rp2 PIO block-2 (pio2) StateMachine tests");

test("RP2350 (3 blocks): SM id 8 maps to PIO block 2, SM 0", () => {
  resetPool();
  fakeNative.pioNum = 3;
  nativeCalls.pio_add_program.length = 0;
  const sm = new StateMachine(8, blinkAsm());
  assert(sm.pio === 2, `expected PIO block 2, got ${sm.pio}`);
  assert(sm.sm === 0, `expected SM 0, got ${sm.sm}`);
  // The program must have been placed in block 2's instruction memory.
  assert(
    nativeCalls.pio_add_program.some((c) => c.pio === 2),
    "pio_add_program was not called for PIO block 2"
  );
});

// On a 3-block chip the block-2 SMs are ids 8 (sm0), 9 (sm1), 10 (sm2), 11 (sm3)
// because this.pio = floor(id/4) and this.sm = id % 4.
test("RP2350 (3 blocks): SM ids 8-11 map to PIO block 2, sm 0-3", () => {
  resetPool();
  fakeNative.pioNum = 3;
  for (let smNo = 0; smNo < 4; smNo++) {
    const sm = new StateMachine(8 + smNo, blinkAsm());
    assert(sm.pio === 2, `id ${8 + smNo}: expected PIO block 2, got ${sm.pio}`);
    assert(sm.sm === smNo, `id ${8 + smNo}: expected SM ${smNo}, got ${sm.sm}`);
  }
});

test("RP2350 (3 blocks): 12 SMs offered (3 blocks x 4 SMs)", () => {
  resetPool();
  fakeNative.pioNum = 3;
  const offered = FULL_POOL.filter((id) => id < StateMachine.pioNum * 4);
  assert(offered.length === 12, `expected 12 SMs, got ${offered.length}`);
  assert(offered.every((i) => i < 12), "all offered SM ids should be < 12");
  // And the head of the pool is a valid block-0 SM.
  assert(StateMachine.getAvailableId() === 0, "pool head should be SM 0");
});

test("RP2040 (2 blocks): SM id 8 is rejected with a range error", () => {
  resetPool();
  fakeNative.pioNum = 2;
  assertThrows(
    () => new StateMachine(8, blinkAsm()),
    /out of range|2 PIO block/,
    "expected a range error for SM id 8 on a 2-block chip"
  );
});

test("RP2040 (2 blocks): only 8 SMs offered (2 blocks x 4 SMs)", () => {
  resetPool();
  fakeNative.pioNum = 2;
  const offered = FULL_POOL.filter((id) => id < StateMachine.pioNum * 4);
  assert(offered.length === 8, `expected 8 SMs, got ${offered.length}`);
  assert(offered.every((i) => i < 8), "all offered SM ids should be < 8");
});

test("RP2350 (3 blocks): block-2 SM exposes an IRQ handler hook", () => {
  resetPool();
  fakeNative.pioNum = 3;
  const sm = new StateMachine(9, blinkAsm()); // id 9 -> block 2, SM 1
  assert(sm.pio === 2 && sm.sm === 1, "id 9 should map to block 2 / SM 1");
  // Native pio_sm_irq is stubbed; on hardware this enables block-2 IRQ 0.
  sm.irq(() => {});
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
