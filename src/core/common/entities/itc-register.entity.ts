// src/core/entities/itc-register.entity.ts
import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    UpdateDateColumn
} from 'typeorm';

@Entity('itc_register') // Table name
@Index(['supplierGstin', 'invoiceNumber', 'invoiceDate'], { unique: true }) // Enforce uniqueness based on key fields? Adjust if needed.
export class ItcRegister {

    @PrimaryGeneratedColumn()
    purtrnId!: number;

    @Index()
    @Column({ type: 'nvarchar', length: 15 })
    supplierGstin!: string;

    @Column({ type: 'nvarchar', length: 255, nullable: true })
    supplierName?: string;

    @Column({ type: 'nvarchar', length: 50 })
    invoiceNumber!: string;

    @Index()
    @Column({ type: 'date' }) // Or 'datetime2'
    invoiceDate!: Date;

    @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
    taxableAmount!: number;

    @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
    igstAmount!: number;

    @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
    cgstAmount!: number;

    @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
    sgstAmount!: number;

    @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
    invoiceValue!: number; // Often Taxable + IGST + CGST + SGST

    @Index()
    @Column({ type: 'nvarchar', length: 50, nullable: true })
    vno?: string; // Local Voucher Number

    @Column({ type: 'nvarchar', length: 50, nullable: true })
    documentMode?: string; // How was this record entered? e.g., 'UPLOAD', 'MANUAL', 'API'

    @Column({ type: 'nvarchar', length: 10, nullable: true }) // INV, CRN, DBN
    documentType?: string;
 
    @Column({ type: 'nvarchar', length: 20, nullable: true }) // B2B, SEZWP, DE etc.
    invType?: number;
    
    @Column({ type: 'varchar',  nullable: true }) // B2B, SEZWP, DE etc.
    series?: string;
    
    @Column({ type: 'nvarchar', length: 100, nullable: true })
    book?: string; // Reference to specific accounting book/ledger if needed

    // You might add Conum here as well if it's part of the core ITC record
    @Column({ type: 'nvarchar', length: 1, nullable: true })
    conum?: number;

    // You might add a status field linked to reconciliation later
    // @Column({ type: 'nvarchar', length: 30, nullable: true, default: 'PendingReconciliation' })
    // reconciliationStatus?: string;

    @CreateDateColumn({ type: 'datetime2', default: () => 'GETDATE()' })
    createdAt!: Date;

    @UpdateDateColumn({ type: 'datetime2', default: () => 'GETDATE()', onUpdate: 'GETDATE()' })
    updatedAt!: Date;
}