// src/core/validation/interfaces/services.ts
import { InternalInvoiceRecord } from '../../common/interfaces/models';

// Add options if needed later (e.g., strictness level)
export interface ValidationOptions { }

// Could return results with errors, or just filter valid ones
export interface ValidationResult {
    validRecords: InternalInvoiceRecord[];
    invalidRecordCount: number;
    // errors: Array<{ recordId?: string, message: string }>; // Optional detailed errors
}

export interface IValidationService {
    /**
     * Validates raw parsed records, standardizes fields, and calculates derived values.
     * Filters out records that fail essential validation.
     * @param records - Array of partially populated records from the parser.
     * @param source - Indicates if data is 'local' or 'portal'.
     * @param options - Optional validation configuration.
     * @returns A promise resolving to an array of fully standardized and validated InternalInvoiceRecord.
     */
    validateAndStandardize(
        records: Partial<InternalInvoiceRecord>[],
        source: 'local' | 'portal',
        options?: ValidationOptions
    ): Promise<InternalInvoiceRecord[]>; // Return only valid & standardized records
}

// Optional: Define DI Token
export const VALIDATION_SERVICE_TOKEN = Symbol.for('ValidationService');