/**
 * Everything here is a **defect**.
 *
 * The vocabulary is written by programmers, not by shopkeepers. A permission
 * identifier spelled `sec.User.Create` is not a business outcome anybody can be
 * shown and asked about; it is wrong identically on every machine the edition
 * is installed on, and the moment to find out is the moment the module declares
 * it rather than the first afternoon a manager edits a role.
 *
 * The base class exists so that a host composing an edition can tell a broken
 * vocabulary from a broken kernel without matching on messages.
 */
export class VocabularyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** A permission identifier was not in the one form the system writes them in. */
export class InvalidPermissionIdError extends VocabularyError {}
