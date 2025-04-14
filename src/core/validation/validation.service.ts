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
                if (!record.invoiceNumberRaw ) {
                    throw new ValidationError(`Missing or invalid Invoice Number (Raw)`);
                }
                if (record.date === undefined || record.date === null) {
                    throw new ValidationError(`Missing Date`);
                }
                if (record.taxableAmount === undefined || record.taxableAmount === null || typeof record.taxableAmount === 'string' && isNaN(parseFloat(record.taxableAmount))) {
                    // Allow string numbers from parser but check if parseable
                    throw new ValidationError(`Missing or invalid Taxable Amount`);
                }
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
    private standardizeSingleRecord(
        record: Partial<InternalInvoiceRecord> & { [key: string]: any },
        source: 'local' | 'portal'
    ): InternalInvoiceRecord {
        // Assign source if missing (shouldn't be if called from validateAndStandardize)
        record.source = record.source ?? source;

        // --- Standardize Core Fields & Calculate Taxes ---
        const igstNum = Number(record.igst || 0);
        const cgstNum = Number(record.cgst || 0);
        const sgstNum = Number(record.sgst || 0);
        const totalTax = igstNum > 0 ? igstNum : (cgstNum + sgstNum);
        const taxableAmountNum = Number(record.taxableAmount || 0);
        // --- End Core Fields ---

        // --- Robust Date Parsing ---
        let parsedDate: Date | null = null;

        // ... (date parsing logic setting parsedDate) ...
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
        // --- End Date Parsing ---

        const dateMonthYear = getCanonicalMonthYear(parsedDate);
        const financialYear = getFinancialYear(parsedDate);

        let docType: InternalInvoiceRecord['documentType'] = undefined;

        if (source === 'local') {
            // --- Access Mode/Type from record.rawData ---
            const rawData = record.rawData as { [key: string]: any } | undefined; // Cast rawData
            let modeRaw: any = undefined;
            let typeRaw: any = undefined;

            if (rawData) { // Check if rawData exists
                 // Access potential raw Mode/Type properties case-insensitively from rawData
                 modeRaw = rawData['Mode'] ?? rawData['mode'] ?? rawData['Document Mode'] ?? rawData['document mode'];
                 typeRaw = rawData['Type'] ?? rawData['type'] ?? rawData['Document Type'] ?? rawData['document type'] ?? rawData['Credit/Debit'] ?? rawData['credit/debit'];
            } else {
                 this.logger.warn(`Record ID ${record.id} missing rawData, cannot determine Mode/Type.`);
            }
            // --- End Access ---
            const mode = typeof modeRaw === 'string' ? modeRaw.trim().toUpperCase() : undefined;
            const type = typeof typeRaw === 'string' ? typeRaw.trim().toUpperCase() : undefined;

            if (mode === 'B2B') {
                docType = 'INV';
            } else if (mode === 'CDNR') {
                if (type === 'CREDIT') {
                    docType = 'D'; // Local purchase / Sup CN = Credit Note context Assign Opposite D
                } else if (type === 'DEBIT') {
                    docType = 'C'; // Local return / Sup DN = Debit Note context Assign Opposite C
                } else {
                    // Mode is CDNR but Type is missing or invalid - Log warning
                    this.logger.warn(`Record ID ${record.invoiceNumberRaw} has Mode='CDNR' but invalid/missing Type='${typeRaw}'. Cannot set documentType.`);
                    // Decide if this makes the record invalid overall - handled in main loop
                }
            } else {
                // Mode is missing or invalid for local data
                this.logger.warn(`Local record ID ${record.invoiceNumberRaw} missing or invalid Mode ('${modeRaw}'). Document type not set from Mode/Type.`);
                // Maybe infer from other data if possible, or leave undefined
            }
        } else { // Source is 'portal'
            // Assign directly from parsed portal data (parser already sets this)
            // Basic validation for portal type
            const portalDocType = record.documentType;
            console.log(`Portal record ID ${record.invoiceNumberRaw} has document type: ${portalDocType}`);
            if (portalDocType && ['INV', 'C', 'D'].includes(portalDocType)) {
                docType = portalDocType as 'INV' | 'C' | 'D';
            } else {
                this.logger.warn(`Portal record ID ${record.id} has unexpected document type: ${portalDocType}`);
            }
        }
        // --- End Conditional Mapping ---

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
            documentType: docType,
            supSource: record.supSource,
            supfileDate: record.supfileDate,

        };
        return finalRecord;
    }
}

// --- DI Registration ---
container.registerSingleton(ValidationService);
// Optionally register for the interface token:
// container.register(VALIDATION_SERVICE_TOKEN, { useClass: ValidationService }, { lifecycle: Lifecycle.Singleton });