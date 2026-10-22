# USB enumeration diagnostic firmware

Minimal USB-CDC + LED-blink firmware (NO Kaluma JS, NO PIO) built with the
exact same pico-sdk 2.1.0 + GCC 14.2 as the Kaluma v1.5.0 release. Used to
isolate whether the "device not recognized after flash" problem is in Kaluma's
boot path vs. the SDK/toolchain/build.

## Flash
1. Hold BOOTSEL + plug in USB (board appears as RPI-RP2 removable disk).
2. Copy the matching .uf2 onto that disk.
3. Watch for: LED (GPIO 25) blinking ~1 Hz, and a USB serial (CDC) port
   printing `USB-TEST: alive` every ~0.5 s.

- usbtest-pico.uf2   -> Raspberry Pi Pico (RP2040)
- usbtest-pico2w.uf2  -> Raspberry Pi Pico 2 W (RP2350)
