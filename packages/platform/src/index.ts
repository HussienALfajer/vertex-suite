export {
  ContractCycleError,
  ContractUnavailableError,
  DuplicateDeclarationError,
  MigrationError,
  ModuleDeclarationError,
  PlatformError,
  RegistryError,
  UndeclaredEventError,
} from './errors.js';

export { contractKey, type ContractKey, type ContractResolver } from './contract.js';

export {
  commandContext,
  systemContext,
  type CommandContext,
  type CommandContextInput,
  type CorrelationId,
} from './context.js';

export {
  createEventBus,
  eventType,
  type DomainEvent,
  type EventBus,
  type EventBusOptions,
  type EventHandler,
  type EventType,
  type HandlerFailure,
} from './events.js';

export {
  defineModule,
  isModuleCode,
  MODULE_CODES,
  MODULE_LAYERS,
  namespaceOf,
  provideContract,
  subscribeTo,
  type AccountRoleDeclaration,
  type ContractProvision,
  type EventDeclaration,
  type FeatureSwitchDeclaration,
  type MigrationDeclaration,
  type MigrationTarget,
  type ModuleCode,
  type ModuleContext,
  type ModuleDefinition,
  type ModuleInput,
  type ModuleLayer,
  type PermissionDeclaration,
  type SettingDeclaration,
  type SubscriptionDeclaration,
} from './module.js';

export {
  composeEdition,
  type EditionPlan,
  type EditionRefusal,
  type EditionRefusalCode,
  type EditionRequest,
  type InactiveEnhancement,
} from './edition.js';

export { createRegistry, type Registry, type RegistryOptions } from './registry.js';

export {
  createMemoryStore,
  createTransactor,
  type EffectFailure,
  type MemorySession,
  type MemoryStore,
  type SessionDriver,
  type Transactor,
  type TransactorOptions,
  type UnitOfWork,
} from './unit-of-work.js';

export {
  memoryJournal,
  runMigrations,
  type MigrationJournal,
  type MigrationOutcome,
  type RunMigrationsOptions,
} from './migrations.js';
