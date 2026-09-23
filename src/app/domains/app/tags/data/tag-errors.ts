/** A Tag changed or disappeared before a requested rename or deletion completed. */
export class TagUnavailableError extends Error {
  constructor() {
    super('That tag is no longer there.');
    this.name = 'TagUnavailableError';
  }
}

/** A write failure does not prove whether a Tag mutation committed. */
export class TagWriteOutcomeUncertainError extends Error {
  constructor() {
    super('The Tag change outcome needs checking.');
    this.name = 'TagWriteOutcomeUncertainError';
  }
}
