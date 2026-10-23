/* DIAGNOSTIC BUILD - real Kaluma boot path with per-step LED ticks +
 * HardFault reporter. LED = GPIO 25 (Pico). Restores original main.c:
 *   git checkout targets/rp2/src/main.c
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

/* Public: also called from instrumented km_system_init / km_runtime_init. */
void __diag_mark(const char *s) {
  __diag_tick();                       /* visual marker */
  if (s) {
    puts(s);
    fflush(stdout);
  }
}

void __diag_fault_report(uint32_t *f) {
  /* f is the Cortex-M fault frame pushed by HW on fault entry:
   * [R0,R1,R2,R3,R12,LR,PC,xPSR]  =>  PC=f[6], LR=f[5] */
  char b[96];
  int n = 0;
  n += snprintf(b + n, sizeof(b) - n,
                "\n### HARDFAULT ###\nPC=0x%08lX LR=0x%08lX\n",
                (unsigned long)f[6], (unsigned long)f[5]);
  fwrite(b, 1, (size_t)n, stdout);
  fflush(stdout);
  for (int i = 0; i < 6; i++) {
    __diag_tick();
    for (volatile int j = 0; j < 3000000; j++)
      ;
  }
  while (1)
    ;
}

/* Cortex-M hard-fault reporter.
 * NOTE: this pico-sdk build wires the vector table to the raw `isr_hardfault`
 * symbol, whose default is a bare `bkpt` (i.e. a fault dies silently - no
 * reset, no reporting). We override it so a fault is actually reported.
 * The handler is `naked`: it captures the original (fault-frame) SP *before*
 * any C prologue can move it, then hands off to the C reporter with that SP.
 */
void isr_hardfault(void) __attribute__((naked));
void isr_hardfault(void) {
  __asm volatile(
      "mov r0, sp\n"
      "b __diag_fault_report\n");
}

int main(void) {
  /* Set up LED immediately (before anything else can touch it). */
  gpio_init(DIAG_LED);
  gpio_set_dir(DIAG_LED, GPIO_OUT);
  gpio_put(DIAG_LED, 0);

  __diag_mark("A: before km_system_init");

  bool load = false;
  km_system_init();
  __diag_mark("B: after km_system_init (USB should be up)");

  load = km_running_script_check();
  __diag_mark("C: after running-script check");

  km_tty_init();
  __diag_mark("D: after km_tty_init");

  km_io_init();
  __diag_mark("E: after km_io_init");

  km_repl_init(true);
  __diag_mark("F: after km_repl_init");

  km_runtime_init(load, true);
  __diag_mark("G: after km_runtime_init (JS engine up)");

  puts("H: entering io loop\n");
  fflush(stdout);
  km_io_run(true);
}
