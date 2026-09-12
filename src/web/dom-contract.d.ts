export {};

declare global {
  interface Document {
    /** index.html owns this exact root; runtime still fail-closes if the DOM contract is broken. */
    querySelector<E extends Element = HTMLDivElement>(selectors: '#app'): E;
  }
}
