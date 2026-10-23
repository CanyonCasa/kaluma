/* COMBINED diagnostic: led-diag boot-phase delays + io-diag io-loop ticks
 * + HardFault reporter + (32/64 KiB stack lives in targets/rp2/target.cmake).
 *
 * WHY the boot-phase delays matter: USB-CDC enumeration takes ~1 s on the host.
 * If the device hard-faults before that, "no USB". The led-diag firmware
 * inserted 4 slow (500 ms) blinks DURING the boot phase, which gave the host
 * time to enumerate (that's why USB appeared there). This combined firmware
 * keeps those delays AND adds per-call ticks inside km_io_run, so we see
 * BOTH "engine comes up" (4 boot blinks) AND "which io-loop call faults".
 *
 * LED = GPIO 25 (Pico). SLOW blink = 500 ms on / 500 ms off.
 *
 * Sequence you should see:
 *   [USB starts inside km_system_init]
 *   BOOT  : 1 slow blink  = km_system_init done
 *           2 slow blinks = km_tty_init + km_io_init done
 *           3 slow blinks = km_repl_init done
 *           4 slow blinks = km_runtime_init done (JS engine UP)
 *   IOLOOP: then per-call ticks from io.c's __diag_mark(N) = N slow blinks:
 *           1 = before km_io_update_time
 *           2 = before km_io_timer_run
 *           3 = before km_io_tty_run
 *           4 = before km_io_watch_run
 *           5 = before km_io_uart_run
 *           6 = before km_io_idle_run  (JERRY: jerry_run_jobs)
 *           7 = before km_io_handle_closing
 *           8 = before km_custom_infinite_loop
 *   FAULT : 6 FAST blinks = HARDFAULT fired (overrides pico-sdk's silent bkpt)
 *
 * READ: after the 4 boot blinks, count slow blinks until the 6-fast flicker.
 * That number = the io-loop call that is faulting. If you never get past the
 * boot phase (faults before/during a boot blink), the fault is in that boot
 * call (engine init etc.).
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

static void __claim_led(void) { gpio_init(DIAG_LED); gpio_set_dir(DIAG_LED, GPIO_OUT); gpio_put(DIAG_LED, 0); }
static void __slow_blink(void) { gpio_put(DIAG_LED, 1); sleep_ms(500); gpio_put(DIAG_LED, 0); sleep_ms(500); }

/* Boot-phase tick (defined in main, used here). */
void __boot_tick(void) { __slow_blink(); }

/* io.c's weak hook: blink ONCE (one slow blink) before each io-loop call.
   So the number of slow blinks you see after the 4 boot blinks = the index of
   the call about to run when the fault hits. 1=update_time, 2=timer, 3=tty,
   4=watch, 5=uart, 6=idle_run(JERRY), 7=closing, 8=custom. */
void __diag_mark(int n) { (void)n; __slow_blink(); }

/* --- HardFault reporter: 6 FAST blinks (distinct from the slow ticks) --- */
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

  km_system_init();      /* includes stdio_init_all (USB) + km_gpio_init (resets LED) */
  __claim_led();         /* re-claim after km_gpio_init re-inited pin 25 to input */
  __boot_tick();         /* 1 slow blink: USB should be up now */

  bool load = km_running_script_check();
  km_tty_init();
  km_io_init();
  __boot_tick();         /* 2 slow blinks total */

  km_repl_init(true);
  __boot_tick();         /* 3 slow blinks total */

  km_runtime_init(load, true);   /* JS engine up */
  __boot_tick();         /* 4 slow blinks total: JS engine up */

  km_io_run(true);       /* io loop -- instrumented per-call in io.c */
}
