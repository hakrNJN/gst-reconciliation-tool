// src/core/parsing/file-parser.service.ts
import 'reflect-metadata'; // DI requirement
import { container, inject, injectable, singleton } from 'tsyringe';
import { v4 as uuidv4 } from 'uuid'; // Or import from common utils
import { Logger } from 'winston';
import * as XLSX from 'xlsx'; // Using namespace import for xlsx

import { LOGGER_TOKEN } from '../../infrastructure/logger';
import { FileParsingError } from '../common/errors';
import { InternalInvoiceRecord } from '../common/interfaces/models';
import { FileParsingOptions, IFileParserService } from './interfaces/services'; // Assuming interfaces are defined

// Define expected header names (case-insensitive keys)
// TODO: Make this more robust or configurable
const EXCEL_HEADER_MAP: { [key: string]: keyof Partial<InternalInvoiceRecord> } = {
    'supplier gstin': 'supplierGstin',
    'gstin': 'supplierGstin', // Alias
    'supplier name': 'supplierName',
    'invoice number': 'invoiceNumberRaw',
    'invoice no': 'invoiceNumberRaw', // Alias
    'bill no': 'invoiceNumberRaw', // Alias
    'invoice date': 'date',
    'date': 'date', // Alias
    'invoice value': 'invoiceValue', // Total value including tax
    'total value': 'invoiceValue', // Alias
    'taxable value': 'taxableAmount',
    'taxable amount': 'taxableAmount', // Alias
    'integrated tax amount': 'igst',
    'igst amount': 'igst',
    'igst': 'igst',
    'central tax amount': 'cgst',
    'cgst amount': 'cgst',
    'cgst': 'cgst',
    'state tax amount': 'sgst',
    'sgst amount': 'sgst',
    'sgst': 'sgst',
    'total tax amount': 'totalTax', // If provided directly
    'total tax': 'totalTax', // Alias
};

@singleton() // Register as a singleton instance
@injectable()
export class FileParserService implements IFileParserService {

    constructor(
        @inject(LOGGER_TOKEN) private logger: Logger
    ) {
        this.logger.info('FileParserService initialized.');
    }

    /**
     * Parses a file buffer (Excel or JSON) into partial invoice records.
     */
    async parseFile(
        fileBuffer: Buffer,
        options?: FileParsingOptions
    ): Promise<Partial<InternalInvoiceRecord>[]> {
        // Simple check for JSON (can be improved)
        const isLikelyJson = fileBuffer.toString('utf8', 0, 1).trim() === '{' || fileBuffer.toString('utf8', 0, 1).trim() === '[';
        const fileType = options?.fileTypeHint ?? (isLikelyJson ? 'json' : 'excel');

        this.logger.info(`Attempting to parse file as ${fileType}`);

        try {
            if (fileType === 'excel') {
                return this.parseExcel(fileBuffer, options);
            } else if (fileType === 'json') {
                return this.parseJson(fileBuffer, options);
            } else {
                throw new FileParsingError(`Unsupported file type hint: ${fileType}`);
            }
        } catch (error: any) {
            this.logger.error(`File parsing failed: ${error.message}`, { stack: error.stack });
            // Re-throw as specific FileParsingError if it's not already one
            if (error instanceof FileParsingError) {
                throw error;
            }
            throw new FileParsingError('Failed to parse file', error);
        }
    }

    private parseExcel(buffer: Buffer, options?: FileParsingOptions): Partial<InternalInvoiceRecord>[] {
        this.logger.debug('Parsing Excel buffer...');
        const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true }); // cellDates is crucial
        const sheetName = options?.sheetName ?? workbook.SheetNames[0]; // Use specified or first sheet
        if (!sheetName) {
            throw new FileParsingError('No sheets found in the Excel workbook.');
        }
        const worksheet = workbook.Sheets[sheetName];
        if (!worksheet) {
            throw new FileParsingError(`Sheet "${sheetName}" not found in the workbook.`);
        }

        // Convert sheet to JSON objects. Assumes first row is header.
        // `raw: false` attempts type conversion (dates, numbers)
        const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet, { raw: false, defval: null });

        this.logger.info(`Parsed ${jsonData.length} rows from Excel sheet "${sheetName}".`);

        const records: Partial<InternalInvoiceRecord>[] = jsonData.map((row, index) => {
            const partialRecord: Partial<InternalInvoiceRecord> = {
                id: uuidv4(), // Assign unique ID
                originalLineNumber: index + 2 // Assuming header is row 1, data starts row 2
            };

            // Map headers using EXCEL_HEADER_MAP (case-insensitive)
            for (const header in row) {
                const normalizedHeader = header.trim().toLowerCase();
                const mappedKey = EXCEL_HEADER_MAP[normalizedHeader];
                if (mappedKey && row[header] !== null && row[header] !== undefined) {
                    // Basic type handling - more robust validation/conversion needed later
                    if (mappedKey === 'date' && !(row[header] instanceof Date)) {
                        // Attempt to parse if not already a Date (XLSX should handle with cellDates:true)
                        // This is a fallback, proper date handling is crucial
                        const parsedDate = new Date(row[header]);
                        if (!isNaN(parsedDate.getTime())) {
                            partialRecord[mappedKey] = parsedDate;
                        } else {
                            this.logger.warn(`Could not parse date for row ${index + 2}, header "${header}": ${row[header]}`);
                        }
                    } else {
                        (partialRecord as any)[mappedKey] = row[header];
                    }
                }
            }
            return partialRecord;
        });

        return records.filter(r => Object.keys(r).length > 2); // Filter out potentially empty rows
    }

    private parseJson(buffer: Buffer, options?: FileParsingOptions): Partial<InternalInvoiceRecord>[] {
        this.logger.debug('Parsing JSON buffer...');
        const jsonString = buffer.toString('utf-8');
        const jsonData = JSON.parse(jsonString);

        if (!Array.isArray(jsonData)) {
            throw new FileParsingError('JSON data must be an array of records.');
        }

        this.logger.info(`Parsed ${jsonData.length} records from JSON.`);

        const records: Partial<InternalInvoiceRecord>[] = jsonData.map((row, index) => ({
            id: uuidv4(),
            originalLineNumber: index + 1,
            ...row // Assume JSON structure maps directly for now - NEEDS VALIDATION LATER
        }));

        return records;
    }
}

// --- DI Registration ---
// Registering the class itself as a singleton.
// Other parts of the app can inject FileParserService directly.
// Alternatively, define and use an IFileParserService token if strict interface-based DI is desired.
container.registerSingleton(FileParserService);
// Example using interface token (define FILE_PARSER_SERVICE_TOKEN symbol/string first):
// import { FILE_PARSER_SERVICE_TOKEN } from './interfaces/services'; // Assuming token is defined
// container.register(FILE_PARSER_SERVICE_TOKEN, { useClass: FileParserService }, { lifecycle: Lifecycle.Singleton });