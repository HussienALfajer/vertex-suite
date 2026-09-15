/**
 * The one way a module reaches something another module owns.
 *
 * modules.md §4 permits a module to import another module's **contract** and
 * nothing else. A contract key is the runtime half of that: the type is
 * imported from the owning module's contract file, and the implementation is
 * fetched by key, so nothing is imported across the boundary except a shape.
 *
 * It exists because of the soft dependencies of §5 and §6. CAT-16 shows a
 * purchase-price history on the item card; PUR owns that data; an edition
 * without PUR still has an item card, simply without that section. A direct
 * import would make CAT unbuildable without PUR, which is the coupling the
 * whole module map exists to avoid.
 */

declare const ContractShape: unique symbol;

/**
 * A key naming a contract and, in the type only, what implements it.
 *
 * The phantom member is what makes resolve() return the right type without a
 * cast at the call site — and a cast at the call site is exactly where the
 * wrong type would be silently asserted.
 */
export interface ContractKey<T> {
  readonly key: string;
  readonly [ContractShape]?: T;
}

/**
 * Declares a contract key. Lives in the owning module's contract file, next to
 * the interface it names:
 *
 *   export interface ItemPurchaseHistory { ... }
 *   export const ItemPurchaseHistory = contractKey<ItemPurchaseHistory>('pur.item-purchase-history');
 */
export function contractKey<T>(key: string): ContractKey<T> {
  return { key };
}

/** What a registry hands to anything that may need another module's contract. */
export interface ContractResolver {
  /**
   * The implementation, or null when no module in this edition provides it.
   *
   * Returning null rather than throwing is the point: the caller is expected to
   * have a shape for the absence, because the absence is a sale the customer
   * made when they chose their edition.
   */
  resolve<T>(key: ContractKey<T>): T | null;

  /**
   * The implementation, or a defect.
   *
   * For a contract the caller genuinely cannot work without — in which case the
   * provider belongs in dependsOn, and this throw only ever fires if that
   * declaration is missing.
   */
  require<T>(key: ContractKey<T>): T;
}
