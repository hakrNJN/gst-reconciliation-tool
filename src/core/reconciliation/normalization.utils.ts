// src/core/reconciliation/normalization.utils.ts
import { distance as levenshteinDistance } from 'fastest-levenshtein'; // Import library


/** Extracts the primary numeric sequence from a string */
function extractNumericPart(str: string | null | undefined): string {
    if (!str) return '';
    // Find sequences of digits, optionally separated by internal hyphens/slashes often ignored
    // Prioritize longer sequences. Match numbers that might be at end, start, or middle.
    const numericMatches = String(str).match(/\d[\d/-]*\d|\d+/g); // Find sequences of digits, possibly with internal - or /
    if (!numericMatches) return '';
    // Return the longest numeric sequence found
    return numericMatches.sort((a, b) => b.length - a.length)[0].replace(/[-/]/g, ''); // Remove internal separators for comparison
}

/**
 * Checks if two invoice numbers are potentially similar.
 * Always returns a similarity assessment rather than null for potential matches.
 * @param inv1 Raw invoice number 1
 * @param inv2 Raw invoice number 2
 * @param threshold Levenshtein distance threshold (e.g., 2)
 * @returns Object indicating similarity method and score.
 */
export function checkInvoiceSimilarity(
    inv1: string | null | undefined,
    inv2: string | null | undefined,
    threshold: number = 2 // Default Levenshtein threshold
): { method: 'Numeric' | 'Levenshtein' | 'None'; score: number } {

    if (!inv1 || !inv2) return { method: 'None', score: Infinity };

    const str1 = String(inv1).trim().toUpperCase();
    const str2 = String(inv2).trim().toUpperCase();

    if (str1 === str2) return { method: 'None', score: 0 }; // Perfect match (handled elsewhere)

    // 1. Check numeric parts
    const num1 = extractNumericPart(str1);
    const num2 = extractNumericPart(str2);
    if (num1 && num1 === num2 && num1.length > 2) { // Ensure numeric part is somewhat significant
        // Check if non-numeric parts are short/ignorable (simple check)
        const nonNum1 = str1.replace(num1, '');
        const nonNum2 = str2.replace(num2, '');
        // Allow if non-numeric parts are very short or mostly non-alphanumeric
        if (nonNum1.replace(/[^A-Z]/g, '').length <= 3 && nonNum2.replace(/[^A-Z]/g, '').length <= 3) {
            return { method: 'Numeric', score: 0 }; // Score 0 for numeric match
        }
    }

    // 2. Check Levenshtein distance on cleaned strings
    // Clean a bit more for Levenshtein (remove common separators)
    const cleanStr1 = str1.replace(/[\s/-]/g, '');
    const cleanStr2 = str2.replace(/[\s/-]/g, '');
    const distance = levenshteinDistance(cleanStr1, cleanStr2);

    if (distance <= threshold) {
        return { method: 'Levenshtein', score: distance };
    }

    // Return a high score for dissimilar invoices - still usable for potential matches
    // where date and amount match but invoice numbers are very different
    return { method: 'None', score: distance };
}

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
 * Gets the canonical month and year string (YYYY-MM) from a Date object or null.
 * Uses UTC methods to avoid timezone shifts.
 * @param date - The input Date object (ideally representing UTC noon) or null.
 * @returns A string in "YYYY-MM" format, or an empty string if the input is null or invalid.
 */
export function getCanonicalMonthYear(date: Date | null | undefined): string {
    if (!(date instanceof Date) || isNaN(date.getTime())) {
        return ''; // Return empty for invalid/null dates
    }

    const year = date.getUTCFullYear(); // Use UTC method
    const month = date.getUTCMonth() + 1; // Use UTC method (0-indexed)

    const monthString = month < 10 ? `0${month}` : String(month);
    return `${year}-${monthString}`;
}

/**
 * Determines the Indian Financial Year (e.g., "2023-24") for a given Date object or null.
 * Uses UTC methods. FY runs from April 1st to March 31st.
 * @param date - The input Date object (ideally representing UTC noon) or null.
 * @returns A string representing the financial year, or empty string if date is invalid/null.
 */
export function getFinancialYear(date: Date | null | undefined): string {
    if (!(date instanceof Date) || isNaN(date.getTime())) {
        return '';
    }

    const year = date.getUTCFullYear(); // Use UTC method
    const month = date.getUTCMonth(); // Use UTC method (0 = Jan, 3 = Apr)

    let startYear: number;
    if (month >= 3) { // April (3) or later
        startYear = year;
    } else { // Jan (0), Feb (1), Mar (2)
        startYear = year - 1;
    }
    const endYearShort = (startYear + 1).toString().slice(-2);
    return `${startYear}-${endYearShort}`;
}

/**
 * Gets the financial quarter string (YYYY-QN) from a Date object.
 * Financial quarters are defined as:
 * - Q1: April - June
 * - Q2: July - September
 * - Q3: October - December
 * - Q4: January - March
 * 
 * @param date - The input Date object.
 * @returns A string in "YYYY-QN" format (e.g., "2023-Q1"), or an empty string if the input is invalid.
 */
export function getFinancialQuarter(date: Date | null | undefined): string {
    if (!(date instanceof Date) || isNaN(date.getTime())) {
        return '';
    }

    // --- Use UTC Methods ---
    const month = date.getUTCMonth(); // 0-indexed (0 = Jan, 3 = Apr)
    const year = date.getUTCFullYear();
    // --- End Use UTC Methods ---

    let financialYearStart: number;
    let quarter: number;

    // Determine financial year start and quarter number
    if (month >= 3 && month <= 5) {       // April (3) to June (5) = Q1
        quarter = 1;
        financialYearStart = year;
    } else if (month >= 6 && month <= 8) { // July (6) to September (8) = Q2
        quarter = 2;
        financialYearStart = year;
    } else if (month >= 9 && month <= 11) { // October (9) to December (11) = Q3
        quarter = 3;
        financialYearStart = year;
    } else {                              // January (0) to March (2) = Q4
        quarter = 4;
        financialYearStart = year - 1; // Belongs to the previous financial year
    }

    return `${financialYearStart}-Q${quarter}`;
}


/**
 * Parses a date string (expects DD-MM-YYYY or DD/MM/YYYY) into a JavaScript Date object SET TO UTC NOON.
 * @param dateStr The date string to parse.
 * @returns JavaScript Date object representing UTC noon of that date, or null if parsing fails or date is invalid.
 */
export function parseDateString(dateStr: string | undefined | null): Date | null {
    if (!dateStr) return null;
    // Allow DD-MM-YYYY or DD/MM/YYYY
    const match = String(dateStr).trim().match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (match) {
        const day = parseInt(match[1], 10);
        const month = parseInt(match[2], 10); // Month is 1-based from input
        const year = parseInt(match[3], 10);

        // Basic sanity check on month/day ranges
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year > 1000) {
            try {
                // Construct timestamp for UTC noon directly
                const utcMilliseconds = Date.UTC(year, month - 1, day, 12, 0, 0); // Month is 0-based for Date.UTC
                const date = new Date(utcMilliseconds);

                // Final check: ensure constructed date didn't wrap due to invalid day/month combo
                 if (isNaN(date.getTime()) ||
                    date.getUTCFullYear() !== year ||
                    date.getUTCMonth() !== month - 1 ||
                    date.getUTCDate() !== day) {
                    return null; // Date was invalid (e.g., Feb 30th)
                 }
                return date; // Represents UTC noon
            } catch (e) {
                return null; // Error during Date construction
            }
        }
    }
    return null; // Format didn't match or basic sanity check failed
}

/**
 * Converts an Excel date serial number to a JavaScript Date object SET TO UTC NOON.
 * Assumes the standard Excel 1900 date system (Windows).
 * @param serial Excel date serial number (number of days since 1899-12-31).
 * @returns JavaScript Date object representing UTC noon of that date, or null if input is invalid.
 */
export function excelSerialDateToJSDate(serial: number | string | null | undefined): Date | null {
    if (typeof serial === 'string') {
        serial = parseFloat(serial);
    }
    // Excel serial number 1 = Jan 1, 1900. Serial number 60 is Feb 29, 1900 (incorrect leap year).
    // Dates BEFORE March 1st 1900 might be off by one day if precision is needed there.
    // Let's focus on dates >= 1.
    if (typeof serial !== 'number' || isNaN(serial) || serial < 1) {
        return null; // Invalid input
    }

    // Excel Epoch days adjustment to Unix Epoch (Jan 1, 1970)
    // 25569 = days from 1900-01-01 to 1970-01-01 (inclusive of Excel's fake 1900 leap day)
    const excelEpochDiff = 25569;
    const millisecondsPerDay = 86400 * 1000;

    // Calculate days since Unix epoch (adjusting for the 1900 base)
    // We subtract the difference in days to get days relative to 1970 epoch
    const daysSinceEpoch = serial - excelEpochDiff;

    // Calculate milliseconds for UTC *noon* on that day
    // daysSinceEpoch * msPerDay gives ms for UTC midnight
    // Add 12 hours worth of ms
    const targetMillisecondsUTC = (daysSinceEpoch * millisecondsPerDay) + (12 * 60 * 60 * 1000);

    const date = new Date(targetMillisecondsUTC);

    // Final validity check
    if (isNaN(date.getTime())) {
        return null;
    }

    return date; // This Date object represents UTC noon
}

/**
 * Converts a Date object to a string in "DD-MMM-YYYY" format.
 * Note: This function uses UTC methods to avoid timezone shifts.
 * @param date - The Date object to convert.
 * @returns date string in "DD-MMM-YYYY" format (e.g., "01-Jan-2023").
 *          Returns an empty string if the date is invalid or null.
 */
export function dateToString(date: Date): string {
    if (!(date instanceof Date) || isNaN(date.getTime())) {
        return '';
    }

    const year = date.getUTCFullYear(); // Use UTC method
    const month = date.getUTCMonth(); // Use UTC method (0 = Jan, 3 = Apr)
    const day = date.getUTCDate(); // Use UTC method

    // Array of abbreviated month names
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    return `${day}-${monthNames[month]}-${year}`; // Format as DD-MMM-YYYY
}