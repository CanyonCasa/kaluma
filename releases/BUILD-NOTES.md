# Kaluma RP2040 (Pico) firmware — v1.2.5

Build notes, pedigree, and the fixes included in these firmware files.

| File | Board | Size | SHA-256 |
|---|---|---|---|
| `kaluma-rp2-pico-1.2.5.uf2` | Raspberry Pi Pico (RP2040) | ~1.05 MB | `dd45d5b8ffee7840212020b2e757f28502c7ac5808d1e90a3c241b145c8bae8c` |
| `kaluma-rp2-pico-w-1.2.5.uf2` | Raspberry Pi Pico W (RP2040 + CYW43) | ~1.67 MB | `cf84e0ff5a7607d5d8b5ba57306dbad0c75f36f1668abfb715b427aba9c6064c` |

Flash by holding `BOOTSEL` while plugging in USB and dropping the `.uf2` onto the
`RP2040` mass-storage volume that appears.

---

## 1. Why this version (the pedigree)

Upstream `kaluma-project/kaluma` has moved to **v1.5.0** (a 2025-era release), but
v1.5.0 is **unusable on the Pico**: it pins **JerryScript 3.0.0**, and the upstream
JerryScript project **explicitly disabled RP2040 support** in 3.0.0 (JerryScript
commit `413f3f4`). In practice the v1.5.0 Pico firmware hangs at the REPL on real
hardware. The upstream project has little/no activity and no fix is in flight.

This build is therefore based on the **v1.2.1 release** (the last v1.2.x, which
pins **JerryScript 2.4.0** — the version that *does* build for RP2040) rather than
v1.5.0. The v1.2.1 Pico firmware was confirmed to boot, enumerate over USB, and run
the REPL on real Pico hardware **before** the fixes below were added.

### Submodule pins (as shipped in upstream v1.2.1 — unmodified by this branch)

| Submodule | Pinned commit | Version |
|---|---|---|
| `lib/jerryscript` | `984c39f` | JerryScript 2.4.0 (with the Pico/RP2 toolchain support) |
| `lib/pico-sdk` | `95ea6ac` | pico-sdk 1.x (used by `pico`) |
| `lib/pico-sdk-2.0.0` | `efe2103` | pico-sdk 2.0.0 (used by `pico-w`) |
| `lib/littlefs` | `ead5080` | littlefs (flash filesystem) |

The `pico-w` build additionally needs pico-sdk 2.0.0's nested submodules
(`cyw43-driver`, `tinyusb`, `lwip`, `mbedtls`, `btstack`) initialised — these are
submodules *of* a submodule and are not present in a shallow clone:

```sh
git -C lib/pico-sdk-2.0.0 submodule update --init --recursive
```

---

## 2. The three PIO / REPL fixes (the reason for v1.2.5)

These are the fixes from the community branch `fix/pio-and-repl-issues`
(commits `361f9a0`, `eb6a0ba`, `6b980f3`), which targeted the v1.5.0 base. Because
v1.5.0 is not buildable on the Pico, they were **ported onto the v1.2.1 /
JerryScript 2.4.0 base**. The v1.2.1 source files are not byte-identical to the
v1.5.0 base, so the fixes were applied surgically (manual port, not a copy). All
three were verified on Pico hardware.

### 2.1 PIO state machines no longer leak between programs — `targets/rp2/src/system.c`
Added `km_pio_cleanup()`, called from `km_system_cleanup()` (which runs on every
program end: `.load`, `.reset`, CTRL+D, and program termination). It stops and
releases every PIO state machine and clears the PIO instruction memory.

**Why it was needed:** previously, state machines created by a program kept
running after the program ended, and the PIO instruction memory was never
reclaimed. Repeatedly `.load`-ing a program that uses PIO would keep being
assigned a lower and lower instruction offset until it failed, and stray state
machines would keep toggling pins. (Upstream issues #690, #691.)

### 2.2 `ASM.delay()` bounds + 32-instruction program limit — `src/modules/rp2/rp2.js`
* `delay(val)` now validates that `val` is a non-negative integer within the
  hardware range and throws a `RangeError` otherwise. The maximum is derived from
  the PIO instruction layout (shared 5-bit delay/sideset field, bits 8–12),
  matching pico-sdk's `pio_encode_delay` / `pio_encode_sideset`:
  `5 - sideset` bits normally, `4 - sideset` bits when sideset is optional.
* A new `check()` method enforces the **32-instruction per-PIO program limit** and
  is called at the end of every instruction so a program cannot silently exceed
  hardware capacity. (Upstream issues #688, #689.)

### 2.3 Idempotent REPL command registration + CTRL+Z docs — `src/repl.c`
`km_repl_register_command()` now skips a command whose name is already registered,
so modules that re-register on each program run (e.g. `fs` → `.ls`, `.cd`) no
longer cause **duplicate lines in `.help`**. The REPL help also documents
`CTRL+Z` (exit shell). (Upstream issue #686.)

---

## 3. Build-system fixes required for a modern host toolchain

Kaluma v1.2.1 (and its 2019-era submodules) predate the host compiler here. Three
build-system issues surfaced and were fixed so the firmware builds at all. The two
in submodules are provided as **patch files** (in `releases/patches/`) so this
branch's submodule pins stay clean at the original v1.2.1 commits; the one in the
main repo is committed directly.

1. **JerryScript 2.4.0 `-Werror` under GCC 15** — the 2.4.0 build treats new
   *false-positive* warnings as errors. Fixed by relaxing the warning set
   (`-Wno-maybe-uninitialized -Wno-unterminated-string-initialization -Wno-error`).
   → `releases/patches/jerryscript-2.4.0-cmake-warnings.patch`
2. **pico-sdk / pico-sdk-2.0.0 pioasm: `uint8_t` does not name a type** — the
   pioasm headers use fixed-width types without including `<cstdint>`; modern GCC
   no longer supplies them transitively. Fixed by adding `#include <cstdint>`.
   → `releases/patches/pico-sdk-pioasm-cstdint.patch`
   → `releases/patches/pico-sdk-2.0.0-pioasm-cstdint.patch`
3. **`tools/kaluma.cmake` compile-flag quoting** — the Jerry compile flags were
   passed as one quoted string; split into separate `--compile-flag` arguments so
   each `-D`/`-Wno-*` is applied individually. (Committed in the main repo.)

### Reproducing the submodule fixes
```sh
cd lib/jerryscript        && git apply ../../releases/patches/jerryscript-2.4.0-cmake-warnings.patch
cd ../pico-sdk            && git apply ../../releases/patches/pico-sdk-pioasm-cstdint.patch
cd ../pico-sdk-2.0.0      && git apply ../../releases/patches/pico-sdk-2.0.0-pioasm-cstdint.patch
```

---

## 4. Build recipe

### Toolchain used
| Component | Version |
|---|---|
| Host | Ubuntu (aarch64), GCC **15.2.0** |
| `arm-none-eabi-gcc` (cross) | **14.2.1** (ARM Embedded toolchain 14.2.rel1) |
| CMake | 3.28.6 |
| Node.js (build scripts) | v24.22.1 |
| Python (JerryScript build) | 3.14.4 |

### Steps
```sh
# 1. Checkout this branch; initialise the pinned submodules:
git submodule update --init --recursive

# 2. Apply the submodule build fixes (see section 3), or use a pre-patched tree.

# 3. Build the Pico (RP2040) firmware:
rm -rf build lib/jerryscript/build src/gen
node build.js --board pico

# 4. Build the Pico W (RP2040 + CYW43) firmware:
#    (needs pico-sdk-2.0.0 nested submodules, see section 1)
rm -rf build lib/jerryscript/build src/gen
node build.js --board pico-w
```

The version string is `CMakeLists.txt` → `set(VER "1.2.5")`, which drives both the
output filename (`kaluma-rp2-<board>-1.2.5`) and the `KALUMA_VERSION` constant in
`src/gen/kaluma_config.h`.

> Note: `pico` and `pico-w` must be built in separate clean build trees (a
> `CMakeCache` / `PICO_PLATFORM` conflict otherwise aborts a combined build).

---

## 5. Verification

* **rp2.js logic** — the `ASM` class was unit-tested (Node, native binding
  stubbed): `_maxDelay()` matches pico-sdk's delay/sideset bit layout for all
  sideset counts; `delay()` accepts valid values and throws `RangeError` at the
  boundary (including non-integers and negatives); the 33rd instruction throws
  `Program too long`; method chaining is preserved. **26/26 assertions passed.**
* **C fixes in the ELF** — `km_pio_cleanup()` is inlined into
  `km_system_cleanup` (disassembly shows `pio_sm_unclaim` ×2 and
  `pio_clear_instruction_memory` ×2); the `CTRL+Z` help string is present; the
  rp2.js snapshot grew from 6166 → 6570 bytes (the added code).
* **Hardware** — the v1.2.1 base (before fixes) booted and ran the REPL on a real
  Pico; the three fixes were then confirmed on hardware by the maintainer.
