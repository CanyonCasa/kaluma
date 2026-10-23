# Kaluma COMBINED diagnostic (boot delays + io-loop ticks + HardFault)

## Why this one is different
The first io-diag was missing the led-diag boot-phase delays, so it crashed
before USB could enumerate. This version has **all four pieces**:

1. **32 KiB stack** (from fix-rp2040-usb) — so `jerry_init` doesn't overflow
2. **4 slow boot blinks** (from led-diag) — gives USB ~2 s to enumerate
3. **Per-call io-loop ticks** (from io-diag) — 1 slow blink before each of the
   8 calls in `km_io_run`
4. **HardFault reporter** — 6 FAST blinks on crash (distinct from slow ticks)

## What you should see
```
[boot]
  ● 1 slow blink  = km_system_init done (USB up)
  ● 2 slow blinks = km_tty_init + km_io_init done
  ● 3 slow blinks = km_repl_init done
  ● 4 slow blinks = km_runtime_init done (JS engine UP)
[io-loop]
  ● 1 slow blink  = before km_io_update_time
  ● 2 slow blinks = before km_io_timer_run
  ● 3 slow blinks = before km_io_tty_run
  ● 4 slow blinks = before km_io_watch_run
  ● 5 slow blinks = before km_io_uart_run
  ● 6 slow blinks = before km_io_idle_run (JERRY: jerry_run_jobs)
  ● 7 slow blinks = before km_io_handle_closing
  ● 8 slow blinks = before km_custom_infinite_loop
[if crash]
  ✦ 6 FAST blinks = HARDFAULT
```

## How to read it
After the 4 boot blinks, count **how many more slow blinks** you see before
the 6-fast-blink flicker. That number = the io-loop call that is faulting.

- **1** → `km_io_update_time`
- **2** → `km_io_timer_run`
- **3** → `km_io_tty_run` (USB-CDC data path)
- **4** → `km_io_watch_run`
- **5** → `km_io_uart_run`
- **6** → **`km_io_idle_run` → `jerry_run_jobs()` (JS idler — most likely)**
- **7** → `km_io_handle_closing`
- **8** → `km_custom_infinite_loop`

If you see **many** slow blinks (8, 8, 8, ...) and it never faults, the io loop
is running fine and the crash is triggered by something external (your shell
connect, a USB event, etc.). Report how many total slow blinks you see.

## Files
- `io-diag-pico.uf2`    — Pico (RP2040), 32 KiB stack, all 4 pieces
- `io-diag-pico2w.uf2`  — Pico2-w (RP2350), 64 KiB stack, all 4 pieces
