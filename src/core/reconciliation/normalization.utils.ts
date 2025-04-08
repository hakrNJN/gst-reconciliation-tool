// src/core/reconciliation/normalization.utils.ts

/**
 * Normalizes an invoice number string for matching purposes.
 * - Removes potential financial year suffixes (e.g., /24-25).
 * - Converts to uppercase.
 * - Trims whitespace.
 * (Further refinement might be needed based on real data variations)
 * @param inv - The raw invoice number string.
 * @returns Normalized invoice number string.
 */
export function normalizeInvoiceNumber(inv: string | null | undefined): string {
    if (inv === null || inv === undefined) {
        return '';
    }
    let normalized = String(inv).trim();

    // Remove potential financial year suffixes like /24-25, -24-25, 24-25 etc.
    // Handles optional separator (/, -) and optional space before separator
    normalized = normalized.replace(/\s*[\/-]?\d{2,4}-\d{2,4}\s*$/, '');

    // Convert to uppercase
    normalized = normalized.toUpperCase();

    // Remove extra internal whitespace (replace multiple spaces with one) - Optional refinement
    // normalized = normalized.replace(/\s+/g, ' ');

    return normalized.trim(); // Trim again just in case
}

/**
 * Gets the canonical month and year string (YYYY-MM) from a Date object.
 * @param date - The input Date object.
 * @returns A string in "YYYY-MM" format, or an empty string if the input is invalid.
 */
export function getCanonicalMonthYear(date: Date | null | undefined): string {
    if (!(date instanceof Date) || isNaN(date.getTime())) {
        // Log a warning or handle invalid dates appropriately if needed
        // console.warn(`Invalid date object received in getCanonicalMonthYear: ${date}`);
        return ''; // Return empty for invalid dates
    }

    const year = date.getFullYear();
    const month = date.getMonth() + 1; // getMonth() is 0-indexed

    // Pad month with leading zero if needed
    const monthString = month < 10 ? `0${month}` : String(month);

    return `${year}-${monthString}`;
}