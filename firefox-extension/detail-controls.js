/* Injected into the selected Marjane tab only when the owner starts automation.
 * Controls are deliberately limited to receipt buttons inside history cards
 * and the matching ticket modal's Fermer button. Never select generic buttons.
 */
(function () {
  'use strict';
  if (window.__marjaneDetailControls) return;
  window.__marjaneDetailControls = true;
  const normalize = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const visible = element => element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none';
  const dialogs = () => [...document.querySelectorAll('.modal, [role="dialog"]')].filter(visible);
  function historyPage() {
    if (location.protocol !== 'https:' || !['www.marjane.ma', 'marjane.ma'].includes(location.hostname) ||
        location.pathname.replace(/\/$/, '') !== '/account/orders' || document.visibilityState !== 'visible') {
      throw new Error('Keep the Marjane history tab visible while loading tickets.');
    }
  }
  function detailButton(ticket) {
    const matches = [...document.querySelectorAll('article button')].filter(button => {
      if (!visible(button) || button.disabled || normalize(button.textContent) !== 'details du ticket') return false;
      const card = button.closest('article');
      // Match the full identifier against a text node, not a substring of another
      // ticket number. Never return card contents to the background page.
      const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) if (walker.currentNode.textContent.trim() === ticket.id) return true;
      return false;
    });
    if (matches.length !== 1) throw new Error('A ticket card is missing or ambiguous. Refresh history and try again.');
    return matches[0];
  }
  browser.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== browser.runtime.id || message?.type !== 'marjane-ticket-control') return undefined;
    try {
      historyPage();
      const url = new URL(location.href);
      if (message.command === 'discover') {
        if (dialogs().length) throw new Error('Close the open ticket or dialog before starting.');
        const matches = [];
        for (const ticket of (message.tickets || []).slice(0, 2000)) {
          try { detailButton(ticket); matches.push(ticket); } catch (_) { /* Not on this loaded page. */ }
        }
        return Promise.resolve({ok: true, tickets: matches.slice(0, 100)});
      }
      const ticket = message.ticket;
      if (!ticket || typeof ticket.id !== 'string' || !ticket.id) throw new Error('Invalid ticket selection.');
      if (message.command === 'open') {
        // Marjane leaves order_number in the URL even after the modal closes.
        // DOM visibility, not a stale query parameter, determines openness.
        if (dialogs().length) throw new Error('Another dialog is open. Automation stopped.');
        detailButton(ticket).click();
      } else if (message.command === 'close') {
        if (!dialogs().length) return Promise.resolve({ok: true, clicked: false});
        if (url.searchParams.get('order_number') !== ticket.id) throw new Error('The selected ticket changed. Automation stopped.');
        const buttons = [...new Set(dialogs().flatMap(dialog => [...dialog.querySelectorAll('button[aria-label="Fermer"]')]))]
          .filter(button => visible(button) && !button.disabled);
        if (!buttons.length) return Promise.resolve({ok: true, clicked: false});
        if (buttons.length !== 1) throw new Error('Could not safely close the ticket. Close it manually.');
        buttons[0].click();
        return Promise.resolve({ok: true, clicked: true});
      } else if (message.command === 'closed') {
        return Promise.resolve({ok: true, closed: dialogs().length === 0});
      } else throw new Error('Unsupported ticket action.');
      return Promise.resolve({ok: true});
    } catch (error) {
      return Promise.resolve({ok: false, error: error.message});
    }
  });
})();
