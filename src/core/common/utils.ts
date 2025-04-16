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

/** Helper to parse DD-MM-YYYY date strings */


/**
 * Converts a date string in any standard format (including ISO) to DD/MM/YYYY format
 * @param dateStr The date string to format
 * @returns Formatted date string or original string if parsing fails
 */
export function formatDateToDDMMYYYY(dateStr: Date | null | undefined): string {
    if (!dateStr) return '';
    if (dateStr instanceof Date && !isNaN(dateStr.getTime())) { 
        // If it's already a Date object, format it
        const day = String(dateStr.getDate()).padStart(2, '0');
        const month = String(dateStr.getMonth() + 1).padStart(2, '0'); // +1 because months are 0-indexed
        const year = dateStr.getFullYear();
        return `${day}/${month}/${year}`;
    }
    try {
      // Create a Date object from the string (works with ISO and many other formats)
      const date = new Date(dateStr);
      
      // Check if date is valid
      if (isNaN(date.getTime())) {
        const day = String(dateStr.getDate()).padStart(2, '0');
        const month = String(dateStr.getMonth() + 1).padStart(2, '0'); // +1 because months are 0-indexed
        const year = dateStr.getFullYear();
        return `${day}/${month}/${year}`;
      }
      
      // Format to DD/MM/YYYY
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0'); // +1 because months are 0-indexed
      const year = date.getFullYear();
      
      return `${day}/${month}/${year}`;
    } catch (error) {
      // If any errors occur during parsing, return the original string
      // Format to DD/MM/YYYY
      const day = String(dateStr.getDate()).padStart(2, '0');
      const month = String(dateStr.getMonth() + 1).padStart(2, '0'); // +1 because months are 0-indexed
      const year = dateStr.getFullYear();
      
      return `${day}/${month}/${year}`;
    }
  }