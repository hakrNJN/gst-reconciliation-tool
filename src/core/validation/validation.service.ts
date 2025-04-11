// src/core/validation/validation.service.ts
import 'reflect-metadata';
import { container, inject, injectable, singleton } from 'tsyringe';
import { Logger } from 'winston';
import { LOGGER_TOKEN } from '../../infrastructure/logger';
import { InternalInvoiceRecord } from '../common/interfaces/models';
// Import normalization and date helpers
import { ValidationError } from '../common/errors';
import {
    excelSerialDateToJSDate,
    getCanonicalMonthYear,
    getFinancialYear,
    normalizeInvoiceNumber,
    parseDateString
} from '../reconciliation/normalization.utils'; // Adjust path as needed
import { IValidationService, ValidationOptions } from './interfaces/services';


@singleton()
@injectable()
export class ValidationService implements IValidationService {

    constructor(@inject(LOGGER_TOKEN) private logger: Logger) {
        this.logger.info('ValidationService Initialized');
    }

    async validateAndStandardize(
        records: Partial<InternalInvoiceRecord>[],
        source: 'local' | 'portal',
        options?: ValidationOptions
    ): Promise<InternalInvoiceRecord[]> {

        this.logger.info(`Validating and standardizing ${records.length} records from source: ${source}`);
        const validRecords: InternalInvoiceRecord[] = [];
        let invalidCount = 0;

        for (const record of records) {
            try {
                // Assign source if missing from parser
                record.source = record.source ?? source;

                // --- 1. Validate Essential Fields ---
                if (!record.id) { // ID should be assigned by parser
                    throw new ValidationError(`Missing internal ID`);
                }
                if (!record.supplierGstin || typeof record.supplierGstin !== 'string' || record.supplierGstin.trim().length < 10) { // Basic GSTIN check
                    throw new ValidationError(`Missing or invalid Supplier GSTIN`);
                }
                if (!record.invoiceNumberRaw || typeof record.invoiceNumberRaw !== 'string' || record.invoiceNumberRaw.trim().length === 0) {
                    throw new ValidationError(`Missing or invalid Invoice Number (Raw)`);
                }
                if (record.date === undefined || record.date === null) {
                    throw new ValidationError(`Missing Date`);
                }
                if (record.taxableAmount === undefined || record.taxableAmount === null || typeof record.taxableAmount === 'string' && isNaN(parseFloat(record.taxableAmount))) {
                    // Allow string numbers from parser but check if parseable
                    throw new ValidationError(`Missing or invalid Taxable Amount`);
                }
                // Add checks for tax amounts if needed (e.g., at least one tax type should likely exist unless zero-rated)


                // --- 2. Standardize & Calculate Derived Fields ---
                const standardizedRecord = this.standardizeSingleRecord(record as any, source); // Use helper, cast needed as input is Partial

                // --- 3. Post-Standardization Validation ---
                if (!standardizedRecord.date) { // Check if date parsing resulted in null
                    throw new ValidationError(`Invalid Date format or value: ${record.date}`);
                }
                // Add more checks if necessary (e.g., total tax calculation seems reasonable)


                // If all checks pass, add to valid list
                validRecords.push(standardizedRecord);

            } catch (error: any) {
                invalidCount++;
                this.logger.warn(`Record validation/standardization failed [ID: ${record.id ?? 'N/A'}, Inv#: ${record.invoiceNumberRaw ?? 'N/A'}]: ${error.message}`);
                // Optionally collect detailed errors: validationErrors.push({ recordId: record.id, message: error.message });
            }
        }

        this.logger.info(`Validation complete. Valid records: ${validRecords.length}, Invalid/Skipped records: ${invalidCount}`);
        return validRecords; // Return only the validated and standardized records
    }


    /** Helper to standardize a single record (contains logic moved from ReconciliationService) */
    private standardizeSingleRecord(record: Partial<InternalInvoiceRecord>, source: 'local' | 'portal'): InternalInvoiceRecord {
        // Assign source if missing (shouldn't be if called from validateAndStandardize)
        record.source = record.source ?? source;

        const igstNum = Number(record.igst || 0);
        const cgstNum = Number(record.cgst || 0);
        const sgstNum = Number(record.sgst || 0);
        const totalTax = igstNum > 0 ? igstNum : (cgstNum + sgstNum);
        const taxableAmountNum = Number(record.taxableAmount || 0);

        let parsedDate: Date | null = null;
        if (record.date instanceof Date && !isNaN(record.date.getTime())) {
            record.date.setUTCHours(12, 0, 0, 0);
            parsedDate = record.date;
        } else if (typeof record.date === 'number' && source === 'local') { // Only trust serial numbers from local excel source
            parsedDate = excelSerialDateToJSDate(record.date);
        } else if (typeof record.date === 'string') {
            parsedDate = parseDateString(record.date); // Try DD-MM-YYYY
            if (!parsedDate) { const isoDate = new Date(record.date); if (!isNaN(isoDate.getTime())) { isoDate.setUTCHours(12, 0, 0, 0); parsedDate = isoDate; } }
        }
        // If parsing failed, parsedDate remains null

        const dateMonthYear = getCanonicalMonthYear(parsedDate);
        const financialYear = getFinancialYear(parsedDate);

        // Construct the final, fully typed object
        const finalRecord: InternalInvoiceRecord = {
            // Ensure all required fields from InternalInvoiceRecord are present
            id: record.id!, // Assert non-null as ID check was done
            source: record.source!, // Assert non-null
            supplierGstin: record.supplierGstin!.trim().toUpperCase(), // Assert non-null + standardize format
            supplierName: record.supplierName?.trim() ?? undefined,
            invoiceNumberRaw: record.invoiceNumberRaw!, // Assert non-null
            invoiceNumberNormalized: normalizeInvoiceNumber(record.invoiceNumberRaw),
            date: parsedDate, // Assign valid Date object or null
            dateMonthYear: dateMonthYear,
            financialYear: financialYear,
            taxableAmount: taxableAmountNum,
            igst: igstNum,
            cgst: cgstNum,
            sgst: sgstNum,
            totalTax: parseFloat(totalTax.toFixed(2)),
            invoiceValue: Number(record.invoiceValue || (taxableAmountNum + totalTax)),
            originalLineNumber: record.originalLineNumber,
            rawData: record.rawData,
            // Optional portal fields might be present from parser
            placeOfSupply: record.placeOfSupply,
            reverseCharge: record.reverseCharge,
            itcAvailable: record.itcAvailable,
            itcReason: record.itcReason,
            documentType: record.documentType,
        };
        return finalRecord;
    }
}

// --- DI Registration ---
container.registerSingleton(ValidationService);
// Optionally register for the interface token:
// container.register(VALIDATION_SERVICE_TOKEN, { useClass: ValidationService }, { lifecycle: Lifecycle.Singleton });