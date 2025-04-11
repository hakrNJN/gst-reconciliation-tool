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
            for (const supplierEntry of docData.cdnr) {
                const supplierGstin = supplierEntry.ctin?.trim().toUpperCase();
                const supplierName = supplierEntry.trdnm?.trim();

                if (!supplierGstin) {
                    this.logger.warn('Skipping CDNR entry with missing Supplier GSTIN (ctin).', supplierEntry);
                    continue;
                }
                if (!supplierEntry.nt  || !Array.isArray(supplierEntry.nt)) {
                    this.logger.warn(`Skipping B2B entry for ${supplierGstin} due to missing or invalid 'inv' array.`, supplierEntry);
                    continue;
                }

                for (const note  of supplierEntry.nt) {
                    lineNumber++;
                    const parsedDate = parsePortalDate(note.dt);
                    if (!parsedDate) {
                        this.logger.warn(`Skipping CDNR  for ${supplierGstin} due to invalid date: ${note.dt}`, note);
                        continue; // Skip record if date is invalid
                    }

                    const igst = Number(note.igst ?? 0);
                    const cgst = Number(note.cgst ?? 0);
                    const sgst = Number(note.sgst ?? 0);
                    const taxableAmount = Number(note.txval ?? 0);
                    const totalTax = parseFloat((igst + cgst + sgst).toFixed(2)); // Calculate and round

                    const partialRecord: Partial<InternalInvoiceRecord> = {
                        id: uuidv4(),
                        source: 'portal',
                        supplierGstin: supplierGstin,
                        supplierName: supplierName,
                        invoiceNumberRaw: note.ntnum,
                        invoiceNumberNormalized: normalizeInvoiceNumber(note.ntnum), // Normalize here
                        date: parsedDate,
                        dateMonthYear: getCanonicalMonthYear(parsedDate), // Calculate here
                        taxableAmount: taxableAmount,
                        igst: igst,
                        cgst: cgst,
                        sgst: sgst,
                        totalTax: totalTax,
                        invoiceValue: Number(note.val ?? (taxableAmount + totalTax)), // Use provided or calculate
                        originalLineNumber: lineNumber,
                        rawData: options?.includeRawData ? note : undefined, // Optional raw data
                        // Map portal specific fields
                        placeOfSupply: note.pos,
                        reverseCharge: note.rev === 'Y',
                        itcAvailable: note.itcavl === 'Y',
                        itcReason: note.rsn,
                        documentType: 'INV' // Mark as Invoice
                    };
                    records.push(partialRecord);
                }
            }
        }

        // TODO: Add parsing for B2BA, CDNA if amendments are needed

        this.logger.info(`Parsed total ${records.length} records from GSTR-2B JSON (B2B section).`);
        return records;
    }
}

// --- DI Registration ---
container.registerSingleton(FileParserService);
