/* CORRECTED LED+HARDFAULT diagnostic.
 *
 * Fixes the earlier LED bug: km_gpio_init() re-inits ALL pins (incl. the LED,
 * pin 25) to input, which silently killed our heartbeat. So we (re)claim the
 * LED *after* km_system_init(), and use a visible ~400 ms blink per step.
 *
 * Sequence (LED = GPIO 25 on Pico):
 *   [USB starts inside km_system_init]
 *   1 blink = km_system_init done          (USB should be up now)
 *   2 blinks = km_tty_init + km_io_init done
 *   3 blinks = km_repl_init done
 *   4 blinks = km_runtime_init done        (JS engine started -- if we get here,
 *                                            jerry_init + km_global_init succeeded)
 *   then:    6 FAST blinks repeating = HARDFAULT (see handler)
 *
 * If USB still never enumerates, count the LED blinks before it freezes:
 *   freezes before 1  -> crash in km_system_init (but no-JS proved this is OK)
 *   1 then freeze      -> crash in km_tty_init/km_io_init
 *   2 then freeze      -> crash in km_repl_init
 *   3 then freeze      -> crash in km_runtime_init (jerry_init / km_global_init)
 *   4 then freeze      -> crash in km_io_run / io loop
 *   6 fast blinks      -> hard-fault (PC/LR also on serial, if port ever appears)
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

#include "pico/stdlib.h"   /* for sleep_ms - reliable timing */

#define DIAG_LED 25
#define BLINK_MS 500        /* ~500 ms on / ~500 ms off per step: clearly countable */
#define FAULT_MS 60         /* short blinks for the 6-tick HARDFAULT pattern */

static void __led(void) { gpio_put(DIAG_LED, 1); sleep_ms(BLINK_MS); gpio_put(DIAG_LED, 0); sleep_ms(BLINK_MS); }
static void __claim_led(void) { gpio_init(DIAG_LED); gpio_set_dir(DIAG_LED, GPIO_OUT); gpio_put(DIAG_LED, 0); }

/* --- HardFault reporter (overrides pico-sdk's silent `bkpt` default) --- */
void __diag_fault_report(uint32_t *f) {
  /* f = HW fault frame [R0,R1,R2,R3,R12,LR,PC,xPSR]; PC=f[6], LR=f[5] */
  char b[96];
  int n = 0;
  n += snprintf(b + n, sizeof(b) - n, "\n### HARDFAULT ### PC=0x%08lX LR=0x%08lX\n",
                (unsigned long)f[6], (unsigned long)f[5]);
  fwrite(b, 1, (size_t)n, stdout);
  fflush(stdout);
  /* 6 distinct fast blinks, then hang */
  for (int i = 0; i < 6; i++) { gpio_put(DIAG_LED, 1); for (volatile int j = 0; j < 300000; j++); gpio_put(DIAG_LED, 0); for (volatile int j = 0; j < 300000; j++); }
  while (1) {}
}
void isr_hardfault(void) __attribute__((naked));
void isr_hardfault(void) {
  __asm volatile("mov r0, sp\n" "b __diag_fault_report\n");
}

int main(void) {
  __claim_led();                 /* set up LED; will be re-claimed after gpio init */

  puts("DIAG 1: km_system_init\n"); fflush(stdout);
  km_system_init();              /* includes stdio_init_all (USB) + km_gpio_init (kills LED) */
  __claim_led();                 /* re-claim after km_gpio_init re-inited it */
  __led();                       /* 1 blink: USB should be up now */

  puts("DIAG 2: tty + io\n"); fflush(stdout);
  bool load = km_running_script_check();
  km_tty_init();
  km_io_init();
  __led();                       /* 2 blinks: tty+io done */

  puts("DIAG 3: km_repl_init\n"); fflush(stdout);
  km_repl_init(true);
  __led();                       /* 3 blinks: repl done */

  puts("DIAG 4: km_runtime_init (jerry_init here -- PRIME SUSPECT)\n"); fflush(stdout);
  km_runtime_init(load, true);
  __led();                       /* 4 blinks: JS engine up */

  puts("DIAG 5: km_io_run\n"); fflush(stdout);
  km_io_run(true);
}
