import { Device, detectDevice } from './Device';
import * as types from './types';
/**
 * Expose all types.
 */
export { types };
/**
 * Expose mediasoup-client version.
 */
export declare const version = "0.0.6";
/**
 * Expose Device class and detectDevice() helper.
 */
export { Device, detectDevice };
/**
 * Expose parseScalabilityMode() function.
 */
export { parse as parseScalabilityMode } from './scalabilityModes';
export * from 'werift';
