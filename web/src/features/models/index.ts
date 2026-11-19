/**
 * Public surface of the model workbenches (owner: Workbench agent).
 * Import only from this file: `import { AerosWorkbench, ... } from "../features/models"`.
 *
 * Additive, optional props beyond CONTRACT.md:
 *   DatasetLibrary  onOpenInAeros?: (stationId) => void   (default: switches any mounted AerosWorkbench)
 *   CoreWorkbench   catalystHref?: string                  (link for "Compare in Catalyst"; default: scroll to a mounted CatalystWorkbench)
 */
export type { SavedRun, WorkbenchProps, ModelKey, ModelInfo } from "./types";
export { MODEL_INFO } from "./modelInfo";
export { AerosWorkbench } from "./aeros/AerosWorkbench";
export { NexusWorkbench } from "./nexus/NexusWorkbench";
export { CoreWorkbench } from "./core/CoreWorkbench";
export { CatalystWorkbench } from "./catalyst/CatalystWorkbench";
export { DatasetLibrary } from "./library/DatasetLibrary";
export { RuntimeStatusPill } from "./RuntimeStatusPill";
