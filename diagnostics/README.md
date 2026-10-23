# Kaluma LED + HardFault diagnostic (corrected)

This runs the REAL Kaluma boot path (incl. JS engine) with a **visible,
countable ~500 ms LED blink per phase** and a **HardFault reporter** (overrides
pico-sdk's silent `bkpt`). Fixes the earlier bugs:
- `km_gpio_init()` re-inits pin 25 to input (was silently killing our LED) →
  we now re-claim it after `km_system_init()`.
- blinks were ~24 ms (a flicker) → now a real `sleep_ms(500)` each.

## Read the Pico (LED = GPIO 25)
Flash, reset, then count the visible blinks BEFORE it freezes:

| Blinks before freeze | Where it dies |
|---|---|
| 0 (never blinks) | crash in `km_system_init` (but no-JS proved this phase is OK) |
| 1, then freeze | `km_tty_init` / `km_io_init` |
| 2, then freeze | `km_repl_init` |
| 3, then freeze | `km_runtime_init` → **`jerry_init` or `km_global_init`** (PRIME SUSPECT) |
| 4, then freeze | `km_io_run` / io loop |
| **6 FAST blinks, repeating** | **HARDFAULT** fired (PC/LR also printed if the port ever enumerates) |

"Freeze" (LED solid on, or stops) = hang. "6 fast blinks" = hard fault.
This distinguishes a **crash (where)** from a **hang (where)** — the data we
need to pick the real fix, since the 32 KiB stack bump alone did not fix it.

## Files
- `led-diag-pico.uf2`    — Pico (RP2040)
- `led-diag-pico2w.uf2`  — Pico2-w (RP2350)

## After you report the count
- **3 slow blinks then frozen** (no 6-short pattern) → it's **hanging** inside
  `jerry_init` / `km_global_init` → most likely the 3.0.0 GC loop (Kaluma already
  patched a Pico "system hang" in `ecma_finalize` GC). Next: I add a tick inside
  `km_runtime_init` (before/after `jerry_init`, before/after `km_global_init`,
  before/after `jerry_heap_gc`) to split it.
- **6 short blinks** → it's a **hard-fault** → read the PC/LR from serial (or I
  add a tick just before `jerry_init`) to name the exact function.
