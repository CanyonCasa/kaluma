// Unit tests for the rp2 PIO ASM / StateMachine JavaScript layer.
//
// This runs under Node with a stubbed `process.binding("rp2")` so it does not
// require the RP2040 hardware or the firmware build. It validates the pure-JS
// logic that was fixed for:
//   - #688  PIO ASM delay() had no bounds checking
//   - #689  PIO ASM assembly had no program size limit checking
//
// The same assertions are intended to also run on the board (Kaluma) where the
// native binding is the real one; the stub below only emulates the tiny subset
// of the native API that StateMachine touches at construction time.

// --- Stub the native rp2 binding -----------------------------------------
const nativeCalls = {
  pio_add_program: [],
  pio_sm_init: [],
};

const fakeNative = {
  rp2: "rp2", // process.binding(process.binding.rp2) -> "rp2"
  pio_add_program(pio, prog) {
    // Emulate pico-sdk: programs are placed at the top of the 32-slot instruction
    // memory, so the offset starts at 32 and is decremented by the length of
    // each program as they are added (this reproduces the #691 symptom on the
    // hardware).
    nativeCalls.pio_add_program.push({ pio, len: prog.length });
    return 32 - prog.length;
  },
  pio_sm_init() {
    nativeCalls.pio_sm_init.push(arguments);
  },
  pio_sm_set_enabled() {},
  pio_sm_restart() {},
  pio_sm_exec() {},
  pio_sm_put() {},
  pio_sm_get() {
    return 0;
  },
  pio_sm_set_pins() {},
  pio_sm_rxfifo() {
    return 0;
  },
  pio_sm_txfifo() {
    return 0;
  },
  pio_sm_clear_fifos() {},
  pio_sm_drain_txfifo() {},
  pio_sm_irq() {},
  dormant() {},
  randomBigInt() {
    return 0n;
  },
};

// rp2.js does: `process.binding(process.binding.rp2)`.
// - `process.binding.rp2` (a property lookup) -> "rp2"
// - `process.binding("rp2")` (a call)          -> fakeNative
// We satisfy both with a single function object that carries the `.rp2` prop.
const bindingStub = () => fakeNative;
bindingStub.rp2 = "rp2";
process.binding = bindingStub;

const rp2 = require("../src/modules/rp2/rp2.js");

// --- tiny test harness ----------------------------------------------------
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
    console.error(`    ${e && e.stack ? e.stack : e}`);
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
  if (!threw) throw new Error(msg || "expected an error to be thrown");
}
const { ASM, StateMachine } = rp2;

console.log("rp2 PIO ASM / StateMachine tests");

// Note: ASM.delay(val) applies the delay to the *last* instruction pushed so
// far (it modifies this.code[this.code.length - 1] in place); it does not add
// a new instruction. The tests below therefore check the encoded word, not the
// instruction count.
function asmWithSideset(opts) {
  const asm = new ASM(opts || {});
  asm.set("pins", 1);
  return asm;
}

test("delay(): valid 0..31 accepted without sideset", () => {
  const asm = asmWithSideset();
  asm.delay(0);
  asm.set("pins", 1); // fresh last instruction
  asm.delay(31);
  // 31 << 8 = 0x1F00 must be present in the last instruction.
  assert((asm.code[asm.code.length - 1] & 0x1f00) === 0x1f00,
    "31-00 delay bits set");
});

test("delay(): out-of-range value throws (no sideset)", () => {
  const asm = asmWithSideset();
  assertThrows(() => asm.delay(32), /delay\(32\)/, "32 exceeds max 31");
  assertThrows(() => asm.delay(-1), /delay\(-1\)/, "negative rejected");
  assertThrows(() => asm.delay(1.5), /delay\(1\.5\)/, "fraction rejected");
});

test("delay(): value that collides with sideset bit is rejected", () => {
  // sideset=2 leaves 3 delay bits (max 7). delay=8 sets bit 8+3=11, which is
  // part of the 2-bit sideset value field — must be rejected.
  const asm = asmWithSideset({ sideset: 2 });
  assertThrows(() => asm.delay(8), /delay\(8\)/, "8 exceeds max 7 for sideset=2");
});

test("delay(): boundary values accepted at the sideset-limited max", () => {
  const asm = asmWithSideset({ sideset: 2 });
  asm.delay(7); // max for 3 delay bits
  assert((asm.code[asm.code.length - 1] & 0x0700) === 0x0700,
    "7 = 0b0111<<8 present");
});

test("delay(): optional sideset leaves one fewer delay bit", () => {
  // sideset=1 opt: value field uses bit 12 (opt) + bit 13 (1 value bit) => 2
  // bits, leaving 3 delay bits (max 7).
  const asm = asmWithSideset({ sideset: 1, sidesetOpt: true });
  assertThrows(() => asm.delay(8), /delay\(8\)/, "8 exceeds max 7 for opt sideset=1");
  asm.delay(7);
  assert((asm.code[asm.code.length - 1] & 0x0700) === 0x0700, "7 accepted");
});

test("delay(): sideset=5 leaves zero delay bits (max 0)", () => {
  const asm = asmWithSideset({ sideset: 5 });
  assertThrows(() => asm.delay(1), /delay\(1\)/, "any non-zero rejected at sideset=5");
  asm.delay(0); // 0 is always valid
});

// --- #689: program size limit checking ------------------------------------
test("check(): program exceeding 32 instructions is rejected", () => {
  const asm = new ASM();
  // 32 nop() instructions is fine (at the limit).
  for (let i = 0; i < 32; i++) asm.nop();
  assert(asm.code.length === 32, "32 instructions accepted at the limit");
  // The 33rd must throw.
  assertThrows(
    () => asm.nop(),
    /Program too long/,
    "33rd instruction rejected"
  );
});

test("check(): a valid program still builds a working state machine", () => {
  // Build a small program (the pattern from issue #691) and confirm it
  // constructs a StateMachine with the expected offset/length.
  const asm = new ASM();
  asm.set("pindirs", 1);
  asm.label("again");
  asm.set("pins", 1).delay(2);
  asm.set("pins", 0).delay(1);
  asm.jmp("again");

  const sm = new StateMachine(
    StateMachine.getAvailableId(),
    asm,
    { freq: 5000000, setBase: 0 }
  );
  assert(sm.offset >= 0, "offset non-negative");
  assert(sm.length === 4, "program length is 4");
  assert(typeof sm.active === "function", "active() present");
});

test("toBinary()/toInst() still produce a Uint16Array", () => {
  const asm = new ASM();
  asm.set("pins", 1).delay(1);
  const bin = asm.toBinary();
  assert(bin instanceof Uint16Array, "toBinary returns Uint16Array");
  assert(bin.length === 1, "single instruction");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
