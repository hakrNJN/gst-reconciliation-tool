// src/core/reconciliation/normalization.utils.ts

/**
 * Determines the Indian Financial Year (e.g., "2023-24") for a given date.
 * FY runs from April 1st to March 31st.
 * @param date - The input Date object.
 * @returns A string representing the financial year, or empty string if date is invalid.
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