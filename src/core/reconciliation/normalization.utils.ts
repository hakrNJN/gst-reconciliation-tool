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
 * Gets the financial year string (YY-YY) from a Date object.
 * Financial year spans from April 1st to March 31st of the next year.
 * 
 * @param date - The input Date object.
 * @returns A string in "YY-YY" format (e.g., "23-24"), or an empty string if the input is invalid.
 */
export function getFinancialYear(date: Date | null | undefined): string {
    if (!(date instanceof Date) || isNaN(date.getTime())) {
        // console.warn(`Invalid date object received in getFinancialYear: ${date}`);
        return '';
    }

    const year = date.getFullYear();
    const month = date.getMonth(); // 0 = Jan, 3 = Apr

    let startYear: number;

    if (month >= 3) { // April (3) or later
        startYear = year;
    } else { // Jan (0), Feb (1), Mar (2)
        startYear = year - 1;
    }

    const endYearShort = (startYear + 1).toString().slice(-2); // Get last two digits of end year

    return `${startYear}-${endYearShort}`;
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
        return ''; // Return empty for invalid dates
    }

    const month = date.getMonth() + 1; // getMonth() is 0-indexed
    const year = date.getFullYear();

    let financialYear: number;
    let quarter: number;

    // Determine financial year and quarter
    if (month >= 4 && month <= 6) {
        // April to June = Q1
        quarter = 1;
        financialYear = year;
    } else if (month >= 7 && month <= 9) {
        // July to September = Q2
        quarter = 2;
        financialYear = year;
    } else if (month >= 10 && month <= 12) {
        // October to December = Q3
        quarter = 3;
        financialYear = year;
    } else {
        // January to March = Q4
        quarter = 4;
        financialYear = year - 1; // This belongs to previous year's financial year
    }

    return `${financialYear}-Q${quarter}`;
}


export function parseDateString(dateStr: string | undefined | null): Date | null {
    // Handles DD-MM-YYYY format specifically
    if (!dateStr) return null;
    const match = dateStr.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/); // Allow / or -
    if (match) {
        const day = parseInt(match[1], 10);
        const month = parseInt(match[2], 10); // Month is 1-based here
        const year = parseInt(match[3], 10);
        // Basic validity check
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            const date = new Date(year, month - 1, day); // Month is 0-based for Date constructor
            // Final check if the constructed date is valid and matches input parts
            if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) {
                date.setUTCHours(12, 0, 0, 0); // Set UTC noon
                return date;
            }
        }
    }
    return null; // Return null if format is wrong or date is invalid
}

/**
 * Converts an Excel date serial number to a JavaScript Date object (UTC).
 * Assumes the standard Excel date system (1900 base, includes faulty 1900 leap year).
 * Does NOT handle the Mac 1904 date system.
 * @param serial Excel date serial number (number of days since 1899-12-31).
 * @returns JavaScript Date object (set to UTC noon), or null if input is invalid.
 */
export function excelSerialDateToJSDate(serial: number | string | null | undefined): Date | null {
    if (typeof serial === 'string') {
        serial = parseFloat(serial); // Attempt conversion if it's a string number
    }
    if (typeof serial !== 'number' || isNaN(serial) || serial <= 0) {
        return null; // Invalid input
    }

    // Excel base date: 1899-12-31 (serial number 0)
    // JavaScript base date: 1970-01-01 UTC (Unix Epoch)
    // Days between Excel base and JS Epoch: 25569 (includes Excel's fake 1900 leap day)
    const excelEpochDiff = 25569;

    // Calculate milliseconds since Unix Epoch
    // (serial - excelEpochDiff) gives days since 1970-01-01
    // Multiply by milliseconds per day (86400 * 1000)
    const millisecondsPerDay = 86400 * 1000;
    const dateMilliseconds = (serial - excelEpochDiff) * millisecondsPerDay;

    const date = new Date(dateMilliseconds);

    // Check if the resulting date is valid
    if (isNaN(date.getTime())) {
        return null;
    }

    // Return date set to UTC noon to avoid timezone issues affecting the date part
    // We need to adjust for the local timezone offset when setting UTC noon
    const timezoneOffsetMs = date.getTimezoneOffset() * 60 * 1000;
    const utcNoonDate = new Date(date.getTime() + timezoneOffsetMs + (12 * 60 * 60 * 1000));

    // Final check if UTC date is valid (sometimes edge cases fail)
    if (isNaN(utcNoonDate.getTime())) {
        return date; // Return original parsed date if UTC conversion fails
    }

    return utcNoonDate;
}