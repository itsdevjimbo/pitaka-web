/** A Tag changed or disappeared before a requested rename or deletion completed. */
export class TagUnavailableError extends Error {
  constructor() {
    super('That tag is no longer there.');
    this.name = 'TagUnavailableError';
  }
}
