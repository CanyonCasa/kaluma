# Kaluma Boot-Path Diagnostic Firmwares

## Root-cause context

Kaluma v1.3.0+ (upstream) **deliberately disabled the Pico (RP2040) build**:

> Commit `413f3f4`: *"Kaluma v1.3.0-beta.1 — Jerryscript v3.0.0 — Disable
> pico, pico-w build. This version does not support RP2040 boards."*

The JerryScript 2.x → 3.0.0 upgrade appears to have broken RP2040.
Our v1.5.0 fork re-enabled the Pico build (commit `14debf8`) **without
knowing why it was disabled**, and the build succeeded — but was **never
tested on real hardware** (upstream had never validated it).

## What these firmwares do

They are **identical to the normal Kaluma v1.5.0 firmware**, except each
boot-phase boundary toggles the onboard LED (GPIO 25 on Pico) and prints
a serial marker. A HardFault handler is also wired in: if any init call
crashes, it reports the fault PC/LR over serial AND blinks the LED
rapidly (6 fast ticks) before halting.

### Boot-phase markers

| Marker | After …
|--------|---------
| A      | `main()` entry, LED configured
| B1     | `stdio_init_all()` (USB stack up)
| B2     | `km_uid_init()`
| B3     | `km_pio_init()`
| B4     | `km_gpio_init()` (re-inits all 30 pins — incl. 16/17)
| B5     | `km_adc_init()`
| B6     | `km_pwm_init()`
| B7     | `km_i2c_init()`
| B8     | `km_spi_init()`
| B9     | `km_uart_init()`
| B10    | `km_rtc_init()`
| B11    | `km_flash_init()` (system_init complete)
| C      | `km_running_script_check()`
| D      | `km_tty_init()`
| E      | `km_io_init()`
| F      | `km_repl_init()`
| G1     | *before* `jerry_init()` — **PRIME SUSPECT** (JS engine start)
| G2     | *after*  `jerry_init()` — JS engine up
| G3-G7  | rest of `km_runtime_init()`
| H      | `km_io_run()` — IO loop starts (USB polling active)

## How to use

### On Pico (RP2040) — LED = GPIO 25 (board LED)

1. Hold BOOTSEL, plug USB, drag-and-drop `instr-pico-boot-diag.uf2`
2. Unplug/replug USB (device resets, firmware runs)
3. **Watch the onboard LED:**
   - Ticks in sequence A→B1→B2→…→G7→H = all init phases completed
   - **LED stops at X → the call right after X crashed** (hang or hard-fault)
   - **6 rapid LED blinks = HARDFAULT** (handler fired, serial has PC/LR)
   - No USB port appears + no LED motion after the last tick → that init
     call killed the device (likely hard-fault in the call after the
     last-ticked marker)
4. For PC/LR values, also open a serial monitor (if port appeared):
   - `screen /dev/ttyACM0 115200` (or use PuTTY/Arduino IDE serial)

### On Pico2-w (RP2350)

The Pico2-w LED is on the CYW43 WiFi chip (not a GPIO). You'll see the
serial markers but no LED. For visual feedback you can wire an external
LED to GPIO 25 and GND.

## Download (from the `boot-diag` branch on GitHub)

- Pico (RP2040):
  `https://github.com/CanyonCasa/kaluma/raw/boot-diag/diagnostics/instr-pico-boot-diag.uf2`
- Pico2-w (RP2350):
  `https://github.com/CanyonCasa/kaluma/raw/boot-diag/diagnostics/instr-pico2w-boot-diag.uf2`

## Interpreting results

| Observation                              | Likely cause
|------------------------------------------|---------------
| Dies after G1 (before G2)                | `jerry_init()` hard-faults → JS engine broken on RP2040 (upstream's own diagnosis)
| Dies after B4 (gpio)                     | `km_gpio_init()` re-inits pins 16/17 → USB broken
| Ticks all the way to H but no USB port   | USB polling isn't running → different issue (check `km_io_run`)
| Rapid 6-blink HARDFAULT pattern          | HardFault handler fired, check serial for PC/LR
