// Fehler-Feedback: kurz rot faden + shake am betreffenden Input/Button.
// Ergaenzend zum Toast — so erkennt der User sofort, welches Feld abgelehnt
// wurde, ohne im Toast nachzulesen.
//
// Konvention: .input-error-Klasse fuer ~400ms anbringen, dann entfernen.
// CSS definiert die Animation (border-color + translateX-shake).

export function flashError(el: HTMLElement | null | undefined, ms = 400): void {
  if (!el) return;
  el.classList.remove('input-error');
  // forced reflow, damit die Animation bei wiederholtem Trigger neu laeuft
  void el.offsetWidth;
  el.classList.add('input-error');
  window.setTimeout(() => el.classList.remove('input-error'), ms);
}
