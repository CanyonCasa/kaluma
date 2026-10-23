# Kaluma IO-loop diagnostic (corrected — with 32 KiB stack)

## Why this one is different from the first io-diag
The first io-diag was built off `master` (2 KiB stack) — it crashed immediately
during `jerry_init`, before the io-loop instrumentation could even run. This
version is built **on top of the 32 KiB stack fix**, matching the `led-diag`
firmware that successfully showed 4 blinks (engine up) before faulting.

## What you should see now (same as led-diag + more detail)
1. **4 slow blinks** (engine init + runtime init)
2. Then the io-loop ticks start: **1 slow blink** (before call 1), then if it
   survives, **2 slow blinks** (before call 2), etc.
3. If a call faults → **6 fast blinks** (HardFault handler).

So count the **slow blinks after the initial 4**:
- 1 slow → fault in `km_io_update_time`
- 2 slow → fault in `km_io_timer_run`
- 3 slow → fault in `km_io_tty_run`
- 4 slow → fault in `km_io_watch_run`
- 5 slow → fault in `km_io_uart_run`
- **6 slow → fault in `km_io_idle_run` (jerry_run_jobs — JS idler)**
- 7 slow → fault in `km_io_handle_closing`
- 8 slow → fault in `km_custom_infinite_loop`

## Files
- `io-diag-pico.uf2`    — Pico (RP2040), 32 KiB stack
- `io-diag-pico2w.uf2`  — Pico2-w (RP2350), 64 KiB stack
