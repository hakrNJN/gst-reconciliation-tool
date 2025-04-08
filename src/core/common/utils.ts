// src/core/common/utils.ts

import { v4 as uuidv4 } from 'uuid';

/**
 * Generates a unique Version 4 UUID.
 * @returns A unique identifier string.
 */
export function generateUniqueId(): string {
    return uuidv4();
}

/**
 * Simple utility to pause execution for a specified duration.
 * Useful for testing, rate limiting simulations, etc. NOT for production blocking.
 * @param ms Milliseconds to sleep.
 */
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Add other generic utility functions here as the project evolves.
// Examples:
// - Type guard functions (e.g., isInternalInvoiceRecord(obj: any): obj is InternalInvoiceRecord)
// - Data transformation helpers
// - Debounce/throttle functions (if needed on server, less common)