// src/core/entities/gstr-2b-reconciled-record.entity.ts
import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';

// Enum for remarks to enforce consistency (optional, but good practice)
export enum ReconciliationRemark {
    MATCHED_PERFECTLY = 'MatchedPerfectly',
    MATCHED_TOLERANCE = 'MatchedWithTolerance',
    MISMATCHED_AMOUNT = 'MismatchedAmount',
}

@Entity('gstr_2b_reconciled_records') // Use snake_case for table names (common convention)
@Index(['supplierGstin', 'localInvoiceNumber', 'localDate']) // Example composite index
export class Gstr2bReconciledRecord {

    @PrimaryGeneratedColumn('increment')
    id!: number;

    @Index() // Index for faster lookups by GSTIN
    @Column({ type: 'nvarchar', length: 15 }) // Standard GSTIN length
    supplierGstin!: string;

    @Column({ type: 'nvarchar', length: 255, nullable: true }) // Supplier Name might be long
    supplierName?: string;

    @Column({ type: 'nvarchar', length: 50 }) // Adjust length as needed
    localInvoiceNumber!: string;

    @Column({ type: 'date', nullable: true }) // Use 'date' if time is not important, 'datetime2' otherwise
    localDate!: Date | null;

    @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 }) // Precision for currency
    localInvoiceValue!: number;

    @Column({ type: 'nvarchar', length: 50, nullable: true })
    localConum?: number;

    @Index() // Index voucher number if frequently queried
    @Column({ type: 'nvarchar', length: 50, nullable: true })
    localVno?: number;

    @Column({ type: 'nvarchar', length: 20, nullable: true }) // B2B, SEZWP etc.
    localInvType?: number;

    @Column({ type: 'nvarchar', length: 10, nullable: true }) // INV, CRN, DBN
    localDocType?: string;

    // Optional: Include portal details for context if needed during queries
    @Column({ type: 'nvarchar', length: 50, nullable: true })
    portalInvoiceNumber?: string;

    @Column({ type: 'date', nullable: true })
    portalDate?: Date | null;

    @Index() // Index remark for filtering
    @Column({
        type: 'nvarchar',
        length: 30,
        // enum: ReconciliationRemark, // Use enum type if DB supports it well & desired
    })
    remark!: ReconciliationRemark | string; // Store as string, use enum type in code

    @Index() // Index by recon date
    @Column({ type: 'datetime2' }) // Store the timestamp when this record was reconciled/saved
    reconciliationDate!: Date;

    @CreateDateColumn({ type: 'datetime2', default: () => 'GETDATE()' }) // Database default timestamp
    createdAt!: Date;

    @UpdateDateColumn({ type: 'datetime2', default: () => 'GETDATE()', onUpdate: 'GETDATE()' }) // Database timestamp on update
    updatedAt!: Date;

     // Optional: If you track the original source record ID
    // @Column({ type: 'int', nullable: true }) // Or appropriate type for your ID
    // sourceItcRegisterId?: number;
}