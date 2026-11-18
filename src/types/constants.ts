// Application-level constants and unique-id generator.
export type Id = string;
export type Rag = 'green' | 'amber' | 'serious' | 'red';

export const APP_NAME = 'Assembly & Static Build Central Spine';
export const APP_VERSION = '1.0';
export const WORKSPACE_SCHEMA = 'asbcs-workspace@1';
export const SUMMARY_SCHEMA = 'summary@V2';

let _seq = 0;
/** Generate a collision-resistant identifier with a human-readable prefix. */
export const uid = (p = 'id'): Id =>
  `${p}_${Date.now().toString(36)}${(_seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
