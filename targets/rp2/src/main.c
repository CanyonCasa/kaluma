/* IO-LOOP diagnostic: locate the exact call in km_io_run that faults.
 *
 * After km_runtime_init() (JS engine is up), we enter km_io_run(). src/io.c
 * now calls __diag_mark(N) before each of the 8 calls in the loop:
 *   1 km_io_update_time   4 km_io_watch_run    7 km_io_handle_closing
 *   2 km_io_timer_run     5 km_io_uart_run     8 km_custom_infinite_loop
 *   3 km_io_tty_run       6 km_io_idle_run     (JS: jerry_run_jobs)
 *
 * __diag_mark(N) blinks N SLOW blinks (500 ms). A hard-fault then triggers the
 * reporter (6 FAST blinks). So "N slow blinks, then a fast flicker" == the
 * fault is inside call #N. (No JS engine init blinks here to avoid confusion.)
 */
#include "board.h"
#include "gpio.h"
#include "hardware/gpio.h"
#include "io.h"
#include "pico/stdlib.h"
#include "repl.h"
#include "runtime.h"
#include "system.h"
#include "tty.h"
#include <stdio.h>

#define DIAG_LED 25

void __claim_led(void) { gpio_init(DIAG_LED); gpio_set_dir(DIAG_LED, GPIO_OUT); gpio_put(DIAG_LED, 0); }
static void __one_blink(void) { gpio_put(DIAG_LED, 1); sleep_ms(500); gpio_put(DIAG_LED, 0); sleep_ms(500); }

/* io.c's weak hook: blink `n` times (n = call index about to run). */
void __diag_mark(int n) { for (int i = 0; i < n; i++) __one_blink(); }

/* --- HardFault reporter (6 FAST blinks, distinct from the slow ticks) --- */
void __diag_fault_report(uint32_t *f) {
  char b[96];
  int n = 0;
  n += snprintf(b + n, sizeof(b) - n, "\n### HARDFAULT ### PC=0x%08lX LR=0x%08lX\n",
                (unsigned long)f[6], (unsigned long)f[5]);
  fwrite(b, 1, (size_t)n, stdout);
  fflush(stdout);
  for (int i = 0; i < 6; i++) { gpio_put(DIAG_LED, 1); for (volatile int j = 0; j < 250000; j++); gpio_put(DIAG_LED, 0); for (volatile int j = 0; j < 250000; j++); }
  while (1) {}
}
void isr_hardfault(void) __attribute__((naked));
void isr_hardfault(void) { __asm volatile("mov r0, sp\n" "b __diag_fault_report\n"); }

int main(void) {
  __claim_led();
  km_system_init();                 /* includes stdio_init_all (USB) */
  __claim_led();                    /* re-claim: km_gpio_init reset the LED pin */
  bool load = km_running_script_check();
  km_tty_init();
  km_io_init();
  km_repl_init(true);
  km_runtime_init(load, true);      /* JS engine up */
  km_io_run(true);                  /* the faulting loop -- now instrumented */
}
