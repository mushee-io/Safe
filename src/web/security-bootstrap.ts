const SAFE_KEY = 'blackout-safe:public-safe:v1';
const MAX_PRIVATE_INPUT_CHARS = 262_144;

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function assertSecureOrigin(): void {
  if (location.protocol === 'https:' || (location.protocol === 'http:' && isLocalHost(location.hostname))) return;
  document.body.replaceChildren();
  const pre = document.createElement('pre');
  pre.textContent = 'BLACKOUT_SAFE_HTTPS_ORIGIN_REQUIRED';
  pre.style.padding = '24px';
  pre.style.fontFamily = 'ui-monospace, monospace';
  document.body.append(pre);
  throw new Error('BLACKOUT_SAFE_HTTPS_ORIGIN_REQUIRED');
}

function scrubSelfAssertedVerification(): void {
  try {
    const raw = localStorage.getItem(SAFE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.deploymentVerifiedOnChain === true) {
      parsed.deploymentVerifiedOnChain = false;
      localStorage.setItem(SAFE_KEY, JSON.stringify(parsed));
    }
  } catch {
    localStorage.removeItem(SAFE_KEY);
  }
}

function hardenInput(element: HTMLInputElement | HTMLTextAreaElement): void {
  element.autocomplete = 'off';
  element.spellcheck = false;
  element.setAttribute('autocapitalize', 'off');
  element.setAttribute('autocorrect', 'off');
  if (element instanceof HTMLTextAreaElement) element.maxLength = MAX_PRIVATE_INPUT_CHARS;
}

function hardenRenderedDom(root: ParentNode): void {
  root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea').forEach(hardenInput);

  // Network verification is evidence, not a user preference. Until the app has
  // an indexer-backed verifier, the attach flow must not let a checkbox promote
  // an arbitrary manifest to NETWORK VERIFIED.
  const selfAsserted = root.querySelector<HTMLInputElement>('#attach-verified');
  if (selfAsserted) {
    const field = selfAsserted.closest('.field');
    if (field) {
      const note = document.createElement('div');
      note.className = 'callout red';
      note.textContent = 'NETWORK VERIFICATION CANNOT BE SELF-DECLARED. Attachments remain unverified until Preview verification is implemented.';
      field.replaceWith(note);
    } else {
      selfAsserted.remove();
    }
  }
}

assertSecureOrigin();
scrubSelfAssertedVerification();
hardenRenderedDom(document);

const observer = new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node instanceof Element) hardenRenderedDom(node);
    }
  }
});

observer.observe(document.documentElement, { childList: true, subtree: true });

window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
