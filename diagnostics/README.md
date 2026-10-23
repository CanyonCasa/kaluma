# Kaluma "no-JS" bisection firmware

Runs Kaluma's **real** hardware init + USB (stdio_init_all, km_gpio_init, all
peripherals, TTY) **without starting the JerryScript engine** (`jerry_init` is
not called; it's dead-code-eliminated from the image entirely).

## The test (no blink-counting needed)

Flash it, reset, and answer one question:

- **A COM/serial port APPEARS** → hardware + USB path is fine → the
  **JerryScript engine is the culprit**. Next: pin JerryScript 2.x for RP2040
  or fix the 3.0.0 init that faults on M0+.
- **NO port appears** → the bug is in the hardware/USB init path (not JS).
  Then use the `boot-diag` branch's per-phase LED ticks to localize it.

The onboard LED (GPIO 25 on Pico) blinks a slow ~500 ms heartbeat while the
io loop runs, so you can tell "still alive" from "froze in init".

## Files
- `nojs-pico-bisect.uf2`    — Pico (RP2040)
- `nojs-pico2w-bisect.uf2`  — Pico2-w (RP2350)
