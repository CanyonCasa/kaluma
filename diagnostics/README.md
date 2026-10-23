# Kaluma USB fix — JerryScript stack overflow on RP2040/RP2350

## Diagnosis (confirmed by bisection)
- **no-JS firmware** (`nojs-bisect` branch): USB enumerates, device alive.
- **JS firmware**: no USB, device dead after `stdio_init`.
- => the **JerryScript engine** is the culprit, not hardware/USB.

## Root cause
Kaluma never overrode `PICO_STACK_SIZE`, so it used the pico-sdk default
**`0x800` = 2 KiB** for the main thread. JerryScript 3.0.0's recursive
GC/parser/VM init needs far more, overflows the 2 KiB stack during
`jerry_init`, and hard-faults. Kaluma's default fault handler is a bare
`bkpt` (silent death), so the device dies *before* USB enumeration completes
=> "not recognized."

This is a **shared** default, which is why **both** the RP2040 Pico *and* the
RP2350 Pico2-w fail identically, and why removing JS fixes both.

## The fix
Set a proper main-thread stack in `targets/rp2/target.cmake`:
- RP2040 (Pico): `PICO_STACK_SIZE=0x8000` (32 KiB)
- RP2350 (Pico2): `PICO_STACK_SIZE=0x10000` (64 KiB)

Both still fit in SRAM:
- Pico: 190.7 KiB (heap+bss) + 32 KiB stack ≈ 223 KiB < 264 KiB
- Pico2-w: 231.9 KiB (heap+bss) + 64 KiB stack ≈ 296 KiB < 528 KiB

## Test
Flash `fix-pico-rp2040-stack.uf2` (Pico) / `fix-pico2w-rp2350-stack.uf2`
(Pico2-w) and check that **both the COM port appears AND the REPL welcome
banner shows up** in your serial monitor.
