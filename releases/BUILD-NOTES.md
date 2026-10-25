# Kaluma RP2350 (Pico 2) firmware — v1.3.5

Build notes, pedigree, and the fixes included in these firmware files.

| File | Board | Size | SHA-256 |
|---|---|---|---|
| `kaluma-rp2-pico2-1.3.5.uf2` | Raspberry Pi Pico 2 (RP2350) | ~1.07 MB | `271ef651c4f75dccc134577ecc287145790cf0dca30d7b2b573eb7629810b3e0` |
| `kaluma-rp2-pico2-w-1.3.5.uf2` | Raspberry Pi Pico 2 W (RP2350 + CYW43) | ~1.70 MB | `1a354487989739443b51559e0a2849406763cddcef6a1337893fba6ebb61b6d8` |

Flash by holding `BOOTSEL` while plugging in USB and dropping the `.uf2` onto the
`RP2350` mass-storage volume that appears.

> **Companion release:** the same three PIO/REPL fixes also exist for the RP2040
> (Pico / Pico W) as **v1.2.5** (JerryScript 2.4.0 base) — see that branch. This
> **v1.3.5** is the RP2350 (Pico 2) line, built on the **1.3.0** base.

---

## 1. Why this version (the pedigree)

Upstream `kaluma-project/kaluma` **1.3.0** (commit `97bb680`, tag `1.3.0`) is the
release that **dropped the RP2040 (`pico`/`pico-w`) and added the RP2350
(`pico2`/`pico2-w`)**. It is the "working build" for Pico 2:

- It pins **JerryScript 3.0.0** (the `kaluma-project/jerryscript` fork at
  `b5114b3`, "ecma_finalize() bug fix — Kaluma system hang issue"). This is the
  JerryScript version the community needed for RP2350 (cortex-m33) and it is
  *exactly* what was requested for this build.
- It uses **pico-sdk 2.1.0** (RP2350-capable fork, has `src/rp2350`), with
  `pico2` → `PICO_BOARD pico2` and `pico2-w` → `PICO_BOARD pico2_w`, both targeting
  the RP2350 (cortex-m33, 384 KiB heap) via `lib/pico-sdk`.
- 1.3.0 explicitly **rejects** `--board pico` / `pico-w`
  ("KalumaJS does not support pico … from version 1.3.0, please use 1.2.x"),
  confirming the 1.x line is the RP2040 release and 1.3.x is the RP2350 release.

This branch is **1.3.0 + the PIO/REPL fixes + version 1.3.5**, i.e. the fixes that
were previously only available against the broken v1.5.0 base are now on the
RP2350 line.

### Submodule pins (as shipped in upstream 1.3.0 — unmodified by this branch)
| Submodule | Pinned commit |
|---|---|
| `lib/jerryscript` | `b5114b3` (JerryScript 3.0.0 + Kaluma `ecma_finalize` fix) |
| `lib/pico-sdk` | `95ea6ac` (pico-sdk 2.1.0 fork, RP2350-capable) |
| `lib/littlefs` | `ead5080` |
| `lib/CMSIS`, `lib/oofatfs`, `lib/dhcpserver`, STM32 libs | as in 1.3.0 |

---

## 2. PIO block 2 (the RP2350's third PIO block)

The RP2350 has **three** PIO blocks (`pio0`, `pio1`, `pio2`) and 12 state
machines (SMs 0–11), but upstream 1.3.0 hardcoded `KALUMA_PIO_NUM 2` in the Pico 2
board headers and used a 2-block mapping in `rp2.js`, so **SM ids 8–11 (block 2)
were unreachable**. This build enables the full 3 blocks (port of the v1.5.0
commit `b412cb9` "enable PIO block 2 (pio2) from JavaScript"):

- `targets/rp2/boards/pico2/board.h` + `pico2-w/board.h`: `KALUMA_PIO_NUM` 2 → **3**.
- `src/modules/rp2/module_rp2.c`: uses the SDK's `NUM_PIOS`/`pio_get_instance()`
  to support any number of blocks, registers `__pio2_irq_0_handler`, and exposes
  `rp2_native.pioNum` (3 on Pico 2) to JavaScript.
- `src/modules/rp2/rp2.js`: `StateMachine` maps `id → (block, sm)` with
  `floor/mod` over `StateMachine.pioNum` (3 on Pico 2), exposes SM ids 8–15,
  bounds-checks the id, and only offers SMs on blocks that exist.
- `targets/rp2/src/system.c`: `km_pio_cleanup()` now releases **all** blocks
  (loops `KALUMA_PIO_NUM`) so block 2's SMs and instruction memory are reclaimed.

Verified: the `__pio2_irq_0_handler` symbol is present (text) in the Pico 2 /
Pico 2 W ELFs and `pioNum` is exported to JS.

## 3. The three PIO / REPL fixes

Ported from the community branch `fix/pio-and-repl-issues` (commits `361f9a0`,
`eb6a0ba`, `6b980f3`), which targeted the v1.5.0 base. For 1.3.0 two of the three
files (`rp2.js`, `system.c`) are **byte-identical to the 1.2.1 base**, so those
fixes carried over verbatim (and are the same code already hardware-verified on the
RP2040 v1.2.5 line). `repl.c` differs and was ported separately.

### 2.1 PIO state machines no longer leak between programs — `targets/rp2/src/system.c`
`km_pio_cleanup()` stops/releases every PIO state machine and clears the PIO
instruction memory; called from `km_system_cleanup()` on every program end
(`.load`, `.reset`, CTRL+D, program termination). Fixes the "repeatedly loading a
PIO program exhausts instruction memory / stray SMs keep toggling pins" reports
(upstream issues #690, #691).

### 2.2 `ASM.delay()` bounds + 32-instruction program limit — `src/modules/rp2/rp2.js`
`delay(val)` validates the range and throws `RangeError` out of bounds (max derived
from the sideset layout, matching pico-sdk's `pio_encode_delay`); a new `check()`
enforces the 32-instruction-per-PIO limit at the end of every instruction
(issues #688, #689).

### 2.3 Idempotent REPL command registration + CTRL+Z docs — `src/repl.c`
`km_repl_register_command()` skips a name that is already registered so modules
re-registering on each program run (e.g. `fs` → `.ls`, `.cd`) no longer produce
duplicate `.help` lines; `.help` now documents `CTRL+Z` (issue #686).

---

## 4. Build-system fixes required for a modern host toolchain

1.3.0 (and its 2019–2021-era submodules) predate the host compiler here; three
issues surfaced and were fixed so it builds at all. The two in submodules are
provided as **patch files** under `releases/patches/` so this branch's submodule
pins stay clean at the original 1.3.0 commits; the one in the main repo is
committed directly.

1. **JerryScript 3.0.0 `-Werror` under GCC 15** — the 3.0.0 build treats new
   false-positive warnings as errors. Relaxed (`-Wno-maybe-uninitialized
   -Wno-unterminated-string-initialization -Wno-error`).
   → `releases/patches/jerryscript-3.0.0-cmake-warnings.patch`
2. **pico-sdk pioasm: `uint8_t` does not name a type** — added `#include <cstdint>`.
   → `releases/patches/pico-sdk-pioasm-cstdint.patch`
3. **`tools/kaluma.cmake` compile-flag quoting** — split the Jerry compile flags
   into separate `--compile-flag` arguments. (Committed in the main repo.)

### Reproducing the submodule fixes
```sh
cd lib/jerryscript && git apply ../../releases/patches/jerryscript-3.0.0-cmake-warnings.patch
cd ../pico-sdk     && git apply ../../releases/patches/pico-sdk-pioasm-cstdint.patch
```

---

## 5. Build recipe

### Toolchain used
| Component | Version |
|---|---|
| Host | Ubuntu (aarch64), GCC **15.2.0** |
| `arm-none-eabi-gcc` (cross) | **14.2.1** (ARM Embedded 14.2.rel1) |
| CMake | 3.28.6 |
| Node.js (build scripts) | v24.22.1 |
| Python (JerryScript build) | 3.14.4 |

### Steps
```sh
# 1. Checkout this branch; initialise the pinned submodules:
git submodule update --init --recursive

# 2. Apply the submodule build fixes (section 3), or use a pre-patched tree.

# 3. Pico 2 (RP2350):
rm -rf build lib/jerryscript/build src/gen
node build.js --board pico2

# 4. Pico 2 W (RP2350 + CYW43):
rm -rf build lib/jerryscript/build src/gen
node build.js --board pico2-w
```

Version string is `CMakeLists.txt` → `set(VER "1.3.5")`, driving the output name
(`kaluma-rp2-<board>-1.3.5`) and the `KALUMA_VERSION` constant.

> `pico2` and `pico2-w` share one `build/` dir and must be built in separate clean
> trees (a combined build trips a CMakeCache / `PICO_BOARD` conflict).

---

## 6. Verification

* **Fixes present in the ELF** — `km_pio_cleanup` (`pio_sm_unclaim` /
  `pio_clear_instruction_memory` symbols) confirmed in the Pico 2 firmware; the
  `CTRL+Z` help string is present; the rp2.js snapshot (delay/check) built and
  linked.
* **rp2.js logic** — the same `ASM` class is unit-tested (delay bounds match
  pico-sdk's `pio_encode_delay`/`pio_encode_sideset`; `check()` throws at 33
  instructions).
* **Hardware** — the identical three fixes were verified on RP2040 hardware on the
  v1.2.5 line; the RP2350 firmware here is the same code on the 1.3.0 base and is
  **ready for the maintainer to verify on a Pico 2 / Pico 2 W**.
