/* Sequential, cancellable detail loading. No HTTP requests or credentials. */
(function (root) {
  'use strict';
  async function collect(queue, driver) {
    const progress = {total: queue.length, completed: 0, attempted: 0};
    for (const ticket of queue) {
      if (!driver.current()) return {...progress, reason: 'stopped'};
      if (await driver.loaded(ticket)) { progress.completed++; driver.progress({...progress}); continue; }
      if (!driver.current()) return {...progress, reason: 'stopped'};
      await driver.open(ticket);
      progress.attempted++;
      driver.progress({...progress});
      const deadline = driver.now() + 15000;
      while (driver.current() && !(await driver.loaded(ticket))) {
        if (driver.now() >= deadline) throw new Error('Ticket response timed out. Automation stopped; try loading this ticket manually.');
        await driver.sleep(200);
      }
      if (!driver.current()) return {...progress, reason: 'stopped'};
      await driver.close(ticket);
      if (!driver.current()) return {...progress, reason: 'stopped'};
      const closeDeadline = driver.now() + 5000;
      while (driver.current() && !(await driver.closed(ticket))) {
        if (driver.now() >= closeDeadline) throw new Error('Ticket modal did not close. Automation stopped.');
        await driver.sleep(100);
      }
      if (!driver.current()) return {...progress, reason: 'stopped'};
      progress.completed++;
      driver.progress({...progress});
      // Give React's modal transition time to finish, and pace requests.
      await driver.sleep(900);
    }
    return {...progress, reason: 'complete'};
  }
  root.MarjaneAutomation = {collect};
  if (typeof module !== 'undefined') module.exports = {collect};
})(globalThis);
