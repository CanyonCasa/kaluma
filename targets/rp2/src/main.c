/* BISECTION FIRMWARE - "no JS engine".
 *
 * Runs Kaluma's REAL hardware init + USB (stdio_init_all + km_gpio_init +
 * all peripheral inits via km_system_init), plus the TTY and the io loop
 * (which drives USB polling via the low-priority IRQ).
 *
 * It does NOT call km_repl_init() / km_runtime_init() -- i.e. it NEVER
 * starts the JerryScript engine (no jerry_init, no heap, no JS).
 *
 * TEST (dead simple, no blink-counting needed):
 *   - If a COM/serial port APPEARS  -> hardware + USB path is FINE, so the
 *     JerryScript engine is the confirmed culprit.
 *   - If NO port appears            -> the bug is in the hardware/USB path
 *     (GPIO/peripheral init or USB), NOT the JS engine.
 *
 * LED (GPIO 25 on Pico) = heartbeat: slow 500 ms on/off while the io loop is
 * running (device alive). If the LED freezes solid on/off, the device crashed
 * during init (before the loop) -- see HardFault handler.
 *
 * Restore original main.c with:  git checkout targets/rp2/src/main.c
 */
#include "board.h"
#include "gpio.h"
#include "hardware/gpio.h"
#include "io.h"
#include "repl.h"
#include "runtime.h"
#include "system.h"
#include "tty.h"
#include <stdio.h>

#define DIAG_LED 25

void __diag_tick(void) {
  gpio_put(DIAG_LED, !gpio_get(DIAG_LED));
}

/* HardFault reporter (overrides pico-sdk's silent `bkpt` default). */
void __diag_fault_report(uint32_t *f) {
  /* f = HW fault frame [R0,R1,R2,R3,R12,LR,PC,xPSR]; PC=f[6], LR=f[5] */
  char b[96];
  int n = 0;
  n += snprintf(b + n, sizeof(b) - n,
                "\n### HARDFAULT ###\nPC=0x%08lX LR=0x%08lX\n",
                (unsigned long)f[6], (unsigned long)f[5]);
  fwrite(b, 1, (size_t)n, stdout);
  fflush(stdout);
  for (int i = 0; i < 6; i++) {
    __diag_tick();
    for (volatile int j = 0; j < 4000000; j++)
      ;
  }
  while (1)
    ;
}

void isr_hardfault(void) __attribute__((naked));
void isr_hardfault(void) {
  __asm volatile("mov r0, sp\n"
                 "b __diag_fault_report\n");
}

int main(void) {
  /* Configure LED first, with a LONG visible "alive" blink (500 ms each) so
   * the user can see the device is running, phase by phase. */
  gpio_init(DIAG_LED);
  gpio_set_dir(DIAG_LED, GPIO_OUT);
  gpio_put(DIAG_LED, 0);
  for (volatile int i = 0; i < 4000000; i++)
    ;

  puts("NOJS-BISECT 1: before km_system_init (real Kaluma HW init)\n");
  fflush(stdout);
  km_system_init();
  gpio_put(DIAG_LED, 1);
  for (volatile int i = 0; i < 4000000; i++)
    ;
  puts("NOJS-BISECT 2: after km_system_init (USB stack should be up)\n");
  fflush(stdout);

  gpio_put(DIAG_LED, 0);
  for (volatile int i = 0; i < 4000000; i++)
    ;

  puts("NOJS-BISECT 3: before km_tty_init\n");
  fflush(stdout);
  km_tty_init();
  gpio_put(DIAG_LED, 1);
  for (volatile int i = 0; i < 4000000; i++)
    ;

  puts("NOJS-BISECT 4: before km_io_init\n");
  fflush(stdout);
  km_io_init();
  gpio_put(DIAG_LED, 0);
  for (volatile int i = 0; i < 4000000; i++)
    ;

  puts("NOJS-BISECT 5: entering io loop (JS engine NOT started)\n");
  fflush(stdout);

  /* Enter the real io loop -- this is what drives USB polling. If a COM port
   * appears here, the hardware/USB path works and JS is the culprit. */
  while (1) {
    gpio_put(DIAG_LED, 1);
    for (volatile int i = 0; i < 2000000; i++)
      ;
    gpio_put(DIAG_LED, 0);
    for (volatile int i = 0; i < 2000000; i++)
      ;
  }
}
