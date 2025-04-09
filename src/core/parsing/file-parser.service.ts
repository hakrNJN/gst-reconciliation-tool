// src/core/parsing/file-parser.service.ts (Rewritten parseJson)
import 'reflect-metadata'; // DI requirement
import { container, inject, injectable, singleton } from 'tsyringe';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from 'winston';
import * as XLSX from 'xlsx';

import { LOGGER_TOKEN } from '../../infrastructure/logger';
import { AppError, FileParsingError } from '../common/errors';
import { InternalInvoiceRecord } from '../common/interfaces/models';
import { FileParsingOptions, IFileParserService } from './interfaces/services';
// Import normalization utils - needed to populate derived fields consistently
import { getCanonicalMonthYear, normalizeInvoiceNumber } from '../reconciliation/normalization.utils';

// --- Header map for Excel remains the same ---
const EXCEL_HEADER_MAP: { [key: string]: keyof Partial<InternalInvoiceRecord> } = {
    'supplier gstin': 'supplierGstin', 'gstin': 'supplierGstin',
    'supplier name': 'supplierName',
    'invoice number': 'invoiceNumberRaw', 'invoice no': 'invoiceNumberRaw', 'bill no': 'invoiceNumberRaw',
    'invoice date': 'date', 'date': 'date',
    'invoice value': 'invoiceValue', 'total value': 'invoiceValue',
    'taxable value': 'taxableAmount', 'taxable amount': 'taxableAmount',
    'integrated tax amount': 'igst', 'igst amount': 'igst', 'igst': 'igst',
    'central tax amount': 'cgst', 'cgst amount': 'cgst', 'cgst': 'cgst',
    'state tax amount': 'sgst', 'sgst amount': 'sgst', 'sgst': 'sgst',
    'total tax amount': 'totalTax', 'total tax': 'totalTax',
};

/** Helper to parse DD-MM-YYYY date strings */
function parsePortalDate(dateStr: string | undefined | null): Date | null {
    if (!dateStr) return null;
    // Simple check for DD-MM-YYYY format
    const match = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (match) {
        // Note: Month in JS Date is 0-indexed (0-11), so subtract 1
        const date = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
        // Basic validation: Check if the parsed date components match the input string parts
        // This helps catch invalid dates like 32-13-2024 that Date might parse leniently
        if (date.getFullYear() === Number(match[3]) &&
            date.getMonth() === Number(match[2]) - 1 &&
            date.getDate() === Number(match[1])) {
            // Set time to midday UTC to avoid timezone shifts affecting the date part
            date.setUTCHours(12, 0, 0, 0);
            return date;
        }
    }
    // Log warning or return null if format is wrong or date is invalid
    // console.warn(`Could not parse portal date format: ${dateStr}`);
    return null;
}


@singleton()
@injectable()
export class FileParserService implements IFileParserService {

    constructor(
        @inject(LOGGER_TOKEN) private logger: Logger
    ) {
        this.logger.info('FileParserService initialized.');
    }

    async parseFile(
        fileBuffer: Buffer,
        options?: FileParsingOptions
    ): Promise<Partial<InternalInvoiceRecord>[]> {
        // Try to infer type if not provided
        let fileType = options?.fileTypeHint;
        if (!fileType) {
            try {
                // Simple check: valid JSON usually starts with { or [
                const startChar = fileBuffer.toString('utf8', 0, 1).trim();
                if (startChar === '{' || startChar === '[') {
                    JSON.parse(fileBuffer.toString('utf8')); // Try parsing to confirm
                    fileType = 'json';
                } else {
                    fileType = 'excel'; // Assume Excel otherwise
                }
                this.logger.debug(`Inferred file type as: ${fileType}`);
            } catch (e) {
                fileType = 'excel'; // Fallback to Excel if JSON parse fails
                this.logger.debug('Could not parse as JSON, assuming Excel.');
            }
        }


        this.logger.info(`Attempting to parse file as ${fileType}`);

        try {
            if (fileType === 'excel') {
                // Keep existing Excel parsing logic (returns Partial<InternalInvoiceRecord>)
                return this.parseExcel(fileBuffer, options);
            } else if (fileType === 'json') {
                // Use new GSTR-2B JSON parsing logic
                return this.parseGstr2bJson(fileBuffer, options);
            } else {
                throw new FileParsingError(`Unsupported file type hint: ${fileType}`);
            }
        } catch (error: any) {
            this.logger.error(`File parsing failed: ${error.message}`, { stack: error.stack });
            if (error instanceof AppError) { // Keep specific errors
                throw error;
            }
            throw new FileParsingError('Failed to parse file', error);
        }
    }

    // --- Keep parseExcel as before ---
    // private parseExcel(buffer: Buffer, options?: FileParsingOptions): Partial<InternalInvoiceRecord>[] {
    //     this.logger.debug('Parsing Excel buffer...');
    //     // ...(Existing Excel parsing logic remains here)...
    //     // ... it should return Partial<InternalInvoiceRecord>[]
    //     const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    //     const sheetName = options?.sheetName ?? workbook.SheetNames[0];
    //     if (!sheetName) { throw new FileParsingError('No sheets found in the Excel workbook.'); }
    //     const worksheet = workbook.Sheets[sheetName];
    //     if (!worksheet) { throw new FileParsingError(`Sheet "${sheetName}" not found.`); }
    //     const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet, { raw: false, defval: null });
    //     this.logger.info(`Parsed ${jsonData.length} rows from Excel sheet "${sheetName}".`);
    //     const records: Partial<InternalInvoiceRecord>[] = jsonData.map((row, index) => {
    //         const partialRecord: Partial<InternalInvoiceRecord> = {
    //             id: uuidv4(),
    //             originalLineNumber: index + 2, // Header is row 1
    //             source: 'local' // Assume Excel is always local data for now
    //         };
    //         for (const header in row) {
    //             const normalizedHeader = header.trim().toLowerCase();
    //             const mappedKey = EXCEL_HEADER_MAP[normalizedHeader];
    //             if (mappedKey && row[header] !== null && row[header] !== undefined) {
    //                 // Basic assignment - further validation/conversion needed later
    //                 (partialRecord as any)[mappedKey] = row[header];
    //             }
    //         }
    //         // Attempt to calculate total tax if components are present and total tax isn't
    //         if (partialRecord.totalTax === undefined && (partialRecord.igst !== undefined || (partialRecord.cgst !== undefined && partialRecord.sgst !== undefined))) {
    //             partialRecord.totalTax = (partialRecord.igst ?? 0) + (partialRecord.cgst ?? 0) + (partialRecord.sgst ?? 0);
    //         }
    //         // Attempt calculation if invoiceValue is missing but others present
    //         if (partialRecord.invoiceValue === undefined && partialRecord.taxableAmount !== undefined && partialRecord.totalTax !== undefined) {
    //             partialRecord.invoiceValue = partialRecord.taxableAmount + partialRecord.totalTax;
    //         }

    //         return partialRecord;
    //     }).filter(r => Object.keys(r).length > 3); // Filter out potentially almost empty rows
    //     return records;
    // }
    private parseExcel(buffer: Buffer, options?: FileParsingOptions): Partial<InternalInvoiceRecord>[] {
        this.logger.debug('Parsing Excel buffer using raw values...');
        const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true }); // Keep cellDates: true as a fallback/preference if it works sometimes
        const sheetName = options?.sheetName ?? workbook.SheetNames[0];
        if (!sheetName) { throw new FileParsingError('No sheets found in the Excel workbook.'); }
        const worksheet = workbook.Sheets[sheetName];
        if (!worksheet) { throw new FileParsingError(`Sheet "${sheetName}" not found.`); }

        // --- Use raw: true to get raw values (numbers for dates) ---
        // defval: null ensures empty cells become null instead of undefined
        const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet, { raw: true, defval: null });
        // --------------------------------------------------------

        this.logger.info(`Parsed ${jsonData.length} raw rows from Excel sheet "${sheetName}".`);

        const records: Partial<InternalInvoiceRecord>[] = jsonData.map((row, index) => {
            const partialRecord: Partial<InternalInvoiceRecord> = {
                id: uuidv4(),
                originalLineNumber: index + 2, // Header is row 1
                source: 'local'
            };
            for (const header in row) {
                const normalizedHeader = header.trim().toLowerCase();
                const mappedKey = EXCEL_HEADER_MAP[normalizedHeader];
                if (mappedKey && row[header] !== null && row[header] !== undefined) {
                    // Assign the raw value. Date will likely be a number (serial date) here.
                    // Type conversion/parsing will happen in the standardize step.
                    (partialRecord as any)[mappedKey] = row[header];
                }
            }
           // Remove calculations previously done here, move to standardize
           // if (partialRecord.totalTax === undefined && ...) { ... }
           // if(partialRecord.invoiceValue === undefined && ...) { ... }

            return partialRecord;
        }).filter(r => Object.keys(r).length > 3);
        return records;
   }
    // --- End parseExcel ---


    /** Parses the GSTR-2B JSON structure */
    private parseGstr2bJson(buffer: Buffer, options?: FileParsingOptions): Partial<InternalInvoiceRecord>[] {
        this.logger.debug('Parsing GSTR-2B JSON buffer...');
        const jsonString = buffer.toString('utf-8');
        const gstr2bData = JSON.parse(jsonString);

        // Validate basic structure
        if (!gstr2bData || !gstr2bData.data || !gstr2bData.data.docdata) {
            throw new FileParsingError('Invalid GSTR-2B JSON structure: Missing "data.docdata"');
        }
        const docData = gstr2bData.data.docdata;

        const records: Partial<InternalInvoiceRecord>[] = [];
        let lineNumber = 0; // Track overall line number roughly

        // --- Process B2B Invoices ---
        if (docData.b2b && Array.isArray(docData.b2b)) {
            this.logger.info(`Processing ${docData.b2b.length} B2B suppliers...`);
            for (const supplierEntry of docData.b2b) {
                const supplierGstin = supplierEntry.ctin?.trim().toUpperCase();
                const supplierName = supplierEntry.trdnm?.trim();

                if (!supplierGstin) {
                    this.logger.warn('Skipping B2B entry with missing Supplier GSTIN (ctin).', supplierEntry);
                    continue;
                }
                if (!supplierEntry.inv || !Array.isArray(supplierEntry.inv)) {
                    this.logger.warn(`Skipping B2B entry for ${supplierGstin} due to missing or invalid 'inv' array.`, supplierEntry);
                    continue;
                }

                for (const invoice of supplierEntry.inv) {
                    lineNumber++;
                    const parsedDate = parsePortalDate(invoice.dt);
                    if (!parsedDate) {
                        this.logger.warn(`Skipping invoice for ${supplierGstin} due to invalid date: ${invoice.dt}`, invoice);
                        continue; // Skip record if date is invalid
                    }

                    const igst = Number(invoice.igst ?? 0);
                    const cgst = Number(invoice.cgst ?? 0);
                    const sgst = Number(invoice.sgst ?? 0);
                    const taxableAmount = Number(invoice.txval ?? 0);
                    const totalTax = parseFloat((igst + cgst + sgst).toFixed(2)); // Calculate and round

                    const partialRecord: Partial<InternalInvoiceRecord> = {
                        id: uuidv4(),
                        source: 'portal',
                        supplierGstin: supplierGstin,
                        supplierName: supplierName,
                        invoiceNumberRaw: invoice.inum,
                        invoiceNumberNormalized: normalizeInvoiceNumber(invoice.inum), // Normalize here
                        date: parsedDate,
                        dateMonthYear: getCanonicalMonthYear(parsedDate), // Calculate here
                        taxableAmount: taxableAmount,
                        igst: igst,
                        cgst: cgst,
                        sgst: sgst,
                        totalTax: totalTax,
                        invoiceValue: Number(invoice.val ?? (taxableAmount + totalTax)), // Use provided or calculate
                        originalLineNumber: lineNumber,
                        rawData: options?.includeRawData ? invoice : undefined, // Optional raw data
                        // Map portal specific fields
                        placeOfSupply: invoice.pos,
                        reverseCharge: invoice.rev === 'Y',
                        itcAvailable: invoice.itcavl === 'Y',
                        itcReason: invoice.rsn,
                        documentType: 'INV' // Mark as Invoice
                    };
                    records.push(partialRecord);
                }
            }
        } else {
            this.logger.warn('No B2B section found or it is not an array in GSTR-2B JSON.');
        }

        // --- Process CDN Records (Credit/Debit Notes) --- Optional ---
        if (docData.cdnr && Array.isArray(docData.cdnr)) {
            this.logger.info(`Processing ${docData.cdnr.length} CDNR suppliers...`);
            // Similar loop structure as B2B, but iterate through `nt` array
            // Map `ntnum` -> `invoiceNumberRaw`, `ntdt` -> `date`, `typ` -> `documentType` ('C'/'D')
            // Remember tax values in CDNs might represent reduction/increase
            // TODO: Implement CDNR parsing if needed for reconciliation scope
        }

        // TODO: Add parsing for B2BA, CDNA if amendments are needed

        this.logger.info(`Parsed total ${records.length} records from GSTR-2B JSON (B2B section).`);
        return records;
    }
}

// --- DI Registration ---
container.registerSingleton(FileParserService);

// // src/core/parsing/file-parser.service.ts
// import 'reflect-metadata'; // DI requirement
// import { container, inject, injectable, singleton } from 'tsyringe';
// import { v4 as uuidv4 } from 'uuid'; // Or import from common utils
// import { Logger } from 'winston';
// import * as XLSX from 'xlsx'; // Using namespace import for xlsx

// import { LOGGER_TOKEN } from '../../infrastructure/logger';
// import { FileParsingError } from '../common/errors';
// import { InternalInvoiceRecord } from '../common/interfaces/models';
// import { FileParsingOptions, IFileParserService } from './interfaces/services'; // Assuming interfaces are defined

// // Define expected header names (case-insensitive keys)
// // TODO: Make this more robust or configurable
// const EXCEL_HEADER_MAP: { [key: string]: keyof Partial<InternalInvoiceRecord> } = {
//     'supplier gstin': 'supplierGstin',
//     'gstin': 'supplierGstin', // Alias
//     'supplier name': 'supplierName',
//     'invoice number': 'invoiceNumberRaw',
//     'invoice no': 'invoiceNumberRaw', // Alias
//     'bill no': 'invoiceNumberRaw', // Alias
//     'invoice date': 'date',
//     'date': 'date', // Alias
//     'invoice value': 'invoiceValue', // Total value including tax
//     'total value': 'invoiceValue', // Alias
//     'taxable value': 'taxableAmount',
//     'taxable amount': 'taxableAmount', // Alias
//     'integrated tax amount': 'igst',
//     'igst amount': 'igst',
//     'igst': 'igst',
//     'central tax amount': 'cgst',
//     'cgst amount': 'cgst',
//     'cgst': 'cgst',
//     'state tax amount': 'sgst',
//     'sgst amount': 'sgst',
//     'sgst': 'sgst',
//     'total tax amount': 'totalTax', // If provided directly
//     'total tax': 'totalTax', // Alias
// };

// @singleton() // Register as a singleton instance
// @injectable()
// export class FileParserService implements IFileParserService {

//     constructor(
//         @inject(LOGGER_TOKEN) private logger: Logger
//     ) {
//         this.logger.info('FileParserService initialized.');
//     }

//     /**
//      * Parses a file buffer (Excel or JSON) into partial invoice records.
//      */
//     async parseFile(
//         fileBuffer: Buffer,
//         options?: FileParsingOptions
//     ): Promise<Partial<InternalInvoiceRecord>[]> {
//         // Simple check for JSON (can be improved)
//         const isLikelyJson = fileBuffer.toString('utf8', 0, 1).trim() === '{' || fileBuffer.toString('utf8', 0, 1).trim() === '[';
//         const fileType = options?.fileTypeHint ?? (isLikelyJson ? 'json' : 'excel');

//         this.logger.info(`Attempting to parse file as ${fileType}`);

//         try {
//             if (fileType === 'excel') {
//                 return this.parseExcel(fileBuffer, options);
//             } else if (fileType === 'json') {
//                 return this.parseJson(fileBuffer, options);
//             } else {
//                 throw new FileParsingError(`Unsupported file type hint: ${fileType}`);
//             }
//         } catch (error: any) {
//             this.logger.error(`File parsing failed: ${error.message}`, { stack: error.stack });
//             // Re-throw as specific FileParsingError if it's not already one
//             if (error instanceof FileParsingError) {
//                 throw error;
//             }
//             throw new FileParsingError('Failed to parse file', error);
//         }
//     }

//     private parseExcel(buffer: Buffer, options?: FileParsingOptions): Partial<InternalInvoiceRecord>[] {
//         this.logger.debug('Parsing Excel buffer...');
//         const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true }); // cellDates is crucial
//         const sheetName = options?.sheetName ?? workbook.SheetNames[0]; // Use specified or first sheet
//         if (!sheetName) {
//             throw new FileParsingError('No sheets found in the Excel workbook.');
//         }
//         const worksheet = workbook.Sheets[sheetName];
//         if (!worksheet) {
//             throw new FileParsingError(`Sheet "${sheetName}" not found in the workbook.`);
//         }

//         // Convert sheet to JSON objects. Assumes first row is header.
//         // `raw: false` attempts type conversion (dates, numbers)
//         const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet, { raw: false, defval: null });

//         this.logger.info(`Parsed ${jsonData.length} rows from Excel sheet "${sheetName}".`);

//         const records: Partial<InternalInvoiceRecord>[] = jsonData.map((row, index) => {
//             const partialRecord: Partial<InternalInvoiceRecord> = {
//                 id: uuidv4(), // Assign unique ID
//                 originalLineNumber: index + 2 // Assuming header is row 1, data starts row 2
//             };

//             // Map headers using EXCEL_HEADER_MAP (case-insensitive)
//             for (const header in row) {
//                 const normalizedHeader = header.trim().toLowerCase();
//                 const mappedKey = EXCEL_HEADER_MAP[normalizedHeader];
//                 if (mappedKey && row[header] !== null && row[header] !== undefined) {
//                     // Basic type handling - more robust validation/conversion needed later
//                     if (mappedKey === 'date' && !(row[header] instanceof Date)) {
//                         // Attempt to parse if not already a Date (XLSX should handle with cellDates:true)
//                         // This is a fallback, proper date handling is crucial
//                         const parsedDate = new Date(row[header]);
//                         if (!isNaN(parsedDate.getTime())) {
//                             partialRecord[mappedKey] = parsedDate;
//                         } else {
//                             this.logger.warn(`Could not parse date for row ${index + 2}, header "${header}": ${row[header]}`);
//                         }
//                     } else {
//                         (partialRecord as any)[mappedKey] = row[header];
//                     }
//                 }
//             }
//             return partialRecord;
//         });

//         return records.filter(r => Object.keys(r).length > 2); // Filter out potentially empty rows
//     }

//     private parseJson(buffer: Buffer, options?: FileParsingOptions): Partial<InternalInvoiceRecord>[] {
//         this.logger.debug('Parsing JSON buffer...');
//         const jsonString = buffer.toString('utf-8');
//         const jsonData = JSON.parse(jsonString);

//         if (!Array.isArray(jsonData)) {
//             throw new FileParsingError('JSON data must be an array of records.');
//         }

//         this.logger.info(`Parsed ${jsonData.length} records from JSON.`);

//         const records: Partial<InternalInvoiceRecord>[] = jsonData.map((row, index) => ({
//             id: uuidv4(),
//             originalLineNumber: index + 1,
//             ...row // Assume JSON structure maps directly for now - NEEDS VALIDATION LATER
//         }));

//         return records;
//     }
// }

// // --- DI Registration ---
// // Registering the class itself as a singleton.
// // Other parts of the app can inject FileParserService directly.
// // Alternatively, define and use an IFileParserService token if strict interface-based DI is desired.
// container.registerSingleton(FileParserService);
// // Example using interface token (define FILE_PARSER_SERVICE_TOKEN symbol/string first):
// // import { FILE_PARSER_SERVICE_TOKEN } from './interfaces/services'; // Assuming token is defined
// // container.register(FILE_PARSER_SERVICE_TOKEN, { useClass: FileParserService }, { lifecycle: Lifecycle.Singleton });